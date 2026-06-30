import { useEffect, useState } from "react";

/** Detects the touch / coarse-pointer environment CENTRALLY (single source).
 *
 *  - coarse  → primary pointer is a finger (phone / tablet / touchscreen)
 *  - noHover → no hover → don't rely on hover-only affordances (port/bend cursor)
 *  - isTouch → enable touch-friendly UI when either one is true
 *
 *  Note: matchMedia is listened to live (external monitor plug/unplug, stylus→finger switch). */
export interface TouchMode {
  coarse: boolean;
  noHover: boolean;
  isTouch: boolean;
}

function read(): TouchMode {
  if (typeof window === "undefined" || !window.matchMedia) {
    return { coarse: false, noHover: false, isTouch: false };
  }
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const noHover = window.matchMedia("(hover: none)").matches;
  return { coarse, noHover, isTouch: coarse || noHover };
}

export function useTouchMode(): TouchMode {
  const [mode, setMode] = useState<TouchMode>(read);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mqs = [
      window.matchMedia("(pointer: coarse)"),
      window.matchMedia("(hover: none)"),
    ];
    const onChange = () => setMode(read());
    mqs.forEach((m) => m.addEventListener("change", onChange));
    return () => mqs.forEach((m) => m.removeEventListener("change", onChange));
  }, []);
  return mode;
}

/** Instant read for non-hook (imperative / event handler) usage. */
export function isTouchEnv(): boolean {
  return read().isTouch;
}
