import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { ProjectsRepository } from "../projects/projects.repository";
import { hasProjectAccess } from "./access";
import type { AuthContext } from "./auth.types";

/** Multi-tenancy (BOLA) enforcement on /projects/:projectId/* sub-resources.
 *  Passes when projectId param is absent (non-project-scoped route) — global LocalAuthGuard
 *  already guarantees authentication. Returns 403 if the project is missing OR not owned by
 *  the caller (same response for both to prevent existence leakage). */
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
      throw new ForbiddenException({ code: "ERR_FORBIDDEN", message: "Access denied." });
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
