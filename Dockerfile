# syntax=docker/dockerfile:1

# --- Build stage: compile the static bundle ---
FROM node:22-alpine AS build
WORKDIR /app
# corepack provides the pnpm version pinned in package.json's packageManager.
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# --- Runtime stage: nginx serves the bundle and proxies /api/ ---
FROM nginx:alpine AS runtime

# Static bundle.
COPY --from=build /app/dist /usr/share/nginx/html

# Config template (rendered at start) + entrypoint hook. The template lives
# OUTSIDE /etc/nginx/templates so the image's built-in envsubst step doesn't
# clobber nginx's own $variables — our hook substitutes only BIRDNETGO_URL.
COPY nginx/default.conf.template /etc/nginx/saezuri.conf.template
COPY nginx/entrypoint.sh /docker-entrypoint.d/40-saezuri.sh
RUN chmod +x /docker-entrypoint.d/40-saezuri.sh

EXPOSE 80
# nginx:alpine's own entrypoint runs /docker-entrypoint.d/* then starts nginx.
