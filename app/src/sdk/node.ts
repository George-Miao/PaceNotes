import type WebSocket from "ws";
import type { ExternalMethod } from "../features/external/contract";
import {
  type ChangeCallbacks,
  type MethodParams,
  type MethodResult,
  type PaceNotesClient,
  parseRpcResponse,
  parseTripChange,
} from "./index";

export type { ChangeCallbacks, MethodParams, MethodResult, PaceNotesClientOptions } from "./index";
export {
  createPaceNotesClient,
  PaceNotesClient,
  PaceNotesConflictError,
  PaceNotesRpcError,
} from "./index";

export interface NodeSocketSubscription {
  /** Calls are available after onRefetch. In-flight calls fail on disconnect; they are not retried. */
  call<M extends ExternalMethod>(method: M, params: MethodParams<M>): Promise<MethodResult<M>>;
  close(): void;
}

interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Node-only WebSocket transport. Import this module only on Node; browser clients use fetch and SSE. */
export function subscribeNodeWebSocket(
  client: PaceNotesClient,
  callbacks: ChangeCallbacks,
): NodeSocketSubscription {
  if (!client.tripId) throw new Error("A trip ID is required for WebSocket subscriptions");
  let closed = false;
  let ready = false;
  let socket: WebSocket | undefined;
  let timer: NodeJS.Timeout | undefined;
  let attempts = 0;
  let nextId = 0;
  const pending = new Map<number, PendingCall>();
  const notices: unknown[] = [];

  const disconnect = (error: Error, instance: WebSocket) => {
    if (socket !== instance) return;
    socket = undefined;
    ready = false;
    notices.length = 0;
    for (const call of pending.values()) call.reject(error);
    pending.clear();
    if (closed) return;
    callbacks.onDisconnect(error);
    if (closed) return;
    timer = setTimeout(
      () => {
        void connect();
      },
      Math.min(30_000, 1_000 * 2 ** Math.min(attempts++, 5)),
    );
  };

  const connect = async () => {
    try {
      // ws supplies an authenticated Node Upgrade request; browser WebSocket cannot set headers.
      const { default: WebSocketClient } = await import("ws");
      if (closed) return;
      const url = client.url("/api/v1/ws");
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const instance = new WebSocketClient(url, { headers: client.authorization() });
      socket = instance;
      instance.on("message", (data, binary) => {
        if (binary) {
          instance.close();
          return;
        }
        try {
          const message: unknown = JSON.parse(data.toString());
          if (!isObject(message) || message.jsonrpc !== "2.0")
            throw new Error("Invalid JSON-RPC message");
          if (message.method === "trip.changed") {
            const change = parseTripChange(message.params);
            if (ready) callbacks.onChange(change);
            else notices.push(change);
          } else if (typeof message.id === "number") {
            const call = pending.get(message.id);
            if (!call) return;
            pending.delete(message.id);
            try {
              call.resolve(parseRpcResponse(message, message.id));
            } catch (error) {
              call.reject(error instanceof Error ? error : new Error("Invalid JSON-RPC response"));
            }
          }
        } catch {
          instance.close();
        }
      });
      instance.once("error", (error) => {
        disconnect(error, instance);
        instance.terminate();
      });
      instance.once("close", () => disconnect(new Error("WebSocket disconnected"), instance));
      instance.once("open", () => {
        // The socket is subscribed now. Read a snapshot before delivering queued notices.
        void client.trip
          .read({ select: { kind: "snapshot" } })
          .then((snapshot) => {
            if (closed || socket !== instance) return;
            attempts = 0;
            ready = true;
            callbacks.onRefetch(snapshot);
            for (const notice of notices) callbacks.onChange(parseTripChange(notice));
            notices.length = 0;
          })
          .catch((error: unknown) => {
            disconnect(error instanceof Error ? error : new Error("Trip refetch failed"), instance);
            instance.close();
          });
      });
    } catch (error) {
      if (closed) return;
      callbacks.onDisconnect(
        error instanceof Error ? error : new Error("WebSocket connection failed"),
      );
      if (closed) return;
      timer = setTimeout(
        () => {
          void connect();
        },
        Math.min(30_000, 1_000 * 2 ** Math.min(attempts++, 5)),
      );
    }
  };
  void connect();

  return {
    call<M extends ExternalMethod>(method: M, params: MethodParams<M>): Promise<MethodResult<M>> {
      if (!ready || !socket || socket.readyState !== socket.OPEN) {
        return Promise.reject(new Error("WebSocket is not connected; wait for onRefetch"));
      }
      const id = ++nextId;
      const connection = socket;
      return new Promise<MethodResult<M>>((resolve, reject) => {
        pending.set(id, { resolve: (value) => resolve(value as MethodResult<M>), reject });
        connection.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }), (error) => {
          if (!error) return;
          pending.delete(id);
          reject(error);
        });
      });
    },
    close() {
      closed = true;
      ready = false;
      clearTimeout(timer);
      socket?.close();
      socket = undefined;
      for (const call of pending.values()) call.reject(new Error("WebSocket closed"));
      pending.clear();
    },
  };
}
