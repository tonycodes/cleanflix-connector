# Cleanflix Connector Desktop Packages

Each desktop package contains the connector source plus a bundled Node 22 runtime.
Set `MEDIA_ROOT`, `PAIRING_PASSWORD_HASH`, and `PUBLIC_BASE_URL` in the generated
configuration before starting it. `PUBLIC_BASE_URL` must be an HTTPS address your TV
and phone can reach on the same LAN.

## macOS

Copy `macos/Cleanflix Connector.app` to Applications, open it once, then edit:
`~/Library/Application Support/Cleanflix Connector/config.env`.

## Windows

Run `windows/install.ps1` in PowerShell. It installs a per-user Scheduled Task and
opens `%APPDATA%\Cleanflix Connector\config.env`.

## Linux

Run `linux/install.sh`. It installs a user systemd service and creates:
`~/.config/cleanflix-connector/config.env`.
