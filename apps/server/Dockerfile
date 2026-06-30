# syntax=docker/dockerfile:1
# Solarch server (NestJS + Neo4j). Build context = repo root (pnpm workspace).

FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /app

# ---- install + build ----
FROM base AS build
# Workspace manifests first for a cached install layer.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
RUN pnpm install --frozen-lockfile --filter @solarch/server...
COPY apps/server apps/server
RUN pnpm --filter @solarch/server build
# Pre-fetch the local embedding model so the first request is offline-ready (best-effort:
# a restricted build network falls back to downloading it on first use at runtime).
RUN cd apps/server && node -e "import('@xenova/transformers').then(m=>m.pipeline('feature-extraction','Xenova/paraphrase-multilingual-MiniLM-L12-v2')).then(()=>console.log('embed model cached')).catch(e=>console.error('embed prefetch skipped:',e.message))" || true

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
# tsx + src are kept so the entrypoint can run the (idempotent) DB bootstrap.
COPY --from=build /app/node_modules ./node_modules
# tsconfig.base.json is required at runtime: apps/server/tsconfig.json extends it, and the
# entrypoint runs the DB bootstrap via tsx (which reads the tsconfig for experimentalDecorators).
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/turbo.json /app/tsconfig.base.json ./
COPY --from=build /app/apps/server ./apps/server
COPY apps/server/docker-entrypoint.sh /usr/local/bin/solarch-entrypoint.sh
RUN chmod +x /usr/local/bin/solarch-entrypoint.sh
WORKDIR /app/apps/server
EXPOSE 4000
ENTRYPOINT ["/usr/local/bin/solarch-entrypoint.sh"]
