import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import type * as Y from "yjs";
import { z } from "zod";
import { db } from "../../db/client";
import { trips } from "../../db/schema";
import { hocuspocus } from "../../sync/hocuspocus";
import { readTripDocument, setTripSettings, validateTripSettings } from "../collaboration/document";
import { tripSettingsSchema } from "../trip/model";
import { conversionFor } from "./exchange.server";
import { currencySchema } from "./model";
import { financialFingerprint } from "./revision";

const inputSchema = z.object({
  tripId: z.string().regex(/^[A-Za-z0-9_-]{20,32}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  expected: z.string(),
  settings: tripSettingsSchema,
});

const pending = new Map<string, Promise<void>>();

async function serialize<T>(tripId: string, action: () => Promise<T>): Promise<T> {
  const previous = pending.get(tripId) ?? Promise.resolve();
  let release = () => {};
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  pending.set(tripId, next);
  await previous;
  try {
    return await action();
  } finally {
    if (pending.get(tripId) === next) pending.delete(tripId);
    release();
  }
}

/** Save settings and reprice every record in one live Yjs transaction, or leave all unchanged. */
export const rebaseTripCurrency = createServerFn({ method: "POST" })
  .validator(inputSchema)
  .handler(async ({ data }) => {
    currencySchema.parse(data.currency);
    return serialize(data.tripId, async () => {
      const [trip] = await db
        .select({ id: trips.id })
        .from(trips)
        .where(and(eq(trips.id, data.tripId), eq(trips.state, "active")))
        .limit(1);
      if (!trip) throw new Error("Trip not found");
      const connection = await hocuspocus.openDirectConnection(data.tripId);
      try {
        const live = connection.document;
        if (!live) throw new Error("Trip is not available");
        const before = readTripDocument(live);
        if (financialFingerprint(before) !== data.expected)
          throw new Error("Expenses changed. Review the ledger and try again.");
        validateTripSettings(live, data.settings);
        if (before.currency === data.currency) return { changed: false };
        const [expenses, settlements] = await Promise.all([
          Promise.all(
            Object.values(before.expenses).map(
              async (expense) =>
                [
                  expense.id,
                  {
                    ...(await conversionFor(
                      expense.amountMinor,
                      expense.currency,
                      data.currency,
                      expense.date ?? expense.conversion.observedDate,
                    )),
                    requestedDate: expense.date,
                  },
                ] as const,
            ),
          ),
          Promise.all(
            Object.values(before.settlements).map(
              async (settlement) =>
                [
                  settlement.id,
                  {
                    ...(await conversionFor(
                      settlement.amountMinor,
                      settlement.currency,
                      data.currency,
                      settlement.conversion.observedDate,
                    )),
                    requestedDate: null,
                  },
                ] as const,
            ),
          ),
        ]);
        await connection.transact((document) => {
          if (financialFingerprint(readTripDocument(document)) !== data.expected)
            throw new Error("Expenses changed. Review the ledger and try again.");
          validateTripSettings(document, data.settings);
          const expenseMap = document.getMap<Y.Map<unknown>>("expenses");
          const settlementMap = document.getMap<Y.Map<unknown>>("settlements");
          for (const [id, conversion] of expenses)
            expenseMap.get(id)?.set("conversion", conversion);
          for (const [id, conversion] of settlements)
            settlementMap.get(id)?.set("conversion", conversion);
          document.getMap("metadata").set("currency", data.currency);
          setTripSettings(document, data.settings);
        });
        return { changed: true };
      } finally {
        await connection.disconnect();
      }
    });
  });
