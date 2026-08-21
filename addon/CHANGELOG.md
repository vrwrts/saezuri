# Changelog

## 0.13.0

First release of the Home Assistant app. Wraps the existing Saezuri image with
ingress, so the collage appears in the sidebar, and with the Supervisor's
configuration and persistence.

- BirdNET-Go is detected automatically when it runs as an app on the same
  machine, so **BirdNET-Go URL** can usually be left empty.
- Illustrations and cached reference recordings persist in `/data`, so they
  survive an app update.
- Port 80 is available but off by default, for an e-ink panel fetching `/24h.png`.
