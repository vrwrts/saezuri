## [1.2.1](https://github.com/vrwrts/saezuri/compare/v1.2.0...v1.2.1) (2026-10-15)


### Bug Fixes

* run on CPUs without AVX or ARMv8.2 ([#52](https://github.com/vrwrts/saezuri/issues/52)) ([bc7b1a8](https://github.com/vrwrts/saezuri/commit/bc7b1a8e1f9428f1e3aa71c88e32f5671dc39001)), closes [#51](https://github.com/vrwrts/saezuri/issues/51)

# [1.2.0](https://github.com/vrwrts/saezuri/compare/v1.1.3...v1.2.0) (2026-10-14)


### Features

* **addon:** keep illustrations in the browsable app config folder ([#56](https://github.com/vrwrts/saezuri/issues/56)) ([dc5020c](https://github.com/vrwrts/saezuri/commit/dc5020cc02caaa91c5f48d6a93149c96abd6bf8b))

## [1.1.3](https://github.com/vrwrts/saezuri/compare/v1.1.2...v1.1.3) (2026-10-14)


### Bug Fixes

* bloom each bird in only once its image has loaded ([#54](https://github.com/vrwrts/saezuri/issues/54)) ([ff86938](https://github.com/vrwrts/saezuri/commit/ff86938e72f5fe00f9aa8490ecf243f8aabc915a)), closes [#36](https://github.com/vrwrts/saezuri/issues/36)

## [1.1.2](https://github.com/vrwrts/saezuri/compare/v1.1.1...v1.1.2) (2026-10-14)


### Bug Fixes

* hold the collage layout while pinch-zoomed ([#53](https://github.com/vrwrts/saezuri/issues/53)) ([7144b4c](https://github.com/vrwrts/saezuri/commit/7144b4c7c7754525fbae51834ffd44b1373a41ee)), closes [#50](https://github.com/vrwrts/saezuri/issues/50)

## [1.1.1](https://github.com/vrwrts/saezuri/compare/v1.1.0...v1.1.1) (2026-08-25)


### Bug Fixes

* allow home assistant app access for non admin users ([#47](https://github.com/vrwrts/saezuri/issues/47)) ([8dfe995](https://github.com/vrwrts/saezuri/commit/8dfe9956a1e769411bb604d669a574713fe806d8))

# [1.1.0](https://github.com/vrwrts/saezuri/compare/v1.0.0...v1.1.0) (2026-08-24)


### Features

* acquire art one pose at a time, in two lanes ([#46](https://github.com/vrwrts/saezuri/issues/46)) ([fc5ae2a](https://github.com/vrwrts/saezuri/commit/fc5ae2a7084c19d08a9d0482f1dab92026a3630b))

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
