import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ProjectsRepository } from "../projects/projects.repository";
import { ClerkAuthGuard } from "./clerk-auth.guard";
import { ProjectAccessGuard } from "./project-access.guard";
import { GuestController } from "./guest.controller";
import { GuestCleanupService } from "./guest-cleanup.service";
import { ApiKeysController } from "./api-keys/api-keys.controller";
import { ApiKeysService } from "./api-keys/api-keys.service";
import { ApiKeysRepository } from "./api-keys/api-keys.repository";

/** Global auth katmanı: ClerkAuthGuard tüm route'lara APP_GUARD olarak uygulanır;
 *  ProjectAccessGuard alt-kaynak controller'larında @UseGuards ile kullanılır ve
 *  global export edilir.
 *
 *  ProjectsRepository'yi ProjectsModule'ü import etmeden DOĞRUDAN sağlıyoruz:
 *  ProjectsModule → TabsModule zincirini import etmek (TabsController guard'ı
 *  tükettiği için) döngüsel init'e yol açıyordu. ProjectsRepository'nin tek
 *  bağımlılığı @Global Neo4jService olduğundan kendi instance'ımızı vermek güvenli. */
@Global()
@Module({
  controllers: [GuestController, ApiKeysController],
  providers: [
    // useExisting → APP_GUARD ClerkAuthGuard provider'ını yeniden kullanır; böylece
    // testlerde overrideProvider(ClerkAuthGuard) global guard'ı da değiştirebilir.
    ClerkAuthGuard,
    { provide: APP_GUARD, useExisting: ClerkAuthGuard },
    ProjectsRepository,
    ProjectAccessGuard,
    GuestCleanupService,
    ApiKeysService,
    ApiKeysRepository,
  ],
  // ProjectsRepository de export edilir: @UseGuards(ProjectAccessGuard) guard'ı her
  // host modülde ad-hoc instantiate ettiğinden, bağımlılığının da global görünür
  // olması gerekir (ProjectAccessGuard'ın kendisi yetmez).
  exports: [ProjectAccessGuard, ProjectsRepository, ApiKeysService],
})
export class AuthModule {}
