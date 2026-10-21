import { and, eq } from "drizzle-orm";
import type * as Y from "yjs";
import { db } from "../../db/client";
import { trips } from "../../db/schema";
import { hocuspocus } from "../../sync/hocuspocus";
import { ExternalError, type TripChange, tripChangeSchema } from "./contract";

/** Observe the shared Hocuspocus document, including updates from browser clients. */
export async function subscribeTripChanges(
  tripId: string,
  notify: (change: TripChange) => void,
): Promise<() => Promise<void>> {
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.state, "active")))
    .limit(1);
  if (!trip) throw new ExternalError("NOT_FOUND", "Trip not found");
  let connection: Awaited<ReturnType<typeof hocuspocus.openDirectConnection>>;
  try {
    connection = await hocuspocus.openDirectConnection(tripId);
  } catch {
    throw new ExternalError("NOT_FOUND", "Trip not found");
  }
  const document = connection.document;
  if (!document) {
    await connection.disconnect();
    throw new ExternalError("NOT_FOUND", "Trip not found");
  }
  const roots = {
    metadata: document.getMap("metadata"),
    days: document.getArray("days"),
    order: document.getArray("order"),
    items: document.getMap("items"),
    tripmates: document.getMap("friends"),
    expenses: document.getMap("expenses"),
    payments: document.getMap("settlements"),
  };
  let open = true;
  const onTransaction = (transaction: Y.Transaction) => {
    if (!open) return;
    const changed = new Set<unknown>(transaction.changedParentTypes.keys());
    const ids = (root: Y.Map<unknown>) => {
      const result = new Set<string>();
      for (const [type, events] of transaction.changedParentTypes) {
        if (!Object.is(type, root)) continue;
        for (const event of events) {
          if (event.target !== root) {
            for (const [id, value] of root.entries()) {
              if (Object.is(event.target, value)) result.add(id);
            }
          }
          if (event.target === root && "keysChanged" in event) {
            for (const key of event.keysChanged as Set<string>) result.add(key);
          }
        }
      }
      return [...result].sort();
    };
    const change = tripChangeSchema.parse({
      trip: changed.has(roots.metadata) || changed.has(roots.days),
      order: changed.has(roots.order),
      items: ids(roots.items),
      tripmates: ids(roots.tripmates),
      expenses: ids(roots.expenses),
      payments: ids(roots.payments),
    });
    if (
      change.trip ||
      change.order ||
      change.items.length ||
      change.tripmates.length ||
      change.expenses.length ||
      change.payments.length
    ) {
      notify(change);
    }
  };
  document.on("afterTransaction", onTransaction);
  return async () => {
    if (!open) return;
    open = false;
    document.off("afterTransaction", onTransaction);
    await connection.disconnect();
  };
}
