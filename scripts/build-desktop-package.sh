#!/usr/bin/env sh
set -eu

PLATFORM=${1:?usage: build-desktop-package.sh macos|linux|windows}
VERSION=${VERSION:-0.1.0}
NODE_VERSION=${NODE_VERSION:-22.14.0}
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DIST="$ROOT/release/cleanflix-connector-$PLATFORM-$VERSION"

case "$PLATFORM" in
  macos) ARCHIVE="node-v$NODE_VERSION-darwin-arm64" ;;
  linux) ARCHIVE="node-v$NODE_VERSION-linux-x64" ;;
  windows) ARCHIVE="node-v$NODE_VERSION-win-x64" ;;
  *) exit 1 ;;
esac

rm -rf "$DIST"
mkdir -p "$DIST"
cp "$ROOT/server.js" "$ROOT/library.js" "$ROOT/hash-password.js" "$ROOT/package.json" "$DIST/"
cp -R "$ROOT/distribution" "$DIST/"
mkdir -p "$DIST/data" "$DIST/media"
if [ "$PLATFORM" = windows ]; then
  curl -fsSLO "https://nodejs.org/dist/v$NODE_VERSION/$ARCHIVE.zip"
  unzip -q "$ARCHIVE.zip"
  rm -f "$ARCHIVE.zip"
else
  curl -fsSLO "https://nodejs.org/dist/v$NODE_VERSION/$ARCHIVE.tar.gz"
  tar -xzf "$ARCHIVE.tar.gz"
  rm -f "$ARCHIVE.tar.gz"
fi
mv "$ARCHIVE" "$DIST/node"
printf '%s\n' "Built $DIST"
