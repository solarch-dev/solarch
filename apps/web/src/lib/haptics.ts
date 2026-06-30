/** Web Vibration API wrapper — haptic feedback.
 *
 *  REALITY (deep-research 2026-06-26): Android Chrome supports
 *  `navigator.vibrate`; iOS Safari SILENTLY IGNORES it (returns no-op). So haptics
 *  can never be the SOLE feedback — every vibration must have a visual counterpart.
 *  Haptics are only "a nice extra layer".
 *
 *  Opt-out layers: prefers-reduced-motion + user setting (localStorage).
 *  All guarded; on unsupported environments a fully silent no-op. */

const KEY = "solarch:haptics";

function supported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

function allowed(): boolean {
  if (!supported()) return false;
  if (typeof window !== "undefined") {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
    try {
      if (window.localStorage?.getItem(KEY) === "off") return false;
    } catch {
      /* ignore if localStorage is inaccessible (private mode) */
    }
  }
  return true;
}

function buzz(pattern: number | number[]): void {
  if (!allowed()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* no-op */
  }
}

/** Light tick — selection, snap-to-grid, first touch of tap-to-connect. */
export const hapticTap = (): void => buzz(10);
/** Medium confirm — successful connection / commit / drop. */
export const hapticConfirm = (): void => buzz([12, 24, 12]);
/** Warning — invalid action / rejected edge / boundary. */
export const hapticWarn = (): void => buzz([8, 40, 8, 40, 8]);

export function setHapticsEnabled(on: boolean): void {
  try {
    window.localStorage?.setItem(KEY, on ? "on" : "off");
  } catch {
    /* no-op */
  }
}

/** Whether haptics are actually working right now (support + permission). For the UI setting. */
export function hapticsActive(): boolean {
  return allowed();
}

/** Whether the device supports haptics (to decide whether to show the setting row). */
export function hapticsSupported(): boolean {
  return supported();
}
