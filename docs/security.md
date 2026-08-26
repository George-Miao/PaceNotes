# Security

## Capability URLs

PaceNotes has no accounts in the MVP. A random trip ID in `/trips/<id>` gives full view, edit, share, and delete access. Treat the complete URL as a secret.

Trip pages use `noindex`, `nofollow`, `noarchive`, and `no-referrer`. PaceNotes has no trip search, index, sitemap entry, or public listing. These controls reduce accidental exposure. They do not replace authentication.

Do not put private, regulated, or safety-critical data in a trip. Anyone who receives the URL can copy it. Hard deletion cannot remove a copy that a browser or editor already saved.

## Input and content

All network and persistence seams validate structured input. Notes use CommonMark with a limited GFM subset. Raw HTML is skipped. The rendered tree passes through `rehype-sanitize`. Links open with `noreferrer`.

Server logs must not contain:

- Full trip URLs or trip IDs paired with client data
- Place query text
- Trip notes or reservation details
- Google request parameters
- Database credentials, salts, or keys

Startup and health logs can contain an event name, process mode, port, and status.

## Provider keys and content

The Google browser key is visible to browser users by design. Restrict it by exact origin and interface. Do not use an unrestricted key. Do not use the browser key for server work.

Store only Google Place IDs. Keep Google names, addresses, coordinates, reviews, and photos in memory and within allowed Google map and Places UI Kit surfaces. Never copy that Google content into Yjs or PostgreSQL.

## Database and sync

Keep PostgreSQL on a private network. Use TLS and managed credentials outside the local Compose stack. Use separate values for `RATE_LIMIT_SALT` in each environment.

The `/sync` WebSocket route checks that a trip is active before it accepts collaboration messages. Trip deletion marks the row as deleting, closes live document connections, and removes durable data. Rotation and revocation of a shared trip URL are not part of the MVP.

## Reports

Report a security issue through a private repository security advisory. Do not put an active secret URL, key, or exploit detail in a public issue.
