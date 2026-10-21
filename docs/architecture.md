# Architecture

## Runtime and storage

The TanStack Start process applies ordered Drizzle migrations before it serves server functions and the Hocuspocus `/sync` route.

PostgreSQL 18 stores trip metadata, durable Yjs documents, and recent trip-creation events.

## Trip document

`features/trip/model.ts` defines trip validation. A trip has fixed dates, one IANA time zone, an ordered item collection, and a planning inbox. Items can be places, notes, reservations, lodging, or transport.

`features/collaboration/document.ts` is the only interface to the Yjs document. Yjs is the source of truth for mutable trip content and resolves concurrent edits. PostgreSQL stores the document durably.

Each trip ID is one Hocuspocus document name. `/sync` accepts a connection only when the trip exists and is active. The trip URL is a bearer capability.

A hard delete marks the trip as deleting, closes its live connections, and deletes its database records through a cascade.

## Opt-in external interfaces

The same Nitro process serves JSON-RPC v1 at `/api/v1/rpc`, SSE notices at `/api/v1/events`, JSON-RPC WebSocket at `/api/v1/ws`, and MCP at `/mcp/v1/*`. All are off unless `PACENOTES_EXTERNAL_ENABLED=true`. The HTTP and MCP handlers call one server action module. It validates wire input, checks live record versions, applies changes to the shared Hocuspocus document, and returns saved data. No second client trip store exists.

PostgreSQL stores 24-hour creation idempotency rows and request rate buckets. A record creation writes its result and receipt in one Yjs transaction before it marks the PostgreSQL claim complete. Event listeners watch the shared document, including browser edits, and send changed record IDs. SSE, WebSocket, and MCP events have no replay. The OpenRPC contract in `app/openrpc.json` defines the HTTP method shapes. Source clients in TypeScript, Python, and Rust use that contract.

## Provider and time data

PaceNotes stores only Google Place IDs. Google names, addresses, coordinates, reviews, photos, and route data remain transient.

Saved item times use the trip IANA time zone. Missing daylight-saving times are rejected. Duplicated times require an explicit earlier or later choice.
