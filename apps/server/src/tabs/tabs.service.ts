import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { TabsRepository } from "./tabs.repository";
import type { StoredTab, TabGraph, CreateTabInput, UpdateTabInput } from "./schemas/tab.schema";

@Injectable()
export class TabsService {
  constructor(private readonly repo: TabsRepository) {}

  /** Project default ("Main Architecture") tab — creates if missing (idempotent). */
  async ensureDefault(projectId: string): Promise<StoredTab> {
    const existing = await this.repo.findDefault(projectId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const tab: StoredTab = {
      id: randomUUID(), projectId, name: "Main Architecture",
      isDefault: true, order: 0, createdAt: now, updatedAt: now,
    };
    await this.repo.create(tab);
    return tab;
  }

  async create(projectId: string, input: CreateTabInput): Promise<StoredTab> {
    await this.assertProject(projectId);
    const order = (await this.repo.maxOrder(projectId)) + 1;
    const now = new Date().toISOString();
    const tab: StoredTab = {
      id: randomUUID(), projectId, name: input.name,
      isDefault: false, order, moduleNodeId: input.moduleNodeId,
      createdAt: now, updatedAt: now,
    };
    await this.repo.create(tab);
    return tab;
  }

  async list(projectId: string): Promise<StoredTab[]> {
    await this.assertProject(projectId);
    return this.repo.list(projectId);
  }

  async getById(projectId: string, tabId: string): Promise<StoredTab> {
    const tab = await this.repo.getById(projectId, tabId);
    if (!tab) throw this.tabNotFound(tabId);
    return tab;
  }

  async update(projectId: string, tabId: string, input: UpdateTabInput): Promise<StoredTab> {
    const updated = await this.repo.update(projectId, tabId, { ...input, updatedAt: new Date().toISOString() });
    if (!updated) throw this.tabNotFound(tabId);
    return updated;
  }

  async delete(projectId: string, tabId: string): Promise<void> {
    const tab = await this.getById(projectId, tabId);
    if (tab.isDefault) {
      throw new BadRequestException({
        code: "ERR_TAB_DEFAULT_DELETE",
        message: "The default 'Main Architecture' tab cannot be deleted.",
      });
    }
    const def = await this.repo.findDefault(projectId);
    if (!def) throw this.tabNotFound("default");
    await this.repo.deleteAndReassign(projectId, tabId, def.id);
  }

  async tabGraph(projectId: string, tabId: string): Promise<TabGraph> {
    const tab = await this.getById(projectId, tabId);
    return this.repo.tabGraph(projectId, tab);
  }

  async addReference(projectId: string, tabId: string, nodeId: string, x: number, y: number): Promise<void> {
    const tab = await this.getById(projectId, tabId);
    if (!(await this.repo.nodeExists(projectId, nodeId))) {
      throw new NotFoundException({ code: "ERR_NODE_NOT_FOUND", message: `Node '${nodeId}' not found.` });
    }
    // Adding a node as reference on its own home tab is meaningless.
    const homeTabId = await this.repo.nodeHomeTab(projectId, nodeId);
    if (homeTabId === tab.id) {
      throw new BadRequestException({
        code: "ERR_TAB_SELF_REFERENCE",
        message: "Node already owns this tab; a reference cannot be added.",
      });
    }
    await this.repo.upsertReference(projectId, tab.id, nodeId, x, y);
  }

  async removeReference(projectId: string, tabId: string, nodeId: string): Promise<void> {
    await this.getById(projectId, tabId);
    if (!(await this.repo.removeReference(projectId, tabId, nodeId))) {
      throw new NotFoundException({ code: "ERR_REFERENCE_NOT_FOUND", message: `Reference not found.` });
    }
  }

  async saveLayout(projectId: string, tabId: string, items: { nodeId: string; x: number; y: number }[]): Promise<void> {
    await this.getById(projectId, tabId);
    await this.repo.saveLayout(projectId, tabId, items);
  }

  private async assertProject(projectId: string): Promise<void> {
    if (!(await this.repo.projectExists(projectId))) {
      throw new NotFoundException({ code: "ERR_PROJECT_NOT_FOUND", message: `Project '${projectId}' not found.` });
    }
  }

  private tabNotFound(tabId: string): NotFoundException {
    return new NotFoundException({ code: "ERR_TAB_NOT_FOUND", message: `Tab '${tabId}' not found.` });
  }
}
