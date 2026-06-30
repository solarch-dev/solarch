import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/** Bir route/controller'ı global ClerkAuthGuard'tan muaf tutar (örn. /health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
