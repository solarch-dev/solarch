# Tabs / Contexts Tasarımı

**Tarih:** 2026-05-22
**Durum:** Onaylandı (tasarım), implementasyon bekliyor
**Amaç:** Frontend'in çoklu-sekme (Obsidian-tarzı bağlam) UX'ini desteklemek — proje
içinde birden fazla canvas (sekme), kutuların sekmeler arası **referans (import)** ile
paylaşımı.

## 1. Çekirdek model — "tek ev + referanslar"

Benzetme: bir kutu = bir component. Component **tek bir yerde tanımlıdır** (evi), başka
yerlerde **import** edilerek kullanılır. Import bir kopya değil, aynı şeyi işaret eden
bir referanstır; datasını bir yerde değiştirince her yerde değişir (tek kaynak).

- Her **node**'un bir **evi** vardır: bir `homeTab` + o sekmedeki konumu (`position`).
  Node oluşturulduğu sekmede "tanımlanır".
- Node, ev sekmesinde otomatik kendi `position`'ında görünür.
- Node başka bir sekmede **referans (import/kısayol)** olarak gösterilebilir: o sekmede
  kendi konumuyla belirir, "referans" olarak işaretlidir ve kaynağı (ev sekmesi) görünür.
- **Tek kaynak:** node datası (properties) düzenlenince ev + tüm referanslarda aynı anda
  güncel. Referans yalnızca konum/görünüm; kimlik ve data tektir.
- **Rules Engine global kalır:** kurallar mantıksal graf (node + edge) üzerinde işler,
  sekmeden bağımsız. Referansa ok çekmek aynı kurallarla doğrulanır.
- **v1 kapsam:** yalnızca context/canvas sekmeleri. View sekmeleri
  (Infrastructure/DBSchema/Flow filtreli görünümler) sonraki faz (out of scope).

## 2. Veri modeli (Neo4j)

```
(:Tab {
  id, projectId, name, isDefault, order, moduleNodeId?, createdAt, updatedAt
})

:Node  → mevcut alanlar KORUNUR (positionX/positionY, properties, type, projectId, ...)
         + yeni alan: homeTabId   // node'un ev sekmesi

(:Tab)-[:REFERENCES { x, y }]->(:Node)   // ev DIŞI sekmelerdeki import/kısayol
```

- `isDefault=true` → otomatik "Ana Mimari" sekmesi (her projede bir tane, silinemez).
- `moduleNodeId?` → drill-down kaynağı Module node bağı (opsiyonel; çift tık ile bir
  Module'ün içine girince açılan sekme onunla ilişkilenir).
- `order` → sekme çubuğu sırası.
- Node `position` (ev konumu) ve `homeTabId` node üzerinde durur; referans konumu
  `REFERENCES` ilişkisinde (`x, y`).

**Bir sekmenin içeriği (render):**
- `homeTabId = sekme` olan node'lar → kendi `position`'larında (sahip/owned).
- O sekmeye `REFERENCES` ile bağlı node'lar → ilişkideki `x, y`'de (referans/imported,
  origin = node.homeTabId).
- Edge'ler: iki ucu da o sekmede görünen (owned veya referenced) edge'ler çizilir.

## 3. API yüzeyi (çoğu additive — mevcut bozulmuyor)

**Yeni Tabs modülü:**
| Endpoint | İş |
|---|---|
| `POST /projects/:id/tabs` | sekme oluştur `{ name, moduleNodeId? }` |
| `GET /projects/:id/tabs` | sekme listesi |
| `GET /projects/:id/tabs/:tabId` | sekme detayı (owned + referenced üyeler, pozisyon, origin) |
| `GET /projects/:id/tabs/:tabId/graph` | render içeriği: pozisyonlu node'lar + aralarındaki edge'ler |
| `PATCH /projects/:id/tabs/:tabId` | yeniden adlandır / sırala |
| `DELETE /projects/:id/tabs/:tabId` | sekme sil (default silinemez; owned node'ların evi default'a taşınır, referanslar kaldırılır) |
| `PUT /projects/:id/tabs/:tabId/references/:nodeId` | node'u sekmeye import et / referans konumunu güncelle `{ x, y }` |
| `DELETE /projects/:id/tabs/:tabId/references/:nodeId` | referansı kaldır (node silinmez) |
| `PATCH /projects/:id/tabs/:tabId/layout` | toplu konum kaydet `[{ nodeId, x, y }]` (canvas drag perf; owned → node.position, referenced → REFERENCES.x/y) |

**Mevcut endpoint'lerde küçük değişiklik:**
- **Node create** (`POST /projects/:id/nodes`): opsiyonel `homeTabId` (verilmezse projenin
  default sekmesi). `position` aynen alınır (ev konumu). Node + homeTab ataması.
- **graph/apply** + **ai/chat**: opsiyonel `tabId` (üretilen node'ların `homeTabId`'si;
  verilmezse default sekme). Grid konumları node.position'a yazılır (bugünküyle aynı).
- **GET /projects/:id/graph**: DEĞİŞMEZ — mantıksal graf + node.position (ev konumu)
  döner. AI ve pattern-promote pozisyon kullanmadığından etkilenmez.

## 4. Migration (yıkıcı değil)

`005-tabs.ts` (idempotent):
- Her projeye `:Tab { name:"Ana Mimari", isDefault:true, order:0 }` oluştur (yoksa).
- Her node'un `homeTabId`'sini o default sekmeye ata (yoksa).
- node.position KORUNUR (silinmez). Tekrar çalıştırmak güvenli.
- Constraint: `tab_id_unique`.

## 5. Kenar durumlar / kurallar

- Bir node birden çok sekmede referans edilebilir; evi tektir.
- Default sekme silinemez (`ERR_TAB_DEFAULT_DELETE`).
- Sekme silinince: owned node'ların `homeTabId`'si default sekmeye taşınır (node kaybolmaz),
  o sekmedeki REFERENCES'lar kaldırılır.
- Node silinince (mevcut cascade genişler): node + tüm REFERENCES'ları + edge'leri silinir.
- Aynı node'u kendi ev sekmesine referans olarak eklemek reddedilir (`ERR_TAB_SELF_REFERENCE`).
- Olmayan sekme/node: `ERR_TAB_NOT_FOUND` / `ERR_NODE_NOT_FOUND`.

## 6. Moduller + test

- Yeni `src/tabs/` (schema/repo/service/controller/module), ProjectsModule/NodesModule
  desenini izler; ProjectsRepository (proje var mı) + NodesRepository (node var mı) inject.
- Etkilenen: nodes (homeTabId), graph (apply tabId), ai (tabId) — küçük dokunuşlar.
- **Test:**
  - Unit: tab schema (Zod), tabs repo (Cypher mock — tab CRUD + reference upsert/remove +
    tab graph), tabs service (default tab koruması, sekme silince home taşıma, self-reference
    reddi), node create homeTabId default.
  - E2E (Testcontainers): sekme CRUD + node import (reference) + tab graph (owned+referenced)
    + sekme silince home taşıma + migration round-trip. Mevcut node/apply e2e'leri homeTabId
    ile güncelle.

## 7. Out of scope (sonraki fazlar)

- View sekmeleri (Infrastructure/DBSchema/Flow filtreli, auto-layout).
- Semantik zoom / Makro-Graf (Nexus) görünümü — frontend render konusu, backend verisi yeter.
- Sekme bazlı erişim/paylaşım.

## 8. Açık notlar

- node.position korunduğu için tüm mevcut akışlar (apply/AI/CRUD/graph) çalışmaya devam eder;
  bu faz büyük ölçüde **additive**.
- Frontend (custom Canvas 2D) bir sekmeyi `GET /tabs/:id/graph` ile çeker; referans node'ları
  görsel olarak "import" rozetiyle (origin) gösterir.
- `moduleNodeId` v1'de yalnızca saklanır; drill-down otomasyonu frontend'de.
