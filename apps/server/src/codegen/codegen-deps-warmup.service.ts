import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ensureFillDepsCache } from "./codegen-fill-deps";

/* ────────────────────────────────────────────────────────────────────────
 * codegen-deps-warmup.service.ts — Surgical fill verified-deps cache'ini STARTUP'ta
 * (bir kez) warm eder → ilk fill anında hazır olsun, "verified" mod garanti olsun.
 *
 * Arka planda çalışır, BOOT'U BLOKLAMAZ (npm install dakikalar sürebilir; geçici
 * npm/ağ sorunu tüm backend'i düşürmesin). ensureFillDepsCache memoize olduğundan,
 * warm hâlâ sürüyorken gelen ilk fill AYNI in-flight kuruluma biner (çift kurulum yok).
 *
 * Cache kurulamazsa: AÇIK uyarı + fill servisi sessiz draft ÜRETMEZ; ERR_FILL_UNVERIFIED
 * ile durur (kullanıcı "app'te temiz, lokalde tsc hatası" sürpriziyle karşılaşmaz).
 * ──────────────────────────────────────────────────────────────────────── */
@Injectable()
export class CodegenDepsWarmupService implements OnModuleInit {
  private readonly logger = new Logger(CodegenDepsWarmupService.name);

  onModuleInit(): void {
    // void: boot'u beklemeden warm et. ensureFillDepsCache memoize → fill ile yarış yok.
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
