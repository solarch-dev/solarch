#!/usr/bin/env bash
# Reset local Neo4j data (password mismatch / fresh start). Deletes all local projects.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=scripts/install-ui.sh
source "$ROOT/scripts/install-ui.sh"

render_install_banner "reset"
echo
ui_warn "This wipes the Neo4j Docker volume (all local Solarch projects)."
ui_warn "Use when NEO4J_PASSWORD changed after the first docker compose up."
echo
read -r -p "$(muted 'Continue? [y/N] ')" ans
case "${ans:-N}" in
  y|Y) ;;
  *) muted "Cancelled."; exit 0 ;;
esac

ui_ok "Stopping stack and removing Neo4j volume…"
docker_compose_clean down -v 2>/dev/null || env -u SOLARCH_BASIC_AUTH_USER -u SOLARCH_BASIC_AUTH_HASH docker compose down -v
ui_ok "Done. Start again: ./scripts/solarch-compose.sh up --build"
