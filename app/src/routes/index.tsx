import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "~/components/LandingPage";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ name: "robots", content: "index,follow" }],
  }),
  component: LandingPage,
});
