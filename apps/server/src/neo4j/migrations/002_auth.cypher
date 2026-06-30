-- Çok-kiracılık (Clerk) — Project sahiplik alanları için index'ler.
-- Kullanıcılar Neo4j'de tutulmaz; ownerId/orgId Clerk JWT'sinden gelen string'lerdir.

CREATE INDEX project_owner_idx IF NOT EXISTS
  FOR (p:Project) ON (p.ownerId);

CREATE INDEX project_org_idx IF NOT EXISTS
  FOR (p:Project) ON (p.orgId);
