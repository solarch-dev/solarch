import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { assembleRealisticFixture } from "./__fixtures__/load";
import { ensureFillDepsCache } from "./codegen-fill-deps";

/* ────────────────────────────────────────────────────────────────────────
 * codegen-tsc.gate.test.ts — BÜTÜN-PROJE TSC GEÇİDİ ("compiles out of the box").
 *
 * Gerçekçi grafı assemble eder → geçici dizine yazar → sıcak deps cache'ini
 * (ensureFillDepsCache, in-app verified-fill ile AYNI) node_modules olarak symlink'ler
 * → üretilen projeye `tsc --noEmit` koşar → 0 hata bekler. Bu, iskeletin GERÇEKTEN
 * derlendiğinin makine-kanıtıdır (README'nin "compiles out of the box" sözü).
 *
 * AYRI çalışır (`*.gate.test.ts`, `*.spec.ts` DEĞİL → default `pnpm test`'e girmez):
 * yavaş + node_modules gerektirir. `pnpm test:codegen-gate` ile / CI'da koşulur.
 *   - Cache kurulamazsa (npm yok / offline) ATLAR (gürültülü uyarı; CI npm sağlamalı).
 *   - Yerel: SOLARCH_FILL_DEPS_CACHE ile hazır bir node_modules'e işaret edilebilir.
 *
 * NOT: bu geçit İSKELET'i derler (gövdeler `throw NOT_IMPLEMENTED`). Cast-ile-gizli
 * (PK casing) ve fill-sonrası (kardinalite) dikiş bug'ları burada GÖRÜNMEZ — onlar
 * codegen-assembly.spec.ts'teki yapısal seam-assertion'larıyla kilitlenir. İki geçit
 * BİRLİKTE "verified, not guessed" sağlar.
 * ──────────────────────────────────────────────────────────────────────── */

const GATE_TIMEOUT = 600_000;

describe("codegen bütün-proje tsc geçidi (gerçekçi graf)", () => {
  it(
    "üretilen iskelet tsc'den 0 hatayla geçer",
    async (ctx) => {
      const files = assembleRealisticFixture();

      const depsDir = await ensureFillDepsCache();
      if (!depsDir) {
        const msg =
          "verified-deps cache yok (npm/offline) → tsc geçidi koşulamadı. " +
          "Yerelde SOLARCH_FILL_DEPS_CACHE ile hazır node_modules verilebilir.";
        // FALSE-GREEN KORUMASI: CI'da skip = sessiz yeşil. CI'da deps SAĞLANMALI;
        // sağlanmadıysa geçidi FAIL et (atlama yalnız yerel geliştirmede).
        if (process.env.CI) throw new Error(`[tsc-gate] ${msg} CI'da geçit atlanamaz.`);
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
        // Sıcak cache'i node_modules olarak symlink'le (kopya yok, hızlı).
        await symlink(join(depsDir, "node_modules"), join(dir, "node_modules"), "dir");

        const { code, output } = await runTsc(dir);
        expect(code, `üretilen iskelet tsc'den GEÇMEDİ:\n${output}`).toBe(0);
      } finally {
        // ÖNCE symlink'i ayrı kaldır → rm paylaşılan cache'e inmesin.
        await unlink(join(dir, "node_modules")).catch(() => {});
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
    GATE_TIMEOUT,
  );
});

/** Üretilen projede `tsc --noEmit -p tsconfig.json` koşar. tsc'yi node ile doğrudan
 *  çağırır (.bin shim'ine değil) → platform-bağımsız. stdout+stderr birleşik döner. */
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
