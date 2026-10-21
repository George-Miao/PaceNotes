import { defineHandler, defineWebSocketHandler } from "nitro";
import { ExternalError, tripChangeSchema } from "../../../../src/features/external/contract";
import { subscribeTripChanges } from "../../../../src/features/external/events.server";
import {
  allowedWebSocketOrigin,
  baseUrl,
  bearerTripId,
  externalEnabled,
  externalRpcError,
  handleRpcText,
  invalidRpcRequest,
  maxRpcBytes,
} from "./transport";

type Connection = {
  tripId: string | null;
  closed: boolean;
  unsubscribe: (() => Promise<void>) | null;
};

const connections = new Map<string, Connection>();

const wsHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

function wsRejection(body: string, status: number): Response {
  return new Response(body, { status, headers: wsHeaders });
}

async function releaseConnection(id: string): Promise<void> {
  const connection = connections.get(id);
  if (!connection) return;
  connections.delete(id);
  connection.closed = true;
  const unsubscribe = connection.unsubscribe;
  connection.unsubscribe = null;
  if (unsubscribe) await unsubscribe().catch(() => {});
}

function closePeer(
  peer: { id: string; close(code: number, reason: string): void },
  code: number,
  reason: string,
): void {
  void releaseConnection(peer.id);
  try {
    peer.close(code, reason);
  } catch {
    // The socket may have closed already.
  }
}

const handler = defineWebSocketHandler({
  upgrade(request) {
    if (!externalEnabled()) return wsRejection("Not Found", 404);
    if (!allowedWebSocketOrigin(request)) return wsRejection("Forbidden", 403);
    if (new URL(request.url).search) return wsRejection("Query parameters are not accepted", 400);
    try {
      bearerTripId(request.headers);
    } catch {
      return wsRejection("Forbidden", 403);
    }
    return { headers: wsHeaders };
  },
  async open(peer) {
    const tripId = bearerTripId(peer.request.headers);
    const connection: Connection = { tripId, closed: false, unsubscribe: null };
    connections.set(peer.id, connection);
    if (tripId === null) return;
    try {
      const unsubscribe = await subscribeTripChanges(tripId, (change) => {
        if (connection.closed) return;
        const parsed = tripChangeSchema.safeParse(change);
        if (!parsed.success) {
          closePeer(peer, 1011, "Invalid change");
          return;
        }
        if (peer.bufferedAmount > maxRpcBytes) {
          closePeer(peer, 1013, "Slow client");
          return;
        }
        try {
          peer.send(
            JSON.stringify({ jsonrpc: "2.0", method: "trip.changed", params: parsed.data }),
          );
        } catch {
          closePeer(peer, 1011, "WebSocket error");
        }
      });
      if (connection.closed) await unsubscribe();
      else connection.unsubscribe = unsubscribe;
    } catch (error) {
      if (connection.closed) return;
      try {
        peer.send(JSON.stringify(externalRpcError(null, error)));
      } catch {
        // The error response is unavailable after the socket closes.
      }
      closePeer(peer, error instanceof ExternalError ? 1008 : 1011, "Trip unavailable");
    }
  },
  async message(peer, message) {
    const connection = connections.get(peer.id);
    if (!connection || connection.closed) return;
    let text: string;
    try {
      const bytes = message.uint8Array();
      if (bytes.byteLength > maxRpcBytes) {
        try {
          peer.send(JSON.stringify(invalidRpcRequest("Request is too large")));
        } catch {
          // The socket cannot receive an error response after it closes.
        }
        closePeer(peer, 1009, "Request is too large");
        return;
      }
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      text = "";
    }
    const response = await handleRpcText(text, {
      tripId: connection.tripId,
      clientAddress: peer.remoteAddress ?? "unknown",
      baseUrl: baseUrl(peer.request),
    });
    if (connection.closed) return;
    if (peer.bufferedAmount > maxRpcBytes) {
      closePeer(peer, 1013, "Slow client");
      return;
    }
    try {
      peer.send(JSON.stringify(response));
    } catch {
      closePeer(peer, 1011, "WebSocket error");
    }
  },
  async close(peer) {
    await releaseConnection(peer.id);
  },
  error(peer) {
    closePeer(peer, 1011, "WebSocket error");
  },
});

export default defineHandler((event) => {
  if (!externalEnabled()) return wsRejection("Not Found", 404);
  return handler(event);
});
