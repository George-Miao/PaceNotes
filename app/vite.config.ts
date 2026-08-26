import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

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
      workbox: {
        globPatterns: ["**/*.{js,css,woff2,png,svg,ico}"],
        navigateFallback: null,
        runtimeCaching: [],
      },
      manifest: {
        name: "PaceNotes",
        short_name: "PaceNotes",
        description: "Fast collaborative trip planning.",
        theme_color: "#f8f8f7",
        background_color: "#eef0f2",
        display: "standalone",
        id: "/",
        scope: "/",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
    nitro({
      compressPublicAssets: true,
      features: { websocket: true },
      serverDir: "server",
    }),
  ],
});
