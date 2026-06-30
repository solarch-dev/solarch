-- Graf seviyesi revizyon sayacı (Solarch 2.0 Faz 2) — her yapısal mutasyonda
-- (node/edge create-update-delete, graph/apply) +1. CLI push çatışma tespiti
-- bu sayaca dayanır. Mevcut projelere 0 backfill.

MATCH (p:Project) WHERE p.graphRevision IS NULL SET p.graphRevision = 0;
