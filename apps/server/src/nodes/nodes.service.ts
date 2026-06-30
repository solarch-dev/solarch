import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Node, NodeKind } from "./schemas";
import { assertNoPlaintextSecret, redactNodeSecrets } from "./secret-redaction";
import { validateNodeProperties } from "./validate-properties";
import { NodesRepository, type StoredNode } from "./nodes.repository";
import { ProjectsRepository } from "../projects/projects.repository";
import { TabsService } from "../tabs/tabs.service";

type CreateInput = Omit<Node, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  homeTabId?: string;
};

export interface UpdateInput {
  position?: { x: number; y: number };
  properties?: Record<string, unknown>;
  type?: NodeKind;
  /** Optimistic concurrency — client's last seen version. Mismatch yields 409. */
  expectedVersion?: number;
}

@Injectable()
export class NodesService {
  constructor(
    private readonly repo: NodesRepository,
    private readonly projectsRepo: ProjectsRepository,
    private readonly tabs: TabsService,
  ) {}

  async create(urlProjectId: string, input: CreateInput): Promise<Node> {
    if (input.projectId !== urlProjectId) {
      throw new BadRequestException({
        code: "ERR_PROJECT_MISMATCH",
        message: "The projectId in the URL does not match the projectId in the body.",
      });
    }

    // Strict referential integrity — project must exist
    if (!(await this.projectsRepo.exists(urlProjectId))) {
      throw new NotFoundException({
        code: "ERR_PROJECT_NOT_FOUND",
        message: `Project '${urlProjectId}' not found. Create a project first via POST /api/v1/projects.`,
      });
    }

    // Kind-based schema validation (defaults applied, extras rejected).
    // HTTP DTO already does this; AI create_node calls this service directly,
    // so required here too -> invalid AI output self-corrects via ERR_SCHEMA_INVALID.
    const validatedProps = validateNodeProperties(input.type, input.properties);
    // Security: block storing plaintext secret values in env-var (all paths).
    assertNoPlaintextSecret(input.type, validatedProps);

    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    const createdAt = input.createdAt ?? now;
    const updatedAt = input.updatedAt ?? now;

    if (input.id) {
      const existing = await this.repo.getById(urlProjectId, input.id);
      if (existing) {
        throw new ConflictException({
          code: "ERR_ID_CONFLICT",
          message: `id '${input.id}' is already in use.`,
        });
      }
    }

    const nameKey = this.repo.findNameKey(input.type);
    const name = validatedProps[nameKey] as string | undefined;
    if (name) {
      const collision = await this.repo.findByName(urlProjectId, name);
      if (collision) {
        throw new ConflictException({
          code: "ERR_NAME_DUPLICATE",
          message: `The name '${name}' is already in use in this project.`,
        });
      }
    }

    const homeTabId = input.homeTabId ?? (await this.tabs.ensureDefault(urlProjectId)).id;

    const stored: StoredNode = {
      id,
      type: input.type,
      projectId: urlProjectId,
      positionX: input.position.x,
      positionY: input.position.y,
      homeTabId,
      createdAt,
      updatedAt,
      version: 1,
      properties: validatedProps,
    };
    await this.repo.create(stored);
    await this.projectsRepo.bumpRevision(urlProjectId);
    return this.toNode(stored);
  }

  async getById(projectId: string, id: string): Promise<Node> {
    const stored = await this.repo.getById(projectId, id);
    if (!stored) {
      throw new NotFoundException({
        code: "ERR_NODE_NOT_FOUND",
        message: `Node '${id}' not found.`,
      });
    }
    return this.toNode(stored);
  }

  async list(projectId: string, kind?: NodeKind): Promise<Node[]> {
    const stored = await this.repo.list(projectId, kind);
    return stored.map((s) => this.toNode(s));
  }

  async update(projectId: string, id: string, input: UpdateInput): Promise<Node> {
    if (input.type !== undefined) {
      throw new BadRequestException({
        code: "ERR_KIND_IMMUTABLE",
        message: "The node type cannot be changed.",
      });
    }
    const existing = await this.repo.getById(projectId, id);
    if (!existing) {
      throw new NotFoundException({
        code: "ERR_NODE_NOT_FOUND",
        message: `Node '${id}' not found.`,
      });
    }

    // Optimistic concurrency — early/clean error. (Actual guarantee is atomic in repo.)
    if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
      throw new ConflictException({
        code: "ERR_VERSION_CONFLICT",
        message: "This node was modified by someone else (human or AI) in the meantime. The latest version has been reloaded — please reapply your changes.",
        currentVersion: existing.version,
      });
    }

    if (input.properties) {
      // Kind-based schema validation — PATCH body arrives as z.record(unknown).
      // properties is replaced wholesale, so incoming FULL properties must be valid;
      // parsed + defaulted here; invalid/missing/extra fields rejected.
      input.properties = validateNodeProperties(existing.type, input.properties);
      // Security: must be secret-safe.
      assertNoPlaintextSecret(existing.type, input.properties);
      const nameKey = this.repo.findNameKey(existing.type);
      const newName = input.properties[nameKey] as string | undefined;
      const oldName = (existing.properties as Record<string, unknown>)[nameKey] as string | undefined;
      if (newName && newName !== oldName) {
        const collision = await this.repo.findByName(projectId, newName);
        if (collision && collision.id !== id) {
          throw new ConflictException({
            code: "ERR_NAME_DUPLICATE",
            message: `The name '${newName}' is already in use in this project.`,
          });
        }
      }
    }

    const updatedAt = new Date().toISOString();
    const updated = await this.repo.update(projectId, id, {
      positionX: input.position?.x,
      positionY: input.position?.y,
      properties: input.properties,
      updatedAt,
      expectedVersion: input.expectedVersion,
    });
    if (!updated) {
      // Atomic guard returned 0 rows. If expectedVersion was given + node still exists
      // -> another update slipped in (TOCTOU race) = version conflict; otherwise deleted.
      if (input.expectedVersion !== undefined) {
        const stillThere = await this.repo.getById(projectId, id);
        if (stillThere) {
          throw new ConflictException({
            code: "ERR_VERSION_CONFLICT",
            message: "This node was modified by someone else (human or AI) in the meantime. The latest version has been reloaded — please reapply your changes.",
            currentVersion: stillThere.version,
          });
        }
      }
      throw new NotFoundException({
        code: "ERR_NODE_NOT_FOUND",
        message: `Node '${id}' not found.`,
      });
    }
    // Structural change (properties) bumps revision; position-only moves do not
    // (avoids unnecessary push conflicts from drift).
    if (input.properties) await this.projectsRepo.bumpRevision(projectId);
    return this.toNode(updated);
  }

  async delete(projectId: string, id: string): Promise<void> {
    const deleted = await this.repo.delete(projectId, id);
    if (!deleted) {
      throw new NotFoundException({
        code: "ERR_NODE_NOT_FOUND",
        message: `Node '${id}' not found.`,
      });
    }
    await this.projectsRepo.bumpRevision(projectId);
  }

  /** Partial properties patch — shallow-merge over existing (RAW) properties,
   *  delegates to update() with fresh version (full schema validation + secret +
   *  name collision + revision bump happen there). Array fields (Columns/
   *  Endpoints/Methods/Fields) are REPLACED; caller must send the full array. */
  async applyPropertiesPatch(
    projectId: string,
    id: string,
    patch: Record<string, unknown>,
  ): Promise<Node> {
    const existing = await this.repo.getById(projectId, id);
    if (!existing) {
      throw new NotFoundException({
        code: "ERR_NODE_NOT_FOUND",
        message: `Node '${id}' not found.`,
      });
    }
    const merged = { ...(existing.properties as Record<string, unknown>), ...patch };
    return this.update(projectId, id, { properties: merged, expectedVersion: existing.version });
  }

  private toNode(s: StoredNode): Node {
    return {
      id: s.id,
      type: s.type,
      projectId: s.projectId,
      position: { x: s.positionX, y: s.positionY },
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      version: s.version,
      properties: redactNodeSecrets(s.type, s.properties),
    } as Node;
  }
}
