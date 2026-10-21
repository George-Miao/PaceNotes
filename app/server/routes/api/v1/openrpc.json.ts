import { defineHandler } from "nitro";
import openrpc from "../../../../openrpc.json";
import { externalEnabled } from "./transport";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const document = JSON.stringify(openrpc);

export default defineHandler((event) => {
  if (!externalEnabled()) return new Response("Not Found", { status: 404, headers });
  if (event.req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (event.req.method !== "GET") {
    return new Response("GET is required", {
      status: 405,
      headers: { ...headers, Allow: "GET, OPTIONS" },
    });
  }
  if (event.url.search)
    return new Response("Query parameters are not accepted", { status: 400, headers });
  return new Response(document, {
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
});
