/* ────────────────────────────────────────────────────────────────────────
 * surgical.ts — Surgical marker + NOT_IMPLEMENTED gövdesi.
 *
 * Metot gövdeleri "algoritma alanıdır" — Constructor bunları YAZMAZ, yapılandırılmış
 * bir marker bırakır. Surgical AI (ayrı, sonraki aşama) yalnız bu işaretli
 * bölgeleri doldurur. Marker formatı SABİTTİR ve makinece ayrıştırılabilir.
 *
 * Format (tek satır comment + bilgi satırları):
 *
 *   // @solarch:surgical id=<nodeId>#<member>
 *   // <iş açıklaması>                         (varsa)
 *   // throws: ExceptionA, ExceptionB          (varsa)
 *   // deps: dep1, dep2                         (varsa)
 *
 * Gövde her zaman:
 *   throw new Error("NOT_IMPLEMENTED: <Class>.<member>");
 * ──────────────────────────────────────────────────────────────────────── */

export interface SurgicalMarkerInput {
  /** İşaretin ait olduğu node'un kalıcı UUID'si. */
  nodeId: string;
  /** Metot/üye adı (ör. "createUser"). */
  member: string;
  /** İş açıklaması — ne yapması gerektiği (tek/çok satır; satıra bölünür). */
  description?: string;
  /** Fırlatılabilir Exception node Name'leri. */
  throws?: string[];
  /** Erişilebilir bağımlılıklar (DI alan adları / repo / servis Name'leri). */
  deps?: string[];
}

const MARKER_PREFIX = "@solarch:surgical";

/** Yapılandırılmış surgical yorum bloku üretir (satır sonu DAHİL DEĞİL —
 *  çağıran kendi girintisini ekler). Determinizm: listeler verildiği SIRADA
 *  yazılır (emitter sıralamayı garanti eder), boşlar düşer. */
export function surgicalMarker(input: SurgicalMarkerInput): string {
  const lines: string[] = [`// ${MARKER_PREFIX} id=${input.nodeId}#${input.member}`];

  if (input.description) {
    for (const raw of input.description.split("\n")) {
      const t = raw.trim();
      if (t.length > 0) lines.push(`// ${t}`);
    }
  }
  if (input.throws && input.throws.length > 0) {
    lines.push(`// throws: ${input.throws.join(", ")}`);
  }
  if (input.deps && input.deps.length > 0) {
    lines.push(`// deps: ${input.deps.join(", ")}`);
  }
  return lines.join("\n");
}

/** Standart NOT_IMPLEMENTED gövde satırı.
 *  notImplemented("UsersService", "create") ->
 *    throw new Error("NOT_IMPLEMENTED: UsersService.create"); */
export function notImplemented(className: string, member: string): string {
  return `throw new Error("NOT_IMPLEMENTED: ${className}.${member}");`;
}

/** Bir içerik bloğundaki surgical marker sayısını (GeneratedFile.surgicalMarkers
 *  için) sayar. Tek kaynak: emitter'lar bunu kullanır, elle saymaz. */
export function countSurgicalMarkers(content: string): number {
  const markers = content.match(new RegExp(MARKER_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length ?? 0;
  // DOLDURULACAK bölge sayısı = marker − dolu damgası. Codegen bir bölgeyi DETERMİNİSTİK
  // olarak tam üretip `@solarch:filled by=codegen` damgaladıysa (ör. BullMQ queue producer),
  // o "doldurulacak" SAYILMAZ. Aksi halde gösterilen toplam (marker) fill'in işlediğinden
  // (NOT_IMPLEMENTED iskeletler) fazla olur → kullanıcı "71 yerine 69 ile başlıyor" görür.
  const filled = content.match(/@solarch:filled\b/g)?.length ?? 0;
  return Math.max(0, markers - filled);
}
