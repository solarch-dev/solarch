import { Check } from "lucide-react";
import { MIN_PASSWORD_LENGTH, MIN_PASSWORD_SCORE, type PwStrength } from "./password-strength";

/** Below the password field: length check + zxcvbn strength bar + label + hint. */
export function PasswordStrength({ password, strength }: { password: string; strength: PwStrength }) {
  if (!password) return null;

  const lengthOk = password.length >= MIN_PASSWORD_LENGTH;
  const scoreOk = strength.score >= MIN_PASSWORD_SCORE;
  const color = scoreOk ? "#16a34a" : strength.score === 2 ? "#d97706" : "#dc2626";

  return (
    <div className="-mt-2 space-y-1.5">
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="h-1 flex-1 rounded-full transition-colors"
            style={{ backgroundColor: i < strength.score ? color : "var(--hairline)" }}
          />
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 font-mono text-[12.5px]">
        <span className="flex items-center gap-1.5">
          <span className="grid size-3.5 place-items-center">
            {lengthOk ? (
              <Check className="size-3.5 text-[#16a34a]" strokeWidth={2.5} />
            ) : (
              <span className="size-1.5 rounded-full bg-[color:var(--ink-faint)]" />
            )}
          </span>
          <span className={lengthOk ? "text-[#16a34a]" : "text-[color:var(--ink-faint)]"}>
            At least {MIN_PASSWORD_LENGTH} characters
          </span>
        </span>
        <span style={{ color }}>{strength.label}</span>
      </div>

      {!scoreOk && strength.warning && (
        <p className="font-mono text-[12px] text-[color:var(--ink-faint)]">{strength.warning}</p>
      )}
    </div>
  );
}
