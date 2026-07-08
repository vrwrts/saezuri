#!/bin/sh
# Runs from /docker-entrypoint.d/ before nginx starts (nginx:alpine convention).
# Renders the server config from the template and writes the optional auth
# include. Kept separate from the image's built-in envsubst step so we can
# substitute ONLY ${BIRDNETGO_URL} and leave nginx's own $variables intact.
set -eu

: "${BIRDNETGO_URL:?BIRDNETGO_URL is required, e.g. http://192.168.1.10:8080}"

# Inject the token as an Authorization header only when set. It lives solely in
# nginx — the browser never receives it. Empty file keeps the `include` valid.
if [ -n "${BIRDNETGO_TOKEN:-}" ]; then
    printf 'proxy_set_header Authorization "Bearer %s";\n' "$BIRDNETGO_TOKEN" \
        > /etc/nginx/conf.d/saezuri_auth.inc
    token_state=set
else
    : > /etc/nginx/conf.d/saezuri_auth.inc
    token_state=unset
fi

# Substitute only BIRDNETGO_URL; everything else ($host, $uri, ...) is left as-is.
export BIRDNETGO_URL
envsubst '${BIRDNETGO_URL}' \
    < /etc/nginx/saezuri.conf.template \
    > /etc/nginx/conf.d/default.conf

# Never log the token value itself.
echo "saezuri: proxying /api/ -> ${BIRDNETGO_URL}/api/ (auth token: ${token_state})"
