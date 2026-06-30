# syntax=docker/dockerfile:1
# Solarch web (Vite SPA) — built, then served by Caddy which also reverse-proxies /api
# to the server (single origin, so the Clerk __session cookie reaches the backend).
# Build context = repo root (pnpm workspace).

# ---- build the SPA ----
FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
RUN pnpm install --frozen-lockfile --filter @solarch/web...
COPY apps/web apps/web
# Vite inlines VITE_* at build time, so they are passed as build args (from .env via compose).
# VITE_API_URL is left empty → the SPA calls a relative /api, which Caddy proxies same-origin.
ARG VITE_API_URL=""
ARG VITE_CLERK_PUBLISHABLE_KEY=""
ARG VITE_POSTHOG_PROJECT_TOKEN=""
ARG VITE_POSTHOG_HOST=""
ENV VITE_API_URL=$VITE_API_URL \
    VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY \
    VITE_POSTHOG_PROJECT_TOKEN=$VITE_POSTHOG_PROJECT_TOKEN \
    VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST
RUN pnpm --filter @solarch/web build

# ---- serve + proxy ----
FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
EXPOSE 3000
