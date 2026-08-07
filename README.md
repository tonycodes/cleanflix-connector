# CleanStream Media Connector Reference

Self-hosted reference implementation of the v1 connector protocol.

```sh
PAIRING_SECRET='choose-a-long-secret' MEDIA_ROOT='/path/to/videos' node server.js
```

For production, place the service behind HTTPS and set `PUBLIC_BASE_URL` and
`APPROVAL_BASE_URL` to its HTTPS address. Scanning the TV QR code opens a phone
approval form protected by `PAIRING_SECRET`; replace that form with your own
identity provider for a production connector.

For a password-protected production connector, generate a local owner password
hash with `node hash-password.js <password>` and set `PAIRING_PASSWORD_HASH`.
`PAIRING_SECRET` is a staging-only convenience PIN and must not be used for a
shared deployment.

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

## Library metadata

Open `/library` in a browser and authenticate with any username and the pairing password. The
scanner uses `guessit-js` to suggest a title, year, and episode information from
messy release names; confirm or correct the title and IMDb ID in the review UI.
Mappings persist in `data/library-index.json`, are keyed by relative media path,
and are used for the catalog and CleanStream skip lookup. The connector scans on
every catalog or library request, so added and removed files are reflected
without moving or renaming originals.

The scanner also reads a same-name `.nfo` sidecar or `movie.nfo` in the media
folder. NFO title, year, and IMDb IDs take precedence over filename suggestions;
explicit library-manager mappings take precedence over both.

When `TMDB_API_KEY` is set, it is used only by the connector to enrich catalog
and detail responses with public artwork and title metadata (overview, runtime,
genres, year, and rating). The key is never included in a response, image URL,
or client configuration. Without a key or when TMDB cannot match a title, the
connector continues to return the locally derived title and file description.
