import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { assembleRealisticFixture } from "./__fixtures__/load";
import { ensureFillDepsCache } from "./codegen-fill-deps";

/* ────────────────────────────────────────────────────────────────────────
 * codegen-tsc.gate.test.ts — BUTUN-PROJE TSC GECIDI ("compiles out of the box").
 *
 * Gercekci grafi assemble eder → gecici dizine yazar → sicak deps cache'ini
 * (ensureFillDepsCache, in-app verified-fill ile AYNI) node_modules olarak symlink'ler
 * → uretilen projeye `tsc --noEmit` kosar → 0 hata bekler. Bu, iskeletin GERCEKTEN
 * derlendiginin makine-kanitidir (README'nin "compiles out of the box" sozu).
 *
 * AYRI calisir (`*.gate.test.ts`, `*.spec.ts` NOT → default `pnpm test`'e girmez):
 * yavas + node_modules gerektirir. `pnpm test:codegen-gate` ile / CI'da kosulur.
 *   - Cache kurulamazsa (npm yok / offline) ATLAR (gurultulu uyari; CI npm saglamali).
 *   - Yerel: SOLARCH_FILL_DEPS_CACHE ile hazir bir node_modules'e isaret edilebilir.
 *
 * NOT: bu gecit ISKELET'i derler (govdeler `throw NOT_IMPLEMENTED`). Cast-ile-gizli
 * (PK casing) ve fill-sonrasi (kardinalite) dikis bug'lari burada GORUNMEZ — onlar
 * codegen-assembly.spec.ts'teki yapisal seam-assertion'lariyla kilitlenir. Iki gecit
 * TOGETHER "verified, not guessed" saglar.
 * ──────────────────────────────────────────────────────────────────────── */

const GATE_TIMEOUT = 600_000;

describe("codegen butun-proje tsc gecidi (gercekci graf)", () => {
  it(
    "generated skeleton passes tsc with 0 errors",
    async (ctx) => {
      const files = assembleRealisticFixture();

      const depsDir = await ensureFillDepsCache();
      if (!depsDir) {
        const msg =
          "verified-deps cache missing (npm/offline) -> tsc gate could not run. " +
          "Locally provide ready node_modules via SOLARCH_FILL_DEPS_CACHE.";
        // FALSE-GREEN KORUMASI: CI'da skip = sessiz yesil. CI'da deps SAGLANMALI;
        // saglanmadiysa gecidi FAIL et (atlama yalniz yerel gelistirmede).
        if (process.env.CI) throw new Error(`[tsc-gate] ${msg} gate cannot be skipped in CI.`);
        console.warn(`[tsc-gate] ${msg} (yerel: ATLANDI)`);
        ctx.skip();
        return;
      }

      const dir = await mkdtemp(join(tmpdir(), "solarch-tsc-gate-"));
      try {
        for (const f of files) {
          const abs = join(dir, f.path);
          await mkdir(dirname(abs), { recursive: true });
          await writeFile(abs, f.content);
        }
        // Sicak cache'i node_modules olarak symlink'le (kopya yok, hizli).
        await symlink(join(depsDir, "node_modules"), join(dir, "node_modules"), "dir");

        const { code, output } = await runTsc(dir);
        expect(code, `generated skeleton did NOT pass tsc:\n${output}`).toBe(0);
      } finally {
        // FIRST symlink'i ayri kaldir → rm paylasilan cache'e inmesin.
        await unlink(join(dir, "node_modules")).catch(() => {});
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
    GATE_TIMEOUT,
  );
});

/** Uretilen projede `tsc --noEmit -p tsconfig.json` kosar. tsc'yi node ile dogrudan
 *  cagirir (.bin shim'ine degil) → platform-bagimsiz. stdout+stderr birlesik doner. */
function runTsc(cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const tscEntry = join(cwd, "node_modules", "typescript", "bin", "tsc");
    const child = spawn(process.execPath, [tscEntry, "--noEmit", "-p", "tsconfig.json"], {
      cwd,
      env: process.env,
    });
    let output = "";
    child.stdout.on("data", (d) => (output += String(d)));
    child.stderr.on("data", (d) => (output += String(d)));
    child.on("error", (e) => resolve({ code: 1, output: `tsc spawn error: ${e.message}` }));
    child.on("close", (c) => resolve({ code: c ?? 1, output }));
  });
}
