import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/health/live")({
  server: {
    handlers: {
      GET: async () => Response.json({ status: "ok" }),
    },
  },
});
