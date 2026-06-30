import { Injectable, NotFoundException } from "@nestjs/common";
import { EDGE_TYPE_REGISTRY, type EdgeTypeMetadata } from "./registry";
import type { EdgeKind } from "../edges/schemas/edge.schema";
import { RulesEngine } from "../rules/rules.engine";

export interface EdgeTypeSummary {
  id: EdgeKind;
  family: string;
  familyLabel: string;
  description: string;
  exampleSource: string;
  exampleTarget: string;
  directionNote: string;
}

export interface EdgeTypeRules {
  id: EdgeKind;
  allow: Array<unknown>;
  deny: Array<unknown>;
}

@Injectable()
export class EdgeTypesService {
  constructor(private readonly rulesEngine: RulesEngine) {}

  listAll(): EdgeTypeSummary[] {
    return Object.values(EDGE_TYPE_REGISTRY).map((m) => this.toSummary(m));
  }

  getById(id: string): EdgeTypeSummary {
    return this.toSummary(this.find(id));
  }

  getRulesById(id: string): EdgeTypeRules {
    const m = this.find(id);
    const r = this.rulesEngine.rulesForEdgeKind(m.id);
    return {
      id: m.id,
      allow: r.allow,
      deny: r.deny,
    };
  }

  private find(id: string): EdgeTypeMetadata {
    const meta = EDGE_TYPE_REGISTRY[id as EdgeKind];
    if (!meta) {
      throw new NotFoundException({
        code: "ERR_EDGE_TYPE_NOT_FOUND",
        message: `Edge tipi '${id}' bilinmiyor. Mevcut: ${Object.keys(EDGE_TYPE_REGISTRY).join(", ")}.`,
      });
    }
    return meta;
  }

  private toSummary(m: EdgeTypeMetadata): EdgeTypeSummary {
    return {
      id: m.id,
      family: m.family,
      familyLabel: m.familyLabel,
      description: m.description,
      exampleSource: m.exampleSource,
      exampleTarget: m.exampleTarget,
      directionNote: m.directionNote,
    };
  }
}
