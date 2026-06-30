# Solarch — Deploy Runbook (Hostinger KVM2, tek-kutu self-host)

Tek sunucuda: **Caddy** (tek origin, HTTPS) → `/` Vite statik dist + `/api/*` → backend (loopback :4000);
**Neo4j** (Docker, yalnız localhost); **backend** (systemd, `node dist/main.js`).

> Artefaktlar `deploy/` altında: `Caddyfile`, `solarch-backend.service`, `solarch-neo4j-backup.{service,timer}`.
> Yedek/restore: `scripts/neo4j-backup.sh` + `docs/ops/backup-restore.md`.

## 0) Ön koşullar (sağlayıcı panelleri — env YETMEZ)
Bu zincirden BİR halka koparsa **giriş tamamen çalışmaz** (semptomlar yanıltıcı: 401/CORS/cookie):
- [ ] **DNS**: `DOMAIN` ve `www.DOMAIN` A kaydı → sunucu IP'si.
- [ ] **Clerk (production instance)**: pk_live/sk_live al; Clerk panelinde **custom domain / Frontend API** DNS kayıtlarını (CNAME `clerk.DOMAIN` vb.) kur; **Allowed origins / redirect URLs** = `https://DOMAIN`. (pk_live, custom domain kurulmadan cookie akmaz.)
- [ ] **Polar (production)**: ürünler production org'da; webhook endpoint = `https://DOMAIN/api/v1/billing/webhook`; **production webhook secret**'ı al (sandbox'tan farklı); organization access token oluştur.
- [ ] **HTTPS ŞART**: Clerk pk_live `Secure` cookie ister → HTTP/IP ile giriş çalışmaz. Caddy otomatik Let's Encrypt (port 80 ACME challenge'ı görmeli → ufw'de açık).

## 1) Sunucu hazırlık
```bash
# Docker + Caddy + node + pnpm kurulu olsun. ufw:
sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 443
sudo ufw enable     # 22'yi AÇMADAN enable etme (kendini kilitleme)
# Neo4j 7474/7687 ufw'de AÇILMAZ — zaten compose 127.0.0.1'e bağlı.
```

## 2) Kod + env
```bash
sudo mkdir -p /opt/solarch && cd /opt/solarch
git clone <backend-repo> solarch-backend && git clone <frontend-repo> solarch-frontend
```
**backend `.env`** (`/opt/solarch/solarch-backend/.env`, `chmod 600`, repo dışı):
```
NODE_ENV=production
PORT=4000
NEO4J_URI=bolt://localhost:7687
NEO4J_PASSWORD=<GÜÇLÜ-RASTGELE>     # compose ilk init'te bunu kullanır
CORS_ORIGIN=https://DOMAIN          # same-origin'de tetiklenmez ama doğru set et
CLERK_SECRET_KEY=sk_live_...
CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_AUTHORIZED_PARTIES=https://DOMAIN   # CSRF — www apex'e redirect edildiği için tek host
POLAR_SERVER=production
POLAR_ACCESS_TOKEN=polar_oat_...(production)
POLAR_WEBHOOK_SECRET=whsec_...(production)
POLAR_PRODUCT_DRAW/BUILD/CODE=prod_...(production)
DEEPSEEK_API_KEY=... (veya BEDROCK_*)
```
**frontend `.env`** (build-time; `pnpm build` ÖNCESİ doğru olmalı — bundle'a gömülür):
```
VITE_API_URL=                       # BOŞ! same-origin /api/v1 (Clerk cookie için ŞART)
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
# Billing: Polar hosted-redirect checkout — backend creates the session, no client billing keys needed.
```
> Secret aktarımı: `.env`'leri **manuel** (scp/panel) koy, repo'ya/CI'a koyma. CI yalnız lint/build/test gate'i — deploy değil.

## 3) Neo4j (ilk kurulum — parola volume'a yazılır)
```bash
cd /opt/solarch/solarch-backend
docker compose up -d                # NEO4J_PASSWORD .env'den okunur, volume init olur
# healthy bekle:
until [ "$(docker inspect -f '{{.State.Health.Status}}' solarch-neo4j)" = healthy ]; do sleep 2; done
pnpm install --frozen-lockfile
pnpm neo4j:migrate                  # constraint/index (idempotent — IF NOT EXISTS)
# (opsiyonel veri: pnpm migrate:data:* / seed:patterns)
```
> Parola değişimi mevcut volume'da ÇALIŞMAZ (Neo4j sadece ilk init'te yazar). Yanlış parolayla
> init olduysa: `docker compose down -v` (VERİ GİDER) → doğru NEO4J_PASSWORD ile tekrar up + migrate.

## 4) Backend (systemd)
```bash
cd /opt/solarch/solarch-backend && pnpm build       # dist/main.js
sudo cp deploy/solarch-backend.service /etc/systemd/system/
# (User/WorkingDirectory/EnvironmentFile yollarını düzelt)
sudo systemctl daemon-reload && sudo systemctl enable --now solarch-backend
curl -s 127.0.0.1:4000/api/v1/health/ready          # {status:ready} bekle (backend 127.0.0.1'e bind — localhost DEĞİL)
```

## 5) Frontend + Caddy
```bash
cd /opt/solarch/solarch-frontend && pnpm install --frozen-lockfile && pnpm build
sudo mkdir -p /var/www/solarch && sudo cp -r dist /var/www/solarch/
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile       # DOMAIN'i düzelt (backend'deki deploy/)
sudo systemctl reload caddy                          # otomatik HTTPS
```

## 6) Otomatik yedek
```bash
sudo cp deploy/solarch-neo4j-backup.{service,timer} /etc/systemd/system/
sudo systemctl enable --now solarch-neo4j-backup.timer
# Detay + offsite + restore: docs/ops/backup-restore.md. Yedek container'ı kısa stop/start
# eder → o pencerede /health/ready 503 (backend Restart ile toparlar). Gece 04:00.
```

## 7) Smoke test (sıralı — kırılgan auth zinciri)
1. `https://DOMAIN` açılır (HTTPS yeşil, www → apex redirect).
2. Kayıt ol → e-posta doğrula → `/start` (login loop YOK → Clerk domain + cookie + AUTHORIZED_PARTIES doğru).
3. Proje oluştur, node ekle, iki node'u bağla (canvas).
4. AI üretim çalışır (DeepSeek/Bedrock anahtarı).
5. `/billing` → Build satın al (Polar prod test) → webhook → plan aktif.
6. `curl https://DOMAIN/api/v1/health/ready` → 200; `docker stop solarch-neo4j` → 503; tekrar start → 200.
7. `sudo systemctl stop solarch-backend` → loglarda graceful shutdown (Neo4j driver.close).

## Güncelleme (redeploy)
```bash
cd /opt/solarch/solarch-backend && git pull && pnpm install --frozen-lockfile && pnpm build && pnpm neo4j:migrate && sudo systemctl restart solarch-backend
cd /opt/solarch/solarch-frontend && git pull && pnpm install --frozen-lockfile && pnpm build && sudo cp -r dist/* /var/www/solarch/dist/
```
> Tek instance → restart sırasında kısa (~saniye) 502 penceresi kaçınılmaz (zero-downtime yok).

## Bilinen sınırlar
- Tek-kutu = tek hata noktası + HA yok. Neo4j heap/pagecache compose'da 512m (8GB'ı backend ile paylaşır; yük artarsa NEO4J_HEAP/NEO4J_PAGECACHE env ile artır).
- CI gate Neo4j repository/migration regresyonlarını yakalamaz (testcontainers nightly'de) — deploy öncesi `pnpm test:docker` + `pnpm test:e2e` lokalde koş.
- Frontend lint-debt (~30 react-hooks uyarısı) gate'te blocking değil.
