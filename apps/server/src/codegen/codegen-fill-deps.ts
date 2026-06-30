import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "@nestjs/common";
import { fillDepsPackageJson } from "./emitters/nestjs/scaffold.emitter";

/* ────────────────────────────────────────────────────────────────────────
 * codegen-fill-deps.ts — DOĞRULANMIŞ in-app fill için sıcak node_modules cache.
 *
 * Sunucuda tsc/jest koşmak için bağımlılıklar gerekir; her fill'de `npm install`
 * yavaş + flaky. Codegen hep aynı NestJS+TypeORM SÜPERSET'ini ürettiğinden, bu
 * superset'i BİR KEZ bir cache dizinine kurup her fill'in temp dizinine symlink'leriz.
 *
 * Kanonik package.json doğrudan codegen'in buildPackageJson'undan gelir
 * (fillDepsPackageJson) → cache, üretilen kodun import edebileceği her paketi kapsar;
 * yeni bir dep eklenince otomatik dahil olur (drift yok).
 *
 * Kurulum başarısızsa (npm yok / offline) null döner → çağıran --skip-verify TASLAK
 * yoluna düşer (doğrulama yoksa taslak; CLI/VS Code kanalı tsc-kanıtlı kalır).
 * ──────────────────────────────────────────────────────────────────────── */

/** Cache kök dizini. Prod'da kalıcı bir volume'e işaret etmesi için env ile ayarlanır. */
export const FILL_DEPS_CACHE_DIR =
  process.env.SOLARCH_FILL_DEPS_CACHE ?? join(tmpdir(), "solarch-fill-deps");

let ensurePromise: Promise<string | null> | null = null;

/** Cache'i (bir kez) kur ve node_modules'ün bulunduğu kök yolu döndür; kurulamazsa
 *  null. Memoize: eşzamanlı fill'ler tek kuruluma biner. Başarısızlıkta promise
 *  sıfırlanır → sonraki fill tekrar dener (kalıcı kilitlenme yok). */
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
    child.on("error", reject); // npm PATH'te yoksa
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
