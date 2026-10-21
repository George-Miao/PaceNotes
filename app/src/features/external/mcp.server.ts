import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ExternalError,
  type ExternalMethod,
  externalMethods,
  externalResults,
  type TripChange,
  tripChangeSchema,
  tripIdSchema,
} from "./contract";
import { subscribeTripChanges } from "./events.server";
import { executeExternalMethod } from "./service.server";

const modernVersion = "2026-07-28";
const legacyVersion = "2025-11-25";
const resourceUri = "pacenotes://trip/changes";
const serverInfo = { name: "pacenotes", version: "0.3.1" };
const supportedVersions = [modernVersion, legacyVersion];
const errorCodes = {
  INVALID_PARAMS: -32602,
  FORBIDDEN: -32003,
  NOT_FOUND: -32004,
  CONFLICT: -32009,
  RATE_LIMIT: -32029,
  PROVIDER_UNAVAILABLE: -32052,
} as const;
const responseHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
  "X-Content-Type-Options": "nosniff",
};

type RpcId = string | number | null;
type RpcRequest = {
  jsonrpc: "2.0";
  id?: RpcId;
  method: string;
  params?: Record<string, unknown>;
};
type LegacySession = {
  tripId: string | null;
  resources: Set<string>;
  streams: Set<() => void>;
  expires: number;
};
const legacySessions = new Map<string, LegacySession>();
const lastChanges = new Map<string, TripChange>();
const liveTripStreams = new Map<string, number>();

const toolDefinitions = (Object.keys(externalMethods) as ExternalMethod[]).map((name) => ({
  name,
  description: `${name} on a PaceNotes trip.`,
  inputSchema: z.toJSONSchema(externalMethods[name]),
  outputSchema: z.toJSONSchema(externalResults[name]),
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...responseHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

async function readBoundedBody(request: Request): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > 1_048_576) throw new RangeError("Request is too large");
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function rpcError(
  id: RpcId,
  code: number,
  message: string,
  data?: unknown,
  status = 200,
): Response {
  return json(
    { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } },
    status,
  );
}

function externalError(id: RpcId, error: unknown): Response {
  if (error instanceof ExternalError) {
    return rpcError(id, errorCodes[error.code], error.message, error.data);
  }
  return rpcError(id, -32603, "Internal error");
}

function resourceCapabilities(tripId: string | null, modern: boolean) {
  return {
    tools: {},
    ...(tripId ? { resources: modern ? {} : { subscribe: true, listChanged: false } } : {}),
  };
}

function tools(tripId: string | null) {
  return toolDefinitions.filter(({ name }) =>
    tripId ? name !== "trip.create" : name === "trip.create" || name === "place.search",
  );
}

function decodeHeader(value: string | null): string | null {
  if (value === null) return null;
  if (!value.startsWith("=?base64?") || !value.endsWith("?=")) return value;
  const encoded = value.slice(9, -2);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    return null;
  return Buffer.from(encoded, "base64").toString("utf8");
}

function sessionFor(request: Request, tripId: string | null): LegacySession | null {
  const key = request.headers.get("mcp-session-id");
  if (!key) return null;
  const session = legacySessions.get(key);
  if (!session) return null;
  if (session.expires < Date.now()) {
    legacySessions.delete(key);
    releaseSession(session);
    return null;
  }
  if (session.tripId !== tripId) return null;
  session.expires = Date.now() + 30 * 60_000;
  return session;
}

function releaseSession(session: LegacySession) {
  for (const close of session.streams) close();
  session.streams.clear();
}

function makeSse(
  request: Request,
  tripId: string,
  notify: (change: TripChange, send: (message: unknown) => void) => void,
  initial?: unknown,
  session?: LegacySession,
): Promise<Response> {
  let sendMessage: (message: unknown) => void = () => {};
  return subscribeTripChanges(tripId, (rawChange) => {
    const change = tripChangeSchema.parse(rawChange);
    lastChanges.set(tripId, change);
    notify(change, sendMessage);
  }).then((unsubscribe) => {
    liveTripStreams.set(tripId, (liveTripStreams.get(tripId) ?? 0) + 1);
    const encoder = new TextEncoder();
    let closed = false;
    let keepAlive: ReturnType<typeof setInterval> | undefined;
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const close = () => {
      if (closed) return;
      closed = true;
      if (keepAlive) clearInterval(keepAlive);
      request.signal.removeEventListener("abort", close);
      session?.streams.delete(close);
      const remaining = (liveTripStreams.get(tripId) ?? 1) - 1;
      if (remaining) liveTripStreams.set(tripId, remaining);
      else {
        liveTripStreams.delete(tripId);
        lastChanges.delete(tripId);
      }
      void unsubscribe().catch(() => {});
      try {
        controller?.close();
      } catch {
        /* A cancelled stream is already closed. */
      }
    };
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
        sendMessage = (message) => {
          if (!closed)
            streamController.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
        };
        if (initial) sendMessage(initial);
        keepAlive = setInterval(() => {
          if (!closed) streamController.enqueue(encoder.encode(": keepalive\n\n"));
        }, 20_000);
        request.signal.addEventListener("abort", close, { once: true });
        session?.streams.add(close);
        if (request.signal.aborted) close();
      },
      cancel: close,
    });
    return new Response(stream, {
      headers: {
        ...responseHeaders,
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
        Connection: "keep-alive",
      },
    });
  });
}

async function dispatch(
  request: Request,
  body: RpcRequest,
  tripId: string | null,
  clientAddress: string,
  modern: boolean,
  session?: LegacySession,
): Promise<Response> {
  const id = body.id ?? null;
  const params = body.params ?? {};
  const complete = <T extends object>(value: T) => ({
    ...(modern ? { resultType: "complete" } : {}),
    ...value,
  });
  const success = (value: unknown) => json({ jsonrpc: "2.0", id, result: value });
  try {
    switch (body.method) {
      case "server/discover":
        if (!modern) break;
        return success({
          resultType: "complete",
          supportedVersions,
          capabilities: resourceCapabilities(tripId, true),
          _meta: { "io.modelcontextprotocol/serverInfo": serverInfo },
        });
      case "initialize":
        if (modern) break;
        return success({
          protocolVersion: legacyVersion,
          capabilities: resourceCapabilities(tripId, false),
          serverInfo,
        });
      case "tools/list":
        return success(complete({ tools: tools(tripId) }));
      case "tools/call": {
        if (typeof params.name !== "string" || !Object.hasOwn(externalMethods, params.name)) {
          return rpcError(id, -32602, "Unknown tool name");
        }
        const name = params.name as ExternalMethod;
        if (
          (tripId === null && name !== "trip.create" && name !== "place.search") ||
          (tripId !== null && name === "trip.create")
        ) {
          return rpcError(id, -32601, "Tool not available at this endpoint");
        }
        const value = await executeExternalMethod(name, params.arguments ?? {}, {
          tripId,
          clientAddress,
          baseUrl: new URL(request.url).origin,
        });
        const result = externalResults[name].parse(value);
        return success(
          complete({
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result,
          }),
        );
      }
      case "resources/list":
        return success(
          complete({
            resources: tripId
              ? [
                  {
                    uri: resourceUri,
                    name: "Trip changes",
                    mimeType: "application/json",
                    description:
                      "Recent changed record IDs. Use trip.read to get the current saved state.",
                  },
                ]
              : [],
          }),
        );
      case "resources/read": {
        if (!tripId || params.uri !== resourceUri)
          return rpcError(id, -32004, "Resource not found");
        const unsubscribeRead = await subscribeTripChanges(tripId, () => {});
        await unsubscribeRead();
        return success(
          complete({
            contents: [
              {
                uri: resourceUri,
                mimeType: "application/json",
                text: JSON.stringify({
                  change: lastChanges.get(tripId) ?? null,
                  readTool: "trip.read",
                }),
              },
            ],
          }),
        );
      }
      case "resources/subscribe":
      case "resources/unsubscribe":
        if (modern) break;
        if (!tripId || params.uri !== resourceUri || !session)
          return rpcError(id, -32004, "Resource not found");
        if (body.method === "resources/subscribe") {
          // Check the trip before an idle notification stream is accepted.
          const unsubscribe = await subscribeTripChanges(tripId, () => {});
          await unsubscribe();
          session.resources.add(resourceUri);
        } else session.resources.delete(resourceUri);
        return success({});
      case "subscriptions/listen": {
        if (!modern) break;
        const notifications = params.notifications;
        if (
          !tripId ||
          typeof notifications !== "object" ||
          notifications === null ||
          !Array.isArray(
            (notifications as { resourceSubscriptions?: unknown }).resourceSubscriptions,
          ) ||
          !(notifications as { resourceSubscriptions: unknown[] }).resourceSubscriptions.includes(
            resourceUri,
          )
        ) {
          return rpcError(id, -32602, "A trip change resource subscription is required");
        }
        const acknowledgement = {
          jsonrpc: "2.0",
          method: "notifications/subscriptions/acknowledged",
          params: {
            _meta: { "io.modelcontextprotocol/subscriptionId": id },
            notifications: { resourceSubscriptions: [resourceUri] },
          },
        };
        return await makeSse(
          request,
          tripId,
          (_change, send) =>
            send({
              jsonrpc: "2.0",
              method: "notifications/resources/updated",
              params: { uri: resourceUri, _meta: { "io.modelcontextprotocol/subscriptionId": id } },
            }),
          acknowledgement,
        );
      }
    }
    return rpcError(id, -32601, "Method not found", undefined, modern ? 404 : 200);
  } catch (error) {
    return externalError(id, error);
  }
}

async function handleMcpRequestInternal(
  request: Request,
  tripId: string | null,
  clientAddress: string,
): Promise<Response> {
  if (new URL(request.url).search) {
    return rpcError(null, -32600, "Query parameters are not accepted", undefined, 400);
  }

  if (request.method === "DELETE" || request.method === "GET") {
    const session = sessionFor(request, tripId);
    if (!session) return new Response(null, { status: 404, headers: responseHeaders });
    if (request.headers.get("mcp-protocol-version") === modernVersion) {
      return new Response(null, { status: 405, headers: responseHeaders });
    }
    if (request.method === "DELETE") {
      releaseSession(session);
      legacySessions.delete(request.headers.get("mcp-session-id") ?? "");
      return new Response(null, { status: 204, headers: responseHeaders });
    }
    if (!tripId || !request.headers.get("accept")?.includes("text/event-stream")) {
      return new Response(null, { status: 405, headers: responseHeaders });
    }
    try {
      releaseSession(session);
      return await makeSse(
        request,
        tripId,
        (_change, send) => {
          if (session.resources.has(resourceUri)) {
            send({
              jsonrpc: "2.0",
              method: "notifications/resources/updated",
              params: { uri: resourceUri },
            });
          }
        },
        undefined,
        session,
      );
    } catch (error) {
      return externalError(null, error);
    }
  }
  if (request.method !== "POST")
    return new Response(null, { status: 405, headers: responseHeaders });
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(
      request.headers.get("content-type") ?? "",
    )
  ) {
    return rpcError(null, -32600, "JSON content type is required", undefined, 415);
  }
  if (
    !request.headers.get("accept")?.includes("application/json") ||
    !request.headers.get("accept")?.includes("text/event-stream")
  ) {
    return rpcError(null, -32600, "Accept must include JSON and event stream", undefined, 406);
  }
  let body: RpcRequest;
  const length = request.headers.get("content-length");
  if (length !== null && Number(length) > 1_048_576) {
    return rpcError(null, -32600, "Request is too large", undefined, 413);
  }
  try {
    body = JSON.parse(await readBoundedBody(request));
  } catch (error) {
    return error instanceof RangeError
      ? rpcError(null, -32600, "Request is too large", undefined, 413)
      : rpcError(null, -32700, "Invalid JSON", undefined, 400);
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    body.jsonrpc !== "2.0" ||
    typeof body.method !== "string" ||
    (body.id !== undefined && !(typeof body.id === "string" || typeof body.id === "number")) ||
    (body.params !== undefined &&
      (body.params === null || typeof body.params !== "object" || Array.isArray(body.params)))
  ) {
    return rpcError(null, -32600, "Invalid JSON-RPC request", undefined, 400);
  }
  const id = body.id ?? null;
  const version = request.headers.get("mcp-protocol-version");
  const legacy =
    version === legacyVersion || (body.method === "initialize" && version !== modernVersion);
  if (legacy) {
    if (version !== null && version !== legacyVersion) {
      return rpcError(
        id,
        -32022,
        "Unsupported protocol version",
        { supported: supportedVersions, requested: version },
        400,
      );
    }
    if (body.method === "initialize") {
      if (body.params?.protocolVersion !== legacyVersion) {
        return rpcError(
          id,
          -32022,
          "Unsupported protocol version",
          { supported: supportedVersions, requested: String(body.params?.protocolVersion ?? "") },
          400,
        );
      }
      const key = randomUUID();
      const session: LegacySession = {
        tripId,
        resources: new Set(),
        streams: new Set(),
        expires: Date.now() + 30 * 60_000,
      };
      legacySessions.set(key, session);
      const result = await dispatch(request, body, tripId, clientAddress, false, session);
      result.headers.set("Mcp-Session-Id", key);
      return result;
    }
    if (!request.headers.has("mcp-session-id")) {
      return rpcError(id, -32003, "MCP session is required", undefined, 400);
    }
    const session = sessionFor(request, tripId);
    if (!session) return rpcError(id, -32003, "MCP session is missing or expired", undefined, 404);
    if (body.id === undefined) return new Response(null, { status: 202, headers: responseHeaders });
    return dispatch(request, body, tripId, clientAddress, false, session);
  }
  if (version === null) {
    return rpcError(id, -32020, "MCP-Protocol-Version header is required", undefined, 400);
  }
  if (version !== modernVersion) {
    return rpcError(
      id,
      -32022,
      "Unsupported protocol version",
      { supported: supportedVersions, requested: version },
      400,
    );
  }
  const meta = body.params?._meta;
  const metadata = meta as Record<string, unknown> | undefined;
  const clientInfo = metadata?.["io.modelcontextprotocol/clientInfo"];
  const clientCapabilities = metadata?.["io.modelcontextprotocol/clientCapabilities"];
  if (
    !metadata ||
    Array.isArray(metadata) ||
    metadata["io.modelcontextprotocol/protocolVersion"] !== version ||
    (clientInfo !== undefined &&
      (typeof clientInfo !== "object" || clientInfo === null || Array.isArray(clientInfo))) ||
    typeof clientCapabilities !== "object" ||
    clientCapabilities === null ||
    Array.isArray(clientCapabilities) ||
    request.headers.get("mcp-method") !== body.method ||
    ((body.method === "tools/call" || body.method === "resources/read") &&
      decodeHeader(request.headers.get("mcp-name")) !==
        (body.method === "tools/call" ? body.params?.name : body.params?.uri))
  ) {
    return rpcError(
      id,
      -32020,
      "MCP request headers or metadata do not match the request",
      undefined,
      400,
    );
  }
  if (body.id === undefined) return new Response(null, { status: 202, headers: responseHeaders });
  return dispatch(request, body, tripId, clientAddress, true);
}

/** Handle a single trip-scoped or public bootstrap Streamable HTTP endpoint. */
export async function handleMcpRequest(
  request: Request,
  tripId: string | null,
  clientAddress: string,
): Promise<Response> {
  if (
    process.env.PACENOTES_EXTERNAL_ENABLED !== "true" ||
    (tripId !== null && !tripIdSchema.safeParse(tripId).success)
  ) {
    return new Response(null, { status: 404, headers: responseHeaders });
  }
  const origin = request.headers.get("origin");
  const origins = (process.env.PACENOTES_EXTERNAL_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (origin !== null && (origin === "null" || !origins.includes(origin))) {
    return new Response(null, { status: 403, headers: responseHeaders });
  }
  if (request.method === "OPTIONS") {
    if (origin === null) return new Response(null, { status: 405, headers: responseHeaders });
    return new Response(null, {
      status: 204,
      headers: {
        ...responseHeaders,
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      },
    });
  }
  const response = await handleMcpRequestInternal(request, tripId, clientAddress);
  if (origin !== null) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Expose-Headers", "Mcp-Session-Id");
    response.headers.set("Vary", "Origin");
  }
  return response;
}
