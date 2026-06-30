import { useEffect, useRef } from "react";

/* In-card ASCII flicker — black mono characters appearing in random clusters
   over an orange ground, scrambling, then fading out. Reduced-motion →
   dim static scatter. (Identical to solarch-landing pricing-section.) */

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@$%&*+=?!<>{}[]/";
const BLOCK = 16;
const INK = "15, 15, 14";
const ri = (n: number) => Math.floor(Math.random() * n);
const rnd = () => CHARS[ri(CHARS.length)];

type Cell = { ch: string; level: number; target: number; dead: number; scr: boolean; last: number };

export function AsciiCardFx({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let cols = 0;
    let rows = 0;
    let cells: Cell[] = [];
    const active = new Set<number>();
    let raf = 0;
    let lastSpawn = 0;
    let visible = true;

    function build() {
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / BLOCK);
      rows = Math.ceil(h / BLOCK);
      cells = new Array(cols * rows);
      for (let i = 0; i < cells.length; i++) {
        cells[i] = { ch: rnd(), level: 0, target: 0, dead: 0, scr: false, last: 0 };
      }
      active.clear();
    }

    function spawn(now: number) {
      let cur = ri(cols * rows);
      const n = 2 + ri(5);
      for (let i = 0; i <= n; i++) {
        const cell = cells[cur];
        if (cell) {
          cell.target = 1;
          cell.dead = now + 480 + ri(320);
          cell.scr = Math.random() < 0.6;
          cell.last = now;
          active.add(cur);
        }
        const c = cur % cols;
        const r = (cur - c) / cols;
        const nc = c + (ri(3) - 1);
        const nr = r + (ri(3) - 1);
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) break;
        cur = nr * cols + nc;
      }
    }

    function frame(now: number) {
      raf = 0;
      if (!visible) return;
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;

      if (now - lastSpawn > 120) {
        const bursts = Math.max(1, Math.round((cols * rows) / 260));
        for (let b = 0; b < bursts; b++) spawn(now);
        lastSpawn = now;
      }

      ctx!.clearRect(0, 0, w, h);
      ctx!.textAlign = "center";
      ctx!.textBaseline = "middle";
      ctx!.font = `500 ${Math.round(BLOCK * 0.62)}px "JetBrains Mono", monospace`;

      for (const idx of active) {
        const cell = cells[idx];
        if (now > cell.dead) cell.target = 0;
        cell.level += (cell.target - cell.level) * 0.16;
        if (cell.target === 0 && cell.level < 0.02) {
          cell.level = 0;
          active.delete(idx);
          continue;
        }
        if (cell.scr && now - cell.last > 90) {
          cell.ch = rnd();
          cell.last = now;
        }
        const c = idx % cols;
        const r = (idx - c) / cols;
        ctx!.fillStyle = `rgba(${INK},${cell.level * 0.5})`;
        ctx!.fillText(cell.ch, c * BLOCK + BLOCK / 2, r * BLOCK + BLOCK / 2);
      }

      raf = requestAnimationFrame(frame);
    }

    function drawStatic() {
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      ctx!.clearRect(0, 0, w, h);
      ctx!.textAlign = "center";
      ctx!.textBaseline = "middle";
      ctx!.font = `500 ${Math.round(BLOCK * 0.62)}px "JetBrains Mono", monospace`;
      for (let i = 0; i < cells.length; i++) {
        if (Math.random() > 0.08) continue;
        const c = i % cols;
        const r = (i - c) / cols;
        ctx!.fillStyle = `rgba(${INK},0.22)`;
        ctx!.fillText(cells[i].ch, c * BLOCK + BLOCK / 2, r * BLOCK + BLOCK / 2);
      }
    }

    build();
    if (reduce) {
      drawStatic();
    } else {
      raf = requestAnimationFrame(frame);
    }

    const ro = new ResizeObserver(() => {
      build();
      if (reduce) drawStatic();
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          visible = e.isIntersecting;
          if (visible && !reduce && !raf) {
            lastSpawn = 0;
            raf = requestAnimationFrame(frame);
          }
        }
      },
      { threshold: 0 },
    );
    io.observe(canvas);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
