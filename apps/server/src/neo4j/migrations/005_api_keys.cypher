-- API keys (CLI/MCP client identity) — keys are not stored in plain text,
-- only SHA-256 hash. Indexes for hash lookup and per-user listing.

CREATE CONSTRAINT api_key_id_unique IF NOT EXISTS
  FOR (k:ApiKey) REQUIRE k.id IS UNIQUE;

CREATE CONSTRAINT api_key_hash_unique IF NOT EXISTS
  FOR (k:ApiKey) REQUIRE k.hash IS UNIQUE;

CREATE INDEX api_key_user_idx IF NOT EXISTS
  FOR (k:ApiKey) ON (k.userId);
