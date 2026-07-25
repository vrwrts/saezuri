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

# --- Runtime stage: nginx serves the bundle, proxies /api/, and (optionally)
#     runs the illustration worker beside it. ---
#
# The base is Debian (not alpine) because the worker's matting model runs on
# onnxruntime, which ships glibc wheels only. The generator toolchain is present
# in every image, but the worker only runs when GEMINI_API_KEY is set — a
# display-only container pays the image size, not any runtime cost. See
# CLAUDE.md / the plan for the "one heavy image for everyone" decision; a leaner
# generator-less variant is a possible future follow-up.
FROM nginx:bookworm AS runtime

# Python + the pipeline dependencies (rembg / onnxruntime / Pillow). This is the
# bulk of the image size.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*
COPY pipeline/requirements.txt /opt/saezuri/pipeline/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages \
        -r /opt/saezuri/pipeline/requirements.txt

# Stream the worker's / pregen's stdout straight to `docker logs` rather than
# letting it sit in a block buffer during long generation runs — that buffering
# is why successful `[ok]` lines (stdout) weren't showing while failures
# (stderr, line-buffered) were.
ENV PYTHONUNBUFFERED=1

# Bake the BiRefNet matting model into the image so the first generation needs
# no download and works offline. rembg resolves models under U2NET_HOME.
ENV U2NET_HOME=/opt/saezuri/models
RUN mkdir -p "$U2NET_HOME" \
    && python3 -c "from rembg import new_session; new_session('birefnet-general')"

# Pipeline scripts + bundled reference art (styles/anti-refs, when present).
COPY pipeline/ /opt/saezuri/pipeline/

# Static bundle.
COPY --from=build /app/dist /usr/share/nginx/html

# Config template (rendered at start) + entrypoint hooks. The template lives
# OUTSIDE /etc/nginx/templates so the image's built-in envsubst step doesn't
# clobber nginx's own $variables — our hook substitutes only BIRDNETGO_URL.
# 40 renders the proxy config; 50 launches the worker (both before nginx starts).
COPY nginx/default.conf.template /etc/nginx/saezuri.conf.template
COPY nginx/entrypoint.sh /docker-entrypoint.d/40-saezuri.sh
COPY nginx/generator.sh /docker-entrypoint.d/50-generator.sh
RUN chmod +x /docker-entrypoint.d/40-saezuri.sh /docker-entrypoint.d/50-generator.sh

EXPOSE 80
# nginx:bookworm's own entrypoint runs /docker-entrypoint.d/* then starts nginx.
