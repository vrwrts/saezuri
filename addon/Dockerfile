# A thin wrapper, not a rebuild: the application image is already published
# multi-arch, so this layer only adds the Supervisor's calling convention
# (/data/options.json -> environment variables) on top of it.
ARG BUILD_FROM=ghcr.io/vrwrts/saezuri:latest
FROM ${BUILD_FROM}

# jq reads options.json. curl (not busybox wget) because the BirdNET-Go probe has
# to tell an authentication failure apart from an unreachable host, and busybox
# wget cannot report an HTTP status code.
RUN apk add --no-cache jq curl

COPY nginx/ingress.conf /opt/saezuri/addon/ingress.conf
COPY run.sh /run.sh
RUN chmod +x /run.sh

# The base image inherits nginx's ENTRYPOINT ["/docker-entrypoint.sh"]. Left in
# place, CMD below would become an *argument* to it: the /docker-entrypoint.d
# hooks would run first and 40-saezuri.sh would abort on the still-unset
# BIRDNETGO_URL. run.sh calls that entrypoint itself, once the options are read.
ENTRYPOINT []
CMD ["/run.sh"]
