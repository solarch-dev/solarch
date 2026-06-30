/* ────────────────────────────────────────────────────────────────────────
 * cardinality.ts — KOLEKSİYON KARDİNALİTESİNİN TEK KAYNAĞI.
 *
 * Bir operasyon (endpoint / service metodu) tekil mi yoksa koleksiyon mu döner?
 * Bu karar BİRDEN ÇOK emitter'da (controller + service) gerekir; ikisi farklı
 * sezgiye/kelime-kümesine dayanırsa imzalar UYUMSUZ olur (controller XDto[], service
 * XDto -> derleme hatası, surgical-output'taki ListProducts/ListOrders bug'ı). Bu
 * yüzden hem kelime kümesi hem de türetme TEK YERDE yaşar; emitter'lar yalnız buradan
 * okur.
 *
 * Öncelik (her iki emitter de UYGULAR):
 *   1) Bildirilmiş alan (Endpoint.ReturnsCollection / ServiceMethod.ReturnsCollection)
 *      — varsa KAZANIR (true de false da). "Bildirilen > tahmin."
 *   2) Tip zaten dizi mi (ReturnType "XDto[]" / "Array<...>").
 *   3) Ad/route liste-semantiği fallback'i (list/all/search + findAll/findMany).
 *
 * SAF + DETERMİNİSTİK: girdi-bağımlı, yan etkisiz, EXACT kelime eşleşmesi.
 * ──────────────────────────────────────────────────────────────────────── */

/** Tek başına bir koleksiyon-semantiği taşıyan kelimeler (EXACT eşleşme — substring
 *  DEĞİL; "listen"/"getAllowance" yanlış pozitif vermez). */
const COLLECTION_WORDS: ReadonlySet<string> = new Set(["list", "all", "search"]);

/** Yalnız BİTİŞİK haliyle koleksiyon olan kelimeler ("findAll" -> "findall"). */
const COLLECTION_JOINED: ReadonlySet<string> = new Set(["findall", "findmany"]);

/** Bir kelime dizisi (splitWords çıktısı) koleksiyon-semantiği taşıyor mu?
 *  controller (route segmenti) ve service (metot adı) AYNI bu fonksiyonu çağırır. */
export function tokensHaveCollectionSemantics(tokens: readonly string[]): boolean {
  const lower = tokens.map((t) => t.toLowerCase());
  if (COLLECTION_JOINED.has(lower.join(""))) return true;
  return lower.some((w) => COLLECTION_WORDS.has(w));
}

/** Bir TS tip string'i zaten bir koleksiyon mu? ("X[]" son-eki veya "Array<...>").
 *  Bildirilmiş/türetilmiş koleksiyonu İKİ KEZ sarmayı önler ("XDto[]" -> "[][]" OLMAZ). */
export function isArrayType(t: string): boolean {
  const s = t.trim();
  return s.endsWith("[]") || /^Array\s*</.test(s);
}
