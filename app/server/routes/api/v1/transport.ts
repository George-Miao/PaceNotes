import {
  ExternalError,
  type ExternalMethod,
  externalMethods,
  tripIdSchema,
} from "../../../../src/features/external/contract";
import { executeExternalMethod } from "../../../../src/features/external/service.server";

export const maxRpcBytes = 1024 * 1024;

export type RpcContext = {
  tripId: string | null;
  clientAddress: string;
  baseUrl: string;
};

type RpcId = string | number | null;

type RpcError = {
  jsonrpc: "2.0";
  id: RpcId;
  error: { code: number; message: string; data?: unknown };
};

type RpcSuccess = { jsonrpc: "2.0"; id: RpcId; result: unknown };
export type RpcResponse = RpcError | RpcSuccess;

const errorCodes = {
  INVALID_PARAMS: -32602,
  FORBIDDEN: -32003,
  NOT_FOUND: -32004,
  CONFLICT: -32009,
  RATE_LIMIT: -32029,
  PROVIDER_UNAVAILABLE: -32052,
} as const;

function rpcError(id: RpcId, code: number, message: string, data?: unknown): RpcError {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

export function externalRpcError(id: RpcId, error: unknown): RpcError {
  if (error instanceof ExternalError) {
    return rpcError(id, errorCodes[error.code], error.message, error.data);
  }
  return rpcError(id, -32603, "Internal error");
}

export function invalidRpcRequest(message: string): RpcResponse {
  return rpcError(null, -32600, message);
}

export function bearerTripId(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  if (authorization === null) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{20,32})$/i.exec(authorization);
  const tripId = match?.[1];
  if (!tripId || !tripIdSchema.safeParse(tripId).success) {
    throw new ExternalError("FORBIDDEN", "A valid trip bearer token is required");
  }
  return tripId;
}

export function externalEnabled(): boolean {
  return process.env.PACENOTES_EXTERNAL_ENABLED === "true";
}

export function allowedWebSocketOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  if (origin === "null") return false;
  const allowed = process.env.PACENOTES_EXTERNAL_ALLOWED_ORIGINS?.split(",") ?? [];
  return allowed.some((entry) => entry.trim() === origin);
}

export function baseUrl(request: Request): string {
  return new URL(request.url).origin;
}

export function jsonResponse(
  body: RpcResponse,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

export async function handleRpcText(
  text: string,
  context: RpcContext,
  authError?: unknown,
): Promise<RpcResponse> {
  let request: unknown;
  try {
    request = JSON.parse(text);
  } catch {
    return rpcError(null, -32700, "Parse error");
  }
  return handleRpcRequest(request, context, authError);
}

async function handleRpcRequest(
  request: unknown,
  context: RpcContext,
  authError?: unknown,
): Promise<RpcResponse> {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    return invalidRpcRequest("One JSON-RPC request is required");
  }
  const call = request as Record<string, unknown>;
  const id = call.id;
  if (
    !Object.hasOwn(call, "id") ||
    (typeof id !== "string" && id !== null && !(typeof id === "number" && Number.isFinite(id)))
  ) {
    return invalidRpcRequest("A JSON-RPC request id is required");
  }
  if (call.jsonrpc !== "2.0" || typeof call.method !== "string") {
    return rpcError(id, -32600, "Invalid JSON-RPC request");
  }
  if (authError !== undefined) return externalRpcError(id, authError);
  if (!Object.hasOwn(externalMethods, call.method)) {
    return rpcError(id, -32601, "Method not found");
  }
  const method = call.method as ExternalMethod;
  if (context.tripId === null && method !== "trip.create" && method !== "place.search") {
    return externalRpcError(id, new ExternalError("FORBIDDEN", "A trip bearer token is required"));
  }
  try {
    const result = await executeExternalMethod(method, call.params, context);
    return { jsonrpc: "2.0", id, result };
  } catch (error) {
    return externalRpcError(id, error);
  }
}
