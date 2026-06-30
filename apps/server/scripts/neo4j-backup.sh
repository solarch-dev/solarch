#!/usr/bin/env bash
#
# Solarch — Neo4j otomatik yedek (Neo4j 5 Community, Docker).
#
# ONLINE dump/backup NONETUR ("database is in use" error) in Neo4j Community
# one way: stop container → offline dump with ephemeral container → start.
# Interrupt window is small, a few seconds on DB (4am cron recommended).
#
# SECURITY RULE: With trap, the container is restarted on EVERY exit (including error)
# → even failed backup won't leave the DB down.
#
# Usage: scripts/neo4j-backup.sh (from root cron; docker access required)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ── Ayarlar (scripts/neo4j-backup.env varsa override eder) ────────────────────
CONTAINER_NAME="solarch-neo4j"
IMAGE="neo4j:5-community"
BACKUP_DIR="${BACKEND_DIR}/backups"
RETENTION_DAYS=7
RCLONE_REMOTE="" # e.g. "b2:solarch-backups" — if empty, offsite is skipped
HEALTH_TIMEOUT=60 # 'healthy' wait after restart (sec)
# shellcheck disable=SC1090
[ -f "${SCRIPT_DIR}/neo4j-backup.env" ] && . "${SCRIPT_DIR}/neo4j-backup.env"

# ── NEO4J identity (from backend .env; does not require dump auth, for smoke testing) ───
NEO4J_USER="neo4j"
NEO4J_PASSWORD=""
if [ -f "${BACKEND_DIR}/.env" ]; then
  set -a; # shellcheck disable=SC1091
  . "${BACKEND_DIR}/.env"; set +a
fi

# ── Docker access (sudo if not root) ──────────────────── ────────────────────
if docker ps >/dev/null 2>&1; then DOCKER="docker"; else DOCKER="sudo docker"; fi

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# SECURITY: restart container no matter what.
restart_container() { ${DOCKER} start "${CONTAINER_NAME}" >/dev/null 2>&1 || true; }
trap restart_container EXIT

TS="$(date +%Y%m%d-%H%M%S)"
DEST="${BACKUP_DIR}/${TS}"
mkdir -p "${DEST}"
START_EPOCH=$(date +%s)

log "Backup starts → ${DEST}"
log "Container durduruluyor (${CONTAINER_NAME})…"
${DOCKER} stop "${CONTAINER_NAME}" >/dev/null

# system + neo4j: get both (system → auth/role data; required on restore).
for DB in system neo4j; do
  log "dump ${DB}…"
# --to-stdout → host gzip file (bypasses bind-mount permission issue)
  ${DOCKER} run --rm --volumes-from "${CONTAINER_NAME}" "${IMAGE}" \
    neo4j-admin database dump "${DB}" --to-stdout 2>>"${DEST}/dump.log" \
    | gzip > "${DEST}/${DB}.dump.gz"
  if [ "${PIPESTATUS[0]}" -ne 0 ] || [ ! -s "${DEST}/${DB}.dump.gz" ]; then
log "ERROR: ${DB} dump failed (see ${DEST}/dump.log)"; exit 1
  fi
done

log "Initializing container…"
${DOCKER} start "${CONTAINER_NAME}" >/dev/null

# Health bekle
WAITED=0
until [ "$(${DOCKER} inspect -f '{{.State.Health.Status}}' "${CONTAINER_NAME}" 2>/dev/null)" = "healthy" ]; do
  sleep 2; WAITED=$((WAITED+2))
if [ "${WAITED}" -ge "${HEALTH_TIMEOUT}" ]; then log "WARNING: Health was not achieved in ${HEALTH_TIMEOUT}sec"; break; fi
done

# Smoke test (parola varsa)
if [ -n "${NEO4J_PASSWORD}" ]; then
  CNT=$(${DOCKER} exec "${CONTAINER_NAME}" cypher-shell -u "${NEO4J_USER}" -p "${NEO4J_PASSWORD}" \
    --format plain "MATCH (n) RETURN count(n)" 2>/dev/null | tail -1 || echo "?")
log "Smoke: number of nodes = ${CNT}"
fi

# latest symlink + retention
ln -sfn "${DEST}" "${BACKUP_DIR}/latest"
find "${BACKUP_DIR}" -maxdepth 1 -type d -name '20*' -mtime "+${RETENTION_DAYS}" -exec rm -rf {} + 2>/dev/null || true

# Offsite (opsiyonel)
if [ -n "${RCLONE_REMOTE}" ] && command -v rclone >/dev/null 2>&1; then
  log "Offsite → ${RCLONE_REMOTE}/neo4j/${TS}"
rclone copy "${DEST}" "${RCLONE_REMOTE}/neo4j/${TS}" --transfers=4 || log "WARNING: offsite copy failed"
elif [ -n "${RCLONE_REMOTE}" ]; then
log "WARNING: RCLONE_REMOTE set but rclone not installed — offsite skipped"
fi

SIZE=$(du -sh "${DEST}" | cut -f1)
log "Yedek tamam (${SIZE}, $(( $(date +%s) - START_EPOCH ))sn). Retention=${RETENTION_DAYS}g."
