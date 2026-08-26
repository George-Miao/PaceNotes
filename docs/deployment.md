# Deployment

## Required settings

Set these values on the web process:

- `DATABASE_URL`: PostgreSQL connection string.
- `RATE_LIMIT_SALT`: Long random value used to hash client addresses for creation limits.
- `GOOGLE_MAPS_API_KEY`: Restricted browser key for the enabled Google Maps Platform products.
- `GOOGLE_MAP_ID`: Google cloud map ID for Advanced Markers.
- `PORT`: Web port. The default is `3000`.


## Create the required values

Only `GOOGLE_MAPS_API_KEY` comes from Google as a credential. `GOOGLE_MAP_ID` is a public identifier. Create `RATE_LIMIT_SALT` locally. Obtain the production `DATABASE_URL` from the PostgreSQL operator. Set `PORT` from the deployment address.

### 1. Create the local environment file

If `.env` does not exist, run:

```sh
cp .env.example .env
```

Generate the rate-limit salt:

```sh
openssl rand -hex 32
```

Copy the output to `RATE_LIMIT_SALT` in `.env`. Use a different value in production. Keep this value and `DATABASE_URL` in the deployment secret store.

### 2. Create the Google Cloud project

1. Open [Google Maps Platform](https://console.cloud.google.com/google/maps-apis/start).
2. Create or select a Google Cloud project.
3. Link a billing account. Google requires billing for the production Maps JavaScript, Routes, Places API, and Places UI Kit interfaces.
4. Use separate projects for development and production.

### 3. Enable the Google interfaces

Enable these four interfaces in the selected project:

1. [Maps JavaScript API](https://console.cloud.google.com/apis/library/maps-backend.googleapis.com)
2. [Routes API](https://console.cloud.google.com/apis/library/routes.googleapis.com)
3. [Places API (New)](https://console.cloud.google.com/apis/library/places-backend.googleapis.com)
4. [Places UI Kit](https://console.cloud.google.com/apis/library/placewidgets.googleapis.com)

PaceNotes uses the Maps JavaScript `maps`, `marker`, `places`, and `routes` libraries. The Place class and new autocomplete need Places API (New). Place details need Places UI Kit. Route computation needs Routes API.

### 4. Create and restrict the browser key

1. Open [Google Maps Platform credentials](https://console.cloud.google.com/project/_/google/maps-apis/credentials).
2. Select **Create credentials**, then **API key**.
3. Edit the new key.
4. Under **Application restrictions**, select **Websites**.
5. For development, add `http://localhost:3000/*` and `http://127.0.0.1:3000/*`.
6. For production, add only the exact HTTPS site, such as `https://trips.example.com/*`.
7. Under **API restrictions**, select **Restrict key**.
8. Select Maps JavaScript API, Routes API, Places API (New), and Places UI Kit.
9. Save the key and copy it to `GOOGLE_MAPS_API_KEY`.

The browser key is visible to browser users. The website and interface restrictions control its use. Do not reuse it for server requests.

### 5. Create the map ID

1. Open [Google Maps Management](https://console.cloud.google.com/google/maps-apis/studio/maps).
2. Select **Create map ID**.
3. Enter a name such as `PaceNotes web`.
4. Select **JavaScript** and **Vector**.
5. Save the map ID.
6. Copy the ID to `GOOGLE_MAP_ID`.

Google requires a map ID for Advanced Markers. A map ID is not a secret.

### 6. Set the deployment address

Set the remaining values:

```dotenv
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DATABASE
PORT=3000
```

HTTP and WebSocket traffic use the same origin and port. Browsers connect to `/sync` with `ws://` locally and `wss://` through production TLS.

### 7. Add cost controls and test the setup

1. Create a [Cloud Billing budget and alert](https://cloud.google.com/billing/docs/how-to/budgets).
2. Review the quotas for Maps JavaScript API, Routes API, Places API (New), and Places UI Kit.
3. Run `docker compose config --quiet` to check the environment.
4. Run `docker compose up --build -d`.
5. Open the app and confirm that place search, place details, the map, markers, and route legs load.
6. Check `/health/ready` and `/health/live`.

Google setup references:

- [Maps JavaScript API setup](https://developers.google.com/maps/documentation/javascript/get-api-key)
- [Routes Library setup](https://developers.google.com/maps/documentation/javascript/routes/start)
- [Places UI Kit setup](https://developers.google.com/maps/documentation/javascript/places-ui-kit/get-started)
- [Map ID setup](https://developers.google.com/maps/documentation/javascript/map-ids/get-map-id)
- [API key security](https://developers.google.com/maps/api-security-best-practices)

## One-host stack

Run:

```sh
docker compose up --build -d
```

The stack starts PostgreSQL, waits for it to become healthy, runs the migration process once, then starts the web process. The web process serves HTTP and `/sync` WebSocket traffic on port 3000. Readiness includes a database query. Liveness only confirms that the web process can answer.

Use a reverse proxy with TLS. Route normal requests and WebSocket upgrades for `/sync` to port 3000. Keep PostgreSQL private.

## Backups

Back up PostgreSQL with a tool that supports PostgreSQL 18. Test restore steps on a separate database. A Docker named volume only keeps data across container replacement. It is not a backup.

The supported upgrade flow is:

1. Back up PostgreSQL.
2. Pull or build the new PaceNotes image.
3. Run the migration process.
4. Replace the web process.
5. Check `/health/ready` and `/health/live`.

Yjs schema changes before 1.0 must be forward-compatible. Use idempotent document migrations during the one-host deployment. Keep a database backup before each migration.

## Provider configuration

Use separate development and production provider projects. Restrict the Google browser key by exact production origins and required interfaces. Configure quota alerts and billing limits.

PaceNotes stores only Google Place IDs. Google names, addresses, coordinates, reviews, and photos stay in memory and render only on allowed Google map and Places UI Kit surfaces.

## Release image

A signed tag with the exact form `vMAJOR.MINOR.PATCH` starts the release workflow. The workflow verifies the tag, builds `.#docker`, and pushes the version and `latest` tags to GHCR. Set the GHCR package visibility to public before the first public release.
