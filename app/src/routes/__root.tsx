/// <reference types="vite/client" />

import { registerSW } from "virtual:pwa-register";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getPublicConfig } from "~/features/config/public-config";
import appCss from "~/styles/app.css?url";

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
        content: "Fast collaborative trip planning with React and TanStack Start.",
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
