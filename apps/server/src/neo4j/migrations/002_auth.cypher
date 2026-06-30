-- Multi-tenancy — indexes for Project ownership fields.
-- Users are not stored in Neo4j; ownerId/orgId are opaque strings from auth context.

CREATE INDEX project_owner_idx IF NOT EXISTS
  FOR (p:Project) ON (p.ownerId);

CREATE INDEX project_org_idx IF NOT EXISTS
  FOR (p:Project) ON (p.orgId);
