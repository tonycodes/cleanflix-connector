# CleanStream Media Connector Reference

Self-hosted reference implementation of the v1 connector protocol.

```sh
PAIRING_SECRET='choose-a-long-secret' MEDIA_ROOT='/path/to/videos' node server.js
```

For production, place the service behind HTTPS and set `PUBLIC_BASE_URL` and
`APPROVAL_BASE_URL` to its HTTPS address. Scanning the TV QR code opens a phone
approval form protected by `PAIRING_SECRET`; replace that form with your own
identity provider for a production connector.

## Local OrbStack development

Copy `.env.example` to `.env`, set `MEDIA_ROOT` to an absolute directory with
video files, then start the shared-Caddy stack:

```sh
docker compose -p cleanstream-connector-local-domain -f docker-compose.local-domain.yml up -d
```

The connector is available at `https://cleanstream-connector.test`. The TV and
phone must be on the same LAN. Because this uses Caddy's internal certificate,
the phone must trust the local Caddy root certificate before it can open the QR
approval URL.
