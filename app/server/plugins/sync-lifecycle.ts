import { definePlugin } from "nitro";
import { shutdownSync } from "../../src/sync/hocuspocus";

export default definePlugin((nitro) => {
  nitro.hooks.hook("close", shutdownSync);
});
