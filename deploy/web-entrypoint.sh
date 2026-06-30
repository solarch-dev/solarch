#!/bin/sh
# Build the final Caddyfile at container start: optional Basic Auth from env.
set -eu

CADDYFILE="/etc/caddy/Caddyfile"
BASE="/etc/caddy/Caddyfile.base"
AUTH_SNIPPET="/etc/caddy/Caddyfile.auth.snippet"

if [ "${BIND_ADDRESS:-127.0.0.1}" = "0.0.0.0" ] && [ -z "${SOLARCH_BASIC_AUTH_USER:-}" ]; then
  echo "WARN: BIND_ADDRESS=0.0.0.0 but SOLARCH_BASIC_AUTH_* is not set — instance is open to the network." >&2
fi

if [ -n "${SOLARCH_BASIC_AUTH_USER:-}" ] && [ -n "${SOLARCH_BASIC_AUTH_HASH:-}" ]; then
  # Inject basic_auth block after the opening site block line.
  awk -v user="$SOLARCH_BASIC_AUTH_USER" -v hash="$SOLARCH_BASIC_AUTH_HASH" '
    NR == 1 { print; next }
    /^\tencode zstd gzip/ {
      print
      print "\t# HTTP Basic Auth — enabled via SOLARCH_BASIC_AUTH_* env."
      print "\tbasic_auth {"
      print "\t\t" user " " hash
      print "\t}"
      next
    }
    { print }
  ' "$BASE" > "$CADDYFILE"
else
  cp "$BASE" "$CADDYFILE"
fi

exec caddy run --config "$CADDYFILE" --adapter caddyfile
