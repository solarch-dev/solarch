#!/bin/sh
# Solarch server entrypoint: idempotently bootstrap the graph DB, then start the API.
# Neo4j readiness is guaranteed by the compose healthcheck (depends_on: service_healthy);
# every step is idempotent (schema uses IF NOT EXISTS, the seed uses MERGE), so a restart
# is safe. Each step is best-effort — a failure is logged but never blocks the server.
set -e
cd /app/apps/server
TSX="node_modules/.bin/tsx"

echo "[solarch] initializing graph database (idempotent) ..."
$TSX src/neo4j/migrations/run.ts || echo "[solarch] WARN: schema migration step failed"
$TSX src/neo4j/migrations/data/004-pattern-vector-index.ts || echo "[solarch] WARN: pattern vector index step failed"
$TSX src/patterns/seed/seed.ts || echo "[solarch] WARN: pattern seed step failed"

echo "[solarch] starting API on ${HOST:-0.0.0.0}:${PORT:-4000} ..."
exec node dist/main.js
