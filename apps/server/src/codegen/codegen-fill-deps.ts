import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "@nestjs/common";
import { fillDepsPackageJson } from "./emitters/nestjs/scaffold.emitter";

/* ────────────────────────────────────────────────────────────────────────
 * codegen-fill-deps.ts — warm node_modules cache for VERIFIED in-app fill.
 *
 * Server needs deps to run tsc/jest; `npm install` per fill is slow + flaky. Codegen
 * always emits same NestJS+TypeORM SUPERSET, so install superset ONCE in cache dir
 * and symlink into each fill's temp dir.
 *
 * Canonical package.json comes directly from codegen's buildPackageJson
 * (fillDepsPackageJson) -> cache covers every package generated code can import;
 * new dep auto-included when added (no drift).
 *
 * When install fails (no npm / offline) returns null -> caller falls back to --skip-verify DRAFT
 * path (draft without verification; CLI/VS Code channel stays tsc-proven).
 * ──────────────────────────────────────────────────────────────────────── */

/** Cache root directory. Set via env to point at persistent volume in prod. */
export const FILL_DEPS_CACHE_DIR =
  process.env.SOLARCH_FILL_DEPS_CACHE ?? join(tmpdir(), "solarch-fill-deps");

let ensurePromise: Promise<string | null> | null = null;

/** Set up cache (once) and return root path where node_modules lives; null if
 *  cannot install. Memoized: concurrent fills join single install. On failure promise
 *  reset -> next fill retries (no permanent lock). */
export function ensureFillDepsCache(logger?: Logger): Promise<string | null> {
  if (!ensurePromise) {
    ensurePromise = buildCache(logger).catch((e) => {
      logger?.warn(`fill deps cache unavailable → draft mode: ${(e as Error).message}`);
      ensurePromise = null;
      return null;
    });
  }
  return ensurePromise;
}

async function buildCache(logger?: Logger): Promise<string> {
  const nodeModules = join(FILL_DEPS_CACHE_DIR, "node_modules");
  if (await exists(nodeModules)) return FILL_DEPS_CACHE_DIR;

  await mkdir(FILL_DEPS_CACHE_DIR, { recursive: true });
  await writeFile(join(FILL_DEPS_CACHE_DIR, "package.json"), fillDepsPackageJson());
  logger?.log(`building fill deps cache (one-time npm install) at ${FILL_DEPS_CACHE_DIR}…`);
  await npmInstall(FILL_DEPS_CACHE_DIR);
  if (!(await exists(nodeModules))) throw new Error("npm install finished but node_modules missing");
  logger?.log("fill deps cache ready");
  return FILL_DEPS_CACHE_DIR;
}

function npmInstall(cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], {
      cwd,
      env: process.env,
    });
    let err = "";
    child.stderr.on("data", (d) => {
      err += String(d);
    });
    child.on("error", reject); // npm not on PATH
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`npm install exit ${code}: ${err.slice(0, 300)}`))));
  });
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
