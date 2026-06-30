// Optimistic concurrency: mevcut tum node'lara baslangic version'u (idempotent).
// NOT: yorum '//' ile (Neo4j inline comment); '--' kullanma — runner '--' ile
// baslayan statement chunk'ini atlar, backfill calismadan gecer.
MATCH (n:Node) WHERE n.version IS NULL SET n.version = 1;
