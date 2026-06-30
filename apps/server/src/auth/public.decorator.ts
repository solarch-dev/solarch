import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/** Exempts a route/controller from the global LocalAuthGuard (e.g. /health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
