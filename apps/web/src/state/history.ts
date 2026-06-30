/** Undo/Redo — generic action stack.
 *  Each entry carries its own undo/redo logic as a closure.
 *  isReplaying: prevents new records during undo/redo (loop protection). */

import { create } from "zustand";

export interface HistoryEntry {
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
}

const MAX_HISTORY = 50;

interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
  isReplaying: boolean;
  record: (entry: HistoryEntry) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  clear: () => void;
}

export const useHistory = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  isReplaying: false,

  record: (entry) => {
    if (get().isReplaying) return;
    set((s) => ({ past: [...s.past, entry].slice(-MAX_HISTORY), future: [] }));
  },

  undo: async () => {
    const s = get();
    if (s.past.length === 0 || s.isReplaying) return;
    const entry = s.past[s.past.length - 1];
    set({ past: s.past.slice(0, -1), future: [...s.future, entry], isReplaying: true });
    try { await entry.undo(); } finally { set({ isReplaying: false }); }
  },

  redo: async () => {
    const s = get();
    if (s.future.length === 0 || s.isReplaying) return;
    const entry = s.future[s.future.length - 1];
    set({ past: [...s.past, entry], future: s.future.slice(0, -1), isReplaying: true });
    try { await entry.redo(); } finally { set({ isReplaying: false }); }
  },

  clear: () => set({ past: [], future: [], isReplaying: false }),
}));
