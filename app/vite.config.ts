import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import { type ManifestOptions, VitePWA } from "vite-plugin-pwa";

const manifest = {
  name: "PaceNotes",
  short_name: "PaceNotes",
  description: "Fast collaborative trip planning.",
  theme_color: "#f8f8f7",
  background_color: "#eef0f2",
  display: "standalone",
  lang: "en",
  id: "/",
  scope: "/",
  start_url: "/",
  icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
} satisfies Partial<ManifestOptions>;

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 3000,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tanstackStart({ srcDirectory: "src" }),
    viteReact(),
    VitePWA({
      outDir: ".output/public",
      integration: { closeBundleOrder: "pre" },
      registerType: "prompt",
      strategies: "generateSW",
      manifest,
      workbox: {
        globPatterns: ["**/*.{js,css,woff2,svg,ico}"],
        navigateFallback: null,
        runtimeCaching: [],
      },
    }),
    {
      name: "pacenotes:dev-manifest",
      apply: "serve",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url?.split("?")[0] !== "/manifest.webmanifest") return next();
          response.setHeader("Content-Type", "application/manifest+json");
          response.end(JSON.stringify(manifest));
        });
      },
    },
    nitro({
      compressPublicAssets: true,
      features: { websocket: true },
      serverDir: "server",
    }),
  ],
});
