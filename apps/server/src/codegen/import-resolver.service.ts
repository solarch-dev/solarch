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
 * import-resolver.service.ts — BOUNDARY: AI = ALGORITHM, SYSTEM = IDENTITY + IMPORT.
 *
 * Surgical AI only writes method BODIES (algorithm) and references types BY NAME;
 * it CANNOT add imports (only body is written). Imports are the SYSTEM's deterministic job.
 *
 * When codegen.generate re-injects saved bodies into fresh skeleton, only BODY is preserved
 * so imports drop -> "Cannot find name" (owned entity/DTO/enum/exception +
 * typeorm operator). This service writes generated project to temp dir and runs `solarch fix-imports`
 * (AI NONE, tsc NONE — pure ts-morph fixMissingImports + owned preference) to wire imports.
 *
 * Why subprocess (not in-memory): backend's ts-morph/ast-core dependency is NONETUR
 * (intentional isolation, same as codegen-fill). Also typeorm operators (ILike) need node_modules
 * -> warm deps cache is symlinked. Best effort: if cache missing/error, files
 * return UNCHANGED (generation never blocked).
 * ──────────────────────────────────────────────────────────────────────── */
@Injectable()
export class ImportResolverService {
  private readonly logger = new Logger(ImportResolverService.name);

  /** Resolve missing imports in filled files (deterministic). Returns files with imports
   *  wired; on any error returns input UNCHANGED (non-fatal). */
  async resolveImports(files: GeneratedFile[]): Promise<GeneratedFile[]> {
    if (files.length === 0) return files;
    const dir = await mkdtemp(join(tmpdir(), "solarch-fiximp-"));
    try {
      for (const f of files) {
        const abs = join(dir, f.path);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, f.content);
      }
      // typeorm operators (ILike etc.) need node_modules; owned types resolve regardless.
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
      // Read back import-fixed files; unchanged ones return as-is.
      const resolved = await Promise.all(
        files.map(async (f) => {
          try {
            return { ...f, content: await readFile(join(dir, f.path), "utf8") };
          } catch {
            return f;
          }
        }),
      );
      // OBSERVABILITY: silent best-effort hides failures. Log how many files actually
      // changed imports -> "thought app was clean but export has Cannot-find-name"
      // surprise diagnosable from log (0 -> fix-imports didn't run/failed; N -> ran).
      const changed = resolved.filter((f, i) => f.content !== files[i].content).length;
      this.logger.log(
        `import-resolver: imports resolved in ${changed}/${files.length} files` +
          (depsDir ? "" : " (no deps cache → owned types only; cache required for library imports)"),
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
