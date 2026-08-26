import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db/client";

export const Route = createFileRoute("/health/ready")({
  server: {
    handlers: {
      GET: async () => {
        try {
          await sql`SELECT 1`;
          return Response.json({ status: "ready" });
        } catch {
          return Response.json({ status: "unready" }, { status: 503 });
        }
      },
    },
  },
});
