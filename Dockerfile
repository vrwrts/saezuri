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

# Vendor the generation pipeline from the illustrations repo at a PINNED release.
# We fetch only the pipeline.tar.gz asset (not the whole art repo), so the build
# stays lean. Bumping PIPELINE_VERSION (a normal app commit) adopts a new pipeline.
# NOTE: the illustrations repo must have published this release first.
ARG PIPELINE_VERSION=v1.0.0
RUN apk add --no-cache curl \
    && mkdir -p /build \
    && curl -fSL "https://github.com/vrwrts/saezuri-illustrations/releases/download/${PIPELINE_VERSION}/pipeline.tar.gz" \
       | tar -xz -C /build \
    && test -f /build/pipeline/worker.py

# --- Runtime stage: nginx serves the static bundle (no BirdNET-Go proxy); the
#     Node refresh service runs beside it (SSE → snapshot + e-ink frames +
#     species dictionaries + on-demand art). ---
#
# alpine base: the cutout step is matte.py (numpy + scipy + Pillow, all with musl
# wheels), so the image needs no glibc-only wheels or baked matting model. The
# generator toolchain + Node service ship in every image; a display-only
# container (no GEMINI_API_KEY) still publishes, it just skips generation.
FROM nginx:alpine AS runtime

# Python (pipeline: numpy / scipy / Pillow) + Node (the refresh service).
RUN apk add --no-cache python3 py3-pip nodejs

# The vendored pipeline (pinned illustrations release, from the build stage) + its
# deps. Includes the generation scripts + bundled reference art (styles/anti-refs).
COPY --from=build /build/pipeline /opt/saezuri/pipeline
RUN pip3 install --no-cache-dir --break-system-packages \
        -r /opt/saezuri/pipeline/requirements.txt

# Stream Python stdout straight to `docker logs` rather than block-buffering it
# during long generation runs.
ENV PYTHONUNBUFFERED=1

# The Node refresh service bundle + its native canvas dep; smoke-test it loads.
COPY --from=build /app/dist-server/refresh.mjs /opt/saezuri/server/refresh.mjs
COPY --from=build /opt/canvas/node_modules /opt/saezuri/server/node_modules
RUN cd /opt/saezuri/server && node -e "require('@napi-rs/canvas')"

# Static bundle.
COPY --from=build /app/dist /usr/share/nginx/html

# Short, typeable mount paths for the two persistent stores. The real directories
# stay under the html root, where nginx already serves them and where the refresh
# service already writes, so a volume mounted the old way keeps working
# untouched; these symlinks only spare operators a 45-character -v target.
# Docker resolves symlinks in a mount destination, so a volume mounted on
# /data/illustrations lands on the real directory.
RUN mkdir -p /usr/share/nginx/html/assets/illustrations \
             /usr/share/nginx/html/assets/calls \
             /data \
    && ln -s /usr/share/nginx/html/assets/illustrations /data/illustrations \
    && ln -s /usr/share/nginx/html/assets/calls /data/calls

# Config template (installed at start) + entrypoint hooks. The template lives
# OUTSIDE /etc/nginx/templates so the image's built-in envsubst step doesn't
# clobber nginx's own $variables — our hook just copies it verbatim now that
# nothing is substituted. 40 installs the static-serving config; 50 launches the
# refresh service (fetches per-species art + dictionaries, publishes the
# snapshot). Both run before nginx, in that order.
COPY nginx/default.conf.template /etc/nginx/saezuri.conf.template
COPY nginx/entrypoint.sh /docker-entrypoint.d/40-saezuri.sh
COPY nginx/generator.sh /docker-entrypoint.d/50-generator.sh
RUN chmod +x /docker-entrypoint.d/40-saezuri.sh \
             /docker-entrypoint.d/50-generator.sh

EXPOSE 80
# nginx:alpine's own entrypoint runs /docker-entrypoint.d/* then starts nginx.
