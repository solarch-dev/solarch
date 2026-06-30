import type { AuthContext } from "./auth.types";

/** Project access rule:
 *  - When org context is active (auth.orgId set): project must belong to that org.
 *  - In personal context: project must belong to caller and not be org-owned. */
export function hasProjectAccess(
  project: { ownerId: string; orgId: string | null },
  auth: AuthContext,
): boolean {
  if (auth.orgId) return project.orgId === auth.orgId;
  return project.ownerId === auth.userId && project.orgId == null;
}

/** Ownership stamped on new projects. */
export function ownershipFor(auth: AuthContext): { ownerId: string; orgId: string | null } {
  return { ownerId: auth.userId, orgId: auth.orgId };
}

/** Scope filter for list(). */
export function projectScope(auth: AuthContext): { userId: string; orgId: string | null } {
  return { userId: auth.userId, orgId: auth.orgId };
}
