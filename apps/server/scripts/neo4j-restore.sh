#!/usr/bin/env bash
#
# Solarch — Neo4j restore (Neo4j 5 Community, Docker).
# Bir yedek dizinindeki system + neo4j dump'larını geri yükler.
# Restore da container stop gerektirir (load çalışan DB'yi değiştiremez).
#
# Kullanım: scripts/neo4j-restore.sh [BACKUP_DIR]   (yoksa backups/latest)
#
# DİKKAT: hedef DB ÜZERİNE YAZILIR (--overwrite-destination). Onay istenir.

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
[ -s "${SRC}/neo4j.dump.gz" ] || { echo "HATA: ${SRC}/neo4j.dump.gz yok/boş"; exit 1; }

if docker ps >/dev/null 2>&1; then DOCKER="docker"; else DOCKER="sudo docker"; fi
log() { echo "[$(date '+%H:%M:%S')] $*"; }

echo "DİKKAT: '${SRC}' yedeği MEVCUT veritabanının ÜZERİNE yazılacak (geri alınamaz)."
read -r -p "Devam etmek için 'evet' yazın: " ans
[ "${ans}" = "evet" ] || { echo "İptal."; exit 1; }

restart_container() { ${DOCKER} start "${CONTAINER_NAME}" >/dev/null 2>&1 || true; }
trap restart_container EXIT

log "Container durduruluyor…"
${DOCKER} stop "${CONTAINER_NAME}" >/dev/null

# system'i neo4j'den ÖNCE yükle (auth/rol verisi).
for DB in system neo4j; do
  log "load ${DB}…"
  gunzip -c "${SRC}/${DB}.dump.gz" \
    | ${DOCKER} run --rm -i --volumes-from "${CONTAINER_NAME}" "${IMAGE}" \
      neo4j-admin database load "${DB}" --from-stdin --overwrite-destination
done

log "Container başlatılıyor…"
${DOCKER} start "${CONTAINER_NAME}" >/dev/null
log "Restore tamam. NOT: yeni şema değişiklikleri için 'pnpm neo4j:migrate' çalıştırmayı unutmayın."
