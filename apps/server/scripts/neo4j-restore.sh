#!/usr/bin/env bash
#
# Solarch — Neo4j restore (Neo4j 5 Community, Docker).
# Restores system + neo4j dumps from a backup directory.
# Restore also requires container stop (load cannot change the running DB).
#
# Usage: scripts/neo4j-restore.sh [BACKUP_DIR] (or backups/latest)
#
# CAUTION: destination DB is OVERWRITTEN (--overwrite-destination). Confirmation is requested.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

CONTAINER_NAME="solarch-neo4j"
IMAGE="neo4j:5-community"
BACKUP_DIR="${BACKEND_DIR}/backups"
# shellcheck disable=SC1090
[ -f "${SCRIPT_DIR}/neo4j-backup.env" ] && . "${SCRIPT_DIR}/neo4j-backup.env"

SRC="${1:-${BACKUP_DIR}/latest}"
[ -d "${SRC}" ] || { echo "HATA: yedek dizini yok: ${SRC}"; exit 1; }
[ -s "${SRC}/neo4j.dump.gz" ] || { echo "ERROR: ${SRC}/neo4j.dump.gz does not exist/empty"; exit 1; }

if docker ps >/dev/null 2>&1; then DOCKER="docker"; else DOCKER="sudo docker"; fi
log() { echo "[$(date '+%H:%M:%S')] $*"; }

echo "CAUTION: Backup '${SRC}' will OVERwrite the CURRENT database (irreversible)."
read -r -p "Type 'yes' to continue: " ans
[ "${ans}" = "yes" ] || { echo "Cancel."; exit 1; }

restart_container() { ${DOCKER} start "${CONTAINER_NAME}" >/dev/null 2>&1 || true; }
trap restart_container EXIT

log "Container durduruluyor…"
${DOCKER} stop "${CONTAINER_NAME}" >/dev/null

#load system FIRST from neo4j (auth/role data).
for DB in system neo4j; do
  log "load ${DB}…"
  gunzip -c "${SRC}/${DB}.dump.gz" \
    | ${DOCKER} run --rm -i --volumes-from "${CONTAINER_NAME}" "${IMAGE}" \
      neo4j-admin database load "${DB}" --from-stdin --overwrite-destination
done

log "Initializing container…"
${DOCKER} start "${CONTAINER_NAME}" >/dev/null
log "Restore ok. NOTE: don't forget to run 'pnpm neo4j:migrate' for new schema changes."
