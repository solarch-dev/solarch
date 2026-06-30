import type { AuthContext } from "./auth.types";

/** Bir projeye erişim kuralı:
 *  - Org bağlamı aktifse (auth.orgId varsa): proje aynı org'a ait olmalı.
 *  - Kişisel bağlamda: proje çağıranın olmalı ve hiçbir org'a ait olmamalı. */
export function hasProjectAccess(
  project: { ownerId: string; orgId: string | null },
  auth: AuthContext,
): boolean {
  if (auth.orgId) return project.orgId === auth.orgId;
  return project.ownerId === auth.userId && project.orgId == null;
}

/** Yeni projeye damgalanacak sahiplik. */
export function ownershipFor(auth: AuthContext): { ownerId: string; orgId: string | null } {
  return { ownerId: auth.userId, orgId: auth.orgId };
}

/** list() için kapsam filtresi. */
export function projectScope(auth: AuthContext): { userId: string; orgId: string | null } {
  return { userId: auth.userId, orgId: auth.orgId };
}
