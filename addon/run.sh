#!/bin/sh
# Home Assistant app entrypoint. Translates the Supervisor's options.json into
# the environment variables the application already understands, then hands off to
# the image's own entrypoint. Nothing downstream of here knows it is running under
# Home Assistant.
set -eu

OPTIONS=/data/options.json

# Hostnames probed for a BirdNET-Go app when birdnetgo_url is left empty, in
# the order they are tried. The Supervisor names an app <repo-prefix>-<slug>,
# where the prefix is `local` for a locally built app and the first 8 hex chars
# of sha1(repository-url) for one from a store. db21ed7f is
# github.com/alexbelgium/hassio-addons, which is where the BirdNET-Go app
# actually lives; a0d7b954 is the Home Assistant Community Add-ons repository,
# should it land there too. No `core-` entry: BirdNET-Go is not a built-in app.
# Users with an unusual slug extend this through the birdnetgo_extra_hosts option
# rather than needing a code change.
BIRDNETGO_HOSTS="db21ed7f-birdnet-go local-birdnet-go a0d7b954-birdnet-go"
BIRDNETGO_PROBE_PORT=8080
# Short enough that a missing neighbour costs no noticeable startup time.
BIRDNETGO_PROBE_TIMEOUT=2

log() { echo "saezuri-addon: $*"; }

# Absent or null means "not configured", and the application's own default must
# apply — so those are never exported. An empty string is a different answer:
# ILLUSTRATIONS_REPO and CALL_PROVIDERS read it as "off".
opt_present() {
    jq -e --arg k "$1" 'has($k) and .[$k] != null' "$OPTIONS" >/dev/null 2>&1
}

opt_value() {
    jq -r --arg k "$1" '.[$k] | tostring' "$OPTIONS"
}

export_opt() {
    if opt_present "$2"; then
        export "$1=$(opt_value "$2")"
    fi
}

# The generator reads prompt addenda from a JSON file, but a Home Assistant user has
# no way to edit a file inside the app's own /data. So the option is a list of
# "key|note" strings — editable in the app's configuration UI, and the same
# pipe-separated convention the pipeline already uses for "scientific|common" — and
# this turns it into the file. Split on the FIRST pipe only, since a note may
# contain one.
export_species_notes() {
    opt_present species_notes || return 0
    _notes_file=/data/species-notes.json
    jq '[.species_notes[]?
          | select(type == "string")
          | (. | index("|")) as $i
          | select($i != null)
          | { key:   (.[:$i]   | sub("^\\s+"; "") | sub("\\s+$"; "")),
              value: (.[$i+1:] | sub("^\\s+"; "") | sub("\\s+$"; "")) }
          | select(.key != "" and .value != "")
        ] | from_entries' "$OPTIONS" > "$_notes_file"
    _count=$(jq 'length' "$_notes_file")
    if [ "$_count" -gt 0 ]; then
        export SPECIES_NOTES="$_notes_file"
        log "species_notes: ${_count} note(s) -> ${_notes_file}"
    else
        # Nothing usable: leave SPECIES_NOTES unset so the app falls back to its own
        # default path, rather than pointing it at an empty file.
        rm -f "$_notes_file"
        log "species_notes: no usable entries (expected \"Scientific name|note\")"
    fi
}

# FRAME_SHADOW is read as "anything but 0", so a YAML bool has to become 1 or 0;
# exporting the string "false" would silently enable the shadow.
export_bool_opt() {
    if opt_present "$2"; then
        if [ "$(opt_value "$2")" = "true" ]; then
            export "$1=1"
        else
            export "$1=0"
        fi
    fi
}

# --- Configuration -----------------------------------------------------------

export_opt BIRDNETGO_URL birdnetgo_url
export_opt BIRDNETGO_TOKEN birdnetgo_token
export_opt ILLUSTRATIONS_REPO illustrations_repo
export_opt ILLUSTRATIONS_REF illustrations_ref
export_opt ILLUSTRATIONS_BASE_URL illustrations_base_url
export_opt GENERATE_API_KEY generate_api_key
export_opt GENERATE_API_URL generate_api_url
export_opt GENERATE_MODEL generate_model
export_opt GENERATE_SLEEP generate_sleep
export_species_notes
export_opt CALL_PROVIDERS call_providers
export_opt CALLS_MAX_PER_CYCLE calls_max_per_cycle
export_opt FRAME_WIDTH frame_width
export_opt FRAME_HEIGHT frame_height
export_opt FRAME_BG frame_bg
export_bool_opt FRAME_SHADOW frame_shadow
export_opt FRAME_WINDOWS frame_windows
export_opt SPECIES_DICT_LOCALES species_dict_locales
export_opt PUBLISH_DEBOUNCE_MS publish_debounce_ms
export_opt AGING_INTERVAL_MS aging_interval_ms
export_opt SUMMARY_INTERVAL_MS summary_interval_ms

# Not options: the standalone defaults are wrong here. /data is the Supervisor's
# persistent volume, so the cache belongs there rather than in the container layer
# that an app update throws away. The html root is where nginx serves from.
export FRAME_HTML_DIR=/usr/share/nginx/html
export CACHE_DIR=/data/cache

# The image already points the html root's asset directories at /data, so mounting
# the persistent volume is the whole of it: no symlink surgery, no moving files.
mkdir -p /data/illustrations /data/calls /data/cache

# --- BirdNET-Go detection ----------------------------------------------------

# Confirms a candidate is really BirdNET-Go rather than just something with an
# open socket. /api/v2/app/config stays public even when BirdNET-Go runs in
# PrivateMode, and reports whether a token will be needed; /api/v2/health is the
# fallback for builds predating it, where a 401 is itself proof of an instance.
# Echoes "ok" or "auth" on a hit, nothing at all otherwise.
probe_birdnetgo() {
    _base="http://$1:${BIRDNETGO_PROBE_PORT}"
    _body=$(mktemp)

    _code=$(curl -s -o "$_body" -w '%{http_code}' \
        --max-time "$BIRDNETGO_PROBE_TIMEOUT" \
        -H 'Accept: application/json' \
        "$_base/api/v2/app/config" 2>/dev/null || echo 000)
    if [ "$_code" = "200" ] && \
       jq -e 'has("csrfToken") and has("projectLinks")' "$_body" >/dev/null 2>&1; then
        if jq -e '.security.privateMode == true' "$_body" >/dev/null 2>&1; then
            echo auth
        else
            echo ok
        fi
        rm -f "$_body"
        return 0
    fi

    _code=$(curl -s -o "$_body" -w '%{http_code}' \
        --max-time "$BIRDNETGO_PROBE_TIMEOUT" \
        -H 'Accept: application/json' \
        "$_base/api/v2/health" 2>/dev/null || echo 000)
    if [ "$_code" = "200" ] && \
       jq -e 'has("status") and has("database_status")' "$_body" >/dev/null 2>&1; then
        echo ok
    elif [ "$_code" = "401" ]; then
        echo auth
    fi
    rm -f "$_body"
}

detect_birdnetgo() {
    _candidates="$BIRDNETGO_HOSTS"
    if opt_present birdnetgo_extra_hosts; then
        # Tried first, so a hand-configured hostname beats the built-in guesses.
        _candidates="$(opt_value birdnetgo_extra_hosts | tr ',' ' ') $_candidates"
    fi

    _chosen=""
    for _host in $_candidates; do
        [ -n "$_host" ] || continue
        _result=$(probe_birdnetgo "$_host")
        [ -n "$_result" ] || continue

        if [ -z "$_chosen" ]; then
            _chosen="$_host"
            log "detected BirdNET-Go at $_host:${BIRDNETGO_PROBE_PORT}"
            if [ "$_result" = "auth" ]; then
                log "that instance requires authentication; set the birdnetgo_token option"
            fi
        else
            # Logged rather than silently discarded, so a user with two instances
            # can see which one was picked and override it.
            log "also responding: $_host:${BIRDNETGO_PROBE_PORT} (not used)"
        fi
    done

    [ -n "$_chosen" ] || return 1
    export "BIRDNETGO_URL=http://$_chosen:${BIRDNETGO_PROBE_PORT}"
}

# An explicitly configured URL always wins and is never second-guessed.
if [ -z "${BIRDNETGO_URL:-}" ]; then
    log "no birdnetgo_url configured; looking for a BirdNET-Go app"
    if ! detect_birdnetgo; then
        log "no BirdNET-Go app found on the Supervisor network."
        log "Set the birdnetgo_url option to your instance, for example"
        log "  http://192.168.1.10:8080"
        log "If your BirdNET-Go app has an unusual slug, add its hostname to"
        log "birdnetgo_extra_hosts instead."
        exit 1
    fi
fi

# --- Startup -----------------------------------------------------------------

redacted() { [ -n "${1:-}" ] && echo '<set>' || echo '<unset>'; }

log "BIRDNETGO_URL=${BIRDNETGO_URL}"
log "BIRDNETGO_TOKEN=$(redacted "${BIRDNETGO_TOKEN:-}")"
log "GENERATE_API_KEY=$(redacted "${GENERATE_API_KEY:-}")"
for _name in ILLUSTRATIONS_REPO ILLUSTRATIONS_REF ILLUSTRATIONS_BASE_URL \
             GENERATE_API_URL GENERATE_MODEL \
             GENERATE_SLEEP SPECIES_NOTES CALL_PROVIDERS CALLS_MAX_PER_CYCLE \
             FRAME_WIDTH FRAME_HEIGHT FRAME_BG FRAME_SHADOW FRAME_WINDOWS \
             SPECIES_DICT_LOCALES PUBLISH_DEBOUNCE_MS AGING_INTERVAL_MS \
             SUMMARY_INTERVAL_MS FRAME_HTML_DIR CACHE_DIR; do
    eval "_set=\${$_name+set}"
    [ "${_set:-}" = set ] || continue
    eval "_value=\$$_name"
    log "$_name=$_value"
done

cp /opt/saezuri/addon/ingress.conf /etc/nginx/conf.d/ingress.conf

# The image's own entrypoint runs its /docker-entrypoint.d hooks (install the
# port-80 config, launch the refresh service) with the environment now populated.
exec /docker-entrypoint.sh nginx -g "daemon off;"
