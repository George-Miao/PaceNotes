/// <reference types="vite/client" />

import { registerSW } from "virtual:pwa-register";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { IconButtonTooltips } from "~/components/IconButtonTooltips";
import { getPublicConfig } from "~/features/config/public-config";
import appCss from "~/styles/app.css?url";

const siteDescription =
  "Plan a fixed-date trip together with shared itineraries, places, routes, and live updates.";

export const Route = createRootRoute({
  loader: () => getPublicConfig(),
  head: () => ({
    meta: [
      { title: "PaceNotes" },
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#f8f8f7" },
      {
        name: "description",
        content: siteDescription,
      },
      { property: "og:title", content: "PaceNotes" },
      { property: "og:type", content: "website" },
      { property: "og:description", content: siteDescription },
      { property: "og:site_name", content: "PaceNotes" },
      { property: "og:image", content: "/opengraph.png" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      {
        property: "og:image:alt",
        content: "PaceNotes logo on a light neutral background.",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "PaceNotes" },
      { name: "twitter:description", content: siteDescription },
      { name: "twitter:image", content: "/opengraph.png" },
      {
        name: "twitter:image:alt",
        content: "PaceNotes logo on a light neutral background.",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  notFoundComponent: () => (
    <main className="not-found">
      <strong>Page not found</strong>
      <a href="/">Return to PaceNotes</a>
    </main>
  ),
  shellComponent: RootDocument,
});

function RootDocument() {
  const config = Route.useLoaderData();
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <meta name="pacenotes-google-maps-api-key" content={config.googleMapsApiKey} />
        <meta name="pacenotes-google-map-id" content={config.googleMapId} />
      </head>
      <body>
        <Outlet />
        <UpdatePrompt />
        <IconButtonTooltips />
        <Scripts />
      </body>
    </html>
  );
}

function UpdatePrompt() {
  const [update, setUpdate] = useState<(() => Promise<void>) | null>(null);
  useEffect(() => {
    let disposed = false;
    const apply = registerSW({
      onNeedRefresh: () => {
        if (!disposed)
          setUpdate(() => async () => {
            await apply(true);
          });
      },
    });
    return () => {
      disposed = true;
    };
  }, []);
  if (!update) return null;
  return (
    <div className="update-toast" role="status">
      <div className="update-toast-copy">
        <strong>Update available</strong>
        <span>Reload to use the newest PaceNotes version.</span>
      </div>
      <button type="button" className="ghost-button" onClick={() => setUpdate(null)}>
        Later
      </button>
      <button type="button" className="primary-button" onClick={update}>
        Reload
      </button>
    </div>
  );
}
