/** Node hover preview line generator — short summary by type.
 *  HoverCard shows a single line like "5 columns · PK: id". */

import type { SceneNode } from "./types";

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function previewLine(node: SceneNode): string {
  const props = node.properties ?? {};
  switch (node.type) {
    case "Table": {
      const cols = asArray(props.Columns);
      const pk = cols
        .filter((c) => (c as { IsPrimaryKey?: boolean }).IsPrimaryKey)
        .map((c) => asString((c as { Name?: string }).Name))
        .filter(Boolean);
      return `${cols.length} column${cols.length !== 1 ? "s" : ""}${pk.length ? ` · PK: ${pk.join(", ")}` : ""}`;
    }
    case "Service": {
      const methods = asArray(props.Methods);
      const tx = props.IsTransactionScoped ? " · transactional" : "";
      return `${methods.length} method${tx}`;
    }
    case "Controller": {
      const endpoints = asArray(props.Endpoints);
      const base = asString(props.BaseRoute);
      return `${endpoints.length} endpoint${base ? ` · ${base}` : ""}`;
    }
    case "DTO": {
      const fields = asArray(props.Fields);
      const req = fields.filter((f) => (f as { IsRequired?: boolean }).IsRequired).length;
      return `${fields.length} field · ${req} required`;
    }
    case "Worker": {
      const sched = asString(props.Schedule);
      const retry = (props.RetryPolicy as { Strategy?: string } | undefined)?.Strategy;
      return `cron: ${sched || "—"}${retry ? ` · retry: ${retry}` : ""}`;
    }
    case "Repository": {
      const ref = asString(props.EntityReference);
      return ref ? `entity: ${ref}` : "repository";
    }
    case "Cache": {
      const ttl = props.TTL_Seconds;
      const engine = asString(props.Engine);
      return `${engine || "cache"}${typeof ttl === "number" ? ` · TTL ${ttl}s` : ""}`;
    }
    case "MessageQueue": {
      const type = asString(props.Type);
      const provider = asString(props.Provider);
      return `${type || "queue"}${provider ? ` · ${provider}` : ""}`;
    }
    case "ExternalService": {
      const url = asString(props.BaseURL);
      return url || "external service";
    }
    case "Enum": {
      const values = asArray(props.Values);
      return `${values.length} value${values.length !== 1 ? "s" : ""}`;
    }
    case "Model": {
      const props2 = asArray(props.Properties);
      const methods = asArray(props.Methods);
      return `${props2.length} property · ${methods.length} method`;
    }
    case "Middleware": {
      const type = asString(props.MiddlewareType);
      return type || "middleware";
    }
    case "EnvironmentVariable": {
      const key = asString(props.Key);
      const type = asString(props.DataType);
      return `${key}${type ? ` : ${type}` : ""}`;
    }
    case "Exception": {
      const code = props.HttpStatusCode;
      const sev = asString(props.LogSeverity);
      return `${typeof code === "number" ? `HTTP ${code}` : ""}${sev ? ` · ${sev}` : ""}`.trim() || "exception";
    }
    default:
      return "";
  }
}
