import { defineHandler } from "nitro";
import { getRequestIP } from "nitro/h3";
import {
  baseUrl,
  bearerTripId,
  externalEnabled,
  handleRpcText,
  invalidRpcRequest,
  jsonResponse,
  maxRpcBytes,
} from "./transport";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

async function readBoundedBody(body: ReadableStream<Uint8Array> | null): Promise<string | null> {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  const parts: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxRpcBytes) return null;
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } finally {
    reader.releaseLock();
  }
}

export default defineHandler(async (event) => {
  if (!externalEnabled()) return new Response("Not Found", { status: 404, headers: corsHeaders });
  if (event.req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (event.req.method !== "POST") {
    return jsonResponse(invalidRpcRequest("POST is required"), 405, {
      ...corsHeaders,
      Allow: "POST, OPTIONS",
    });
  }
  if (event.url.search) {
    return jsonResponse(invalidRpcRequest("Query parameters are not accepted"), 400, corsHeaders);
  }
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(
      event.req.headers.get("content-type") ?? "",
    )
  ) {
    return jsonResponse(invalidRpcRequest("JSON content type is required"), 415, corsHeaders);
  }
  const length = event.req.headers.get("content-length");
  if (length !== null && Number(length) > maxRpcBytes) {
    return jsonResponse(invalidRpcRequest("Request is too large"), 413, corsHeaders);
  }

  let text: string | null;
  try {
    text = await readBoundedBody(event.req.body);
  } catch {
    text = "";
  }
  if (text === null)
    return jsonResponse(invalidRpcRequest("Request is too large"), 413, corsHeaders);
  let tripId: string | null = null;
  let authError: unknown;
  try {
    tripId = bearerTripId(event.req.headers);
  } catch (error) {
    authError = error;
  }

  const result = await handleRpcText(
    text,
    {
      tripId,
      clientAddress:
        event.runtime?.node?.req.socket?.remoteAddress ?? getRequestIP(event) ?? "unknown",
      baseUrl: baseUrl(event.req),
    },
    authError,
  );
  return jsonResponse(result, 200, corsHeaders);
});
