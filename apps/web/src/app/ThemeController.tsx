/** ThemeController — bridges the theme store to the outside world (invisible, returns null).
 *
 *  Two bridges:
 *  1. OS preference: re-resolve when `prefers-color-scheme` changes (only mode==="system").
 *  2. Per-user persistence (Clerk): on sign-in, adopt the user's saved theme
 *     (single source across devices). If the user later changes the theme, mirror it to
 *     Clerk `unsafeMetadata.theme`. Guests have no Clerk → localStorage only (the store
 *     already writes it). Clerk is async; first paint is correct via localStorage, and once
 *     metadata arrives it is adopted ONCE (if it differs) → no flicker. */

import { useEffect, useRef } from "react";
import { useUser } from "@clerk/clerk-react";
import { useTheme, type ThemeMode } from "../state/theme";

function validMode(v: unknown): ThemeMode | undefined {
  return v === "light" || v === "dark" || v === "system" ? v : undefined;
}

export function ThemeController() {
  const { isLoaded, isSignedIn, user } = useUser();
  const mode = useTheme((s) => s.mode);
  const hydrate = useTheme((s) => s.hydrate);
  const syncSystem = useTheme((s) => s.syncSystem);
  const hydratedFor = useRef<string | null>(null);
  const lastWritten = useRef<ThemeMode | null>(null);

  // 1) OS preference changes (active only when mode==="system").
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => syncSystem();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [syncSystem]);

  // 2a) On sign-in: adopt the user's saved theme (source across devices).
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;
    if (hydratedFor.current === user.id) return;
    hydratedFor.current = user.id;
    const saved = validMode(user.unsafeMetadata?.theme);
    if (saved) {
      lastWritten.current = saved;
      hydrate(saved);
    } else {
      // No preference yet → seed the local choice into Clerk (so other devices match).
      lastWritten.current = mode;
      void user.update({ unsafeMetadata: { ...user.unsafeMetadata, theme: mode } }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, user?.id]);

  // 2b) When signed in and the theme changes → mirror it to Clerk (across devices).
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;
    if (hydratedFor.current !== user.id) return; // don't write before the initial adoption settles
    if (lastWritten.current === mode) return; // don't write back the adopted/written value (no loop)
    lastWritten.current = mode;
    void user.update({ unsafeMetadata: { ...user.unsafeMetadata, theme: mode } }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, isLoaded, isSignedIn]);

  return null;
}
