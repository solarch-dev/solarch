import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ProjectsRepository } from "../projects/projects.repository";
import { LocalAuthGuard } from "./local-auth.guard";
import { ProjectAccessGuard } from "./project-access.guard";
import { ApiKeysController } from "./api-keys/api-keys.controller";
import { ApiKeysService } from "./api-keys/api-keys.service";
import { ApiKeysRepository } from "./api-keys/api-keys.repository";

/** Global auth layer: LocalAuthGuard applies to all routes as APP_GUARD;
 *  ProjectAccessGuard is used via @UseGuards on sub-resource controllers and
 *  exported globally.
 *
 *  We provide ProjectsRepository directly without importing ProjectsModule:
 *  importing ProjectsModule → TabsModule chain (because TabsController consumes
 *  the guard) caused circular init. ProjectsRepository's only dependency is
 *  @Global Neo4jService, so providing our own instance is safe. */
@Global()
@Module({
  controllers: [ApiKeysController],
  providers: [
    // useExisting → reuses LocalAuthGuard provider for APP_GUARD so tests can
    // overrideProvider(LocalAuthGuard) and affect the global guard too.
    LocalAuthGuard,
    { provide: APP_GUARD, useExisting: LocalAuthGuard },
    ProjectsRepository,
    ProjectAccessGuard,
    ApiKeysService,
    ApiKeysRepository,
  ],
  // ProjectsRepository is also exported: @UseGuards(ProjectAccessGuard) instantiates
  // the guard ad hoc in each host module, so its dependency must be globally visible
  // (exporting ProjectAccessGuard alone is not enough).
  exports: [ProjectAccessGuard, ProjectsRepository, ApiKeysService],
})
export class AuthModule {}
