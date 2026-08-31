#!/bin/sh
# Runs from /docker-entrypoint.d/ AFTER 40-saezuri.sh and before nginx starts.
# Launches the Node refresh service in the background (reparented to nginx, PID 1
# once this returns); a restart loop keeps it alive across crashes without a full
# supervisor. The service holds BirdNET-Go's detection SSE stream and publishes
# the snapshot + e-ink frames nginx serves, generating any missing art on demand.
#
# Gated on BIRDNETGO_URL (already required by 40-saezuri.sh) — NOT on
# GENERATE_API_KEY: a display-only container (no key) still publishes from existing
# art; only the art-generation step inside the service is key-gated.
set -eu

if [ -z "${BIRDNETGO_URL:-}" ]; then
    echo "saezuri: refresh service disabled (BIRDNETGO_URL unset)" >&2
    exit 0
fi

echo "saezuri: starting refresh service"
(
    while true; do
        node /opt/saezuri/server/refresh.mjs || true
        echo "saezuri: refresh service exited; restarting in 30s" >&2
        sleep 30
    done
) &
