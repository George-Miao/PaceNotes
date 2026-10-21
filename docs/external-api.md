# External API and MCP

External access is off by default. Set `PACENOTES_EXTERNAL_ENABLED=true` on the web process to enable JSON-RPC v1 and MCP. Use HTTPS outside a local machine. A trip ID gives full edit access to that trip. Do not put it in a log, a query string, or a public issue. These interfaces do not offer hard trip deletion. The web trip URL still does.

The server keeps live content in Yjs and stores it in PostgreSQL. An API write is complete when the live document accepts it. It does not wait for a PostgreSQL flush. Limits are 30 days, 500 places, and 10 editors per trip. Read [deployment](deployment.md) for provider keys and rate limits.

## JSON-RPC v1

Send one JSON-RPC 2.0 request to `POST /api/v1/rpc`. Use `Authorization: Bearer <tripId>` for trip calls. `trip.create` and `place.search` do not need a trip ID. A client can read the OpenRPC 1.3.2 contract at `GET /api/v1/openrpc.json`; its source is `app/openrpc.json`. The server allows CORS from any origin for HTTP JSON-RPC. Keep the trip ID secret in browser code and network traces.

```sh
curl -sS "$PACENOTES_URL/api/v1/rpc" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $PACENOTES_TRIP_ID" \
  --data '{"jsonrpc":"2.0","id":1,"method":"trip.read","params":{"select":{"kind":"snapshot"}}}'
```

`trip.create` needs `idempotencyKey`, `startDate`, `endDate`, and `destination.placeId`. An optional `timeZone` overrides the time zone from Google Place Details. Without it, the server reads `timeZone.id` with the server-only Places API (New) key. A server key is also needed for `place.search`. Google Place Details time zone data can incur a paid Pro SKU charge. Set Google project quotas and billing alerts. The server returns only saved Place IDs in trip reads, not transient Google names or coordinates.

A snapshot contains `days`, `order`, `items`, `friends`, `expenses`, and `settlements`, plus trip settings. These are saved records, not a derived day view. `trip.read` also accepts `items`, `item`, `tripmates`, `tripmate`, `expenses`, `expense`, `payments`, `payment`, and `finance` selectors. List selectors accept `limit` up to 100 and an opaque `cursor`; the result has `records` and `nextCursor`. `finance` returns balances and suggested payments, not a money transfer.

Named changes are `trip.update`, `trip.setDates`, `trip.changeCurrency`, `item.create`, `item.update`, `item.move`, `item.reorder`, `item.remove`, `tripmate.create`, `tripmate.update`, `tripmate.remove`, `expense.create`, `expense.update`, `expense.remove`, `payment.create`, `payment.update`, and `payment.remove`. The OpenRPC contract defines every field. Creates need a caller-generated 16-128 character `idempotencyKey`. The server retains the result for 24 hours and returns it on a retry with the same input. A different input with the same key returns a conflict. A tripmate can be removed only if no financial record uses it. Item removal keeps an attached expense and clears its item link. A payment above the outstanding amount needs `acknowledgeOverpayment: true`.

Each edited record has a `version`. Send its `expected` version on a change. An item move also needs `orderExpected`. A stale write returns `CONFLICT` with `data.current` and `data.version`; a removed record returns null for both. Unrelated record changes do not make an item version stale. Times use the trip IANA time zone. A daylight-saving gap is invalid. An ambiguous time returns `INVALID_PARAMS` with both values in `data.offsets`; retry with `timeChoice: "earlier"` or `"later"`. This choice stays with the item. A time-zone change keeps local clock times and checks them again.

Errors use JSON-RPC codes `-32602` for invalid parameters, `-32003` for forbidden access, `-32004` for a missing trip or record, `-32009` for a conflict, `-32029` for a rate limit, and `-32052` for an unavailable provider. A malformed JSON request uses `-32700`. Do not use an HTTP status alone to identify a JSON-RPC error.

### Live notices

`GET /api/v1/events` sends SSE `trip.changed` events. Send the trip bearer header with `fetch`, not with `EventSource`, which cannot set it. Native clients can use `GET /api/v1/ws` with the same header for both JSON-RPC calls and `trip.changed` notifications. Browser WebSocket cannot set that header, so use HTTP and SSE in a browser. The WebSocket Origin must be in `PACENOTES_EXTERNAL_ALLOWED_ORIGINS` when an Origin is present. SSE uses an HTTP fetch and needs no Origin allowlist. Do not send the trip ID in a WebSocket query string.

A notice has `trip` and `order` flags and changed IDs in `items`, `tripmates`, `expenses`, and `payments`. It does not contain full records. There is no replay. After any disconnect, read a fresh snapshot and then listen again.

## Remote MCP

The public creation and place search endpoint is `/mcp/v1/bootstrap`. A trip client uses `/mcp/v1/trips/<tripId>`. This path contains the bearer trip ID. Keep MCP URLs private. MCP does not offer trip deletion. Browsers need an exact Origin in `PACENOTES_EXTERNAL_ALLOWED_ORIGINS`. Server clients without an Origin do not need that setting.

The remote server supports MCP `2026-07-28` with `server/discover`, tools, resources, and `subscriptions/listen`. It also supports `2025-11-25` with `initialize`, a session ID, resource subscription, and GET SSE. Trip tools use the same names and JSON fields as JSON-RPC. The `pacenotes://trip/changes` resource holds the most recent changed IDs while a listener is active. Modern listeners first receive `notifications/subscriptions/acknowledged`, then `notifications/resources/updated`. Older clients use `resources/subscribe` and a session GET stream. A client without subscriptions can read the resource and call `trip.read` again. Do not use the change resource as a durable history.

### Local stdio client

Tagged releases attach unsigned standalone executables and `SHA256SUMS`:

- `pacenotes-mcp-linux-x64`
- `pacenotes-mcp-macos-x64`
- `pacenotes-mcp-macos-arm64`
- `pacenotes-mcp-windows-x64.exe`

Check the checksum before use. The executable is a stdio proxy to a running PaceNotes server. It does not start a local database and it needs network access. Set `PACENOTES_MCP_BASE_URL` to the HTTPS server origin and `PACENOTES_MCP_TRIP_ID` for a trip. For public tools, set `PACENOTES_MCP_BOOTSTRAP=1` instead of a trip ID. The proxy accepts JSON-RPC lines on stdin and writes JSON-RPC lines on stdout. It forwards both supported MCP versions and resource notices. A local build uses `pnpm --dir app build:mcp-cli --target=bun-linux-x64 --outfile=dist/pacenotes-mcp-linux-x64`.

## Source SDKs

No SDK is published to a package registry. Each client uses JSON-RPC v1 methods and keeps no second trip state store.

- TypeScript: import `createPaceNotesClient` from `app/src/sdk/index.ts`. Browser code uses HTTP calls and `subscribeChanges` with authenticated fetch SSE. Node code can import `subscribeNodeWebSocket` from `app/src/sdk/node.ts`; it has authenticated WebSocket calls and notices. Both refetch a full snapshot after reconnect. The Node entry needs the app's exact `ws` dependency.
- Python 3.11 or later: install `./sdk/python` from source. Use `async with PaceNotesClient(base_url, trip_id)` and named async methods, `events(transport="sse")`, or `events(transport="websocket")`. See [Python SDK](../sdk/python/README.md). It does not retry a write on its own.
- Rust: add `sdk/rust` as a path dependency. Enable `reqwest` for Tokio or `cyper` for Compio. The Cyper feature selects Compio's polling driver; the application supplies a Compio runtime. Both clients have named async methods, authenticated SSE, and native WebSocket calls and notices. See [Rust SDK](../sdk/rust/README.md).

Python and Rust use API major version 1 and can release on separate schedules. The OpenRPC document is the wire contract. Build a client against that contract, not the browser's transient map data.
