# PaceNotes

PaceNotes is an open source, high-performance web itinerary planner. Several people can edit one fixed-date trip in real time without an account.

## MVP

- React 19 and TanStack Start
- Places, notes, reservations, lodging, and transport items
- Google place search, maps, routes, and transient place details
- Place ID-only storage for provider places
- Yjs and Hocuspocus live collaboration
- PostgreSQL 18 durable storage
- Desktop split view and mobile bottom sheet
- Installable PWA shell with an explicit update prompt
- AGPL-3.0-or-later

A random trip URL gives full edit and delete access. The MVP has no authentication, role, discovery, or offline editing contract.

## Start locally

1. Install Nix with flakes and direnv.
2. Run `direnv allow`.
3. Copy `.env.example` to `.env`.
4. Add a restricted Google browser key and a Google map ID.
5. Run `docker compose up --build`.
6. Open `http://localhost:3000`.

For application development:

```sh
docker compose up db
pnpm --dir app install
pnpm --dir app db:migrate
pnpm --dir app dev
```

## Checks

```sh
pnpm --dir app typecheck
pnpm --dir app lint
pnpm --dir app test
pnpm --dir app build
pnpm --dir app test:performance
nix flake check
```

Run `pnpm --dir app test:e2e` after the web process and PostgreSQL are ready. Run `pnpm --dir app test:performance` against the production web process on port 3000.

## Deployment

`compose.yaml` runs one web process, a one-shot migration process, and PostgreSQL 18.6. The web process serves HTTP and the `/sync` WebSocket route on one port. The release workflow accepts signed `vMAJOR.MINOR.PATCH` tags and publishes the image to GHCR.

The Nix image is available as `.#docker` on Linux. Set these runtime values:

- `DATABASE_URL`
- `RATE_LIMIT_SALT`
- `GOOGLE_MAPS_API_KEY`
- `GOOGLE_MAP_ID`


## Documentation

- [Architecture](docs/architecture.md)
- [Deployment](docs/deployment.md)
- [Security](docs/security.md)
- [Roadmap](docs/roadmap.md)
- [License](LICENSE)
