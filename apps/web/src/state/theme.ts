/** Theme state — app-wide dark/light switch (workspace-view twin).
 *
 *  A single value (`mode`) flips the whole app: the store applies the `<html>.dark` class
 *  + color-scheme, writes the preference to localStorage, and signals the canvas renderer to
 *  repaint via the "solarch:theme-change" event. CSS variables (`:root` ↔ `.dark`, src/index.css)
 *  swap the actual colors; this store is only the switch.
 *
 *  - mode:      user's choice — "system" (follow OS) | "light" | "dark".
 *  - resolved:  theme actually applied — "light" | "dark" (resolved from OS when system).
 *  - setMode:   user choice (writes to localStorage + applies).
 *  - cycle:     System → Light → Dark cycle for the menu toggle.
 *  - hydrate:   adopt from Clerk metadata (on sign-in; also mirrors to localStorage).
 *  - syncSystem: re-resolve when OS preference changes (only when mode==="system").
 *
 *  First-paint: the inline script in index.html has already applied the class (no FOUC); on init
 *  this store does not touch the DOM, it only reads the same value. */

import { create } from "zustand";

export type ThemeMode = "system" | "light" | "dark";
type Resolved = "light" | "dark";

const STORAGE_KEY = "solarch:theme";

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(mode: ThemeMode): Resolved {
  if (mode === "system") return systemPrefersDark() ? "dark" : "light";
  return mode;
}

function readStoredMode(): ThemeMode {
  try {
    const m = localStorage.getItem(STORAGE_KEY);
    if (m === "light" || m === "dark" || m === "system") return m;
  } catch {
    /* no storage */
  }
  return "system";
}

function persist(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* no storage — this session only */
  }
}

/** Apply the resolved theme to <html> + signal the canvas to repaint. */
function applyResolved(resolved: Resolved): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.classList.toggle("dark", resolved === "dark");
  el.style.colorScheme = resolved;
  // The canvas renderer does not read CSS variables; notify it to repaint once.
  window.dispatchEvent(new Event("solarch:theme-change"));
}

interface ThemeState {
  mode: ThemeMode;
  resolved: Resolved;
  setMode: (mode: ThemeMode) => void;
  cycle: () => void;
  hydrate: (mode: ThemeMode) => void;
  syncSystem: () => void;
}

const initialMode = readStoredMode();
const CYCLE: ThemeMode[] = ["system", "light", "dark"];

export const useTheme = create<ThemeState>((set, get) => ({
  mode: initialMode,
  resolved: resolve(initialMode),
  setMode: (mode) => {
    persist(mode);
    const resolved = resolve(mode);
    applyResolved(resolved);
    set({ mode, resolved });
  },
  cycle: () => {
    const next = CYCLE[(CYCLE.indexOf(get().mode) + 1) % CYCLE.length]!;
    get().setMode(next);
  },
  hydrate: (mode) => {
    persist(mode);
    const resolved = resolve(mode);
    applyResolved(resolved);
    set({ mode, resolved });
  },
  syncSystem: () => {
    if (get().mode !== "system") return;
    const resolved = resolve("system");
    if (resolved !== get().resolved) {
      applyResolved(resolved);
      set({ resolved });
    }
  },
}));
