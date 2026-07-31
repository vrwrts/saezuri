#!/bin/sh
# Runs from /docker-entrypoint.d/ before nginx starts (nginx:alpine convention).
# Installs the server config. The browser only ever reads static files Saezuri
# publishes — nginx no longer proxies BirdNET-Go — so there is nothing to
# substitute and nginx holds no upstream credentials. BIRDNETGO_URL /
# BIRDNETGO_TOKEN are consumed only by the Node refresh service (50-generator.sh);
# we still require the URL here so the container fails fast when it is missing.
set -eu

: "${BIRDNETGO_URL:?BIRDNETGO_URL is required, e.g. http://192.168.1.10:8080}"

# The template has no ${...} placeholders left, so copy it verbatim — nginx's own
# $host/$uri/... must survive, which a plain copy trivially guarantees.
cp /etc/nginx/saezuri.conf.template /etc/nginx/conf.d/default.conf

echo "saezuri: serving static bundle; BirdNET-Go is backend-only (no /api proxy)"
