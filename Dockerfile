# syntax=docker/dockerfile:1

# --- Build stage: compile the static bundle + the Node refresh service ---
FROM node:22-alpine AS build
WORKDIR /app
# corepack provides the pnpm version pinned in package.json's packageManager.
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Browser bundle (dist/) + the refresh service bundled to one .mjs (dist-server/).
RUN pnpm build && pnpm build:server
# A flat, copyable node_modules holding just the native rasterizer. Installed
# here in node:22-alpine so npm fetches the linux-musl prebuilt matching the
# runtime's libc/arch; the refresh bundle marks @napi-rs/canvas external and
# resolves it from this tree. Smoke-test the binary loads.
RUN mkdir -p /opt/canvas && cd /opt/canvas \
    && npm init -y >/dev/null 2>&1 \
    && npm install --omit=dev --no-audit --no-fund \
        "@napi-rs/canvas@$(node -p "require('/app/node_modules/@napi-rs/canvas/package.json').version")" \
    && node -e "require('@napi-rs/canvas')"

# --- Runtime stage: nginx serves the bundle + proxies /api/; the Node refresh
#     service runs beside it (SSE → snapshot + e-ink frames + on-demand art). ---
#
# alpine base: the cutout step is matte.py (numpy + scipy + Pillow, all with musl
# wheels), so the image needs no glibc-only wheels or baked matting model. The
# generator toolchain + Node service ship in every image; a display-only
# container (no GEMINI_API_KEY) still publishes, it just skips generation.
FROM nginx:alpine AS runtime

# Python (pipeline: numpy / scipy / Pillow) + Node (the refresh service).
RUN apk add --no-cache python3 py3-pip nodejs
COPY pipeline/requirements.txt /opt/saezuri/pipeline/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages \
        -r /opt/saezuri/pipeline/requirements.txt

# Stream Python stdout straight to `docker logs` rather than block-buffering it
# during long generation runs.
ENV PYTHONUNBUFFERED=1

# Pipeline scripts + bundled reference art (styles/anti-refs, when present).
COPY pipeline/ /opt/saezuri/pipeline/

# The Node refresh service bundle + its native canvas dep; smoke-test it loads.
COPY --from=build /app/dist-server/refresh.mjs /opt/saezuri/server/refresh.mjs
COPY --from=build /opt/canvas/node_modules /opt/saezuri/server/node_modules
RUN cd /opt/saezuri/server && node -e "require('@napi-rs/canvas')"

# Static bundle.
COPY --from=build /app/dist /usr/share/nginx/html

# Config template (rendered at start) + entrypoint hooks. The template lives
# OUTSIDE /etc/nginx/templates so the image's built-in envsubst step doesn't
# clobber nginx's own $variables — our hook substitutes only BIRDNETGO_URL.
# 40 renders the proxy config; 50 launches the refresh service (both before nginx).
COPY nginx/default.conf.template /etc/nginx/saezuri.conf.template
COPY nginx/entrypoint.sh /docker-entrypoint.d/40-saezuri.sh
COPY nginx/generator.sh /docker-entrypoint.d/50-generator.sh
RUN chmod +x /docker-entrypoint.d/40-saezuri.sh /docker-entrypoint.d/50-generator.sh

EXPOSE 80
# nginx:alpine's own entrypoint runs /docker-entrypoint.d/* then starts nginx.
