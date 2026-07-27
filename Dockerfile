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
# alpine base: the cutout step is now matte.py (numpy + scipy + Pillow, all with
# musl wheels), so the image no longer needs onnxruntime's glibc-only wheels, a
# Debian base, or a baked ~1 GB matting model. The generator toolchain is present
# in every image, but the worker only runs when GEMINI_API_KEY is set — a
# display-only container pays a little image size, not any runtime cost.
FROM nginx:alpine AS runtime

# Python + the pipeline dependencies (numpy / scipy / Pillow).
RUN apk add --no-cache python3 py3-pip
COPY pipeline/requirements.txt /opt/saezuri/pipeline/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages \
        -r /opt/saezuri/pipeline/requirements.txt

# Stream the worker's / pregen's stdout straight to `docker logs` rather than
# letting it sit in a block buffer during long generation runs — that buffering
# is why successful `[ok]` lines (stdout) weren't showing while failures
# (stderr, line-buffered) were.
ENV PYTHONUNBUFFERED=1

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
