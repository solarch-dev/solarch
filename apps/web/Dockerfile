# syntax=docker/dockerfile:1
# Solarch web (Vite SPA) — built, then served by Caddy which reverse-proxies /api to the server.

FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
RUN pnpm install --frozen-lockfile --filter @solarch/web...
COPY apps/web apps/web
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @solarch/web build

FROM caddy:2-alpine
COPY deploy/Caddyfile.base /etc/caddy/Caddyfile.base
COPY deploy/Caddyfile.auth.snippet /etc/caddy/Caddyfile.auth.snippet
COPY deploy/web-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
COPY --from=build /app/apps/web/dist /srv
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
