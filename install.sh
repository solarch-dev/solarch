#!/usr/bin/env bash
# Solarch self-host setup wizard (Linux / macOS).
# Asks for an AI provider + API key and a Neo4j password, writes .env, and
# (optionally) starts the stack. No secret is ever echoed back or logged.
#
#   git clone https://github.com/solarch-dev/solarch.git && cd solarch && ./install.sh
set -euo pipefail

cd "$(dirname "$0")"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
dim()  { printf '\033[2m%s\033[0m\n' "$1"; }
err()  { printf '\033[31m%s\033[0m\n' "$1" >&2; }

bold "Solarch — self-host setup"
echo

# ── Prerequisites ────────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  err "Docker is required but was not found. Install Docker, then re-run ./install.sh"
  err "  → https://docs.docker.com/get-docker/"
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  err "Docker Compose v2 is required (the 'docker compose' command)."
  exit 1
fi

# ── Don't clobber an existing .env without asking ─────────────────────────────
if [ -f .env ]; then
  read -r -p ".env already exists. Overwrite it? [y/N] " ans
  case "${ans:-N}" in
    y|Y) : ;;
    *) echo "Keeping existing .env. Edit it by hand or remove it and re-run."; exit 0 ;;
  esac
fi

gen_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  else LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c 64; echo; fi
}

# ── AI provider ───────────────────────────────────────────────────────────────
bold "1) Choose your AI provider"
dim  "   The AI Architect needs a tool-calling-capable model. Bring your own key."
cat <<'MENU'
   1) OpenAI            6) Groq
   2) Anthropic         7) OpenRouter (300+ models)
   3) Google Gemini     8) Ollama (local, no key)
   4) DeepSeek          9) Bedrock (OpenAI-compatible)
   5) Mistral          10) Custom OpenAI-compatible
MENU
read -r -p "   Provider [1-10] (default 1): " pick
pick="${pick:-1}"

PROVIDER=""; KEY_LINES=""; MODEL_DEFAULT=""; ASK_MODEL=1
read_secret() { # $1=prompt  → echoes value (used in command substitution)
  local v; read -r -s -p "   $1: " v; echo >&2; printf '%s' "$v"
}

case "$pick" in
  1) PROVIDER=openai;     k=$(read_secret "OPENAI_API_KEY");     KEY_LINES="OPENAI_API_KEY=$k";     MODEL_DEFAULT="gpt-4o" ;;
  2) PROVIDER=anthropic;  k=$(read_secret "ANTHROPIC_API_KEY");  KEY_LINES="ANTHROPIC_API_KEY=$k";  MODEL_DEFAULT="claude-3-5-sonnet-latest" ;;
  3) PROVIDER=google;     k=$(read_secret "GOOGLE_API_KEY");     KEY_LINES="GOOGLE_API_KEY=$k";     MODEL_DEFAULT="gemini-1.5-pro" ;;
  4) PROVIDER=deepseek;   k=$(read_secret "DEEPSEEK_API_KEY");   KEY_LINES="DEEPSEEK_API_KEY=$k";   ASK_MODEL=0 ;;
  5) PROVIDER=mistral;    k=$(read_secret "MISTRAL_API_KEY");    KEY_LINES="MISTRAL_API_KEY=$k";    MODEL_DEFAULT="mistral-large-latest" ;;
  6) PROVIDER=groq;       k=$(read_secret "GROQ_API_KEY");       KEY_LINES="GROQ_API_KEY=$k";       MODEL_DEFAULT="llama-3.3-70b-versatile" ;;
  7) PROVIDER=openrouter; k=$(read_secret "OPENROUTER_API_KEY"); KEY_LINES="OPENROUTER_API_KEY=$k"; MODEL_DEFAULT="openai/gpt-4o" ;;
  8) PROVIDER=ollama
     read -r -p "   OLLAMA_BASE_URL [http://host.docker.internal:11434]: " ob
     ob="${ob:-http://host.docker.internal:11434}"
     read -r -p "   Model (e.g. llama3.1): " om; om="${om:-llama3.1}"
     KEY_LINES="OLLAMA_BASE_URL=$ob"; MODEL_DEFAULT="$om"; ASK_MODEL=0 ;;
  9) PROVIDER=bedrock
     k=$(read_secret "BEDROCK_API_KEY")
     read -r -p "   BEDROCK_BASE_URL: " bu
     KEY_LINES=$(printf 'BEDROCK_API_KEY=%s\nBEDROCK_BASE_URL=%s' "$k" "$bu"); ASK_MODEL=0 ;;
  10) PROVIDER=openai-compatible
     k=$(read_secret "LLM_API_KEY")
     read -r -p "   LLM_BASE_URL: " lu
     read -r -p "   Model: " lm
     KEY_LINES=$(printf 'LLM_API_KEY=%s\nLLM_BASE_URL=%s' "$k" "$lu"); MODEL_DEFAULT="$lm"; ASK_MODEL=0 ;;
  *) err "Invalid choice."; exit 1 ;;
esac

MODEL=""
if [ "$ASK_MODEL" = "1" ]; then
  read -r -p "   Model [$MODEL_DEFAULT]: " MODEL; MODEL="${MODEL:-$MODEL_DEFAULT}"
elif [ "$PROVIDER" != "deepseek" ]; then
  MODEL="$MODEL_DEFAULT"
fi

# ── Neo4j password ────────────────────────────────────────────────────────────
echo; bold "2) Database password (Neo4j)"
read -r -p "   Press Enter to auto-generate, or type a password: " NEO4J_PW
if [ -z "$NEO4J_PW" ]; then NEO4J_PW=$(gen_secret); echo "   Generated a strong password."; fi

# ── Network exposure ──────────────────────────────────────────────────────────
echo; bold "3) Network exposure"
dim  "   Local-only is safest. LAN/VPS enables HTTP Basic Auth at the edge."
cat <<'MENU'
   1) Local only (127.0.0.1) — default, this machine only
   2) LAN / remote (0.0.0.0 + HTTP Basic Auth)
MENU
read -r -p "   Exposure [1-2] (default 1): " EXPOSURE
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
    echo "   Generating HTTP Basic Auth credentials…"
    AUTH_HASH=$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "$AUTH_PASSWORD")
    echo
    bold "   Save these credentials — shown once:"
    echo "   User:     $AUTH_USER"
    echo "   Password: $AUTH_PASSWORD"
    echo
    ;;
  1|*) ;;
  *) err "Invalid choice."; exit 1 ;;
esac

# ── Write .env (fresh, real values; never printed) ────────────────────────────
umask 077
{
  echo "# Generated by install.sh — do not commit (this file is gitignored)."
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
  fi
} > .env
chmod 600 .env

echo
bold "✓ Wrote .env  (provider: $PROVIDER${MODEL:+, model: $MODEL})"
dim  "  Secrets were written to .env only — never printed here."
echo
read -r -p "Start Solarch now with 'docker compose up --build'? [Y/n] " go
case "${go:-Y}" in
  n|N) echo "When ready:  docker compose up --build   →   http://localhost:3000" ;;
  *)   exec docker compose up --build ;;
esac
