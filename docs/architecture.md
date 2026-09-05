# Architecture

## Process model

PaceNotes has two application process modes from one image:

1. The TanStack Start web process serves HTML, assets, server routes, server functions, and the Hocuspocus `/sync` WebSocket route.
2. The migration process applies ordered Drizzle SQL migrations and exits.

PostgreSQL 18 stores trip metadata, the durable Yjs document, and recent trip-creation events.

## Trip module

`features/trip/model.ts` defines the trip language and validation. A trip has fixed dates, one IANA time zone default, one ordered item collection, and one planning inbox. Item types are place, note, reservation, lodging, and transport.

`features/collaboration/document.ts` is the interface to the Yjs document. Callers add, update, delete, and reorder items through this module. Callers do not work with Yjs maps directly.

The Yjs document is the client source of truth. Local React state contains only transient display state, such as the selected item, open panel, and drag state.

## Collaboration

Each trip ID is one Hocuspocus document name. The `/sync` route accepts a connection only after it checks that the random trip exists and is active. This check is not user authentication. The URL remains a bearer capability.

Yjs resolves simultaneous field edits with deterministic conflict rules. A local undo manager tracks only local document origins. It keeps at most 100 captured edits.

A trip hard delete first marks the database row as deleting. The collaboration module closes matching live connections. The web process then deletes the row and its document through the database cascade.

## Map and provider

Google Maps Platform supplies place search, transient place fields, the map, and route legs. PaceNotes stores only Google Place IDs. Names, addresses, coordinates, reviews, and photos stay in memory and render only on allowed Google surfaces. Map rendering is a lazy client seam, so list planning does not include the map renderer in its first planner chunk.

Route order comes from visible itinerary order. A stale route stays visible and marked stale until the new route is ready. If Google routing fails, the itinerary remains usable and the leg reports that the route is unavailable.

When an editor adds a place to the active day, `features/trip/place-placement.ts` ranks every visible insertion point. It first minimizes schedule overflow, including open-item durations and elapsed time across clock changes, then minimizes the Google route minutes introduced by the place. Google place coordinates and route matrices remain transient; the collaboration document receives only the item label and Place ID. Partial or unavailable routing falls back to the schedule evidence that is available.

## Time

Saved local item times use the assigned day and an IANA time-zone ID. `Temporal` converts the local value to an instant. A missing daylight-saving time is rejected. A duplicated time requires an explicit earlier or later choice.

## Data limits

- 30 trip days
- 500 place items by product contract
- 10 active editors by product contract
- 10,000 characters for item details
- 200 characters for trip titles
- 300 characters for item titles
- 10 trip creations per client address per hour

The UI limits are usability limits. Server validation is the authority at network seams.
