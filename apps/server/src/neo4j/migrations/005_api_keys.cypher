-- API anahtarları (CLI/MCP istemci kimliği) — anahtar düz metin saklanmaz,
-- yalnız SHA-256 hash. Hash lookup'ı ve kullanıcı listesi için index'ler.

CREATE CONSTRAINT api_key_id_unique IF NOT EXISTS
  FOR (k:ApiKey) REQUIRE k.id IS UNIQUE;

CREATE CONSTRAINT api_key_hash_unique IF NOT EXISTS
  FOR (k:ApiKey) REQUIRE k.hash IS UNIQUE;

CREATE INDEX api_key_user_idx IF NOT EXISTS
  FOR (k:ApiKey) ON (k.userId);
