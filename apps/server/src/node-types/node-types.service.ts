import { Injectable, NotFoundException } from "@nestjs/common";
import { zodV3ToOpenAPI } from "nestjs-zod";
import { NODE_TYPE_REGISTRY, type NodeTypeMetadata, type FieldHint } from "./registry";
import type { NodeKind } from "../nodes/schemas";
import { RulesEngine } from "../rules/rules.engine";

export interface NodeTypeSummary {
  id: NodeKind;
  family: string;
  familyLabel: string;
  description: string;
  nameKey: string;
}

export interface NodeTypeDetail extends NodeTypeSummary {
  schema: unknown; // OpenAPI/JSON Schema export
  fieldHints: Record<string, FieldHint>; // UI inspector rozet/grup metadata
}

export interface NodeTypeRules {
  id: NodeKind;
  allowAsSource: Array<unknown>;
  allowAsTarget: Array<unknown>;
  denyAsSource: Array<unknown>;
  denyAsTarget: Array<unknown>;
}

@Injectable()
export class NodeTypesService {
  constructor(private readonly rulesEngine: RulesEngine) {}

  listAll(): NodeTypeSummary[] {
    return Object.values(NODE_TYPE_REGISTRY).map((m) => this.toSummary(m));
  }

  getById(id: string): NodeTypeDetail {
    const meta = this.find(id);
    return {
      ...this.toSummary(meta),
      // zodV3ToOpenAPI recursive type sig stresses TS compiler — OK at runtime
      schema: zodV3ToOpenAPI(meta.schema as any),
      fieldHints: meta.fieldHints ?? {},
    };
  }

  getRulesById(id: string): NodeTypeRules {
    const meta = this.find(id);
    const r = this.rulesEngine.rulesForNodeKind(meta.id);
    return {
      id: meta.id,
      allowAsSource: r.allowAsSource,
      allowAsTarget: r.allowAsTarget,
      denyAsSource: r.denyAsSource,
      denyAsTarget: r.denyAsTarget,
    };
  }

  private find(id: string): NodeTypeMetadata {
    const meta = NODE_TYPE_REGISTRY[id as NodeKind];
    if (!meta) {
      throw new NotFoundException({
        code: "ERR_NODE_TYPE_NOT_FOUND",
        message: `Node tipi '${id}' bilinmiyor. Mevcut tipler: ${Object.keys(NODE_TYPE_REGISTRY).join(", ")}.`,
      });
    }
    return meta;
  }

  private toSummary(m: NodeTypeMetadata): NodeTypeSummary {
    return {
      id: m.id,
      family: m.family,
      familyLabel: m.familyLabel,
      description: m.description,
      nameKey: m.nameKey,
    };
  }
}
