import { BadRequestException } from "@nestjs/common";
import type { NodeKind } from "./schemas";

/** Secret taşıyabilen tek node tipi. */
const SECRET_NODE_KIND = "EnvironmentVariable";

function holdsPlaintextSecret(properties: Record<string, unknown> | undefined): boolean {
  if (!properties) return false;
  const dv = properties.DefaultValue;
  return properties.IsSecret === true && typeof dv === "string" && dv.trim().length > 0;
}

/** Yazım koruması: `IsSecret=true` olan EnvironmentVariable'da düz-metin
 *  `DefaultValue` (gerçek secret) saklanmasını engeller. Tüm yazım yolları
 *  (HTTP create/update + AI create_node) NodesService üzerinden buraya uğrar. */
export function assertNoPlaintextSecret(
  type: NodeKind | string,
  properties: Record<string, unknown> | undefined,
): void {
  if (type !== SECRET_NODE_KIND) return;
  if (holdsPlaintextSecret(properties)) {
    throw new BadRequestException({
      code: "ERR_SECRET_PLAINTEXT",
      message:
        "When IsSecret=true, DefaultValue (plain-text secret) cannot be stored. " +
        "Keep the secret value in a secret manager / env binding; in the node, enter only Key and Description.",
    });
  }
}

/** Okuma koruması: secret EnvironmentVariable'ın `DefaultValue`'sini API/AI/codegen'e
 *  hiç döndürme (yazım guard'ından önce yazılmış legacy veride kalmış olabilir).
 *  Yeni nesne döner; girdi mutate edilmez. */
export function redactNodeSecrets(
  type: NodeKind | string,
  properties: Record<string, unknown>,
): Record<string, unknown> {
  if (type !== SECRET_NODE_KIND || !holdsPlaintextSecret(properties)) return properties;
  return { ...properties, DefaultValue: "" };
}
