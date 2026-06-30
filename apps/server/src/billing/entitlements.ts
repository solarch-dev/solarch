import { env } from "../config/env";

export type Plan = "guest" | "free" | "draw" | "build" | "code";
/** generations = AI diyagram üretimi · edits = AI düzenleme · questions = AI soru
 *  codegen = Constructor "Generate Code" (deterministik). canGenerateCode olmayan
 *  tier'lar (guest/free/draw) bu metreyle 4h'de 1 KEZ ücretsiz önizleme alır;
 *  Build/Code canGenerateCode ile sınırsız (bu metreyi tüketmez). */
export type Meter = "generations" | "edits" | "questions" | "codegen";

/** Kota penceresi: 4 saat. Tüm planların AI sayaçları bu pencereyle ölçülür
 *  (aylık sayaç YOK artık). Pencere UTC epoch bucket'ı — DST derdi yok. */
export const METER_WINDOW_MS = 4 * 60 * 60 * 1000;

export interface PlanLimits {
  projectCap: number; // -1 = sınırsız
  /** AI omni-bar erişimi. Artık TÜM planlarda açık — sınırı plan değil 4h kota koyar. */
  canUseAI: boolean;
  /** Generate Code / ZIP export (Constructor) SINIRSIZ. Build ve üzeri. (Altındaki
   *  tier'lar `meters.codegen` ile 4h'de 1 ücretsiz önizleme alır — değer-önce-kanıt.) */
  canGenerateCode: boolean;
  /** Surgical AI rezervi (Code tier) — deterministik codegen akışında KULLANILMAZ. */
  canCodegen: boolean;
  meters: Record<Meter, number>; // 4 saatlik pencere üst sınırı (0 = kapalı)
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  // guest = login'siz deneme (X-Guest-Token). 1 proje; AI tadımlık (1 üretim + 2 soru / 4h).
  guest: { projectCap: 1,  canUseAI: true, canGenerateCode: false, canCodegen: false, meters: { generations: 1,  edits: 0, questions: 2,  codegen: 1  } },
  free:  { projectCap: 2,  canUseAI: true, canGenerateCode: false, canCodegen: false, meters: { generations: 2,  edits: 0, questions: 4,  codegen: 1  } },
  // draw = free ile aynı AI hakkı; farkı sınırsız proje.
  draw:  { projectCap: -1, canUseAI: true, canGenerateCode: false, canCodegen: false, meters: { generations: 2,  edits: 0, questions: 4,  codegen: 1  } },
  // build/code canGenerateCode ile SINIRSIZ generate eder → codegen metresini tüketmez
  // (değer cosmetic; getState tutarlılığı için generations'ı yansıtır).
  build: { projectCap: -1, canUseAI: true, canGenerateCode: true,  canCodegen: false, meters: { generations: 10, edits: 0, questions: 20, codegen: 10 } },
  code:  { projectCap: -1, canUseAI: true, canGenerateCode: true,  canCodegen: true,  meters: { generations: 25, edits: 0, questions: 50, codegen: 25 } },
};

/** Polar product ID → plan. env boşsa eşleşmez. */
export function productIdToPlan(productId: string): Plan | null {
  if (productId && productId === env.POLAR_PRODUCT_DRAW) return "draw";
  if (productId && productId === env.POLAR_PRODUCT_BUILD) return "build";
  if (productId && productId === env.POLAR_PRODUCT_CODE) return "code";
  return null;
}

export function planToProductId(plan: Plan): string {
  return plan === "draw" ? env.POLAR_PRODUCT_DRAW
    : plan === "build" ? env.POLAR_PRODUCT_BUILD
    : plan === "code" ? env.POLAR_PRODUCT_CODE : "";
}

export const limitsFor = (plan: Plan): PlanLimits => PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

/** Hiyerarşik plan sırası — düşük/eşit plana checkout (downgrade) engellenir. */
export const PLAN_RANK: Record<Plan, number> = { guest: -1, free: 0, draw: 1, build: 2, code: 3 };
export const planRank = (plan: Plan): number => PLAN_RANK[plan] ?? 0;
