import { createFileRoute } from "@tanstack/react-router";
import { readRoutingProviderHealth } from "~/features/routing/motis.server";

export const Route = createFileRoute("/health/providers")({
  server: {
    handlers: {
      GET: async () => {
        const motis = await readRoutingProviderHealth();
        return Response.json({
          status: motis.status === "degraded" ? "degraded" : "ready",
          providers: { motis },
        });
      },
    },
  },
});
