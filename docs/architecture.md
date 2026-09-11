# Architecture

## Runtime and storage

The TanStack Start process serves server functions and the Hocuspocus `/sync` route. A separate process applies ordered Drizzle migrations and exits.

PostgreSQL 18 stores trip metadata, durable Yjs documents, and recent trip-creation events.

## Trip document

`features/trip/model.ts` defines trip validation. A trip has fixed dates, one IANA time zone, an ordered item collection, and a planning inbox. Items can be places, notes, reservations, lodging, or transport.

`features/collaboration/document.ts` is the only interface to the Yjs document. Yjs is the source of truth for mutable trip content and resolves concurrent edits. PostgreSQL stores the document durably.

Each trip ID is one Hocuspocus document name. `/sync` accepts a connection only when the trip exists and is active. The trip URL is a bearer capability.

A hard delete marks the trip as deleting, closes its live connections, and deletes its database records through a cascade.

## Provider and time data

PaceNotes stores only Google Place IDs. Google names, addresses, coordinates, reviews, photos, and route data remain transient.

Saved item times use the trip IANA time zone. Missing daylight-saving times are rejected. Duplicated times require an explicit earlier or later choice.
