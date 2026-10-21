import { defineHandler } from "nitro";
import { getRequestIP } from "nitro/h3";
import { handleMcpRequest } from "../../../../../src/features/external/mcp.server";

export default defineHandler((event) => {
  const tripId = event.context.params?.tripId;
  const clientAddress =
    event.runtime?.node?.req.socket?.remoteAddress ?? getRequestIP(event) ?? "unknown";
  return handleMcpRequest(event.req, typeof tripId === "string" ? tripId : "", clientAddress);
});
