import { Injectable, Logger } from "@nestjs/common";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { ensureFillDepsCache } from "./codegen-fill-deps";
import type { GeneratedFile } from "./types";

/** Resolve the @solarch/cli entry point (subprocess isolation, same as codegen-fill).
 *  Order: explicit SOLARCH_CLI_ENTRY env → installed @solarch/cli (the default in this
 *  monorepo / Docker image) → sibling solarch-tools checkout (local tooling dev). */
function resolveCliEntry(): string {
  if (process.env.SOLARCH_CLI_ENTRY) return process.env.SOLARCH_CLI_ENTRY;
  try {
    return require.resolve("@solarch/cli");
  } catch {
    return join(process.cwd(), "..", "solarch-tools", "packages", "cli", "dist", "index.js");
  }
}
const CLI_ENTRY = resolveCliEntry();

/* ────────────────────────────────────────────────────────────────────────
 * import-resolver.service.ts — SINIR: AI = ALGORİTMA, SİSTEM = KİMLİK + IMPORT.
 *
 * Surgical AI yalnız metot GÖVDESİNİ (algoritmayı) yazar ve tipleri ADLA referans eder;
 * import EKLEYEMEZ (yalnız gövde yazılır). Import'lar SİSTEMİN deterministik işidir.
 *
 * codegen.generate kayıtlı gövdeleri taze iskelete re-inject ederken yalnız GÖVDE saklı
 * olduğu için import'lar düşer → "Cannot find name" (owned entity/DTO/enum/exception +
 * typeorm operatörü). Bu servis üretilen projeyi geçici dizine yazıp `solarch fix-imports`
 * (AI YOK, tsc YOK — saf ts-morph fixMissingImports + owned-tercih) ile import'ları bağlar.
 *
 * Neden subprocess (in-memory değil): backend'in ts-morph/ast-core bağımlılığı YOKTUR
 * (kasıtlı izolasyon, codegen-fill ile aynı). Ayrıca typeorm operatörleri (ILike) node_modules
 * ister → sıcak deps cache symlink'lenir. En iyi çaba: cache yoksa/hata olursa dosyalar
 * AYNEN döner (üretim asla bloklanmaz).
 * ──────────────────────────────────────────────────────────────────────── */
@Injectable()
export class ImportResolverService {
  private readonly logger = new Logger(ImportResolverService.name);

  /** Dolu dosyalardaki eksik import'ları çöz (deterministik). Dosyaları import'lanmış
   *  haliyle döndürür; herhangi bir hata olursa girdiyi AYNEN döndürür (non-fatal). */
  async resolveImports(files: GeneratedFile[]): Promise<GeneratedFile[]> {
    if (files.length === 0) return files;
    const dir = await mkdtemp(join(tmpdir(), "solarch-fiximp-"));
    try {
      for (const f of files) {
        const abs = join(dir, f.path);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, f.content);
      }
      // typeorm operatörleri (ILike vb.) node_modules ister; owned tipler ister istemez çözülür.
      const depsDir = await ensureFillDepsCache(this.logger);
      if (depsDir) {
        await symlink(join(depsDir, "node_modules"), join(dir, "node_modules"), "dir").catch((e) =>
          this.logger.warn(`import-resolver symlink failed (owned types still resolve): ${(e as Error).message}`),
        );
      }
      await new Promise<void>((res) => {
        const child = spawn(process.execPath, [CLI_ENTRY, "fix-imports", "--all", "--json"], { cwd: dir, env: process.env });
        let stderr = "";
        child.stderr.on("data", (d) => (stderr += String(d)));
        child.on("close", (c) => {
          if (c !== 0 && stderr) this.logger.warn(`fix-imports exit ${c}: ${stderr.slice(0, 300)}`);
          res();
        });
        child.on("error", (e) => {
          this.logger.warn(`fix-imports spawn failed: ${e.message}`);
          res();
        });
      });
      // import-fixed dosyaları geri oku; değişmeyenler aynen döner.
      const resolved = await Promise.all(
        files.map(async (f) => {
          try {
            return { ...f, content: await readFile(join(dir, f.path), "utf8") };
          } catch {
            return f;
          }
        }),
      );
      // GÖZLEMLENEBİLİRLİK: sessiz best-effort, başarısızlığı gizler. Kaç dosyada import
      // gerçekten değişti logla → "app'te temiz sandın ama export'ta Cannot-find-name"
      // sürprizi log'dan teşhis edilebilir (0 → fix-imports koşmadı/başarısız; N → çalıştı).
      const changed = resolved.filter((f, i) => f.content !== files[i].content).length;
      this.logger.log(
        `import-resolver: ${changed}/${files.length} dosyada import çözüldü` +
          (depsDir ? "" : " (deps cache yok → yalnız owned tipler; kütüphane import'ları için cache gerekir)"),
      );
      return resolved;
    } catch (e) {
      this.logger.warn(`import-resolver failed (best-effort): ${(e as Error).message}`);
      return files;
    } finally {
      await unlink(join(dir, "node_modules")).catch(() => {});
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
