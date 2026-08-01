# CleanStream Media Connector Reference

Self-hosted reference implementation of the v1 connector protocol.

```sh
PAIRING_SECRET='choose-a-long-secret' MEDIA_ROOT='/path/to/videos' node server.js
```

For production, place the service behind HTTPS and set `PUBLIC_BASE_URL` and
`APPROVAL_BASE_URL` to its HTTPS address. Scanning the TV QR code opens a phone
approval form protected by `PAIRING_SECRET`; replace that form with your own
identity provider for a production connector.
