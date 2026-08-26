# PaceNotes repository guide

## Project structure

- `app/` is the only JavaScript package. It contains the React 19 and TanStack Start application.
- `app/src/routes/` contains page routes, server routes, and route loaders.
- `app/src/features/trip/` owns trip types, validation, date rules, and server functions.
- `app/src/features/collaboration/` owns the Yjs document interface and React synchronization hook.
- `app/src/sync/` and `app/server/routes/sync.ts` own Hocuspocus collaboration on the web port.
- `app/src/db/` and `app/drizzle/` own the PostgreSQL schema and migrations.
- `app/src/features/google/` owns Google place search, transient place fields, map display, and route computation.
- `prototype/` contains the approved Compact Precision design work. Do not use it as a second application.
- `flake.nix` owns development dependencies, the reproducible application build, and the Linux image build.
- `compose.yaml` runs the web, migration, and PostgreSQL processes on one host.

## Product contract

- The MVP builds a fixed-date day itinerary for up to 30 days, 500 places, and 10 editors.
- A trip URL is the only access control. Anyone with the URL can view, edit, share, or delete the trip.
- There is no authentication, role, trip discovery, offline editing contract, or public trip index.
- Trip pages must use `noindex` and `no-referrer` policies.
- Places to visit and unscheduled items stay in the planning inbox until an editor assigns a day.
- Item times use the trip IANA time zone. Reject daylight-saving gaps. Ask the editor to resolve duplicated times.
- Deleting a day moves items on that day to the inbox and shifts later planning days one day earlier.
- Local undo covers this editor's current session. It must not undo another editor's work or a hard trip deletion.

## Data and provider rules

- Yjs is the source of truth for live trip content. Do not copy the trip into another client state store.
- PostgreSQL is the durable store. A Docker volume is not a backup.
- Hocuspocus runs inside the Nitro web process on `/sync`. TanStack server functions remain request-response interfaces.
- Google Maps Platform supplies place search, transient place fields, the map, and route legs.
- Store only Google Place IDs. Resolve names, addresses, coordinates, reviews, and photos in memory and keep them on allowed Google surfaces. Never copy Google place content into Yjs or PostgreSQL.
- Restrict the Google browser key by exact origin and interface. Never commit a key.
- Logs must not include full trip URLs, query text, notes, provider parameters, or secret values.

## Interface and design rules

- Use deep modules. Keep Yjs details behind `features/collaboration/document.ts`.
- Use the Compact Precision direction: small radii, crisp borders, dense neutral surfaces, quiet blue accents, and white text on primary blue controls.
- Light and dark modes follow the system. Keep WCAG 2.2 AA contrast and visible keyboard focus.
- Desktop uses a resizable itinerary and map split. Mobile uses a draggable bottom sheet. Keep Map, List, and Split modes.
- Timed itinerary entries show time first, then a type icon, title, optional status, and details. Transport legs are grey and borderless between bordered entry cards.
- Use Iconify Lucide icons for actions and item types. Give icon-only controls an accessible name.
- Do not add color to date navigation. Its hover state is grey and its active state is white.

## Development commands

Run all commands from the repository root unless stated otherwise.

- `direnv allow` enters the pinned Nix shell.
- `nix develop` opens the Node.js 24, pnpm 11, PostgreSQL 18, and Docker Compose shell.
- `pnpm --dir app install` installs application dependencies.
- `pnpm --dir app dev` starts the web development server.
- `pnpm --dir app db:migrate` applies database migrations.
- `pnpm --dir app typecheck` checks TypeScript.
- `pnpm --dir app lint` checks formatting and lint rules.
- `pnpm --dir app test` runs focused unit and CRDT tests.
- `pnpm --dir app test:e2e` runs browser and accessibility checks against running services.
- `pnpm --dir app build` builds the web, collaboration, migration, and PWA outputs.
- `nix flake check` runs the release checks.
- `nix build .#docker` builds the Linux image on Linux.
- `docker compose up --build` runs the complete local stack.

## Change rules

- Use TypeScript strict mode. Keep `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` enabled.
- Use Zod at network and persistence seams. Use typed results and explicit error states.
- Use CSS modules for new isolated surfaces. Global CSS contains only shared tokens, controls, and the approved application layout.
- Add a test only for a new observable contract or a plausible regression.
- Use real PostgreSQL and Hocuspocus for browser collaboration checks. Do not mock the live data path.
- Do not call external Google test services in normal CI.
- Keep dependencies exact and small. Use native browser behavior before adding a package.
- Keep initial compressed JavaScript below 150 KiB and the planner route below 250 KiB before the lazy map chunk.
- Use Conventional Commits. Do not add a commit description or co-author line.
