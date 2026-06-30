#!/usr/bin/env bash
# Solarch self-host setup wizard (Linux / macOS).
# Branded like @solarch/cli — validates inputs, writes .env, optionally starts Docker.
#
#   git clone https://github.com/solarch-dev/solarch.git && cd solarch && ./install.sh
#
# Options:
#   -y, --yes          Start stack (if already set up) or finish wizard then start
#   --reconfigure      Force the setup wizard even when .env exists
#   -h, --help         Show help
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
INSTALL_ROOT="$ROOT"
# shellcheck source=scripts/install-ui.sh
source "$ROOT/scripts/install-ui.sh"

INSTALL_VERSION="0.1.0"
AUTO_START=0
FORCE_RECONFIGURE=0

usage() {
  cat <<EOF
$(brand "solarch install") $(muted "— self-host setup wizard")

  $(muted "Usage:")  ./install.sh [options]

  $(muted "Options:")
    -y, --yes          If already set up: start stack. Otherwise: start after wizard.
    --reconfigure      Run the full wizard (overwrites .env)
    -h, --help         Show this help

  $(muted "Already installed?")  ./install.sh → menu (start / reconfigure / exit)
  $(muted "Day-to-day:")         ./scripts/solarch-compose.sh up --build
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes) AUTO_START=1; shift ;;
    --reconfigure) FORCE_RECONFIGURE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) ui_fail "Unknown option: $1"; usage >&2; exit 1 ;;
  esac
done

render_install_banner "$INSTALL_VERSION"

if ! preflight_docker; then exit 1; fi

OLD_NEO4J_PW=""
ENV_WROTE=0

# ── Already installed? ────────────────────────────────────────────────────────
if [ "$FORCE_RECONFIGURE" = "0" ] && env_is_complete .env; then
  if [ "$AUTO_START" = "1" ]; then
    handle_existing_install start
  fi
  handle_existing_install ""
fi

# Broken .env — offer fix path without silent overwrite
if [ -f .env ] && ! validate_existing_env .env; then
  echo
  ui_warn ".env exists but is invalid."
  read -r -p "$(muted '  Run reconfigure wizard to fix? [Y/n] ')" ans
  case "${ans:-Y}" in
    n|N) muted "  Edit .env manually, then: ./scripts/solarch-compose.sh up --build"; exit 1 ;;
    *) OLD_NEO4J_PW=$(grep -E '^NEO4J_PASSWORD=' .env | head -1 | cut -d= -f2- || true) ;;
  esac
elif [ -f .env ] && [ "$FORCE_RECONFIGURE" = "1" ]; then
  OLD_NEO4J_PW=$(grep -E '^NEO4J_PASSWORD=' .env | head -1 | cut -d= -f2- || true)
  ui_warn "Reconfigure — will overwrite .env."
fi

# ── Step 1: AI provider ───────────────────────────────────────────────────────
ui_step 1 3 "AI provider" "Tool-calling model + your API key. Required for AI Architect."

cat <<MENU | sed "s/^/$(muted '  ')/"
  1) OpenAI            6) Groq
  2) Anthropic         7) OpenRouter (300+ models)
  3) Google Gemini     8) Ollama (local, no key)
  4) DeepSeek          9) Bedrock (OpenAI-compatible)
  5) Mistral          10) Custom OpenAI-compatible
MENU

read -r -p "$(muted '  Provider [1-10] (default 1): ')" pick
pick="${pick:-1}"

PROVIDER=""; KEY_LINES=""; MODEL_DEFAULT=""; ASK_MODEL=1

case "$pick" in
  1) PROVIDER=openai;     k=$(read_secret "OPENAI_API_KEY");     KEY_LINES="OPENAI_API_KEY=$k";     MODEL_DEFAULT="gpt-4o" ;;
  2) PROVIDER=anthropic;  k=$(read_secret "ANTHROPIC_API_KEY");  KEY_LINES="ANTHROPIC_API_KEY=$k";  MODEL_DEFAULT="claude-3-5-sonnet-latest" ;;
  3) PROVIDER=google;     k=$(read_secret "GOOGLE_API_KEY");     KEY_LINES="GOOGLE_API_KEY=$k";     MODEL_DEFAULT="gemini-1.5-pro" ;;
  4) PROVIDER=deepseek;   k=$(read_secret "DEEPSEEK_API_KEY");   KEY_LINES="DEEPSEEK_API_KEY=$k";   ASK_MODEL=0 ;;
  5) PROVIDER=mistral;    k=$(read_secret "MISTRAL_API_KEY");    KEY_LINES="MISTRAL_API_KEY=$k";    MODEL_DEFAULT="mistral-large-latest" ;;
  6) PROVIDER=groq;       k=$(read_secret "GROQ_API_KEY");       KEY_LINES="GROQ_API_KEY=$k";       MODEL_DEFAULT="llama-3.3-70b-versatile" ;;
  7) PROVIDER=openrouter; k=$(read_secret "OPENROUTER_API_KEY"); KEY_LINES="OPENROUTER_API_KEY=$k"; MODEL_DEFAULT="openai/gpt-4o" ;;
  8)
    PROVIDER=ollama; ASK_MODEL=0
    read -r -p "$(muted '  OLLAMA_BASE_URL [http://host.docker.internal:11434]: ')" ob
    ob="${ob:-http://host.docker.internal:11434}"
    read -r -p "$(muted '  Model [llama3.1]: ')" om; om="${om:-llama3.1}"
    KEY_LINES="OLLAMA_BASE_URL=$ob"; MODEL_DEFAULT="$om"
    ;;
  9)
    PROVIDER=bedrock; ASK_MODEL=0
    k=$(read_secret "BEDROCK_API_KEY")
    read -r -p "$(muted '  BEDROCK_BASE_URL: ')" bu
    KEY_LINES=$(printf 'BEDROCK_API_KEY=%s\nBEDROCK_BASE_URL=%s' "$k" "$bu")
    ;;
  10)
    PROVIDER=openai-compatible; ASK_MODEL=0
    k=$(read_secret "LLM_API_KEY")
    read -r -p "$(muted '  LLM_BASE_URL: ')" lu
    read -r -p "$(muted '  Model: ')" lm
    KEY_LINES=$(printf 'LLM_API_KEY=%s\nLLM_BASE_URL=%s' "$k" "$lu"); MODEL_DEFAULT="$lm"
    ;;
  *) ui_fail "Invalid choice."; exit 1 ;;
esac

if [ "$PROVIDER" != "ollama" ]; then
  key_val="${KEY_LINES#*=}"
  key_val="${key_val%%$'\n'*}"
  while ! api_key_ok "$key_val"; do
    ui_fail "API key cannot be empty."
    case "$PROVIDER" in
      openai)     k=$(read_secret "OPENAI_API_KEY");     KEY_LINES="OPENAI_API_KEY=$k" ;;
      anthropic)  k=$(read_secret "ANTHROPIC_API_KEY");  KEY_LINES="ANTHROPIC_API_KEY=$k" ;;
      google)     k=$(read_secret "GOOGLE_API_KEY");     KEY_LINES="GOOGLE_API_KEY=$k" ;;
      deepseek)   k=$(read_secret "DEEPSEEK_API_KEY");   KEY_LINES="DEEPSEEK_API_KEY=$k" ;;
      mistral)    k=$(read_secret "MISTRAL_API_KEY");    KEY_LINES="MISTRAL_API_KEY=$k" ;;
      groq)       k=$(read_secret "GROQ_API_KEY");       KEY_LINES="GROQ_API_KEY=$k" ;;
      openrouter) k=$(read_secret "OPENROUTER_API_KEY"); KEY_LINES="OPENROUTER_API_KEY=$k" ;;
      bedrock)    k=$(read_secret "BEDROCK_API_KEY");    KEY_LINES=$(printf 'BEDROCK_API_KEY=%s\nBEDROCK_BASE_URL=%s' "$k" "$bu") ;;
      openai-compatible) k=$(read_secret "LLM_API_KEY"); KEY_LINES=$(printf 'LLM_API_KEY=%s\nLLM_BASE_URL=%s' "$k" "$lu") ;;
    esac
    key_val="${KEY_LINES#*=}"
    key_val="${key_val%%$'\n'*}"
  done
  ui_ok "Provider: $(brand "$PROVIDER")"
fi

MODEL=""
if [ "$ASK_MODEL" = "1" ]; then
  read -r -p "$(muted "  Model [$MODEL_DEFAULT]: ")" MODEL
  MODEL="${MODEL:-$MODEL_DEFAULT}"
elif [ "$PROVIDER" != "deepseek" ]; then
  MODEL="$MODEL_DEFAULT"
fi

# ── Step 2: Neo4j ─────────────────────────────────────────────────────────────
ui_step 2 3 "Database" "Neo4j password — Enter auto-generates a strong one (recommended)."

if neo4j_volume_exists && [ -n "$OLD_NEO4J_PW" ]; then
  ui_warn "Neo4j volume exists — keep the same password or the server won't connect."
  read -r -p "$(muted '  Keep existing DB password? [Y/n] ')" keep
  case "${keep:-Y}" in
    n|N)
      read -r -p "$(muted '  New password (Enter = auto-generate): ')" NEO4J_PW
      NEO4J_PW=$(ensure_neo4j_password "$NEO4J_PW")
      ;;
    *)
      NEO4J_PW="$OLD_NEO4J_PW"
      ui_ok "Keeping existing Neo4j password."
      ;;
  esac
else
  read -r -p "$(muted '  Password (Enter = auto-generate): ')" NEO4J_PW
  NEO4J_PW=$(ensure_neo4j_password "$NEO4J_PW")
fi

# ── Step 3: Exposure ──────────────────────────────────────────────────────────
ui_step 3 3 "Network" "Local-only is safest. Remote exposure adds HTTP Basic Auth."

cat <<MENU | sed "s/^/$(muted '  ')/"
  1) Local only (127.0.0.1) — this machine only
  2) LAN / remote (0.0.0.0 + HTTP Basic Auth)
MENU

read -r -p "$(muted '  Exposure [1-2] (default 1): ')" EXPOSURE
EXPOSURE="${EXPOSURE:-1}"

BIND_ADDRESS="127.0.0.1"
AUTH_USER=""
AUTH_HASH=""
AUTH_PASSWORD=""

case "$EXPOSURE" in
  2)
    BIND_ADDRESS="0.0.0.0"
    AUTH_USER="solarch"
    AUTH_PASSWORD=$(gen_secret | head -c 24)
    echo "$(muted '  Generating HTTP Basic Auth…')"
    AUTH_HASH=$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "$AUTH_PASSWORD")
    echo
    bold "  Save these credentials — shown once:"
    echo "    User:     $AUTH_USER"
    echo "    Password: $AUTH_PASSWORD"
    echo
    ui_ok "Remote exposure + Basic Auth enabled."
    ;;
  1|*) ui_ok "Local only ($(muted '127.0.0.1:3000'))." ;;
  *) ui_fail "Invalid choice."; exit 1 ;;
esac

# ── Write .env ────────────────────────────────────────────────────────────────
umask 077
{
  echo "# Generated by install.sh — do not commit (gitignored)."
  echo "PUBLIC_URL=http://localhost:3000"
  echo "PORT_PUBLIC=3000"
  echo "BIND_ADDRESS=$BIND_ADDRESS"
  echo "NEO4J_PASSWORD=$NEO4J_PW"
  echo "LOCAL_USER_ID=local_owner"
  echo "LLM_GENERATION_PROVIDER=$PROVIDER"
  echo "LLM_CHAT_PROVIDER=$PROVIDER"
  printf '%s\n' "$KEY_LINES"
  [ -n "$MODEL" ] && echo "LLM_MODEL=$MODEL"
  if [ -n "$AUTH_USER" ]; then
    echo "SOLARCH_BASIC_AUTH_USER=$AUTH_USER"
    echo "SOLARCH_BASIC_AUTH_HASH=$AUTH_HASH"
  else
    echo "# SOLARCH_BASIC_AUTH_USER="
    echo "# SOLARCH_BASIC_AUTH_HASH="
  fi
} > .env
chmod 600 .env
ENV_WROTE=1

echo
ui_ok "Wrote $(brand '.env') $(muted "(provider: $PROVIDER${MODEL:+, model: $MODEL})")"
muted "  Secrets stay in .env only — never printed here."

if [ "$ENV_WROTE" = "1" ]; then
  offer_neo4j_volume_reset "$OLD_NEO4J_PW" "$NEO4J_PW"
fi

ui_summary_box \
  "Open  http://localhost:3000" \
  "AI    $PROVIDER${MODEL:+ · $MODEL}" \
  "Auth  no login (local owner)" \
  "Stop  Ctrl+C · ./scripts/solarch-compose.sh down"

echo
if [ "$AUTO_START" = "1" ]; then
  ui_ok "Starting stack…"
  exec "$ROOT/scripts/solarch-compose.sh" up --build
fi

read -r -p "$(muted "Start Solarch now? [Y/n] ")" go
case "${go:-Y}" in
  n|N)
    muted "  When ready:  ./scripts/solarch-compose.sh up --build"
    ;;
  *)
    ui_ok "Starting stack…"
    exec "$ROOT/scripts/solarch-compose.sh" up --build
    ;;
esac
