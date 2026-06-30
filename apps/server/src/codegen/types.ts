import type { NodeKind } from "../nodes/schemas";
import type { CodeGraph, CodeNode } from "./ir";

/* ────────────────────────────────────────────────────────────────────────
 * Constructor Codegen — paylaşılan tipler / sözleşme.
 *
 * TechnicalGraph (nodes + edges) -> DETERMINISTIK NestJS+TypeScript iskeleti.
 * AI YOK. Tüm emitter'lar SAF fonksiyonlardır: aynı graph -> byte-identical çıktı.
 *
 * Bu dosya "tek kaynak" (single source) — emitter ajanları yalnız buradaki ve
 * ir.ts / naming.ts / imports.ts / surgical.ts içindeki imzalara dayanır.
 * ──────────────────────────────────────────────────────────────────────── */

/** Hedef stack. v1 yalnız "nestjs" üretir; tip ileride genişler. */
export type CodegenTarget = "nestjs";

/** Üretilen bir dosyanın dili — formatlama/lint/snapshot ipucu. */
export type GeneratedLanguage = "typescript" | "sql" | "json" | "markdown" | "env";

/** Üretilen tek bir dosya. `path` proje köküne göreli POSIX yoludur (her zaman
 *  "/" ayraç, baş "/" YOK), ör. "users/users.service.ts". */
export interface GeneratedFile {
  /** Proje köküne göreli POSIX yolu (baş "/" yok). */
  path: string;
  /** Tam dosya içeriği. Sonu tek "\n" ile biter (POSIX). */
  content: string;
  /** Sözdizimi/format ipucu. */
  language: GeneratedLanguage;
  /** Bu dosyadaki surgical marker (@solarch:surgical) sayısı. */
  surgicalMarkers: number;
  /** Bu dosyayı ÜRETEN node'un kalıcı UUID'si (bir node-emitter çıktısı ise).
   *  scaffold (proje-genel), sentezlenen feature module ve sentetik entity gibi
   *  node'a BAĞLI OLMAYAN dosyalarda undefined. nodeFiles haritası bundan kurulur. */
  nodeId?: string;
}

/** Atlanan/stub'lanan node tipleri ve adetleri (summary için). */
export type SkippedKinds = Record<string, number>;

/** Codegen'in tam çıktısı — montajlanmış proje. */
export interface GeneratedProject {
  target: CodegenTarget;
  files: GeneratedFile[];
  /** node.id -> o node'un ÜRETTİĞİ dosya yolları (montaj sonrası nihai path'ler,
   *  ör. "src/users/users.service.ts" / "migrations/001_create_users.sql").
   *  Yalnız node-emitter çıktıları yer alır; scaffold/feature-module/sentetik
   *  entity gibi node'a bağlı olmayan dosyalar HARİÇ. Bir node birden çok dosya
   *  üretebilir (liste). Anahtarlar + yollar deterministik sıralı. */
  nodeFiles: Record<string, string[]>;
  /** Deterministik codegen uyarıları — üretim BAŞARILI ama yapısal bir karar
   *  kullanıcıya bildirilir (ör. karşılıklı feature module import'u tespit edilip
   *  döngü kırıldı: A<->B'de bir yön düşürüldü, forwardRef üretilmedi). İçerik
   *  girdiye göre deterministik + sıralı; uyarı yoksa boş dizi. (M4) */
  warnings: string[];
  summary: {
    /** Bu çıktıyı üreten Constructor sürümü (CODEGEN_VERSION). Üretilen kodun
     *  hangi nesil iskeleten geldiğini etiketler. */
    version: number;
    fileCount: number;
    nodeCount: number;
    surgicalMarkerCount: number;
    /** Emitter'ı OLAN ama stub üreten (kalan kapsam-dışı tip) + REGISTRY'de hiç
     *  yer almayan kind'ların adet dökümü. */
    skippedKinds: SkippedKinds;
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * EmitterContext — bir emitter'ın node'u koda çevirirken ihtiyaç duyduğu HER
 * şey. Emitter'lar I/O yapmaz, store'a erişmez; yalnız bu ctx + node üzerinden
 * çalışır (saflık + determinizm garantisi). ir.ts tarafından inşa edilir.
 * ──────────────────────────────────────────────────────────────────────── */
export interface EmitterContext {
  /** İlişki çözümleme + indeksler içeren çözümlenmiş graph. */
  readonly graph: CodeGraph;
  /** Hedef stack (şu an hep "nestjs"). */
  readonly target: CodegenTarget;
}

/* ────────────────────────────────────────────────────────────────────────
 * Emitter sözleşmesi.
 *
 * Üç biçim vardır; hepsi SAF fonksiyon, hepsi GeneratedFile[] döner:
 *
 *  1) NodeEmitter   — bir node'u dosya(lar)a çevirir. (node, ctx) -> GeneratedFile[].
 *                     Çoğu emitter tek dosya döner; bazıları (Module barrel,
 *                     Model+entity vb.) birden çok dönebilir. ASLA throw etmez;
 *                     kayıp ref'leri tolere eder (ctx.graph.resolveRef null dönerse
 *                     o satırı atla / TODO yorumu bırak).
 *
 *  2) StubEmitter   — desteklenmeyen 12 tip için. Aynı imza ama anlamca
 *                     "surgical-markerlı boş iskelet + edge özeti" üretir.
 *                     Tip olarak NodeEmitter ile aynıdır; ayrı isim yalnız niyet
 *                     belgeler. REGISTRY'de stub emitter da NodeEmitter yuvasına
 *                     girer.
 *
 *  3) ScaffoldEmitter — node'a BAĞLI OLMAYAN proje-seviyesi dosyalar
 *                       (package.json, tsconfig, main.ts, app.module.ts ...).
 *                       (ctx) -> GeneratedFile[]. Tek girdi: ctx.
 *
 * Emitter ajanları (1) ve (2)'yi yazar; (3) scaffold çekirdek tarafından sağlanır.
 * ──────────────────────────────────────────────────────────────────────── */

/** Bir node'u (veya stub'ı) dosya(lar)a çeviren saf fonksiyon. */
export type NodeEmitter = (node: CodeNode, ctx: EmitterContext) => GeneratedFile[];

/** Desteklenmeyen tip için stub üreten saf fonksiyon (NodeEmitter ile tip-aynı). */
export type StubEmitter = NodeEmitter;

/** Node'dan bağımsız proje-seviyesi dosya üreten saf fonksiyon. */
export type ScaffoldEmitter = (ctx: EmitterContext) => GeneratedFile[];

/** Bir nodeKind için kayıtlı emitter girdisi.
 *  `supported=true`  -> tam backend zinciri emitter'ı (Module/Controller/...).
 *  `supported=false` -> stub emitter (skippedKinds'e sayılır). */
export interface EmitterEntry {
  kind: NodeKind;
  emit: NodeEmitter;
  /** false ise summary.skippedKinds'e yazılır (sessizce düşmez). */
  supported: boolean;
}

/** nodeKind -> emitter eşlemesi. emitters/nestjs/index.ts bunu doldurur. */
export type EmitterRegistry = Partial<Record<NodeKind, EmitterEntry>>;
