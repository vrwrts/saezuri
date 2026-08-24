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
ARG PIPELINE_VERSION=v1.1.0
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
# The runtime user cannot write __pycache__ under /opt, and CPython swallows that
# failure silently — without this, every generation batch re-compiles the pipeline.
RUN python3 -m compileall -q /opt/saezuri/pipeline

# Stream Python stdout straight to `docker logs` rather than block-buffering it
# during long generation runs.
ENV PYTHONUNBUFFERED=1

# The Node refresh service bundle + its native canvas dep; smoke-test it loads.
COPY --from=build /app/dist-server/refresh.mjs /opt/saezuri/server/refresh.mjs
COPY --from=build /opt/canvas/node_modules /opt/saezuri/server/node_modules
RUN cd /opt/saezuri/server && node -e "require('@napi-rs/canvas')"

# Static bundle.
COPY --from=build /app/dist /usr/share/nginx/html

# /data is the real persistence root for the two stores; the html root reaches
# them through symlinks. This direction, not the reverse, because the Home
# Assistant Supervisor mounts its persistent volume at /data (alongside the
# options.json it writes there) — symlinks under /data would be mounted over, and
# downloaded art would silently land in the ephemeral container layer instead.
# Docker resolves symlinks in a mount destination, so a volume mounted the long
# way (/usr/share/nginx/html/assets/illustrations) still lands on /data: both
# spellings keep working, and an existing deployment keeps its data because that
# data lives in the volume, not at a path.
#
# The bundled art the build just shipped (the generic fallback silhouette) has to
# move out of the way first — `ln -s` onto an existing directory silently nests
# the link inside it. It cannot simply move *into* /data either: under the
# Supervisor /data is a bind mount, which masks image content rather than seeding
# it the way a named volume does. So it is parked here and re-seeded at start by
# nginx/entrypoint.sh. `rm -rf` for calls, which never has bundled content.
RUN mkdir -p /opt/saezuri/bundled \
    && mv /usr/share/nginx/html/assets/illustrations /opt/saezuri/bundled/illustrations \
    && rm -rf /usr/share/nginx/html/assets/calls \
    && mkdir -p /data/illustrations /data/calls \
    && ln -s /data/illustrations /usr/share/nginx/html/assets/illustrations \
    && ln -s /data/calls /usr/share/nginx/html/assets/calls

# Config template (installed at start) + the location blocks it includes +
# entrypoint hooks. The template lives OUTSIDE /etc/nginx/templates so the
# image's built-in envsubst step doesn't clobber nginx's own $variables — our
# hook just copies it verbatim now that nothing is substituted. The locations
# file is included from a server block, so it ships unconditionally: the Home
# Assistant app wrapper (addon/) adds a second server block that includes the
# same file. 40 installs the static-serving config; 50 launches the refresh service
# (fetches per-species art + dictionaries, publishes the snapshot). Both run
# before nginx, in that order.
COPY nginx/default.conf.template /etc/nginx/saezuri.conf.template
COPY nginx/saezuri-locations.conf /etc/nginx/saezuri-locations.conf
COPY nginx/entrypoint.sh /docker-entrypoint.d/40-saezuri.sh
COPY nginx/generator.sh /docker-entrypoint.d/50-generator.sh
RUN chmod +x /docker-entrypoint.d/40-saezuri.sh \
             /docker-entrypoint.d/50-generator.sh

# --- Rootless ---
# Permission is granted by directory mode, not ownership, so that any `docker run
# --user` works and not just the default one — ownership would also leak into a
# fresh named volume, which inherits the image directory's uid and mode. The mode
# is enough because every runtime writer here is tmp-file + rename(), which needs
# the directory bit rather than the file. uid 1000 over nginx's own 101, a system
# uid on Debian hosts. The stock conf.d/default.conf goes because entrypoint.sh
# copies over that path and O_TRUNC on a root-owned file is not granted by a
# writable parent; the pid file leaves root-owned /run for the same reason.
RUN addgroup -g 1000 saezuri \
    && adduser -D -u 1000 -G saezuri saezuri \
    && rm -f /etc/nginx/conf.d/default.conf \
    && sed -i 's,^pid .*,pid /tmp/nginx.pid;,' /etc/nginx/nginx.conf \
    && mkdir -p /var/cache/saezuri/references \
    && chmod 0777 /etc/nginx/conf.d /usr/share/nginx/html \
                  /data /data/illustrations /data/calls \
                  /var/cache/saezuri /var/cache/saezuri/references \
    && chmod -R 0777 /var/cache/nginx

# Docker sets HOME=/ for a --user with no passwd entry, and / is not writable.
ENV HOME=/tmp

USER saezuri

EXPOSE 8080
# nginx:alpine's own entrypoint runs /docker-entrypoint.d/* then starts nginx.
