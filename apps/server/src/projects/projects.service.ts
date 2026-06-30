import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ProjectsRepository, type StoredProject } from "./projects.repository";
import { TabsService } from "../tabs/tabs.service";
import { hasProjectAccess, ownershipFor, projectScope } from "../auth/access";
import type { AuthContext } from "../auth/auth.types";
import type { CreateProjectInput } from "./dto/create-project.dto";
import type { UpdateProjectInput } from "./dto/update-project.dto";
import type {
  ProjectWithCounts,
  ProjectGraph,
} from "./dto/project-response.dto";

@Injectable()
export class ProjectsService {
  constructor(
    private readonly repo: ProjectsRepository,
    private readonly tabs: TabsService,
  ) {}

  async create(input: CreateProjectInput, auth: AuthContext): Promise<ProjectWithCounts> {
    const now = new Date().toISOString();
    const stored: StoredProject = {
      id: randomUUID(),
      name: input.name,
      description: input.description,
      status: input.status,
      ...ownershipFor(auth),
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.create(stored);
    // Auto-create default "Main Architecture" tab for each project.
    await this.tabs.ensureDefault(stored.id);
    return { ...stored, counts: { nodes: 0, edges: 0 } };
  }

  async getById(id: string, auth: AuthContext): Promise<ProjectWithCounts> {
    const project = await this.assertAccess(id, auth);
    const counts = await this.repo.counts(id);
    return { ...project, counts };
  }

  async list(auth: AuthContext): Promise<ProjectWithCounts[]> {
    const projects = await this.repo.list(projectScope(auth));
    const out: ProjectWithCounts[] = [];
    for (const p of projects) {
      const counts = await this.repo.counts(p.id);
      out.push({ ...p, counts });
    }
    return out;
  }

  async update(id: string, input: UpdateProjectInput, auth: AuthContext): Promise<ProjectWithCounts> {
    await this.assertAccess(id, auth);
    const updatedAt = new Date().toISOString();
    const updated = await this.repo.update(id, { ...input, updatedAt });
    if (!updated) throw this.notFound(id);
    const counts = await this.repo.counts(id);
    return { ...updated, counts };
  }

  async delete(id: string, auth: AuthContext): Promise<void> {
    await this.assertAccess(id, auth);
    const deleted = await this.repo.delete(id);
    if (!deleted) throw this.notFound(id);
  }

  /** Implementation report — writes counters onto nodes (Phase B: canvas badges). */
  async reportImplementation(
    id: string,
    entries: { nodeId: string; total: number; filled: number; filledAi: number }[],
    auth: AuthContext,
  ): Promise<{ updated: number }> {
    await this.assertAccess(id, auth);
    if (entries.length === 0) return { updated: 0 };
    const updated = await this.repo.setImplementation(id, entries);
    return { updated };
  }

  async getGraph(id: string, auth: AuthContext): Promise<ProjectGraph> {
    const project = await this.assertAccess(id, auth);
    const { nodes, edges } = await this.repo.getGraph(id);
    const graphRevision = await this.repo.getGraphRevision(id);
    return {
      project,
      nodes,
      edges,
      counts: { nodes: nodes.length, edges: edges.length },
      graphRevision,
    };
  }

  /** Loads project; throws if missing OR caller lacks access. Returns 403 when
   *  access is denied (404 only when the project truly does not exist). */
  private async assertAccess(id: string, auth: AuthContext): Promise<StoredProject> {
    const project = await this.repo.getById(id);
    if (!project) throw this.notFound(id);
    if (!hasProjectAccess(project, auth)) {
      throw new ForbiddenException({
        code: "ERR_PROJECT_FORBIDDEN",
        message: "You do not have access to this project.",
      });
    }
    return project;
  }

  private notFound(id: string): NotFoundException {
    return new NotFoundException({
      code: "ERR_PROJECT_NOT_FOUND",
      message: `Project '${id}' not found.`,
    });
  }
}
