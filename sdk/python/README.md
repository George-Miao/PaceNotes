# PaceNotes Python SDK

Install from this source tree with `python -m pip install ./sdk/python`. This package is not published to a registry. Python 3.11 or later is required. Set `PACENOTES_EXTERNAL_ENABLED=true` on your PaceNotes server before you use the external interface. Use HTTPS in production. The trip ID is a bearer secret: do not print it, put it in a URL, or log request headers.

```python
import asyncio
import os
import secrets

from pacenotes import ConflictError, PaceNotesClient, TransportError

BASE_URL = os.environ["PACENOTES_URL"]
TRIP_ID = os.environ["PACENOTES_TRIP_ID"]

async def main() -> None:
    async with PaceNotesClient(BASE_URL, TRIP_ID) as client:
        read = await client.trip_read({"select": {"kind": "snapshot"}})
        assert read["kind"] == "snapshot"
        version = read["versions"]["trip"]
        try:
            await client.trip_update({
                "expected": version,
                "patch": {"title": "Revised trip"},
            })
        except ConflictError as error:
            # Decide how to merge using the current saved record and version.
            current_record = error.current
            current_version = error.version

        # A native WebSocket JSON-RPC call uses the same method and params.
        finance = await client.trip_read(
            {"select": {"kind": "finance"}}, transport="websocket"
        )
        assert finance["kind"] == "finance"


asyncio.run(main())
```

Public methods do not need a trip ID:

```python
async with PaceNotesClient(BASE_URL) as client:
    places = await client.place_search({"query": "Kyoto"})
    result = await client.trip_create({
        "idempotencyKey": secrets.token_urlsafe(24),
        "startDate": "2026-11-01",
        "endDate": "2026-11-03",
        "destination": {"placeId": places["places"][0]["placeId"]},
    })
    # Store result["id"] securely. It gives bearer access to this trip.
```

Use `transport="sse"` or `transport="websocket"` for live changed-ID notices. A notice has only changed record IDs, not full records. A stream has no replay. If the stream disconnects, fetch a new snapshot before you subscribe again. Do not keep a local trip cache as an authority.

```python
async def watch() -> None:
    async with PaceNotesClient(BASE_URL, TRIP_ID) as client:
        while True:
            await client.trip_read({"select": {"kind": "snapshot"}})
            try:
                async for change in client.events(transport="sse"):
                    print(change["items"])  # IDs; refetch the records you need.
                    await client.trip_read({"select": {"kind": "snapshot"}})
            except TransportError:
                await asyncio.sleep(1)
                # The next iteration refetches before opening a new stream.

# To use native WebSocket notices instead, call client.events(transport="websocket").
```

Each typed method takes a `TypedDict` from `pacenotes.types` and accepts `transport="http"` or `transport="websocket"`. All 20 methods in `app/openrpc.json` have named wrappers. `call(method, params, transport=...)` is also available for generic callers. Create methods reject absent or invalid idempotency keys before sending. The client does not retry writes or cache trip data. Server JSON-RPC errors raise `PaceNotesError`, with `code`, `name`, `message`, and `data`; `ConflictError.current` and `.version` expose the conflict payload.
