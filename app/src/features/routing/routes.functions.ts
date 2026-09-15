import { createServerFn } from "@tanstack/react-start";
import { type MotisRouteBatchResult, motisRouteBatchSchema } from "./model";
import { computeMotisRoutes } from "./motis.server";

export const readMotisRoutes = createServerFn({ method: "POST" })
  .validator(motisRouteBatchSchema)
  .handler(async ({ data }): Promise<MotisRouteBatchResult> => computeMotisRoutes(data));
