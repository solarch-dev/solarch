import { BadRequestException } from "@nestjs/common";
import type { NodeKind } from "./schemas";

/** Only node type that can hold secrets. */
const SECRET_NODE_KIND = "EnvironmentVariable";

function holdsPlaintextSecret(properties: Record<string, unknown> | undefined): boolean {
  if (!properties) return false;
  const dv = properties.DefaultValue;
  return properties.IsSecret === true && typeof dv === "string" && dv.trim().length > 0;
}

/** Write guard: prevents storing plain-text `DefaultValue` (actual secret) on
 *  EnvironmentVariable with `IsSecret=true`. All write paths (HTTP create/update +
 *  AI create_node) reach here via NodesService. */
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

/** Read guard: never return secret EnvironmentVariable `DefaultValue` to API/AI/codegen
 *  (legacy data may remain from before the write guard). Returns a new object; input is not mutated. */
export function redactNodeSecrets(
  type: NodeKind | string,
  properties: Record<string, unknown>,
): Record<string, unknown> {
  if (type !== SECRET_NODE_KIND || !holdsPlaintextSecret(properties)) return properties;
  return { ...properties, DefaultValue: "" };
}
