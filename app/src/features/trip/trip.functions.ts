import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { and, count, eq, gte, lt } from "drizzle-orm";
import * as Y from "yjs";
import { z } from "zod";
import { db } from "../../db/client";
import { creationEvents, documents, trips } from "../../db/schema";
import { initializeTripDocument } from "../collaboration/document";
import { createInitialSnapshot, newTripSchema } from "./model";

const tripIdSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{20,32}$/) });

export const createTrip = createServerFn({ method: "POST" })
  .validator(newTripSchema)
  .handler(async ({ data }) => {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    const forwarded = getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim();
    const clientAddress = forwarded || getRequestHeader("x-real-ip") || "unknown";
    const clientHash = createHash("sha256")
      .update(`${process.env.RATE_LIMIT_SALT ?? "pacenotes-local"}:${clientAddress}`)
      .digest("hex");

    await db.delete(creationEvents).where(lt(creationEvents.createdAt, cutoff));
    const existing = await db
      .select({ value: count() })
      .from(creationEvents)
      .where(and(eq(creationEvents.clientHash, clientHash), gte(creationEvents.createdAt, cutoff)));
    if (Number(existing[0]?.value ?? 0) >= 10)
      throw new Error("Trip creation limit reached. Try again later.");

    const id = randomBytes(18).toString("base64url");
    const snapshot = createInitialSnapshot(id, data);
    const document = new Y.Doc();
    initializeTripDocument(document, snapshot);
    const encoded = Buffer.from(Y.encodeStateAsUpdate(document));

    await db.transaction(async (transaction) => {
      await transaction.insert(trips).values({
        id,
        title: data.title,
        startDate: data.startDate,
        endDate: data.endDate,
        destinationPlaceId: data.destination.placeId,
        timeZone: data.timeZone,
      });
      await transaction.insert(documents).values({ name: id, data: encoded });
      await transaction.insert(creationEvents).values({ id: randomUUID(), clientHash });
    });

    return { id };
  });

export const getTripMetadata = createServerFn({ method: "GET" })
  .validator(tripIdSchema)
  .handler(async ({ data }) => {
    const [trip] = await db
      .select({
        id: trips.id,
        title: trips.title,
        startDate: trips.startDate,
        endDate: trips.endDate,
        state: trips.state,
      })
      .from(trips)
      .where(eq(trips.id, data.id))
      .limit(1);
    if (trip?.state !== "active") throw new Error("Trip not found");
    return trip;
  });

export const deleteTrip = createServerFn({ method: "POST" })
  .validator(tripIdSchema)
  .handler(async ({ data }) => {
    const [trip] = await db
      .update(trips)
      .set({ state: "deleting", updatedAt: new Date() })
      .where(and(eq(trips.id, data.id), eq(trips.state, "active")))
      .returning({ id: trips.id });
    if (!trip) return { deleted: false };

    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await db.delete(trips).where(eq(trips.id, data.id));
    return { deleted: true };
  });
