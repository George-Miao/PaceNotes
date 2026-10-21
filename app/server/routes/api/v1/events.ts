import { defineHandler } from "nitro";
import { createEventStream } from "nitro/h3";
import { ExternalError, tripChangeSchema } from "../../../../src/features/external/contract";
import { subscribeTripChanges } from "../../../../src/features/external/events.server";
import {
  bearerTripId,
  externalEnabled,
  externalRpcError,
  invalidRpcRequest,
  jsonResponse,
} from "./transport";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

export default defineHandler(async (event) => {
  if (!externalEnabled()) return new Response("Not Found", { status: 404, headers: corsHeaders });
  if (event.req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (event.req.method !== "GET") {
    return jsonResponse(invalidRpcRequest("GET is required"), 405, {
      ...corsHeaders,
      Allow: "GET, OPTIONS",
    });
  }
  if (event.url.search) {
    return jsonResponse(invalidRpcRequest("Query parameters are not accepted"), 400, corsHeaders);
  }

  let tripId: string | null;
  try {
    tripId = bearerTripId(event.req.headers);
  } catch (error) {
    return jsonResponse(externalRpcError(null, error), 403, corsHeaders);
  }
  if (tripId === null) {
    return jsonResponse(
      externalRpcError(null, new ExternalError("FORBIDDEN", "A trip bearer token is required")),
      403,
      corsHeaders,
    );
  }

  const stream = createEventStream(event);
  let closed = false;
  let unsubscribe: (() => Promise<void>) | null = null;
  const releaseSubscription = async () => {
    const release = unsubscribe;
    unsubscribe = null;
    if (release) await release();
  };
  const onAbort = () => {
    void stream.close();
  };
  event.req.signal.addEventListener("abort", onAbort, { once: true });
  stream.onClosed(() => {
    closed = true;
    event.req.signal.removeEventListener("abort", onAbort);
    void releaseSubscription().catch(() => {});
  });
  if (event.req.signal.aborted) onAbort();

  try {
    unsubscribe = await subscribeTripChanges(tripId, (change) => {
      if (closed) return;
      const parsed = tripChangeSchema.safeParse(change);
      if (!parsed.success) {
        void stream.close();
        return;
      }
      void stream.push({ event: "trip.changed", data: JSON.stringify(parsed.data) }).catch(() => {
        void stream.close();
      });
    });
  } catch (error) {
    void stream.close();
    const status =
      error instanceof ExternalError
        ? error.code === "NOT_FOUND"
          ? 404
          : error.code === "FORBIDDEN"
            ? 403
            : 400
        : 500;
    return jsonResponse(externalRpcError(null, error), status, corsHeaders);
  }
  if (closed) {
    await releaseSubscription().catch(() => {});
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  event.res.headers.set("Access-Control-Allow-Origin", "*");
  event.res.headers.set("Referrer-Policy", "no-referrer");
  event.res.headers.set("X-Content-Type-Options", "nosniff");
  const heartbeat = setInterval(() => {
    void stream.pushComment("keepalive").catch(() => {
      void stream.close();
    });
  }, 20_000);
  stream.onClosed(() => clearInterval(heartbeat));
  return stream.send();
});
