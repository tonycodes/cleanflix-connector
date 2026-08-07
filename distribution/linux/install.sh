#!/usr/bin/env sh
set -eu
ROOT="${CLEANFLIX_INSTALL_ROOT:-$HOME/.local/lib/cleanflix-connector}"
CONFIG="$HOME/.config/cleanflix-connector"
mkdir -p "$CONFIG" "$HOME/.config/systemd/user"
cp distribution/common/config.env.example "$CONFIG/config.env"
sed "s#%h#$HOME#g" distribution/linux/cleanflix-connector.service > "$HOME/.config/systemd/user/cleanflix-connector.service"
systemctl --user daemon-reload
systemctl --user enable --now cleanflix-connector.service
printf '%s\n' "Edit $CONFIG/config.env, then run: systemctl --user restart cleanflix-connector"
