CREATE CONSTRAINT node_id_unique IF NOT EXISTS
  FOR (n:Node) REQUIRE n.id IS UNIQUE;

CREATE INDEX node_project_idx IF NOT EXISTS
  FOR (n:Node) ON (n.projectId);

CREATE CONSTRAINT project_id_unique IF NOT EXISTS
  FOR (p:Project) REQUIRE p.id IS UNIQUE;
