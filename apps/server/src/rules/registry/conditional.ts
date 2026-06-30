import type { ConditionalRuleDescriptor } from "../types";

/* Plans/Kurallar Matrisi — Bölüm 3 (Conditional).
 * Whitelist match olsa bile çalışan derin (graph + cross-field) kontroller. */
export const CONDITIONAL_RULES: ConditionalRuleDescriptor[] = [
  {
    code: "ERR_COND_001",
    type: "CIRCULAR_DEPENDENCY",
    severity: "error",
    description:
      "When Service_A → CALLS → Service_B exists, a Service_B → CALLS → Service_A connection cannot be created (infinite loop).",
    appliesWhen: "Graph traversal is performed when both source and target are of type Service and the edge is CALLS.",
  },
  {
    code: "ERR_COND_002",
    type: "TYPE_MISMATCH",
    severity: "error",
    description:
      "When, in Controller → CALLS → Service, the Controller's RequestDTORef does not match the Service's parameter types.",
    appliesWhen: "Source Controller, target Service, edge CALLS. Controller.Endpoints[].RequestDTORef and Service.Methods[].Parameters[].Type/DtoRef are compared.",
  },
  {
    code: "WARN_COND_001",
    type: "EMPTY_SCHEMA",
    severity: "warning",
    description:
      "In Repository → QUERIES → Table, a warning is raised if the target Table's Columns are empty (the edge is still created).",
    appliesWhen: "Edge kind QUERIES, target Table, properties.Columns array is empty.",
  },
];
