import { Database } from "@hocuspocus/extension-database";
import { Hocuspocus } from "@hocuspocus/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, sql } from "../db/client.js";
import { documents, trips } from "../db/schema.js";

export const hocuspocus = new Hocuspocus({
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

const deletionPoll = setInterval(async () => {
  const rows = await db
    .select({ id: trips.id })
    .from(trips)
    .where(inArray(trips.state, ["deleting", "deleted"]));
  for (const row of rows) hocuspocus.closeConnections(row.id);
}, 500);
deletionPoll.unref();

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
