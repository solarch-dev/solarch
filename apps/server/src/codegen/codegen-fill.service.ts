import { Injectable, Logger } from "@nestjs/common";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { CodegenService } from "./codegen.service";
import { SurgicalFillRepository } from "./surgical-fill.repository";
import { ensureFillDepsCache } from "./codegen-fill-deps";
import type { CodegenTarget, GeneratedFile } from "./types";

/** Eszamanli doldurulacak DOSYA sayisi (env ile ayarlanir; ayni dosyanin bolgeleri
 *  her zaman sirali). */
const FILL_PARALLEL = Math.max(1, Number.parseInt(process.env.SOLARCH_FILL_PARALLEL ?? "6", 10) || 6);

/** Resolve the @solarch/cli `fill` entry point. It runs as a subprocess so the server's
 *  dependency tree stays clean (no ts-morph/ast-core in-process) while the full fill engine
 *  (tool-calling agent + validators) is reused as-is.
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

/** Fill akis olaylari — SSE'ye birebir map'lenir. */
export type FillEvent =
  | { event: "start"; fileCount: number; markerCount: number }
  | { event: "mode"; verified: boolean; withTests: boolean; reason?: string }
  | { event: "region"; status: string; nodeId?: string; member: string; file: string; attempts: number; violations?: string[]; error?: string; body?: string }
  | { event: "phase"; kind: string; round?: number; ok?: boolean; errorCount?: number; file?: string; member?: string; files?: number; skipped?: boolean }
  // GOZLEM: fill ajaninin tool eylemi (read/grep/glob/lookup_members/verify_fill). KALICI NOT —
  // yalniz canli akar (persistRegion'a girmez). Ozet GUVENLI (kod govdesi / secret deger NONE).
  | { event: "activity"; member: string; file: string; tool: string; summary: string; ok?: boolean; attempt?: number }
  | { event: "report"; filled: number; violations: number; errors: number; typecheck?: { ok: boolean }; tests?: { ok: boolean; skipped?: boolean } }
  | { event: "files"; files: GeneratedFile[] }
  | { event: "error"; message: string; code?: string };

/** Surgical AI (sunucu-tarafi) — Constructor iskeletinin `@solarch:surgical`
 *  bolgelerini AI'la doldurur. Akis: assemble (DB'siz) → gecici dizine yaz →
 *  sicak deps cache'ini node_modules olarak symlink'le → `solarch fill --all
 *  --parallel N --json` subprocess'i (DOGRULANMIS: tsc dongude, opsiyonel jest) →
 *  NDJSON ilerleme + faz olaylarini stream et → dolu dosyalari geri oku → temizle.
 *
 *  Dogrulama: deps cache (codegen-fill-deps) kurulabildiyse temp dizine node_modules
 *  symlink edilir → CLI gercek `tsc` kosar, hatali bolgeleri onarir (parallel). Cache
 *  yoksa (npm yok / offline) `--skip-verify` TASLAK yoluna dusulur + `mode` olayi
 *  verified:false der. jest ("derin dogrula") opsiyoneldir (withTests). */
@Injectable()
export class CodegenFillService {
  private readonly logger = new Logger(CodegenFillService.name);

  constructor(
    private readonly codegen: CodegenService,
    private readonly surgicalFills: SurgicalFillRepository,
  ) {}

  async *fill(
    projectId: string,
    target: CodegenTarget,
    signal?: AbortSignal,
    opts?: { withTests?: boolean },
  ): AsyncGenerator<FillEvent> {
    // service.generate proje yoksa NotFoundException atar → controller'a duser.
    const project = await this.codegen.generate(projectId, target);
    const markerCount = project.files.reduce((s, f) => s + (f.surgicalMarkers ?? 0), 0);
    if (markerCount === 0) {
      yield { event: "report", filled: 0, violations: 0, errors: 0 };
      yield { event: "files", files: project.files };
      return;
    }

    const dir = await mkdtemp(join(tmpdir(), "solarch-fill-"));
    try {
      for (const f of project.files) {
        const abs = join(dir, f.path);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, f.content);
      }
      yield { event: "start", fileCount: project.files.length, markerCount };

      // Dogrulama bagimliliklari: sicak cache'i node_modules olarak symlink'le.
      // SESSIZ DRAFT NONE — verified saglanamiyorsa acik, tekrar-denenebilir hata ver
      // ("app'te temiz, lokalde tsc hatasi" surprizini engelle). Cache startup'ta warm
      // edilir (CodegenDepsWarmupService); bu hata yalniz warm henuz bitmediyse/basarisizsa.
      const depsDir = await ensureFillDepsCache(this.logger);
      let verified = false;
      let unverifiedReason = "verified-deps cache unavailable (npm/network at startup)";
      if (depsDir) {
        try {
          await symlink(join(depsDir, "node_modules"), join(dir, "node_modules"), "dir");
          verified = true;
        } catch (e) {
          unverifiedReason = `node_modules symlink failed: ${(e as Error).message}`;
        }
      }
      if (!verified) {
        this.logger.warn(`fill refused (unverified): ${unverifiedReason}`);
        yield {
          event: "error",
          code: "ERR_FILL_UNVERIFIED",
          message: `Verified fill is temporarily unavailable (${unverifiedReason}). Please try again in a moment — or use the CLI, which verifies locally.`,
        };
        return;
      }

      const withTests = opts?.withTests === true;
      yield { event: "mode", verified: true, withTests };

      const args = [CLI_ENTRY, "fill", "--all", "--parallel", String(FILL_PARALLEL), "--json"];
      if (withTests) args.push("--with-tests");
      const child = spawn(process.execPath, args, {
        cwd: dir,
        env: process.env,
      });
      const onAbort = () => child.kill("SIGTERM");
      signal?.addEventListener("abort", onAbort);

      let stderr = "";
      child.stderr.on("data", (d) => {
        stderr += String(d);
      });

      // stdout NDJSON — satir satir parse et; dolan bolgeyi ANINDA kalici sakla, sonra yield.
      const rl = createInterface({ input: child.stdout });
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let ev: FillEvent;
        try {
          ev = JSON.parse(trimmed) as FillEvent;
        } catch {
          continue; // json olmayan gurultu — atla
        }
        // Bolge doldugu an govdeyi bolge-bazinda kalici uygula (re-open dolu gorunur,
        // yarida kesilse de elde olan kalir). En iyi caba; hata fill'i bozmaz.
        if (ev.event === "region" && ev.nodeId) {
          await this.persistRegion(projectId, ev);
        }
        yield ev;
      }
      const code: number = await new Promise((res) => child.on("close", (c) => res(c ?? 0)));
      signal?.removeEventListener("abort", onAbort);
      if (code !== 0 && stderr) this.logger.warn(`fill subprocess exit ${code}: ${stderr.slice(0, 400)}`);

      // Dolu dosyalari geri oku (tumunu; degismeyenler aynen doner).
      const filled = await Promise.all(
        project.files.map(async (f) => {
          try {
            return { ...f, content: await readFile(join(dir, f.path), "utf8") };
          } catch {
            return f;
          }
        }),
      );
      yield { event: "files", files: filled };
    } finally {
      // FIRST node_modules symlink'ini AYRI kaldir → rm asla paylasilan cache'e
      // (symlink hedefine) inmesin. (fs.rm symlink'i izlemez ama kasitli garanti.)
      await unlink(join(dir, "node_modules")).catch(() => {});
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Bir "region" olayini DB'ye kalici uygula — DB bolgenin FINAL durumunu yansitsin.
   *
   *  Bir bolge AYNI fill akisinda once "filled" sonra "violation" emit edilebilir:
   *  ilk-dolum import'lar cozulmeden tip-denetler (gercek tip hatasi "Cannot find name"
   *  arkasina saklanir → "filled"); repair fazinda import'lar cozulunce hata gorunur ve
   *  model cozemezse bolge "violation"a duser. Bu yuzden:
   *   - "filled" → govdeyi yaz/uzerine yaz (gecerli sonuc).
   *   - "violation"/"error" → sakli (kirik) govdeyi SIL → bolge stub'a doner (stub DERLENIR,
   *     derlenmeyen govde KALICI NOT). 3 gundur GetVideo TS2322'sinin saklanma sebebi:
   *     "filled" kaydediliyor ama sonraki "violation" yok sayiliyordu → kirik govde kaliyordu.
   *  En iyi caba: persist hatasi fill akisini bozmaz. */
  private async persistRegion(projectId: string, ev: Extract<FillEvent, { event: "region" }>): Promise<void> {
    if (!ev.nodeId) return;
    if (ev.status === "filled" && ev.body) {
      await this.surgicalFills
        .upsert(projectId, ev.nodeId, ev.member, ev.body, new Date().toISOString())
        .catch((e) => this.logger.warn(`surgical fill persist failed (${ev.member}): ${(e as Error).message}`));
    } else if (ev.status === "violation" || ev.status === "error") {
      await this.surgicalFills
        .deleteOne(projectId, ev.nodeId, ev.member)
        .catch((e) => this.logger.warn(`surgical fill revert failed (${ev.member}): ${(e as Error).message}`));
    }
  }
}
