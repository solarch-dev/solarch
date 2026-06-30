import type { OpenAPIObject } from "@nestjs/swagger";
import { propsOf, type CodeGraph } from "./ir";
import { pascalCase } from "./naming";

/* ────────────────────────────────────────────────────────────────────────
 * openapi.emitter.ts — deterministic graph -> OpenAPI 3.1 projection.
 *
 * Mirrors simple-projection.ts: a pure, verified projection of the CodeGraph.
 * No throws (the graph may be partial) and no AI here — structure is derived
 * solely from Controller nodes (paths/operations) and, in Task 2, DTO/Enum
 * nodes (component schemas). AI enrichment (prose/examples) lands later and
 * only annotates EXISTING operations/schemas; it never invents paths.
 * ──────────────────────────────────────────────────────────────────────── */

/** Convert a Nest-style path (BaseRoute + Route, ":id") to an OpenAPI path ("{id}"). */
function fullPath(base: string, route: string): string {
  const join = `${base ?? ""}/${route ?? ""}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  return join.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

export function projectOpenApi(graph: CodeGraph): OpenAPIObject {
  const paths: Record<string, Record<string, unknown>> = {};
  const tags: { name: string; description?: string }[] = [];

  for (const ctrl of graph.allOf("Controller")) {
    const p = propsOf<"Controller">(ctrl);
    tags.push({ name: ctrl.name, description: p.Description });
    for (const ep of p.Endpoints ?? []) {
      const path = fullPath(p.BaseRoute, ep.Route);
      const method = ep.HttpMethod.toLowerCase();
      const parameters = [
        ...(ep.PathParams ?? []).map((pp) => ({ name: pp.Name, in: "path", required: true, schema: { type: "string" } })),
        ...(ep.QueryParams ?? []).map((qp) => ({ name: qp.Name, in: "query", required: false, schema: { type: "string" } })),
      ];
      const responses: Record<string, unknown> = {};
      const codes = (ep.StatusCodes ?? []).length ? ep.StatusCodes! : [{ Code: ep.HttpMethod === "POST" ? 201 : 200, Description: "OK" }];
      for (const sc of codes) {
        responses[String(sc.Code)] = {
          description: sc.Description ?? "Response",
          ...(ep.ResponseDTORef && sc.Code < 400
            ? { content: { "application/json": { schema: ep.ReturnsCollection
                ? { type: "array", items: { $ref: `#/components/schemas/${pascalCase(ep.ResponseDTORef)}` } }
                : { $ref: `#/components/schemas/${pascalCase(ep.ResponseDTORef)}` } } } }
            : {}),
        };
      }
      const op: Record<string, unknown> = {
        operationId: `${ctrl.name}_${method}_${path}`.replace(/[^A-Za-z0-9]+/g, "_"),
        tags: [ctrl.name],
        summary: ep.Description ?? `${ep.HttpMethod} ${path}`,
        parameters,
        responses,
        ...(ep.RequiresAuth ? { security: [{ bearer: [] }] } : {}),
        ...(ep.RequestDTORef ? { requestBody: { required: true, content: { "application/json": { schema: { $ref: `#/components/schemas/${pascalCase(ep.RequestDTORef)}` } } } } } : {}),
      };
      (paths[path] ??= {})[method] = op;
    }
  }

  // ── components.schemas: a JSON Schema per DTO/Enum ───────────────────────
  // Each DTO field maps to a property: DataType -> type, IsArray -> array,
  // IsRequired -> required[], ValidationRules -> min/max/format/pattern,
  // EnumRef/NestedDTORef -> $ref. Enums become string enum schemas. No throws —
  // unresolved refs fall back to the raw name (the graph may be partial).
  const schemas: Record<string, unknown> = {};
  const DT: Record<string, { type: string; format?: string }> = {
    string: { type: "string" }, int: { type: "integer" }, integer: { type: "integer" },
    number: { type: "number" }, float: { type: "number" }, boolean: { type: "boolean" },
    bool: { type: "boolean" }, date: { type: "string", format: "date-time" },
    datetime: { type: "string", format: "date-time" }, uuid: { type: "string", format: "uuid" },
  };
  const ruleToSchema = (rule: string, value?: string): Record<string, unknown> => {
    switch (rule) {
      case "Min": return { minimum: Number(value) }; case "Max": return { maximum: Number(value) };
      case "MinLength": return { minLength: Number(value) }; case "MaxLength": return { maxLength: Number(value) };
      case "Email": return { format: "email" }; case "Url": return { format: "uri" };
      case "Regex": case "Pattern": return value ? { pattern: value } : {}; default: return {};
    }
  };
  for (const dto of graph.allOf("DTO")) {
    const dp = propsOf<"DTO">(dto);
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const f of dp.Fields ?? []) {
      let schema: Record<string, unknown>;
      if (f.EnumRef) { const e = graph.resolveRef("Enum", f.EnumRef); schema = { $ref: `#/components/schemas/${pascalCase(e ? e.name : f.EnumRef)}` }; }
      else if (f.NestedDTORef) { const n = graph.resolveRef("DTO", f.NestedDTORef); schema = { $ref: `#/components/schemas/${pascalCase(n ? n.name : f.NestedDTORef)}` }; }
      else { schema = { ...(DT[f.DataType.toLowerCase()] ?? { type: "string" }) }; for (const r of f.ValidationRules ?? []) Object.assign(schema, ruleToSchema(r.Rule, r.Value)); }
      properties[f.Name] = f.IsArray ? { type: "array", items: schema } : schema;
      if (f.IsRequired) required.push(f.Name);
      if (f.Description) (properties[f.Name] as Record<string, unknown>).description = f.Description;
    }
    schemas[pascalCase(dto.name)] = { type: "object", properties, ...(required.length ? { required } : {}), ...(dp.Description ? { description: dp.Description } : {}) };
  }
  for (const en of graph.allOf("Enum")) {
    const ep = propsOf<"Enum">(en);
    schemas[pascalCase(en.name)] = { type: "string", enum: (ep.Values ?? []).map((v) => v.Value ?? v.Key) };
  }
  // (Models: emit as object schemas the same way if referenced; DTOs cover the
  //  API surface for v1.)

  return {
    openapi: "3.1.0",
    info: { title: "API", version: "1.0.0" },
    tags,
    paths: paths as OpenAPIObject["paths"],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      schemas: schemas as NonNullable<OpenAPIObject["components"]>["schemas"],
    },
  };
}
