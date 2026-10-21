import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { and, eq } from "drizzle-orm";
import type postgres from "postgres";
import * as Y from "yjs";
import { z } from "zod";
import { db, sql } from "../../db/client";
import { trips } from "../../db/schema";
import { hocuspocus } from "../../sync/hocuspocus";
import {
  addTripItem,
  createTripmate,
  initializeTripDocument,
  moveTripItem,
  readTripDocument,
  removeExpense,
  removeSettlement,
  removeTripItem,
  removeTripmate,
  setTripField,
  setTripOrder,
  setTripSettings,
  updateTripItem,
  upsertExpense,
  upsertFriend,
  upsertSettlement,
} from "../collaboration/document";
import { conversionFor } from "../expense/exchange.server";
import { type Expense, expenseSchema, type Settlement, settlementSchema } from "../expense/model";
import { balances, suggestSettlements } from "../expense/money";
import { financialFingerprint } from "../expense/revision";
import { destinationTimeZone, searchPlaces, validTimeZone } from "../google/places.server";
import {
  createInitialSnapshot,
  type TripItem,
  type TripSnapshot,
  tripItemSchema,
  tripSettingsSchema,
} from "../trip/model";
import {
  ExternalError,
  type ExternalMethod,
  externalMethods,
  externalResults,
  tripIdSchema,
} from "./contract";
import { idempotentRecord } from "./idempotency.server";
import {
  assertItemSchedule,
  assertLocalTime,
  assertNew,
  assertOrder,
  assertVersion,
  canonical,
  paginate,
  tripRecord,
  version,
  versions,
} from "./state.server";

type Input<M extends ExternalMethod> = z.output<(typeof externalMethods)[M]>;
type LiveConnection = Awaited<ReturnType<typeof hocuspocus.openDirectConnection>>;
type Tx = postgres.TransactionSql;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requestsPerMinute(name: string, fallback: number): number {
  const configured = process.env[name];
  if (configured === undefined) return fallback;
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

const rateLimits = {
  client: requestsPerMinute("PACENOTES_EXTERNAL_CLIENT_RPM", 120),
  trip: requestsPerMinute("PACENOTES_EXTERNAL_TRIP_RPM", 240),
  searchClient: requestsPerMinute("PACENOTES_EXTERNAL_SEARCH_CLIENT_RPM", 30),
  searchTrip: requestsPerMinute("PACENOTES_EXTERNAL_SEARCH_TRIP_RPM", 60),
};

async function rateBucket(scope: string, max: number, intervalSeconds: number): Promise<void> {
  const bucket = new Date(
    Math.floor(Date.now() / (intervalSeconds * 1_000)) * intervalSeconds * 1_000,
  ).toISOString();
  const rows = await sql`
    INSERT INTO external_rate_buckets (scope, bucket, count) VALUES (${scope}, ${bucket}, 1)
    ON CONFLICT (scope, bucket) DO UPDATE SET count = external_rate_buckets.count + 1
      WHERE external_rate_buckets.count < ${max}
    RETURNING count
  `;
  if (!rows.length) throw new ExternalError("RATE_LIMIT", "Request limit reached. Try again later");
  if (Math.random() < 0.002) {
    void sql`DELETE FROM external_rate_buckets WHERE bucket < now() - interval '2 hours'`.catch(
      () => {},
    );
  }
}

async function rateLimit(
  method: ExternalMethod,
  tripId: string | null,
  clientAddress: string,
): Promise<void> {
  const clientHash = hash(`${process.env.RATE_LIMIT_SALT ?? "pacenotes-local"}:${clientAddress}`);
  await rateBucket(`ip:${clientHash}`, rateLimits.client, 60);
  if (tripId) await rateBucket(`trip:${tripId}`, rateLimits.trip, 60);
  if (method === "place.search") {
    await rateBucket(`search:${clientHash}`, rateLimits.searchClient, 60);
    if (tripId) await rateBucket(`search:trip:${tripId}`, rateLimits.searchTrip, 60);
  }
}

async function idempotent<T>(
  method: ExternalMethod,
  scope: string,
  key: string,
  input: unknown,
  action: (tx: Tx) => Promise<T>,
): Promise<T> {
  const requestHash = hash(canonical(input));
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope}:${method}:${key}`}, 0))`;
    const existing = await tx`
      SELECT request_hash, response FROM external_idempotency
      WHERE scope = ${scope} AND method = ${method} AND key = ${key} AND expires_at > now()
    `;
    if (existing.length) {
      const row = existing[0];
      if (row?.request_hash !== requestHash) {
        throw new ExternalError("CONFLICT", "The idempotency key was used with different input", {
          current: null,
          version: null,
        });
      }
      return row.response as T;
    }
    await tx`DELETE FROM external_idempotency WHERE scope = ${scope} AND method = ${method} AND key = ${key}`;
    const response = await action(tx);
    await tx`
      INSERT INTO external_idempotency (scope, method, key, request_hash, response, expires_at)
      VALUES (${scope}, ${method}, ${key}, ${requestHash}, ${JSON.stringify(response)}::jsonb, now() + interval '24 hours')
    `;
    return response;
  }) as Promise<T>;
}

async function activeTrip(id: string): Promise<void> {
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, id), eq(trips.state, "active")))
    .limit(1);
  if (!trip) throw new ExternalError("NOT_FOUND", "Trip not found");
}

async function withTrip<T>(
  id: string,
  action: (connection: LiveConnection) => Promise<T>,
): Promise<T> {
  await activeTrip(id);
  let connection: LiveConnection;
  try {
    connection = await hocuspocus.openDirectConnection(id);
  } catch {
    throw new ExternalError("NOT_FOUND", "Trip not found");
  }
  try {
    if (!connection.document) throw new ExternalError("NOT_FOUND", "Trip not found");
    return await action(connection);
  } finally {
    await connection.disconnect();
  }
}

async function apply<T>(
  connection: LiveConnection,
  action: (doc: Y.Doc, snapshot: TripSnapshot) => T,
): Promise<T> {
  let result!: T;
  await connection.transact((doc) => {
    result = action(doc, readTripDocument(doc));
  });
  return result;
}

function recordResult(snapshot: TripSnapshot) {
  const record = tripRecord(snapshot);
  return { record, version: version(record) };
}

function itemResult(snapshot: TripSnapshot, id: string, includeOrder = false) {
  const record = snapshot.items[id];
  if (!record) throw new ExternalError("NOT_FOUND", "Item not found");
  return {
    record,
    version: version(record),
    ...(includeOrder ? { orderVersion: version(snapshot.order) } : {}),
  };
}

function financeRecord<T>(record: T | undefined): { record: T; version: string } {
  if (!record) throw new ExternalError("NOT_FOUND", "Record not found");
  return { record, version: version(record) };
}

function requireCurrency(snapshot: TripSnapshot): string {
  if (!snapshot.currency) throw new ExternalError("INVALID_PARAMS", "Choose a trip currency first");
  return snapshot.currency;
}

function validTripZone(zone: string): void {
  if (!validTimeZone(zone))
    throw new ExternalError("INVALID_PARAMS", "Time zone must be an IANA time zone");
}

function checkZoneTimes(snapshot: TripSnapshot, zone: string): void {
  for (const item of Object.values(snapshot.items)) {
    assertLocalTime(item.dayId, item.startTime, zone, item.timeChoice);
  }
}

function dateOfPayment(paidAt: string, zone: string): string {
  return Temporal.Instant.from(paidAt).toZonedDateTimeISO(zone).toPlainDate().toString();
}

function validatePayment(
  snapshot: TripSnapshot,
  payment: Settlement,
  acknowledge: boolean,
  previousId?: string,
): void {
  if (!snapshot.friends[payment.fromId] || !snapshot.friends[payment.toId]) {
    throw new ExternalError("INVALID_PARAMS", "Choose tripmates on this trip");
  }
  if (
    (snapshot.friends[payment.fromId]?.archived || snapshot.friends[payment.toId]?.archived) &&
    (!previousId ||
      snapshot.settlements[previousId]?.fromId !== payment.fromId ||
      snapshot.settlements[previousId]?.toId !== payment.toId)
  ) {
    throw new ExternalError("INVALID_PARAMS", "Archived tripmates cannot be added to payments");
  }
  const remaining = previousId
    ? {
        ...snapshot,
        settlements: Object.fromEntries(
          Object.entries(snapshot.settlements).filter(([id]) => id !== previousId),
        ),
      }
    : snapshot;
  const ledger = balances(remaining);
  const due = Math.min(
    Math.max(0, -(ledger[payment.fromId] ?? 0)),
    Math.max(0, ledger[payment.toId] ?? 0),
  );
  if (payment.conversion.amountMinor > due && !acknowledge) {
    throw new ExternalError("INVALID_PARAMS", "Acknowledge this overpayment before recording it");
  }
}

function normalizedExpense(
  snapshot: TripSnapshot,
  input: Input<"expense.create">["expense"],
): Omit<Expense, "conversion"> {
  const item = input.itemId ? snapshot.items[input.itemId] : null;
  if (input.itemId && !item)
    throw new ExternalError("INVALID_PARAMS", "Attached item no longer exists");
  if (input.followsItemDate && !input.itemId)
    throw new ExternalError("INVALID_PARAMS", "A dated attachment needs an item");
  return { ...input, date: input.followsItemDate ? (item?.dayId ?? null) : input.date };
}

async function expenseWithConversion(
  snapshot: TripSnapshot,
  input: Input<"expense.create">["expense"],
): Promise<Expense> {
  const base = normalizedExpense(snapshot, input);
  const currency = requireCurrency(snapshot);
  const conversion = await conversionFor(base.amountMinor, base.currency, currency, base.date);
  return expenseSchema.parse({ ...base, conversion });
}

async function paymentWithConversion(
  snapshot: TripSnapshot,
  input: Input<"payment.create">["payment"],
): Promise<Settlement> {
  const currency = requireCurrency(snapshot);
  const quote = await conversionFor(
    input.amountMinor,
    input.currency,
    currency,
    dateOfPayment(input.paidAt, snapshot.timeZone),
  );
  return settlementSchema.parse({ ...input, conversion: { ...quote, requestedDate: null } });
}

function verifyExpenseQuote(
  snapshot: TripSnapshot,
  input: Input<"expense.create">["expense"],
  quoted: Expense,
  base: TripSnapshot,
): void {
  if (
    snapshot.currency !== base.currency ||
    normalizedExpense(snapshot, input).date !== quoted.date
  ) {
    throw new ExternalError("CONFLICT", "Trip currency or attached item date changed", {
      current: snapshot.expenses[input.id] ?? null,
      version: snapshot.expenses[input.id] ? version(snapshot.expenses[input.id]) : null,
    });
  }
}

function verifyPaymentQuote(
  snapshot: TripSnapshot,
  base: TripSnapshot,
  input: Input<"payment.create">["payment"],
): void {
  if (
    snapshot.currency !== base.currency ||
    dateOfPayment(input.paidAt, snapshot.timeZone) !== dateOfPayment(input.paidAt, base.timeZone)
  ) {
    throw new ExternalError("CONFLICT", "Trip currency or time zone changed", {
      current: snapshot.settlements[input.id] ?? null,
      version: snapshot.settlements[input.id] ? version(snapshot.settlements[input.id]) : null,
    });
  }
}

function readSelection(snapshot: TripSnapshot, select: Input<"trip.read">["select"]): unknown {
  switch (select.kind) {
    case "snapshot":
      return { kind: "snapshot", snapshot, versions: versions(snapshot) };
    case "items": {
      const items = snapshot.order
        .map((id) => snapshot.items[id])
        .filter((item): item is TripItem => !!item)
        .filter((item) => select.dayId === undefined || item.dayId === select.dayId)
        .filter((item) => select.type === undefined || item.type === select.type);
      return {
        kind: "items",
        ...paginate(
          items,
          `items:${select.dayId ?? (select.dayId === null ? "null" : "all")}:${select.type ?? "all"}`,
          select.limit,
          select.cursor,
        ),
      };
    }
    case "item":
      return { kind: "item", ...financeRecord(snapshot.items[select.id]) };
    case "tripmates":
      return {
        kind: "tripmates",
        ...paginate(
          Object.values(snapshot.friends).sort((a, b) => a.id.localeCompare(b.id)),
          "tripmates",
          select.limit,
          select.cursor,
        ),
      };
    case "tripmate":
      return { kind: "tripmate", ...financeRecord(snapshot.friends[select.id]) };
    case "expenses":
      return {
        kind: "expenses",
        ...paginate(
          Object.values(snapshot.expenses)
            .filter((expense) => select.date === undefined || expense.date === select.date)
            .sort((a, b) => a.id.localeCompare(b.id)),
          `expenses:${select.date ?? (select.date === null ? "null" : "all")}`,
          select.limit,
          select.cursor,
        ),
      };
    case "expense":
      return { kind: "expense", ...financeRecord(snapshot.expenses[select.id]) };
    case "payments":
      return {
        kind: "payments",
        ...paginate(
          Object.values(snapshot.settlements).sort((a, b) => a.id.localeCompare(b.id)),
          "payments",
          select.limit,
          select.cursor,
        ),
      };
    case "payment":
      return { kind: "payment", ...financeRecord(snapshot.settlements[select.id]) };
    case "finance":
      return {
        kind: "finance",
        currency: requireCurrency(snapshot),
        balances: balances(snapshot),
        suggestions: suggestSettlements(snapshot),
      };
  }
}

async function dispatch(
  method: ExternalMethod,
  input: unknown,
  context: { tripId: string | null; clientAddress: string; baseUrl: string },
): Promise<unknown> {
  if (method === "place.search") {
    const p = input as Input<"place.search">;
    return searchPlaces(p.query, p.language);
  }
  if (method === "trip.create") {
    const p = input as Input<"trip.create">;
    const scope = `ip:${hash(`${process.env.RATE_LIMIT_SALT ?? "pacenotes-local"}:${context.clientAddress}`)}`;
    return idempotent(method, scope, p.idempotencyKey, p, async (tx) => {
      const clientHash = scope.slice(3);
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`create:${clientHash}`}, 0))`;
      const recent = await tx`
        SELECT count(*)::integer AS value FROM creation_events
        WHERE client_hash = ${clientHash} AND created_at >= now() - interval '1 hour'
      `;
      if (Number(recent[0]?.value ?? 0) >= 10)
        throw new ExternalError("RATE_LIMIT", "Trip creation limit reached. Try again later");
      if (p.timeZone) validTripZone(p.timeZone);
      const zone = p.timeZone ?? (await destinationTimeZone(p.destination.placeId));
      const id = randomBytes(18).toString("base64url");
      const snapshot = createInitialSnapshot(id, { ...p, title: p.title ?? "", timeZone: zone });
      const doc = new Y.Doc();
      initializeTripDocument(doc, snapshot);
      const data = Buffer.from(Y.encodeStateAsUpdate(doc));
      doc.destroy();
      await tx`INSERT INTO trips (id, title, start_date, end_date, destination_place_id, time_zone)
        VALUES (${id}, ${snapshot.title}, ${snapshot.startDate}, ${snapshot.endDate}, ${snapshot.destination.placeId}, ${zone})`;
      await tx`INSERT INTO documents (name, data) VALUES (${id}, ${data})`;
      await tx`INSERT INTO creation_events (id, client_hash) VALUES (${randomUUID()}, ${clientHash})`;
      return { id, url: new URL(`/trips/${id}`, context.baseUrl).toString() };
    });
  }
  const tripId = context.tripId;
  if (!tripId) throw new ExternalError("FORBIDDEN", "A trip bearer ID is required");
  return withTrip(tripId, async (connection) => {
    const live = connection.document;
    if (!live) throw new ExternalError("NOT_FOUND", "Trip not found");
    if (method === "trip.read")
      return readSelection(readTripDocument(live), (input as Input<"trip.read">).select);

    if (method === "trip.update") {
      const p = input as Input<"trip.update">;
      const before = readTripDocument(live);
      assertVersion(tripRecord(before), p.expected);
      const zone =
        p.patch.timeZone ??
        (p.patch.destination && p.patch.destination.placeId !== before.destination.placeId
          ? await destinationTimeZone(p.patch.destination.placeId)
          : before.timeZone);
      validTripZone(zone);
      if (zone !== before.timeZone) checkZoneTimes(before, zone);
      return apply(connection, (doc, saved) => {
        assertVersion(tripRecord(saved), p.expected);
        if (zone !== saved.timeZone) checkZoneTimes(saved, zone);
        tripSettingsSchema.parse({
          startDate: saved.startDate,
          endDate: saved.endDate,
          tripLanguage: p.patch.tripLanguage ?? saved.tripLanguage,
          distanceUnit: p.patch.distanceUnit ?? saved.distanceUnit,
          defaultTravelMode: p.patch.defaultTravelMode ?? saved.defaultTravelMode,
          calendarStartHour: p.patch.calendarStartHour ?? saved.calendarStartHour,
        });
        const fields = { ...p.patch, timeZone: zone };
        for (const field of ["title", "destination", "timeZone", "defaultTravelMode"] as const) {
          if (
            fields[field] !== undefined &&
            (field !== "destination" ||
              p.patch.destination?.placeId !== saved.destination.placeId) &&
            (field === "destination" || fields[field] !== saved[field])
          ) {
            setTripField(doc, field, fields[field]);
          }
        }
        const metadata = doc.getMap("metadata");
        for (const field of ["tripLanguage", "distanceUnit", "calendarStartHour"] as const) {
          if (p.patch[field] !== undefined && p.patch[field] !== saved[field]) {
            metadata.set(field, p.patch[field]);
          }
        }
        return recordResult(readTripDocument(doc));
      });
    }

    if (method === "trip.setDates") {
      const p = input as Input<"trip.setDates">;
      return apply(connection, (doc, saved) => {
        assertVersion(tripRecord(saved), p.expected);
        setTripSettings(doc, {
          startDate: p.startDate,
          endDate: p.endDate,
          tripLanguage: saved.tripLanguage,
          distanceUnit: saved.distanceUnit,
          defaultTravelMode: saved.defaultTravelMode,
          calendarStartHour: saved.calendarStartHour,
        });
        return recordResult(readTripDocument(doc));
      });
    }

    if (method === "trip.changeCurrency") {
      const p = input as Input<"trip.changeCurrency">;
      const before = readTripDocument(live);
      assertVersion(tripRecord(before), p.expected);
      if (before.currency === p.currency) return recordResult(before);
      const fingerprint = financialFingerprint(before);
      const [expenses, payments] = await Promise.all([
        Promise.all(
          Object.values(before.expenses).map(
            async (expense) =>
              [
                expense.id,
                {
                  ...(await conversionFor(
                    expense.amountMinor,
                    expense.currency,
                    p.currency,
                    expense.date ?? expense.conversion.observedDate,
                  )),
                  requestedDate: expense.date,
                },
              ] as const,
          ),
        ),
        Promise.all(
          Object.values(before.settlements).map(
            async (payment) =>
              [
                payment.id,
                {
                  ...(await conversionFor(
                    payment.amountMinor,
                    payment.currency,
                    p.currency,
                    payment.conversion.observedDate,
                  )),
                  requestedDate: null,
                },
              ] as const,
          ),
        ),
      ]);
      return apply(connection, (doc, saved) => {
        assertVersion(tripRecord(saved), p.expected);
        if (financialFingerprint(saved) !== fingerprint) {
          throw new ExternalError(
            "CONFLICT",
            "Financial records changed while converting currency",
            {
              current: tripRecord(saved),
              version: version(tripRecord(saved)),
            },
          );
        }
        const expenseMap = doc.getMap<Y.Map<unknown>>("expenses");
        const paymentMap = doc.getMap<Y.Map<unknown>>("settlements");
        for (const [id, conversion] of expenses) expenseMap.get(id)?.set("conversion", conversion);
        for (const [id, conversion] of payments) paymentMap.get(id)?.set("conversion", conversion);
        doc.getMap("metadata").set("currency", p.currency);
        return recordResult(readTripDocument(doc));
      });
    }

    if (method === "item.create") {
      const p = input as Input<"item.create">;
      return idempotentRecord(
        method,
        tripId,
        p.idempotencyKey,
        p,
        p.item.id,
        connection,
        async () => (doc, saved) => {
          assertNew(saved.items[p.item.id]);
          if (saved.order.length >= 500)
            throw new ExternalError("INVALID_PARAMS", "The trip already has 500 items");
          const record = tripItemSchema.parse({ ...p.item, timeChoice: p.timeChoice ?? null });
          assertItemSchedule(record, saved);
          addTripItem(doc, record);
          return itemResult(readTripDocument(doc), record.id, true);
        },
      );
    }
    if (method === "item.update") {
      const p = input as Input<"item.update">;
      return apply(connection, (doc, saved) => {
        const current = saved.items[p.id] ?? null;
        assertVersion(current, p.expected);
        const changedTime =
          p.patch.startTime !== undefined && p.patch.startTime !== current.startTime;
        const choice = p.timeChoice ?? (changedTime ? null : (current.timeChoice ?? null));
        const next = tripItemSchema.parse({ ...current, ...p.patch, timeChoice: choice });
        if (changedTime || p.timeChoice) assertItemSchedule(next, saved);
        updateTripItem(doc, p.id, { ...(p.patch as Partial<TripItem>), timeChoice: choice });
        return itemResult(readTripDocument(doc), p.id);
      });
    }
    if (method === "item.move") {
      const p = input as Input<"item.move">;
      return apply(connection, (doc, saved) => {
        const current = saved.items[p.id] ?? null;
        assertVersion(current, p.expected);
        assertOrder(saved.order, p.orderExpected);
        const remaining = saved.order.filter((id) => id !== p.id);
        if (!saved.order.includes(p.id) || (p.beforeId && !remaining.includes(p.beforeId))) {
          throw new ExternalError("INVALID_PARAMS", "Item position is not in the saved order");
        }
        const changedTime = p.dayId !== current.dayId || p.startTime !== current.startTime;
        const choice = p.timeChoice ?? (changedTime ? null : (current.timeChoice ?? null));
        const next = tripItemSchema.parse({
          ...current,
          dayId: p.dayId,
          startTime: p.startTime,
          timeChoice: choice,
        });
        if (changedTime || p.timeChoice) assertItemSchedule(next, saved);
        remaining.splice(p.beforeId ? remaining.indexOf(p.beforeId) : remaining.length, 0, p.id);
        moveTripItem(doc, p.id, p.dayId, p.startTime, remaining, undefined, choice);
        return itemResult(readTripDocument(doc), p.id, true);
      });
    }
    if (method === "item.reorder") {
      const p = input as Input<"item.reorder">;
      return apply(connection, (doc, saved) => {
        assertOrder(saved.order, p.expected);
        const savedIds = new Set(saved.order);
        if (
          p.order.length !== saved.order.length ||
          new Set(p.order).size !== p.order.length ||
          p.order.some((id) => !savedIds.has(id))
        ) {
          throw new ExternalError(
            "INVALID_PARAMS",
            "Order must contain every saved item exactly once",
          );
        }
        setTripOrder(doc, p.order);
        const current = readTripDocument(doc).order;
        return { order: current, version: version(current) };
      });
    }
    if (method === "item.remove") {
      const p = input as Input<"item.remove">;
      return apply(connection, (doc, saved) => {
        assertVersion(saved.items[p.id] ?? null, p.expected);
        removeTripItem(doc, p.id);
        return { removed: true as const, orderVersion: version(readTripDocument(doc).order) };
      });
    }

    if (method === "tripmate.create") {
      const p = input as Input<"tripmate.create">;
      return idempotentRecord(
        method,
        tripId,
        p.idempotencyKey,
        p,
        p.id,
        connection,
        async () => (doc, saved) => {
          assertNew(saved.friends[p.id]);
          createTripmate(doc, { id: p.id, name: p.name, color: p.color, archived: false });
          return financeRecord(readTripDocument(doc).friends[p.id]);
        },
      );
    }
    if (method === "tripmate.update") {
      const p = input as Input<"tripmate.update">;
      return apply(connection, (doc, saved) => {
        const current = saved.friends[p.id] ?? null;
        assertVersion(current, p.expected);
        upsertFriend(doc, {
          id: p.id,
          name: p.patch.name ?? current.name,
          color: p.patch.color ?? current.color,
          archived: p.patch.archived ?? current.archived,
        });
        return financeRecord(readTripDocument(doc).friends[p.id]);
      });
    }
    if (method === "tripmate.remove") {
      const p = input as Input<"tripmate.remove">;
      return apply(connection, (doc, saved) => {
        const current = saved.friends[p.id] ?? null;
        assertVersion(current, p.expected);
        const used =
          Object.values(saved.expenses).some(
            (expense) =>
              expense.payerId === p.id ||
              (expense.split.kind !== "payer" &&
                (expense.split.kind === "exact"
                  ? Object.hasOwn(expense.split.shares, p.id)
                  : expense.split.friendIds.includes(p.id))),
          ) ||
          Object.values(saved.settlements).some(
            (payment) => payment.fromId === p.id || payment.toId === p.id,
          );
        if (used)
          throw new ExternalError("CONFLICT", "Tripmate has financial records", {
            current,
            version: version(current),
          });
        removeTripmate(doc, p.id);
        return { removed: true as const };
      });
    }

    if (method === "expense.create") {
      const p = input as Input<"expense.create">;
      return idempotentRecord(
        method,
        tripId,
        p.idempotencyKey,
        p,
        p.expense.id,
        connection,
        async () => {
          const base = readTripDocument(live);
          assertNew(base.expenses[p.expense.id]);
          const quoted = await expenseWithConversion(base, p.expense);
          return (doc, saved) => {
            assertNew(saved.expenses[p.expense.id]);
            verifyExpenseQuote(saved, p.expense, quoted, base);
            upsertExpense(doc, quoted);
            return financeRecord(readTripDocument(doc).expenses[p.expense.id]);
          };
        },
      );
    }
    if (method === "expense.update") {
      const p = input as Input<"expense.update">;
      const base = readTripDocument(live);
      assertVersion(base.expenses[p.expense.id] ?? null, p.expected);
      const quoted = await expenseWithConversion(base, p.expense);
      return apply(connection, (doc, saved) => {
        assertVersion(saved.expenses[p.expense.id] ?? null, p.expected);
        verifyExpenseQuote(saved, p.expense, quoted, base);
        upsertExpense(doc, quoted);
        return financeRecord(readTripDocument(doc).expenses[p.expense.id]);
      });
    }
    if (method === "expense.remove") {
      const p = input as Input<"expense.remove">;
      return apply(connection, (doc, saved) => {
        assertVersion(saved.expenses[p.id] ?? null, p.expected);
        removeExpense(doc, p.id);
        return { removed: true as const };
      });
    }

    if (method === "payment.create") {
      const p = input as Input<"payment.create">;
      return idempotentRecord(
        method,
        tripId,
        p.idempotencyKey,
        p,
        p.payment.id,
        connection,
        async () => {
          const base = readTripDocument(live);
          assertNew(base.settlements[p.payment.id]);
          const quoted = await paymentWithConversion(base, p.payment);
          return (doc, saved) => {
            assertNew(saved.settlements[p.payment.id]);
            verifyPaymentQuote(saved, base, p.payment);
            validatePayment(saved, quoted, p.acknowledgeOverpayment === true);
            upsertSettlement(doc, quoted);
            return financeRecord(readTripDocument(doc).settlements[p.payment.id]);
          };
        },
      );
    }
    if (method === "payment.update") {
      const p = input as Input<"payment.update">;
      const base = readTripDocument(live);
      assertVersion(base.settlements[p.payment.id] ?? null, p.expected);
      const quoted = await paymentWithConversion(base, p.payment);
      return apply(connection, (doc, saved) => {
        assertVersion(saved.settlements[p.payment.id] ?? null, p.expected);
        verifyPaymentQuote(saved, base, p.payment);
        validatePayment(saved, quoted, p.acknowledgeOverpayment === true, p.payment.id);
        upsertSettlement(doc, quoted);
        return financeRecord(readTripDocument(doc).settlements[p.payment.id]);
      });
    }
    if (method === "payment.remove") {
      const p = input as Input<"payment.remove">;
      return apply(connection, (doc, saved) => {
        assertVersion(saved.settlements[p.id] ?? null, p.expected);
        removeSettlement(doc, p.id);
        return { removed: true as const };
      });
    }
    throw new ExternalError("INVALID_PARAMS", "Unknown method");
  });
}

export async function executeExternalMethod(
  method: ExternalMethod,
  params: unknown,
  context: { tripId: string | null; clientAddress: string; baseUrl: string },
): Promise<unknown> {
  const schema = externalMethods[method];
  if (!schema) throw new ExternalError("INVALID_PARAMS", "Unknown method");
  const validated = schema.safeParse(params);
  if (!validated.success) {
    throw new ExternalError("INVALID_PARAMS", "Invalid method parameters", {
      issues: validated.error.issues.slice(0, 8).map((issue) => ({
        path: issue.path.join(".").slice(0, 120),
        message: issue.message.slice(0, 160),
      })),
    });
  }
  if (context.tripId !== null && !tripIdSchema.safeParse(context.tripId).success) {
    throw new ExternalError("FORBIDDEN", "Invalid trip bearer ID");
  }
  if (!context.tripId && method !== "trip.create" && method !== "place.search") {
    throw new ExternalError("FORBIDDEN", "A trip bearer ID is required");
  }
  try {
    await rateLimit(method, context.tripId, context.clientAddress);
    const result = await dispatch(method, validated.data, context);
    return externalResults[method].parse(result);
  } catch (error) {
    if (error instanceof ExternalError) throw error;
    if (error instanceof z.ZodError || error instanceof RangeError) {
      throw new ExternalError("INVALID_PARAMS", error.message);
    }
    if (error instanceof Error) {
      if (error.message === "Trip not found")
        throw new ExternalError("NOT_FOUND", "Trip not found");
      if (/exchange rate|Frankfurter/i.test(error.message)) {
        throw new ExternalError("PROVIDER_UNAVAILABLE", "Exchange rates are unavailable");
      }
      if (
        /tripmate|reservation|attached item|currency|expense|payment|settlement|trip day|trip date|item/i.test(
          error.message,
        )
      ) {
        throw new ExternalError("INVALID_PARAMS", error.message);
      }
    }
    throw new ExternalError("PROVIDER_UNAVAILABLE", "External service is unavailable");
  }
}
