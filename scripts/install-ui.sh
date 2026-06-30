#!/usr/bin/env bash
# Shared branding + helpers for install.sh (Solarch CLI look & feel).
# Source only — not executed directly.

# Brand colors (match @solarch/cli brand.ts)
_BRAND=$'\033[38;2;253;106;9m'
_BRAND_DEEP=$'\033[38;2;255;87;0m'
_MUTED=$'\033[38;2;148;163;184m'
_GREEN=$'\033[32m'
_RED=$'\033[31m'
_BOLD=$'\033[1m'
_DIM=$'\033[2m'
_RESET=$'\033[0m'

_ui_colors() {
  [ -t 1 ] && [ -z "${NO_COLOR:-}" ]
}

brand() {
  if _ui_colors; then printf '%s%s%s' "$_BRAND" "$1" "$_RESET"
  else printf '%s' "$1"; fi
}

muted() {
  if _ui_colors; then printf '%s%s%s' "$_MUTED" "$1" "$_RESET"
  else printf '%s' "$1"; fi
}

bold() {
  if _ui_colors; then printf '%s%s%s' "$_BOLD" "$1" "$_RESET"
  else printf '%s' "$1"; fi
}

ui_ok()   { printf '  %s✓%s %s\n' "$_GREEN" "$_RESET" "$1"; }
ui_fail() { printf '  %s✗%s %s\n' "$_RED" "$_RESET" "$1" >&2; }
ui_warn() { printf '  %s!%s %s\n' "$_BRAND" "$_RESET" "$1"; }

render_install_banner() {
  local ver="${1:-0.1.0}"
  # Logo from @solarch/cli logo.generated.ts (density ramp → orange gradient when TTY)
  local lines=(
    "        11tttt11"
    "    iittttiiiittttii"
    "iitttt11        11ttttii"
    "ff11      iiii      11ff"
    "fftt11ii11tttt11ii11ttff"
    "tt  11fftt    ttff11  tt"
    "tt    tttttt11tttt    tt"
    "tt    tt11111111tt    tt"
    "tt  11fftt1111ttff11  tt"
    "tttttt11ttffff1111tttttt"
    "ff11      1111      11ff"
    "iitttt11  1111  11ttttii"
    "    iitttt1111ttttii"
    "        11ffff11"
  )
  if _ui_colors; then
    local ramp=' .,:;i1tfLCG08@'
    for line in "${lines[@]}"; do
      local out="" ch idx t
      for (( i=0; i<${#line}; i++ )); do
        ch="${line:i:1}"
        idx="${ramp%%"$ch"*}"
        idx="${#idx}"
        if [ "$idx" -le 0 ]; then out+="$ch"; continue; fi
        t=$(( idx * 100 / (${#ramp} - 1) ))
        if [ "$t" -ge 72 ]; then out+="${_BRAND_DEEP}${ch}${_RESET}"
        elif [ "$t" -ge 38 ]; then out+="${_BRAND}${ch}${_RESET}"
        else out+="${_MUTED}${ch}${_RESET}"; fi
      done
      printf '     %b\n' "$out"
    done
  else
    for line in "${lines[@]}"; do printf '     %s\n' "$line"; done
  fi
  echo
  printf '     %b %s %b %s %b\n' "$(brand "SOLARCH")" "$(muted "·")" "$(muted "self-host setup")" "$(muted "·")" "$(bold "v${ver}")"
  printf '     %s\n' "$(muted "----------------------------------------")"
  printf '     %s\n' "$(muted "diagram ⟷ code  ·  rules engine  ·  AI architect")"
  echo
}

ui_step() {
  local n="$1" total="$2" title="$3" hint="${4:-}"
  printf '\n%s %s\n' "$(brand "Step ${n}/${total}")" "$(bold "$title")"
  [ -n "$hint" ] && printf '%s\n' "$(muted "  $hint")"
}

ui_summary_box() {
  # ui_summary_box "line1" "line2" ...
  local w=44 line
  printf '\n  %s+-- Ready %s+%s\n' "$_MUTED" "$(printf '%*s' $((w-8)) '' | tr ' ' '-')" "$_RESET"
  for line in "$@"; do
    printf '  %s|%s %-*s %s|%s\n' "$_MUTED" "$_RESET" "$w" "$line" "$_MUTED" "$_RESET"
  done
  printf '  %s+%s+%s\n' "$_MUTED" "$(printf '%*s' $((w+2)) '' | tr ' ' '-')" "$_RESET"
}

gen_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 16
  else LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c 32; echo; fi
}

neo4j_password_ok() { [ "${#1}" -ge 8 ]; }

ensure_neo4j_password() {
  # $1 = current value (may be empty). Echoes final password on stdout.
  local pw="$1"
  if [ -z "$pw" ]; then
    pw=$(gen_secret)
    ui_ok "Generated a strong Neo4j password (32 hex chars)."
    printf '%s' "$pw"
    return 0
  fi
  while ! neo4j_password_ok "$pw"; do
    ui_fail "Neo4j requires at least 8 characters (yours: ${#pw})."
    read -r -p "$(muted '  Press Enter to auto-generate, or type a longer password: ')" pw
    if [ -z "$pw" ]; then
      pw=$(gen_secret)
      ui_ok "Generated a strong Neo4j password."
      break
    fi
  done
  printf '%s' "$pw"
}

api_key_ok() {
  local k="$1"
  k="${k#"${k%%[![:space:]]*}"}"
  k="${k%"${k##*[![:space:]]}"}"
  [ -n "$k" ]
}

read_secret() {
  local prompt="$1" v
  read -r -s -p "$(muted "  $prompt: ")" v
  echo >&2
  printf '%s' "$v"
}

docker_compose_clean() {
  # Shell-exported SOLARCH_BASIC_AUTH_* overrides .env — strip before compose.
  env -u SOLARCH_BASIC_AUTH_USER -u SOLARCH_BASIC_AUTH_HASH docker compose "$@"
}

preflight_docker() {
  printf '\n%s\n' "$(brand "Preflight")"
  printf '%s\n' "$(muted "  Checking Docker…")"
  if ! command -v docker >/dev/null 2>&1; then
    ui_fail "Docker not found."
    echo "$(muted '  Install: https://docs.docker.com/get-docker/')" >&2
    return 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    ui_fail "Docker Compose v2 required (docker compose)."
    return 1
  fi
  if ! docker info >/dev/null 2>&1; then
    ui_fail "Docker daemon is not running. Start Docker, then re-run ./install.sh"
    return 1
  fi
  ui_ok "Docker $(docker compose version --short 2>/dev/null || echo 'ready')"
  return 0
}

validate_existing_env() {
  local env_file="$1"
  [ -f "$env_file" ] || return 0
  local pw
  pw=$(grep -E '^NEO4J_PASSWORD=' "$env_file" | head -1 | cut -d= -f2- || true)
  if [ -n "$pw" ] && ! neo4j_password_ok "$pw"; then
    ui_fail ".env has NEO4J_PASSWORD with only ${#pw} characters (Neo4j needs ≥8)."
    ui_warn "Choose reconfigure in the menu, or edit .env by hand."
    return 1
  fi
  return 0
}

# .env exists and has the minimum required keys for a working stack.
env_is_complete() {
  local f="${1:-.env}"
  [ -f "$f" ] || return 1
  validate_existing_env "$f" || return 1
  grep -qE '^NEO4J_PASSWORD=.+' "$f" || return 1
  grep -qE '^LLM_GENERATION_PROVIDER=.+' "$f" || return 1
  grep -qE '^LLM_CHAT_PROVIDER=.+' "$f" || return 1
  local provider
  provider=$(grep -E '^LLM_GENERATION_PROVIDER=' "$f" | head -1 | cut -d= -f2-)
  if [ "$provider" = "ollama" ]; then
    grep -qE '^OLLAMA_BASE_URL=.+' "$f" || return 1
  else
    grep -qE '^(OPENAI|ANTHROPIC|GOOGLE|DEEPSEEK|MISTRAL|GROQ|OPENROUTER|BEDROCK|LLM)_' "$f" || return 1
  fi
  return 0
}

install_stack_running() {
  docker_compose_clean ps --status running -q web 2>/dev/null | grep -q .
}

install_stack_exists() {
  docker_compose_clean ps -aq 2>/dev/null | grep -q .
}

env_summary_line() {
  local f="${1:-.env}"
  local provider model
  provider=$(grep -E '^LLM_GENERATION_PROVIDER=' "$f" | head -1 | cut -d= -f2- || echo "?")
  model=$(grep -E '^LLM_MODEL=' "$f" | head -1 | cut -d= -f2- || true)
  if [ -n "$model" ]; then printf '%s · %s' "$provider" "$model"
  else printf '%s' "$provider"; fi
}

# Already installed — don't rerun the wizard unless the user asks.
handle_existing_install() {
  local choice="${1:-}"
  echo
  ui_ok "Solarch is already set up on this machine."
  printf '%s\n' "$(muted "  Config   .env ($(env_summary_line))")"
  if neo4j_volume_exists; then
    printf '%s\n' "$(muted "  Database Neo4j volume present (local projects kept)")"
  fi
  if install_stack_running; then
    printf '%s\n' "$(muted "  Stack    running → http://localhost:3000")"
  elif install_stack_exists; then
    printf '%s\n' "$(muted "  Stack    stopped")"
  else
    printf '%s\n' "$(muted "  Stack    not created yet")"
  fi
  echo
  if [ -n "$choice" ]; then
    case "$choice" in
      start|up) choice=1 ;;
      reconfigure|configure|reset) choice=2 ;;
      exit|quit) choice=3 ;;
    esac
  else
    cat <<MENU | sed "s/^/$(muted '  ')/"
  1) Start stack (recommended if stopped)
  2) Reconfigure — new .env wizard (keeps DB unless you reset)
  3) Exit
MENU
    read -r -p "$(muted '  Choice [1-3] (default 1): ')" choice
    choice="${choice:-1}"
  fi
  case "$choice" in
    1)
      if install_stack_running; then
        ui_ok "Already running at http://localhost:3000"
        muted "  Logs: ./scripts/solarch-compose.sh logs -f"
        exit 0
      fi
      ui_ok "Starting stack…"
      exec "${INSTALL_ROOT:-.}/scripts/solarch-compose.sh" up --build
      ;;
    2)
      ui_warn "Reconfigure will overwrite .env."
      read -r -p "$(muted '  Continue? [y/N] ')" ans
      case "${ans:-N}" in
        y|Y)
          OLD_NEO4J_PW=$(grep -E '^NEO4J_PASSWORD=' .env | head -1 | cut -d= -f2- || true)
          return 0
          ;;
        *) ui_ok "Cancelled."; exit 0 ;;
      esac
      ;;
    3|*) ui_ok "Nothing changed."; exit 0 ;;
    *) ui_fail "Invalid choice."; exit 1 ;;
  esac
}

neo4j_volume_exists() {
  docker volume ls -q 2>/dev/null | grep -Eq '(^|_)solarch_neo4j_data$'
}

# After .env is (re)written: Neo4j only applies NEO4J_PASSWORD on first volume init.
offer_neo4j_volume_reset() {
  local old_pw="$1" new_pw="$2"
  neo4j_volume_exists || return 0
  if [ -n "$old_pw" ] && [ "$old_pw" = "$new_pw" ]; then
    return 0
  fi
  echo
  ui_warn "Neo4j data volume already exists from a previous run."
  if [ -n "$old_pw" ] && [ "$old_pw" != "$new_pw" ]; then
    ui_warn "NEO4J_PASSWORD changed — the volume still has the old password."
  else
    ui_warn "Neo4j locks the password on first start; changing .env alone won't update it."
  fi
  read -r -p "$(muted '  Reset database volume (local projects lost)? [Y/n] ')" reset
  case "${reset:-Y}" in
    n|N)
      ui_warn "Keeping volume — expect auth errors if passwords differ."
      ui_warn "Fix anytime: ./scripts/solarch-reset-db.sh"
      ;;
    *)
      ui_ok "Clearing Neo4j volume…"
      docker_compose_clean down -v 2>/dev/null || env -u SOLARCH_BASIC_AUTH_USER -u SOLARCH_BASIC_AUTH_HASH docker compose down -v 2>/dev/null || true
      ui_ok "Neo4j volume cleared — fresh database on next start."
      ;;
  esac
}
