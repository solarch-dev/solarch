# Graf Revizyonu + CLI Push — SOLARCH 2.0 Faz 2 tasarımı

**Tarih:** 2026-06-12 · **Durum:** Uygulandı

## Problem

Solarch grafı artık üç istemciden yazılıyor: web canvas (insan), AI agent ve
`solarch push` (CLI). Node seviyesinde optimistic locking vardı
(`version` + `expectedVersion`), ama **graf seviyesinde** revizyon yoktu — iki
istemci aynı anda node/edge eklerse kimse fark etmiyordu. Ayrıca `graph/apply`
yalnız batch içi `tempId`'ler arasına edge kurabiliyordu; CLI'ın "koddaki yeni
servis, buluttaki mevcut tabloya bağlanacak" senaryosu imkânsızdı.

## Tasarım: iki katmanlı çatışma koruması

```
Katman 1 — graf revizyonu  : "graf bütünü değişti mi?"  → push'un rebase tetiği
Katman 2 — node versiyonu  : "şu tek node değişti mi?"  → property PATCH guard'ı
```

### Katman 1: `Project.graphRevision`

- Migration `006_graph_revision.cypher`: mevcut projelere `graphRevision = 0` backfill.
- `ProjectsRepository.bumpRevision(id)`: `SET p.graphRevision = coalesce(p.graphRevision,0)+1`.
- **Bump noktaları:** `NodesService` create/delete + properties değiştiren update,
  `EdgesService` create/update/delete, `GraphService.apply` commit'i.
- **Bump ETMEYENLER (bilinçli):** salt pozisyon taşıma ve tab layout kaydetme —
  çizimi taşımak mimariyi değiştirmez; bump'lasaydı her sürükleme CLI push'una
  sahte çatışma üretirdi.
- `GET /projects/:id/graph` yanıtına `graphRevision` eklendi (`ProjectGraph` tipi).

### Katman 2: `Node.version` (mevcuttu, değişmedi)

`PATCH /nodes/:id` + `expectedVersion`; uyuşmazlıkta `409 ERR_VERSION_CONFLICT`
+ `currentVersion`. `ConflictFilter` artık `currentRevision`'ı da zarfa taşır.

## `graph/apply` genişlemesi (upsert köprüsü)

### Edge uçları: tempId VEYA cloud id

```jsonc
{
  "baseRevision": 5,                  // opsiyonel — çatışma koruması
  "mutations": {
    "nodes": [{ "tempId": "t_svc", "type": "Service", "properties": { … } }],
    "edges": [
      { "sourceTempId": "t_svc", "targetId": "ca33ceae-…", "edgeType": "CALLS" }
      //          yeni node ↑            ↑ mevcut cloud node (UUID)
    ]
  }
}
```

- Zod şeması her uç için **tam olarak birini** zorlar (`sourceTempId` XOR `sourceId`).
- Mevcut node DB'den okunur ve **Rules Engine'e verilir** — upsert köprüsü kural
  denetimini baypas etmez. Bulunamayan id → `ERR_EDGE_NODE_NOT_FOUND` (rollback).
- Edge yazımı `apoc.create.relationship` yerine **`apoc.merge.relationship`**:
  aynı `(source, target, kind, projectId)` ikinci kez gönderilirse yeni kayıt
  açılmaz → push **idempotent**. `createdAt/updatedAt` yalnız ilk yaratımda set
  edilir (`coalesce`).

### `baseRevision` sözleşmesi

1. **Ön kontrol:** validasyonlardan önce revizyon karşılaştırılır — eskiyse
   hiçbir iş yapılmadan `409 ERR_GRAPH_REVISION_CONFLICT` + `currentRevision`.
2. **Atomik kontrol:** asıl garanti commit transaction'ındadır —
   `WHERE rev = $baseRevision` koşullu bump; araya yazma girdiyse 0 kayıt döner,
   transaction rollback olur ve aynı 409 fırlar (TOCTOU yarışı kapalı).
3. Commit sonunda bump yapılır; yanıt `graphRevision` döner — istemci bir
   sonraki push'ta bunu `baseRevision` olarak kullanır.
4. `baseRevision` verilmezse davranış eskisi gibi (AI/UI çağrıları kırılmaz).
5. Boş mutation no-op'tur: bump yok, mevcut revizyon döner.

## CLI tarafı

### `solarch pull`

`GET graph` → `.solarch/to-be.json` (revizyon dahil). Offline `diff --to-be`
ve push öncesi referans.

### `solarch push` akışı

```
taze GET graph (rev R) ─▶ diff ─▶ plan { yeni node'lar, yeni edge'ler, liste-property farkları }
   illegal edge varsa ──▶ exit 1 (ASLA pushlanmaz)
   plan boşsa ─────────▶ "Already in sync" (no-op)
   onay (--yes CI'da atlar)
   graph/apply (baseRevision=R)
      409 ─▶ re-pull + re-plan + TEK retry ─▶ yine 409 ─▶ kullanıcıya bırak
   PATCH /nodes/:id (expectedVersion) — liste alanlarında KOD kaynak kabul edilir
      409 ─▶ TTY: cloud'u tut / kodu yaz / atla · CI: otomatik atla + rapor
   idMap ─▶ .solarch/map.json (yeni node'lar anında eşleşmiş)
```

Property merge semantiği: yalnız liste alanları (Columns/Fields/Methods/
Endpoints/Values) kodunkiyle değiştirilir; cloud'da elle yazılmış diğer
property'ler (Description vb.) **korunur**.

## Hata kodları

| Kod | HTTP | Kaynak | İstemci tepkisi |
|---|---|---|---|
| `ERR_GRAPH_REVISION_CONFLICT` | 409 | `graph/apply` + `baseRevision` | re-pull + re-plan + tek retry |
| `ERR_VERSION_CONFLICT` | 409 | `PATCH /nodes/:id` + `expectedVersion` | interaktif: cloud/kod/atla |
| `ERR_EDGE_NODE_NOT_FOUND` | 200 (violations) | apply'da cloud id bulunamadı | rollback raporu |

## Kapsam dışı (bilinçli)

- **Silme/`--prune` yok** — cloud'dan node silmek yalnız canvas'tan yapılır.
- Frontend'e canlı "başkası değiştirdi" bildirimi yok (React Query refetch
  yeterli); UI işi Faz 4'e.

## Doğrulama

- `graph.service.spec.ts`: mevcut-node edge, revizyon çatışması (ön kontrol +
  tx-içi), idempotent merge, boş mutation no-op.
- CLI `test/push.test.ts`: planner (tempId/cloudId karışık uçlar, illegal edge
  dışlama, property merge), 409 retry akışı (API mock).
- Uçtan uca smoke (lokal backend + Neo4j): fixture app push → 15 node + 17 edge;
  ikinci push no-op; buluttan silinen method üçüncü push'ta koddan geri yazıldı.

## Yan bulgular (bu çalışmada düzeltildi)

- Migration koşucusu `--` yorumla başlayan cypher bloklarını sessizce
  atlıyordu (005'in ilk constraint'i hiç çalışmamıştı) — yorum satırları artık
  statement içinden ayıklanıyor.
- AST extractor'ları Exception/Middleware/Worker/EventHandler/Orchestrator
  için zorunlu şema alanlarını üretmiyordu — şema-geçerli default'lar eklendi
  (yoksa push şema kontrolüne takılıyordu).
