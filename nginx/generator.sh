#!/bin/sh
# Runs from /docker-entrypoint.d/ AFTER 40-saezuri.sh and before nginx starts.
# When GEMINI_API_KEY is set, launch the illustration worker in the background so
# it generates art for detected species while nginx serves; otherwise do nothing
# and the container is a display-only build (generic silhouettes). The worker is
# reparented to nginx (PID 1) once this script returns; a restart loop keeps it
# alive across crashes without a full supervisor.
set -eu

if [ -z "${GEMINI_API_KEY:-}" ]; then
    echo "saezuri: illustration worker disabled (GEMINI_API_KEY unset)"
    exit 0
fi

echo "saezuri: starting illustration worker (GEMINI_API_KEY set)"
(
    while true; do
        python3 /opt/saezuri/pipeline/worker.py || true
        echo "saezuri: worker exited; restarting in 30s" >&2
        sleep 30
    done
) &
