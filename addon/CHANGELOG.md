# [1.0.0](https://github.com/vrwrts/saezuri/compare/v0.14.2...v1.0.0) (2026-08-24)


### Features

* run the container as an unprivileged user ([#45](https://github.com/vrwrts/saezuri/issues/45)) ([a3a46ec](https://github.com/vrwrts/saezuri/commit/a3a46ecd87f6cf55b287d9dda263370955c850c9))


### BREAKING CHANGES

* the container now listens on 8080 instead of 80.
Published
ports must be remapped, e.g. `-p 8090:8080`. Existing volumes were
created
root-owned and are unwritable to the unprivileged container; it refuses
to
start and prints the one-off `chown` to run.
* the add-on's optional direct port is now 8080/tcp, not
80/tcp. The Supervisor stores the mapping against the old number, so
anyone
running an e-ink panel on it must re-open the new port once after
updating.

## [0.14.2](https://github.com/vrwrts/saezuri/compare/v0.14.1...v0.14.2) (2026-08-23)


### Bug Fixes

* always regenerate missing images ([#44](https://github.com/vrwrts/saezuri/issues/44)) ([29cb383](https://github.com/vrwrts/saezuri/commit/29cb38385679e3736de6cfbd90bdc0a91a32764f))

## [0.14.1](https://github.com/vrwrts/saezuri/compare/v0.14.0...v0.14.1) (2026-08-22)


### Bug Fixes

* incorrect email in repository.yaml ([b97e705](https://github.com/vrwrts/saezuri/commit/b97e70547a779bded6454d716f80926d9e4d3ded))

# [0.14.0](https://github.com/vrwrts/saezuri/compare/v0.13.0...v0.14.0) (2026-08-22)


### Bug Fixes

* let the release push the add-on version bump to main ([#43](https://github.com/vrwrts/saezuri/issues/43)) ([a1b71c1](https://github.com/vrwrts/saezuri/commit/a1b71c122b99a5084ce1205a9c586c8ed4a0a6f8))


### Features

* add home assistant app/add-on ([#42](https://github.com/vrwrts/saezuri/issues/42)) ([931a0e0](https://github.com/vrwrts/saezuri/commit/931a0e04c531c37e1d793d7b1981dc314500c87a))

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
