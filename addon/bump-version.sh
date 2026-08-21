#!/bin/sh
# Rewrites the app's pinned version in place. Run by semantic-release (see
# .releaserc.json) so the bump lands in the release commit: the app store reads
# config.yaml from the default branch, and a version with no matching published
# image tag makes the app uninstallable, so this can never be a manual step.
set -eu

VERSION="${1:?usage: bump-version.sh X.Y.Z}"
DIR="$(dirname "$0")"

sed -i.bak -E "s/^version: .*/version: ${VERSION}/" "$DIR/config.yaml"
# The wrapper must be built against the application image of the same release.
sed -i.bak -E "s|(ghcr\.io/vrwrts/saezuri):[^ ]*|\1:${VERSION}|" "$DIR/build.yaml"
rm -f "$DIR/config.yaml.bak" "$DIR/build.yaml.bak"

grep -q "^version: ${VERSION}$" "$DIR/config.yaml"
grep -c "saezuri:${VERSION}$" "$DIR/build.yaml" | grep -qx 2
echo "addon pinned to ${VERSION}"
