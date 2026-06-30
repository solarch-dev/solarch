/** The SINGLE place frontend env values are read. */

/** Empty = same-origin (/api) — intentional for reverse-proxy single-origin deploys. */
export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
