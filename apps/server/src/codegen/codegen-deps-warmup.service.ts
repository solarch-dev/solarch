import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ensureFillDepsCache } from "./codegen-fill-deps";

/* ────────────────────────────────────────────────────────────────────────
 * codegen-deps-warmup.service.ts — Warms surgical fill verified-deps cache at STARTUP
 * (once) -> first fill is ready immediately, "verified" mode guaranteed.
 *
 * Runs in background, does NOT BLOCK BOOT (npm install can take minutes; transient
 * npm/network issues must not take down entire backend). ensureFillDepsCache is memoized,
 * so first fill while warm still in progress joins SAME in-flight install (no double install).
 *
 * When cache cannot be set up: EXPLICIT warning + fill service does NOT silently produce draft;
 * stops with ERR_FILL_UNVERIFIED (user won't hit "clean in app, tsc error locally" surprise).
 * ──────────────────────────────────────────────────────────────────────── */
@Injectable()
export class CodegenDepsWarmupService implements OnModuleInit {
  private readonly logger = new Logger(CodegenDepsWarmupService.name);

  onModuleInit(): void {
    // void: warm without blocking boot. ensureFillDepsCache memoized -> no race with fill.
    void ensureFillDepsCache(this.logger).then((dir) => {
      if (dir) {
        this.logger.log(`Surgical fill verified-deps cache ready at ${dir}`);
      } else {
        this.logger.warn(
          "Surgical fill verified-deps cache UNAVAILABLE at startup — in-app fill will refuse with " +
            "ERR_FILL_UNVERIFIED (no silent draft) until resolved. Set SOLARCH_FILL_DEPS_CACHE to a " +
            "writable path with npm reachable (persistent volume in prod). The CLI channel still verifies locally.",
        );
      }
    });
  }
}
