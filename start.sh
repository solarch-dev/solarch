#!/usr/bin/env bash
# Start Solarch (Docker). First time? Run ./install.sh instead.
#
#   ./start.sh          # foreground (logs in terminal)
#   ./start.sh -d       # background
#   ./start.sh --build  # rebuild images then start
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
INSTALL_ROOT="$ROOT"
# shellcheck source=scripts/install-ui.sh
source "$ROOT/scripts/install-ui.sh"

DETACH=""
EXTRA=()

usage() {
  cat <<EOF
$(brand "solarch start") $(muted "— run the local stack")

  $(muted "Usage:")  ./start.sh [options]

  $(muted "Options:")
    -d, --detach    Run in background
    --build         Rebuild images before start
    -h, --help      Show this help

  $(muted "First time:")     ./install.sh
  $(muted "Stop:")           ./scripts/solarch-compose.sh down
  $(muted "Open:")           http://localhost:3000
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -d|--detach) DETACH="-d"; shift ;;
    --build) EXTRA+=(--build); shift ;;
    -h|--help) usage; exit 0 ;;
    *) ui_fail "Unknown option: $1"; usage >&2; exit 1 ;;
  esac
done

if ! env_is_complete .env 2>/dev/null; then
  if [ ! -f .env ]; then
    ui_fail "No .env yet — run ./install.sh first."
  else
    ui_fail ".env is incomplete or invalid — run ./install.sh"
  fi
  exit 1
fi

if ! preflight_docker; then exit 1; fi

if install_stack_running; then
  ui_ok "Already running → http://localhost:3000"
  muted "  Logs: ./scripts/solarch-compose.sh logs -f"
  exit 0
fi

ui_ok "Starting Solarch…"
exec "${INSTALL_ROOT}/scripts/solarch-compose.sh" up "${EXTRA[@]}" $DETACH
