# Neo4j Yedek & Restore (Solarch — self-host, Neo4j 5 Community)

## Neden offline?
Neo4j **Community** edition'da online `backup` subcommand'ı ve çalışan DB üzerinde
`dump` **yoktur** (`The database is in use` hatası). Tek güvenli yol: container'ı
kısa süre durdur → ephemeral container ile **offline dump** → tekrar başlat.
Kesinti penceresi küçük DB'de birkaç saniyedir; gece düşük trafikte (04:00) çalıştır.

> Büyük DB / sıfır-kesinti gerekirse Neo4j **Enterprise** online-backup veya read-replica
> değerlendirilmeli. Launch ölçeğinde offline dump yeterli.

## Dosyalar
- `scripts/neo4j-backup.sh` — günlük yedek (stop → dump system+neo4j → start → health →
  retention → opsiyonel offsite). **trap ile her çıkışta container yeniden başlatılır.**
- `scripts/neo4j-restore.sh [DIZIN]` — bir yedeği geri yükler (varsayılan `backups/latest`).
- `scripts/neo4j-backup.env.example` — kopyala → `scripts/neo4j-backup.env` (gitignore'lu).

Yedekler `backups/<YYYYMMDD-HHMMSS>/` altında `system.dump.gz` + `neo4j.dump.gz`.
`backups/` ve `scripts/neo4j-backup.env` **gitignore'lu** (dump PII içerir).

## Kurulum (sunucu)

### systemd timer (önerilir — kaçırılan çalıştırmayı telafi eder)
`/etc/systemd/system/solarch-neo4j-backup.service`:
```ini
[Unit]
Description=Solarch Neo4j gunluk yedek
[Service]
Type=oneshot
ExecStart=/home/USER/solarch-backend/scripts/neo4j-backup.sh
```
`/etc/systemd/system/solarch-neo4j-backup.timer`:
```ini
[Unit]
Description=Solarch Neo4j yedek zamanlayici
[Timer]
OnCalendar=*-*-* 04:00:00
Persistent=true
[Install]
WantedBy=timers.target
```
```bash
sudo systemctl enable --now solarch-neo4j-backup.timer
sudo systemctl list-timers | grep solarch        # doğrula
journalctl -u solarch-neo4j-backup.service        # log
```

### cron (alternatif — root, docker erişimi için)
```cron
0 4 * * * /home/USER/solarch-backend/scripts/neo4j-backup.sh >> /var/log/solarch-neo4j-backup.log 2>&1
```

## Offsite (önerilir)
```bash
rclone config                  # B2 / GCS / S3 remote tanımla
echo 'RCLONE_REMOTE=b2:solarch-backups' >> scripts/neo4j-backup.env
```
Offsite hedef erişimi kısıtlı/şifreli olmalı (dump tüm veriyi taşır).

## Restore
```bash
scripts/neo4j-restore.sh                       # backups/latest
scripts/neo4j-restore.sh backups/20260602-040000
# 'evet' onayı → stop → load system+neo4j (--overwrite) → start
pnpm neo4j:migrate                             # restore SONRASI şema migration'larını çalıştır
```

## Doğrulama (ilk kurulumda mutlaka)
1. `scripts/neo4j-backup.sh` çalıştır → `backups/<ts>/` altında iki `.dump.gz` (>0 byte), container `healthy`.
2. **Trap testi (kritik):** `neo4j-backup.env`'de geçici `IMAGE=yok:lmage` yap → script hata verir AMA `docker ps` container'ı RUNNING gösterir. (Sonra geri al.)
3. **Round-trip:** test node ekle → backup → node'u sil → `neo4j-restore.sh latest` → node geri geldi mi.

## Felaket kurtarma checklist
- [ ] offsite yedek erişilebilir mi (rclone ls)
- [ ] doğru gün/saat yedeği seç
- [ ] restore + `pnpm neo4j:migrate`
- [ ] smoke: giriş, proje listesi, bir AI üretim, webhook
