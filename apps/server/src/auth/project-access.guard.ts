import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { ProjectsRepository } from "../projects/projects.repository";
import { hasProjectAccess } from "./access";
import type { AuthContext } from "./auth.types";

/** /projects/:projectId/* alt-kaynaklarında çok-kiracılık (BOLA) zorlaması.
 *  projectId param'ı yoksa (proje-kapsamsız route) geçer — global ClerkAuthGuard
 *  zaten kimlik doğrulamayı garanti eder. Proje yoksa VEYA çağırana ait değilse
 *  403 (var/yok sızıntısını önlemek için ikisi de aynı yanıt). */
@Injectable()
export class ProjectAccessGuard implements CanActivate {
  constructor(private readonly projects: ProjectsRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      params?: Record<string, string>;
      auth?: AuthContext;
    }>();
    const projectId = req.params?.projectId;
    if (!projectId) return true;

    const auth = req.auth;
    if (!auth) {
      throw new ForbiddenException({ code: "ERR_FORBIDDEN", message: "Yetki yok." });
    }
    const project = await this.projects.getById(projectId);
    if (!project || !hasProjectAccess(project, auth)) {
      throw new ForbiddenException({
        code: "ERR_PROJECT_FORBIDDEN",
        message: "You do not have access to this project.",
      });
    }
    return true;
  }
}
