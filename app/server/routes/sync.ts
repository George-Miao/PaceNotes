import type { WebSocketLike } from "@hocuspocus/server";
import { defineWebSocketHandler } from "nitro";
import { hocuspocus } from "../../src/sync/hocuspocus";

type ClientConnection = ReturnType<typeof hocuspocus.handleConnection>;

const connections = new Map<string, ClientConnection>();

export default defineWebSocketHandler({
  open(peer) {
    const connection = hocuspocus.handleConnection(
      peer.websocket as unknown as WebSocketLike,
      peer.request,
    );
    connections.set(peer.id, connection);
  },
  message(peer, message) {
    connections.get(peer.id)?.handleMessage(message.uint8Array());
  },
  close(peer, details) {
    connections.get(peer.id)?.handleClose({ code: details.code, reason: details.reason });
    connections.delete(peer.id);
  },
  error(peer, error) {
    connections.get(peer.id)?.handleClose({ code: 1011, reason: "WebSocket error" });
    connections.delete(peer.id);
    console.error("Hocuspocus WebSocket error", error);
  },
});
