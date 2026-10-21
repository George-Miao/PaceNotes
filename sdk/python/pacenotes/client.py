"""Async PaceNotes v1 JSON-RPC client and changed-ID event streams."""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import AsyncIterator, Mapping
from typing import Any, Literal, cast
from urllib.parse import urlsplit, urlunsplit

import httpx
from websockets.asyncio.client import connect
from websockets.exceptions import WebSocketException

from . import types as wire

CallTransport = Literal["http", "websocket"]
EventTransport = Literal["sse", "websocket"]

_ERROR_NAMES = {
    -32602: "INVALID_PARAMS",
    -32003: "FORBIDDEN",
    -32004: "NOT_FOUND",
    -32009: "CONFLICT",
    -32029: "RATE_LIMIT",
    -32052: "PROVIDER_UNAVAILABLE",
}
_CREATE_METHODS = frozenset({
    "trip.create", "item.create", "tripmate.create", "expense.create", "payment.create",
})
_PUBLIC_METHODS = frozenset({"trip.create", "place.search"})
_KEY = re.compile(r"[A-Za-z0-9_-]{16,128}\Z")


class PaceNotesError(Exception):
    """A JSON-RPC error. The original error data is available in ``data``."""

    def __init__(self, code: int, message: str, data: object = None):
        self.code = code
        self.name = _ERROR_NAMES.get(code, "RPC_ERROR")
        self.message = message
        self.data = data
        super().__init__(f"{self.name} ({code}): {message}")


class ConflictError(PaceNotesError):
    """A stale write. ``current`` and ``version`` are the server's current values."""

    @property
    def current(self) -> object:
        return self.data.get("current") if isinstance(self.data, dict) else None

    @property
    def version(self) -> str | None:
        value = self.data.get("version") if isinstance(self.data, dict) else None
        return value if isinstance(value, str) else None


class TransportError(Exception):
    """The network stream ended or the remote side sent invalid JSON-RPC data.

    An event stream cannot replay missed changes. Refetch with ``trip_read``
    after a disconnect, before starting a new event stream.
    """


def _json(value: str | bytes) -> object:
    try:
        return json.loads(value)
    except (ValueError, UnicodeDecodeError) as exc:
        raise TransportError("Invalid JSON from PaceNotes") from exc


def _result(message: object, request_id: str) -> object:
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0" or message.get("id") != request_id:
        raise TransportError("Invalid JSON-RPC response")
    error = message.get("error")
    if error is not None:
        if not isinstance(error, dict) or not isinstance(error.get("code"), int) or not isinstance(error.get("message"), str):
            raise TransportError("Invalid JSON-RPC error")
        cls = ConflictError if error["code"] == -32009 else PaceNotesError
        raise cls(error["code"], error["message"], error.get("data"))
    if "result" not in message:
        raise TransportError("JSON-RPC response has no result")
    return message["result"]


def _change(value: object) -> wire.TripChange:
    if not isinstance(value, dict) or not isinstance(value.get("trip"), bool) or not isinstance(value.get("order"), bool):
        raise TransportError("Invalid trip.changed notification")
    for field in ("items", "tripmates", "expenses", "payments"):
        ids = value.get(field)
        if not isinstance(ids, list) or any(not isinstance(item, str) for item in ids):
            raise TransportError("Invalid trip.changed notification")
    return cast(wire.TripChange, value)


class PaceNotesClient:
    """One client for a trip. Use ``trip_id=None`` for public create and search.

    HTTP and WebSocket send the trip ID as an Authorization bearer token.
    Each WebSocket RPC call uses its own connection. The client keeps no trip
    state and never retries a write without its caller's idempotency key.
    """

    def __init__(self, base_url: str, trip_id: str | None = None, *, timeout: float = 30.0):
        parts = urlsplit(base_url)
        if parts.scheme not in ("http", "https") or not parts.netloc or parts.query or parts.fragment:
            raise ValueError("base_url must be an HTTP(S) origin or URL path")
        self._base_url = base_url.rstrip("/")
        self._trip_id = trip_id
        self._http = httpx.AsyncClient(timeout=timeout)
        self._closed = False

    async def __aenter__(self) -> PaceNotesClient:
        if self._closed:
            raise RuntimeError("PaceNotesClient is closed")
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._http.aclose()
        self._closed = True

    @property
    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._trip_id}"} if self._trip_id is not None else {}

    def _url(self, path: str) -> str:
        return self._base_url + path

    def _ws_url(self) -> str:
        url = urlsplit(self._url("/api/v1/ws"))
        return urlunsplit(("wss" if url.scheme == "https" else "ws", url.netloc, url.path, url.query, ""))

    async def call(self, method: wire.Method, params: Mapping[str, Any], *, transport: CallTransport = "http") -> object:
        """Call a v1 method. Use typed method wrappers for typed results."""
        if self._closed:
            raise RuntimeError("PaceNotesClient is closed")
        if method not in _PUBLIC_METHODS and self._trip_id is None:
            raise ValueError("A trip ID is required for this method")
        if method in _CREATE_METHODS and not (
            isinstance(params.get("idempotencyKey"), str) and _KEY.fullmatch(params["idempotencyKey"])
        ):
            raise ValueError("Create actions require a 16-128 character idempotencyKey")
        request_id = uuid.uuid4().hex
        request = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": dict(params)}
        if transport == "http":
            try:
                response = await self._http.post(self._url("/api/v1/rpc"), json=request, headers=self._headers)
            except httpx.HTTPError as exc:
                raise TransportError("PaceNotes HTTP request failed") from exc
            if not response.content:
                raise TransportError(f"PaceNotes HTTP returned {response.status_code} without JSON-RPC")
            value = _json(response.content)
            result = _result(value, request_id)
            if response.is_error:
                raise TransportError(f"PaceNotes HTTP returned {response.status_code}")
            return result
        if transport == "websocket":
            try:
                async with connect(self._ws_url(), additional_headers=self._headers) as socket:
                    await socket.send(json.dumps(request))
                    while True:
                        message = _json(await socket.recv())
                        # A notification can arrive while waiting for a call result.
                        if isinstance(message, dict) and message.get("method") == "trip.changed" and "id" not in message:
                            continue
                        return _result(message, request_id)
            except (OSError, TimeoutError, WebSocketException) as exc:
                raise TransportError("PaceNotes WebSocket disconnected") from exc
        raise ValueError("transport must be 'http' or 'websocket'")

    async def events(self, *, transport: EventTransport = "sse") -> AsyncIterator[wire.TripChange]:
        """Yield changed record IDs. On any disconnect, refetch trip.read.

        This stream does not reconnect or replay changes. A new ``events`` call
        opens a fresh stream after the caller has refetched its trip data.
        """
        if self._closed:
            raise RuntimeError("PaceNotesClient is closed")
        if self._trip_id is None:
            raise ValueError("A trip ID is required for events")
        if transport == "sse":
            try:
                async with self._http.stream(
                    "GET", self._url("/api/v1/events"),
                    headers={**self._headers, "Accept": "text/event-stream"},
                    timeout=None,
                ) as response:
                    response.raise_for_status()
                    event = ""
                    data: list[str] = []
                    async for line in response.aiter_lines():
                        if not line:
                            if event == "trip.changed" and data:
                                yield _change(_json("\n".join(data)))
                            event, data = "", []
                        elif line.startswith("event:"):
                            event = line[6:].lstrip(" ")
                        elif line.startswith("data:"):
                            data.append(line[5:].lstrip(" "))
                    raise TransportError("PaceNotes SSE stream disconnected; refetch trip.read")
            except httpx.HTTPError as exc:
                raise TransportError("PaceNotes SSE stream disconnected; refetch trip.read") from exc
        elif transport == "websocket":
            try:
                async with connect(self._ws_url(), additional_headers=self._headers) as socket:
                    async for raw in socket:
                        message = _json(raw)
                        if (
                            isinstance(message, dict) and message.get("jsonrpc") == "2.0"
                            and message.get("method") == "trip.changed" and "id" not in message
                        ):
                            yield _change(message.get("params"))
                    raise TransportError("PaceNotes WebSocket disconnected; refetch trip.read")
            except (OSError, TimeoutError, WebSocketException) as exc:
                raise TransportError("PaceNotes WebSocket disconnected; refetch trip.read") from exc
        else:
            raise ValueError("transport must be 'sse' or 'websocket'")

    async def trip_create(self, params: wire.TripCreateParams, *, transport: CallTransport = "http") -> wire.TripCreateResult:
        return cast(wire.TripCreateResult, await self.call("trip.create", params, transport=transport))

    async def place_search(self, params: wire.PlaceSearchParams, *, transport: CallTransport = "http") -> wire.PlaceSearchResult:
        return cast(wire.PlaceSearchResult, await self.call("place.search", params, transport=transport))

    async def trip_read(self, params: wire.TripReadParams, *, transport: CallTransport = "http") -> wire.ReadResult:
        return cast(wire.ReadResult, await self.call("trip.read", params, transport=transport))

    async def trip_update(self, params: wire.TripUpdateParams, *, transport: CallTransport = "http") -> wire.TripResult:
        return cast(wire.TripResult, await self.call("trip.update", params, transport=transport))

    async def trip_set_dates(self, params: wire.TripSetDatesParams, *, transport: CallTransport = "http") -> wire.TripResult:
        return cast(wire.TripResult, await self.call("trip.setDates", params, transport=transport))

    async def trip_change_currency(self, params: wire.TripChangeCurrencyParams, *, transport: CallTransport = "http") -> wire.TripResult:
        return cast(wire.TripResult, await self.call("trip.changeCurrency", params, transport=transport))

    async def item_create(self, params: wire.ItemCreateParams, *, transport: CallTransport = "http") -> wire.ItemResult:
        return cast(wire.ItemResult, await self.call("item.create", params, transport=transport))

    async def item_update(self, params: wire.ItemUpdateParams, *, transport: CallTransport = "http") -> wire.ItemResult:
        return cast(wire.ItemResult, await self.call("item.update", params, transport=transport))

    async def item_move(self, params: wire.ItemMoveParams, *, transport: CallTransport = "http") -> wire.ItemResult:
        return cast(wire.ItemResult, await self.call("item.move", params, transport=transport))

    async def item_reorder(self, params: wire.ItemReorderParams, *, transport: CallTransport = "http") -> wire.ItemReorderResult:
        return cast(wire.ItemReorderResult, await self.call("item.reorder", params, transport=transport))

    async def item_remove(self, params: wire.IdExpectedParams, *, transport: CallTransport = "http") -> wire.ItemRemovedResult:
        return cast(wire.ItemRemovedResult, await self.call("item.remove", params, transport=transport))

    async def tripmate_create(self, params: wire.TripmateCreateParams, *, transport: CallTransport = "http") -> wire.TripmateResult:
        return cast(wire.TripmateResult, await self.call("tripmate.create", params, transport=transport))

    async def tripmate_update(self, params: wire.TripmateUpdateParams, *, transport: CallTransport = "http") -> wire.TripmateResult:
        return cast(wire.TripmateResult, await self.call("tripmate.update", params, transport=transport))

    async def tripmate_remove(self, params: wire.IdExpectedParams, *, transport: CallTransport = "http") -> wire.RemovedResult:
        return cast(wire.RemovedResult, await self.call("tripmate.remove", params, transport=transport))

    async def expense_create(self, params: wire.ExpenseCreateParams, *, transport: CallTransport = "http") -> wire.ExpenseResult:
        return cast(wire.ExpenseResult, await self.call("expense.create", params, transport=transport))

    async def expense_update(self, params: wire.ExpenseUpdateParams, *, transport: CallTransport = "http") -> wire.ExpenseResult:
        return cast(wire.ExpenseResult, await self.call("expense.update", params, transport=transport))

    async def expense_remove(self, params: wire.IdExpectedParams, *, transport: CallTransport = "http") -> wire.RemovedResult:
        return cast(wire.RemovedResult, await self.call("expense.remove", params, transport=transport))

    async def payment_create(self, params: wire.PaymentCreateParams, *, transport: CallTransport = "http") -> wire.PaymentResult:
        return cast(wire.PaymentResult, await self.call("payment.create", params, transport=transport))

    async def payment_update(self, params: wire.PaymentUpdateParams, *, transport: CallTransport = "http") -> wire.PaymentResult:
        return cast(wire.PaymentResult, await self.call("payment.update", params, transport=transport))

    async def payment_remove(self, params: wire.IdExpectedParams, *, transport: CallTransport = "http") -> wire.RemovedResult:
        return cast(wire.RemovedResult, await self.call("payment.remove", params, transport=transport))
