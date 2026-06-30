import { BadRequestException } from "@nestjs/common";
import { PROPERTIES_SCHEMA_BY_KIND, type NodeKind } from "./schemas";

/** Bir node'un properties'ini kind'a özel Zod şemasıyla doğrular ve **parse
 *  edilmiş** (default'lar uygulanmış, fazlalıklar reddedilmiş) nesneyi döner.
 *
 *  Tüm yazım yolları buraya uğrar: HTTP PATCH (update) + AI create_node. Geçersiz
 *  girdi `ERR_SCHEMA_INVALID` + alan bazlı `details` ile reddedilir; AI agent
 *  loop'u bu gövdeyi okuyup kendini düzeltir (ReAct). */
export function validateNodeProperties(
  kind: NodeKind | string,
  properties: unknown,
): Record<string, unknown> {
  const schema = PROPERTIES_SCHEMA_BY_KIND[kind as NodeKind];
  if (!schema) {
    throw new BadRequestException({
      code: "ERR_UNKNOWN_KIND",
      message: `Bilinmeyen node tipi: '${kind}'.`,
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
