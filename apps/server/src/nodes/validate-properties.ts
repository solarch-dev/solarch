import { BadRequestException } from "@nestjs/common";
import { PROPERTIES_SCHEMA_BY_KIND, type NodeKind } from "./schemas";

/** Validates a node's properties with the kind-specific Zod schema and returns the **parsed**
 *  object (defaults applied, extras rejected).
 *
 *  All write paths go through here: HTTP PATCH (update) + AI create_node. Invalid
 *  input is rejected with `ERR_SCHEMA_INVALID` + field-level `details`; the AI agent
 *  loop reads this body and self-corrects (ReAct). */
export function validateNodeProperties(
  kind: NodeKind | string,
  properties: unknown,
): Record<string, unknown> {
  const schema = PROPERTIES_SCHEMA_BY_KIND[kind as NodeKind];
  if (!schema) {
    throw new BadRequestException({
      code: "ERR_UNKNOWN_KIND",
      message: `Unknown node type: '${kind}'.`,
    });
  }
  const result = schema.safeParse(properties);
  if (!result.success) {
    throw new BadRequestException({
      code: "ERR_SCHEMA_INVALID",
      message: `The properties of the '${kind}' node do not match the schema.`,
      details: result.error.issues.map((i) => ({
        field: i.path.join(".") || "(root)",
        message: i.message,
      })),
    });
  }
  return result.data as Record<string, unknown>;
}
