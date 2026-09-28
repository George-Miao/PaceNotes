import { Database } from "@hocuspocus/extension-database";
import { Hocuspocus } from "@hocuspocus/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, sql } from "../db/client.js";
import { documents, trips } from "../db/schema.js";

// The WebSocket route and server functions must use the same live document cache.
const shared = globalThis as typeof globalThis & {
  __paceNotesSync?: {
    server: Hocuspocus;
    deletionPoll: NodeJS.Timeout;
  };
};

export const hocuspocus =
  shared.__paceNotesSync?.server ??
  new Hocuspocus({
    debounce: 500,
    maxDebounce: 1_500,
    extensions: [
      new Database({
        fetch: async ({ documentName }) => {
          const [row] = await db
            .select({ data: documents.data })
            .from(documents)
            .innerJoin(trips, eq(documents.name, trips.id))
            .where(and(eq(documents.name, documentName), eq(trips.state, "active")))
            .limit(1);
          return row?.data ?? null;
        },
        store: async ({ documentName, state }) => {
          await sql`
          UPDATE documents
          SET data = ${Buffer.from(state)}, updated_at = now()
          WHERE name = ${documentName}
            AND EXISTS (
              SELECT 1 FROM trips
              WHERE trips.id = documents.name AND trips.state = 'active'
            )
        `;
        },
      }),
    ],
    onAuthenticate: async ({ documentName }) => {
      const [trip] = await db
        .select({ id: trips.id })
        .from(trips)
        .where(and(eq(trips.id, documentName), eq(trips.state, "active")))
        .limit(1);
      if (!trip) throw new Error("Trip not found");
      return { tripId: trip.id };
    },
  });

const deletionPoll =
  shared.__paceNotesSync?.deletionPoll ??
  setInterval(async () => {
    const rows = await db
      .select({ id: trips.id })
      .from(trips)
      .where(inArray(trips.state, ["deleting", "deleted"]));
    for (const row of rows) hocuspocus.closeConnections(row.id);
  }, 500);
deletionPoll.unref();
shared.__paceNotesSync ??= { server: hocuspocus, deletionPoll };

let shutdownPromise: Promise<void> | undefined;

export function shutdownSync(): Promise<void> {
  shutdownPromise ??= new Promise<void>((resolve) => {
    clearInterval(deletionPoll);
    hocuspocus.configuration.extensions.push({
      async afterUnloadDocument({ instance }) {
        if (instance.getDocumentsCount() === 0) resolve();
      },
    });
    if (hocuspocus.getDocumentsCount() === 0) resolve();
    hocuspocus.closeConnections();
    hocuspocus.flushPendingStores();
  }).then(() => hocuspocus.hooks("onDestroy", { instance: hocuspocus }));

  return shutdownPromise;
}
