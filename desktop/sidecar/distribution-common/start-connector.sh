#!/usr/bin/env sh
set -eu

CONFIG_PATH=${CLEANFLIX_CONFIG_PATH:?CLEANFLIX_CONFIG_PATH is required}
APP_ROOT=${CLEANFLIX_APP_ROOT:?CLEANFLIX_APP_ROOT is required}
[ -f "$CONFIG_PATH" ] || { printf '%s\n' "Missing configuration: $CONFIG_PATH" >&2; exit 1; }

set -a
. "$CONFIG_PATH"
set +a

: "${MEDIA_ROOT:?Set MEDIA_ROOT in config.env}"
: "${PAIRING_PASSWORD_HASH:?Set PAIRING_PASSWORD_HASH in config.env}"
: "${PUBLIC_BASE_URL:?Set PUBLIC_BASE_URL in config.env}"

export TOKEN_STORE_PATH="${TOKEN_STORE_PATH:-$(dirname "$CONFIG_PATH")/data/tokens.json}"
export LIBRARY_INDEX_PATH="${LIBRARY_INDEX_PATH:-$(dirname "$CONFIG_PATH")/data/library-index.json}"
exec "$CLEANFLIX_NODE" "$APP_ROOT/server.js"
