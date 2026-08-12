#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
OUT="$ROOT/desktop/sidecar"
NODE_VERSION=${NODE_VERSION:-22.14.0}
rm -rf "$OUT"
mkdir -p "$OUT"
cp "$ROOT/server.js" "$ROOT/library.js" "$ROOT/hash-password.js" "$ROOT/package.json" "$OUT/"
cp -R "$ROOT/distribution/common" "$OUT/distribution-common"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) ARCHIVE="node-v$NODE_VERSION-darwin-arm64" ;;
  Darwin-x86_64) ARCHIVE="node-v$NODE_VERSION-darwin-x64" ;;
  Linux-x86_64) ARCHIVE="node-v$NODE_VERSION-linux-x64" ;;
  *) echo "Unsupported build platform" >&2; exit 1 ;;
esac
curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$ARCHIVE.tar.gz" | tar -xz -C "$OUT"
mv "$OUT/$ARCHIVE" "$OUT/node"
"$OUT/node/bin/npm" install --omit=dev --prefix "$OUT"
