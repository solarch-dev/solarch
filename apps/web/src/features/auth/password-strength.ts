import { zxcvbn, zxcvbnOptions } from "@zxcvbn-ts/core";
import * as zxcvbnCommon from "@zxcvbn-ts/language-common";
import * as zxcvbnEn from "@zxcvbn-ts/language-en";

/* Clerk measures password strength with zxcvbn. We use the same library (zxcvbn-ts)
 * on the frontend to evaluate strength before sending a request. Dictionary + en translations are set once. */
zxcvbnOptions.setOptions({
  dictionary: { ...zxcvbnCommon.dictionary, ...zxcvbnEn.dictionary },
  graphs: zxcvbnCommon.adjacencyGraphs,
  translations: zxcvbnEn.translations,
});

export const MIN_PASSWORD_LENGTH = 8;
/** zxcvbn score 0–4. "Above Medium" accepted → at least 3 (Good). */
export const MIN_PASSWORD_SCORE = 3;

export type PwStrength = {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  warning: string;
};

const LABELS = ["Very weak", "Weak", "Medium", "Good", "Strong"] as const;

/** userInputs: predictable inputs like email (zxcvbn penalizes these). */
export function scorePassword(pw: string, userInputs: string[] = []): PwStrength {
  if (!pw) return { score: 0, label: "", warning: "" };
  const r = zxcvbn(pw, userInputs.filter(Boolean));
  const score = r.score as 0 | 1 | 2 | 3 | 4;
  return { score, label: LABELS[score], warning: r.feedback.warning ?? "" };
}
