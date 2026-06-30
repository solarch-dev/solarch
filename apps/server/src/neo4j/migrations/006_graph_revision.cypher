-- Graph-level revision counter (Solarch 2.0 Phase 2) — incremented on each structural
-- mutation (node/edge create-update-delete, graph/apply). CLI push conflict detection
-- relies on this counter. Backfill existing projects to 0.

MATCH (p:Project) WHERE p.graphRevision IS NULL SET p.graphRevision = 0;
