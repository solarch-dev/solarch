#!/usr/bin/env bash
#
# Solarch — Neo4j otomatik yedek (Neo4j 5 Community, Docker).
#
# Neo4j Community'de ONLINE dump/backup YOKTUR ("database is in use" hatası),
# tek yol: container'ı durdur → ephemeral container ile offline dump → başlat.
# Kesinti penceresi küçük DB'de birkaç saniye (gece 04:00 cron önerilir).
#
# GÜVENLİK KURALI: trap ile HER çıkışta (hata dahil) container yeniden başlatılır
# → başarısız yedek bile DB'yi kapalı bırakmaz.
#
# Kullanım: scripts/neo4j-backup.sh   (root cron'dan; docker erişimi gerekir)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ── Ayarlar (scripts/neo4j-backup.env varsa override eder) ────────────────────
CONTAINER_NAME="solarch-neo4j"
IMAGE="neo4j:5-community"
BACKUP_DIR="${BACKEND_DIR}/backups"
RETENTION_DAYS=7
RCLONE_REMOTE=""            # ör. "b2:solarch-backups" — boşsa offsite atlanır
HEALTH_TIMEOUT=60           # restart sonrası 'healthy' bekleme (sn)
# shellcheck disable=SC1090
[ -f "${SCRIPT_DIR}/neo4j-backup.env" ] && . "${SCRIPT_DIR}/neo4j-backup.env"

# ── NEO4J kimlik (backend .env'den; dump auth gerektirmez, smoke test için) ───
NEO4J_USER="neo4j"
NEO4J_PASSWORD=""
if [ -f "${BACKEND_DIR}/.env" ]; then
  set -a; # shellcheck disable=SC1091
  . "${BACKEND_DIR}/.env"; set +a
fi

# ── Docker erişimi (root değilse sudo) ────────────────────────────────────────
if docker ps >/dev/null 2>&1; then DOCKER="docker"; else DOCKER="sudo docker"; fi

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# GÜVENLİK: ne olursa olsun container'ı geri başlat.
restart_container() { ${DOCKER} start "${CONTAINER_NAME}" >/dev/null 2>&1 || true; }
trap restart_container EXIT

TS="$(date +%Y%m%d-%H%M%S)"
DEST="${BACKUP_DIR}/${TS}"
mkdir -p "${DEST}"
START_EPOCH=$(date +%s)

log "Yedek başlıyor → ${DEST}"
log "Container durduruluyor (${CONTAINER_NAME})…"
${DOCKER} stop "${CONTAINER_NAME}" >/dev/null

# system + neo4j: ikisini de al (system → auth/rol verisi; restore'da şart).
for DB in system neo4j; do
  log "dump ${DB}…"
  # --to-stdout → host gzip dosyası (bind-mount izin sorununu atlar)
  ${DOCKER} run --rm --volumes-from "${CONTAINER_NAME}" "${IMAGE}" \
    neo4j-admin database dump "${DB}" --to-stdout 2>>"${DEST}/dump.log" \
    | gzip > "${DEST}/${DB}.dump.gz"
  if [ "${PIPESTATUS[0]}" -ne 0 ] || [ ! -s "${DEST}/${DB}.dump.gz" ]; then
    log "HATA: ${DB} dump başarısız (bkz. ${DEST}/dump.log)"; exit 1
  fi
done

log "Container başlatılıyor…"
${DOCKER} start "${CONTAINER_NAME}" >/dev/null

# Health bekle
WAITED=0
until [ "$(${DOCKER} inspect -f '{{.State.Health.Status}}' "${CONTAINER_NAME}" 2>/dev/null)" = "healthy" ]; do
  sleep 2; WAITED=$((WAITED+2))
  if [ "${WAITED}" -ge "${HEALTH_TIMEOUT}" ]; then log "UYARI: ${HEALTH_TIMEOUT}sn'de healthy olmadı"; break; fi
done

# Smoke test (parola varsa)
if [ -n "${NEO4J_PASSWORD}" ]; then
  CNT=$(${DOCKER} exec "${CONTAINER_NAME}" cypher-shell -u "${NEO4J_USER}" -p "${NEO4J_PASSWORD}" \
    --format plain "MATCH (n) RETURN count(n)" 2>/dev/null | tail -1 || echo "?")
  log "Smoke: node sayısı = ${CNT}"
fi

# latest symlink + retention
ln -sfn "${DEST}" "${BACKUP_DIR}/latest"
find "${BACKUP_DIR}" -maxdepth 1 -type d -name '20*' -mtime "+${RETENTION_DAYS}" -exec rm -rf {} + 2>/dev/null || true

# Offsite (opsiyonel)
if [ -n "${RCLONE_REMOTE}" ] && command -v rclone >/dev/null 2>&1; then
  log "Offsite → ${RCLONE_REMOTE}/neo4j/${TS}"
  rclone copy "${DEST}" "${RCLONE_REMOTE}/neo4j/${TS}" --transfers=4 || log "UYARI: offsite kopya başarısız"
elif [ -n "${RCLONE_REMOTE}" ]; then
  log "UYARI: RCLONE_REMOTE set ama rclone kurulu değil — offsite atlandı"
fi

SIZE=$(du -sh "${DEST}" | cut -f1)
log "Yedek tamam (${SIZE}, $(( $(date +%s) - START_EPOCH ))sn). Retention=${RETENTION_DAYS}g."
