#!/usr/bin/env bash
# docker compose wrapper — ignores shell-exported SOLARCH_BASIC_AUTH_* that override .env.
set -euo pipefail
cd "$(dirname "$0")/.."
exec env -u SOLARCH_BASIC_AUTH_USER -u SOLARCH_BASIC_AUTH_HASH docker compose "$@"
