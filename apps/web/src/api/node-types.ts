import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "./client";

export interface FieldHint {
  badge?: string;
  group?: string;
  /** Value-set registry id (e.g. 'http-methods', 'parameter-types').
   *  Frontend opens a Select widget — fetched from /value-sets/:id. */
  valueSet?: string;
  /** Node reference within the project — frontend opens NodeRefCombobox.
   *  If edgeKind is present: source → target edge is auto-created after selection/create. */
  nodeRef?: {
    type: string;
    edgeKind?: string;
  };
}

export interface NodeTypeDetail {
  id: string;
  family: string;
  familyLabel: string;
  description: string;
  nameKey: string;
  schema: unknown; // JSON Schema (OpenAPI export)
  fieldHints: Record<string, FieldHint>; // dotted path → group/badge metadata
}

/** Full detail of a single node type — Zod → JSON Schema + fieldHints. For Inspector. */
export function useNodeType(id: string | null) {
  return useQuery({
    queryKey: ["node-type", id],
    enabled: !!id,
    staleTime: Infinity, // node type schema does not change at runtime
    queryFn: async () =>
      unwrap<NodeTypeDetail>(
        await api.GET("/api/v1/node-types/{typeId}", {
          params: { path: { typeId: id! } },
        }),
      ),
  });
}
