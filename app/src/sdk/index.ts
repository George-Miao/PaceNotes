import type { z } from "zod";
import type {
  ExternalMethod,
  ExternalParams,
  externalResults,
  TripChange,
} from "../features/external/contract";

export type MethodResult<M extends ExternalMethod> = z.output<(typeof externalResults)[M]>;
export type MethodParams<M extends ExternalMethod> = ExternalParams<M>;
export type TripSnapshot = Extract<MethodResult<"trip.read">, { kind: "snapshot" }>;
export type TripSelection<S extends MethodParams<"trip.read">["select"]> = Extract<
  MethodResult<"trip.read">,
  { kind: S["kind"] }
>;

export type RpcErrorCode =
  | "INVALID_PARAMS"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMIT"
  | "PROVIDER_UNAVAILABLE";
const errorCodes: Record<number, RpcErrorCode> = {
  [-32602]: "INVALID_PARAMS",
  [-32003]: "FORBIDDEN",
  [-32004]: "NOT_FOUND",
  [-32009]: "CONFLICT",
  [-32029]: "RATE_LIMIT",
  [-32052]: "PROVIDER_UNAVAILABLE",
};

export class PaceNotesRpcError extends Error {
  readonly name: string = "PaceNotesRpcError";

  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }

  get kind(): RpcErrorCode | undefined {
    return errorCodes[this.code];
  }
}

export class PaceNotesConflictError<T = unknown> extends PaceNotesRpcError {
  override readonly name = "PaceNotesConflictError";
  readonly current: T | null;
  readonly version: string | null;

  constructor(message: string, data: unknown) {
    super(-32009, message, data);
    const fields = isObject(data) ? data : {};
    this.current = (fields.current ?? null) as T | null;
    this.version = typeof fields.version === "string" ? fields.version : null;
  }
}

export interface PaceNotesClientOptions {
  /** Absolute HTTP(S) origin or base URL. The API paths are fixed at /api/v1/. */
  baseUrl: string;
  /** The trip URL ID is the bearer credential. Do not put it in a query string. */
  tripId?: string;
  fetch?: typeof fetch;
}

export interface ChangeCallbacks {
  onChange(change: TripChange): void;
  /** On every connection, read a fresh full snapshot after the stream is subscribed. */
  onRefetch(snapshot: TripSnapshot): void;
  /** No replay is available. On disconnect, the next connection fetches a full snapshot. */
  onDisconnect(error: Error): void;
}

export interface ChangeSubscription {
  close(): void;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readChange(value: unknown): TripChange {
  if (
    !isObject(value) ||
    typeof value.trip !== "boolean" ||
    typeof value.order !== "boolean" ||
    ![value.items, value.tripmates, value.expenses, value.payments].every(
      (ids) => Array.isArray(ids) && ids.every((id) => typeof id === "string"),
    )
  ) {
    throw new Error("Invalid trip change notification");
  }
  return value as TripChange;
}

export function parseTripChange(value: unknown): TripChange {
  return readChange(value);
}

export function parseRpcResponse<M extends ExternalMethod>(
  value: unknown,
  id: number,
): MethodResult<M> {
  if (
    !isObject(value) ||
    value.jsonrpc !== "2.0" ||
    value.id !== id ||
    "result" in value === "error" in value
  ) {
    throw new Error("Invalid JSON-RPC response");
  }
  if ("error" in value) {
    const failure = value.error;
    if (
      !isObject(failure) ||
      typeof failure.code !== "number" ||
      typeof failure.message !== "string"
    ) {
      throw new Error("Invalid JSON-RPC error");
    }
    if (failure.code === -32009) throw new PaceNotesConflictError(failure.message, failure.data);
    throw new PaceNotesRpcError(failure.code, failure.message, failure.data);
  }
  return value.result as MethodResult<M>;
}

const reconnectDelay = (attempt: number) => Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));

export class PaceNotesClient {
  readonly baseUrl: string;
  readonly tripId: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private nextId = 0;

  constructor(options: PaceNotesClientOptions) {
    const url = new URL(options.baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new Error("Expected HTTP(S) base URL");
    this.baseUrl = url.origin;
    this.tripId = options.tripId;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  url(path: "/api/v1/rpc" | "/api/v1/events" | "/api/v1/ws"): URL {
    return new URL(path, this.baseUrl);
  }

  authorization(): Record<string, string> {
    return this.tripId ? { Authorization: `Bearer ${this.tripId}` } : {};
  }

  private requireTrip(): void {
    if (!this.tripId) throw new Error("A trip ID is required for this method");
  }

  async call<M extends ExternalMethod>(
    method: M,
    params: MethodParams<M>,
    signal?: AbortSignal,
  ): Promise<MethodResult<M>> {
    if (method !== "trip.create" && method !== "place.search") this.requireTrip();
    const id = ++this.nextId;
    const response = await this.fetchImpl(this.url("/api/v1/rpc"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authorization() },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      ...(signal ? { signal } : {}),
    });
    // JSON-RPC failures can have non-2xx HTTP status. Parse the envelope first.
    const body: unknown = await response.json();
    return parseRpcResponse<M>(body, id);
  }

  readonly trip = {
    create: (params: MethodParams<"trip.create">) => this.call("trip.create", params),
    read: <S extends MethodParams<"trip.read">["select"]>(params: {
      select: S;
    }): Promise<TripSelection<S>> => this.call("trip.read", params) as Promise<TripSelection<S>>,
    update: (params: MethodParams<"trip.update">) => this.call("trip.update", params),
    setDates: (params: MethodParams<"trip.setDates">) => this.call("trip.setDates", params),
    changeCurrency: (params: MethodParams<"trip.changeCurrency">) =>
      this.call("trip.changeCurrency", params),
  };
  readonly place = {
    search: (params: MethodParams<"place.search">) => this.call("place.search", params),
  };
  readonly item = {
    create: (params: MethodParams<"item.create">) => this.call("item.create", params),
    update: (params: MethodParams<"item.update">) => this.call("item.update", params),
    move: (params: MethodParams<"item.move">) => this.call("item.move", params),
    reorder: (params: MethodParams<"item.reorder">) => this.call("item.reorder", params),
    remove: (params: MethodParams<"item.remove">) => this.call("item.remove", params),
  };
  readonly tripmate = {
    create: (params: MethodParams<"tripmate.create">) => this.call("tripmate.create", params),
    update: (params: MethodParams<"tripmate.update">) => this.call("tripmate.update", params),
    remove: (params: MethodParams<"tripmate.remove">) => this.call("tripmate.remove", params),
  };
  readonly expense = {
    create: (params: MethodParams<"expense.create">) => this.call("expense.create", params),
    update: (params: MethodParams<"expense.update">) => this.call("expense.update", params),
    remove: (params: MethodParams<"expense.remove">) => this.call("expense.remove", params),
  };
  readonly payment = {
    create: (params: MethodParams<"payment.create">) => this.call("payment.create", params),
    update: (params: MethodParams<"payment.update">) => this.call("payment.update", params),
    remove: (params: MethodParams<"payment.remove">) => this.call("payment.remove", params),
  };

  subscribeChanges(callbacks: ChangeCallbacks): ChangeSubscription {
    this.requireTrip();
    const controller = new AbortController();
    let cancelRetry = () => {};
    let attempt = 0;
    let closed = false;
    const connect = async () => {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const response = await this.fetchImpl(this.url("/api/v1/events"), {
          headers: { Accept: "text/event-stream", ...this.authorization() },
          signal: controller.signal,
        });
        if (!response.ok || !response.body)
          throw new Error(`Event stream failed (${response.status})`);
        reader = response.body.getReader();
        // Fetch resolves after the subscription is active. Read before delivering notices.
        const snapshot = await this.call(
          "trip.read",
          { select: { kind: "snapshot" } },
          controller.signal,
        );
        if (snapshot.kind !== "snapshot") throw new Error("Invalid trip snapshot");
        if (closed) return;
        callbacks.onRefetch(snapshot);
        attempt = 0;
        const decoder = new TextDecoder();
        let buffer = "";
        let event = "";
        let data: string[] = [];
        const flush = () => {
          if (event === "trip.changed" && data.length)
            callbacks.onChange(readChange(JSON.parse(data.join("\n"))));
          event = "";
          data = [];
        };
        while (!closed) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error("Event stream disconnected");
          buffer += decoder.decode(chunk.value, { stream: true });
          let newline = buffer.indexOf("\n");
          while (newline !== -1) {
            let line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line) flush();
            else if (line.startsWith("event:")) event = line.slice(6).trimStart();
            else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
            newline = buffer.indexOf("\n");
          }
        }
      } catch (error) {
        if (closed) return;
        callbacks.onDisconnect(
          error instanceof Error ? error : new Error("Event stream disconnected"),
        );
        if (closed) return;
        const timeout = setTimeout(() => {
          void connect();
        }, reconnectDelay(attempt++));
        cancelRetry = () => clearTimeout(timeout);
      } finally {
        await reader?.cancel().catch(() => {});
      }
    };
    void connect();
    return {
      close: () => {
        closed = true;
        controller.abort();
        cancelRetry();
      },
    };
  }
}

export function createPaceNotesClient(options: PaceNotesClientOptions): PaceNotesClient {
  return new PaceNotesClient(options);
}
