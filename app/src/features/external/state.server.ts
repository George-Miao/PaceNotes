import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import type { TripItem, TripSnapshot } from "../trip/model";
import { ExternalError } from "./contract";

export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    return Object.fromEntries(
      Object.entries(entry).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  });
}

export function version(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function tripRecord(snapshot: TripSnapshot) {
  const {
    id,
    title,
    startDate,
    endDate,
    timeZone,
    destination,
    tripLanguage,
    distanceUnit,
    defaultTravelMode,
    calendarStartHour,
    currency,
  } = snapshot;
  return {
    id,
    title,
    startDate,
    endDate,
    timeZone,
    destination,
    tripLanguage,
    distanceUnit,
    defaultTravelMode,
    calendarStartHour,
    currency,
  };
}

export function versions(snapshot: TripSnapshot) {
  return {
    trip: version(tripRecord(snapshot)),
    order: version(snapshot.order),
    items: Object.fromEntries(
      Object.entries(snapshot.items).map(([id, value]) => [id, version(value)]),
    ),
    tripmates: Object.fromEntries(
      Object.entries(snapshot.friends).map(([id, value]) => [id, version(value)]),
    ),
    expenses: Object.fromEntries(
      Object.entries(snapshot.expenses).map(([id, value]) => [id, version(value)]),
    ),
    payments: Object.fromEntries(
      Object.entries(snapshot.settlements).map(([id, value]) => [id, version(value)]),
    ),
  };
}

export function assertVersion<T>(current: T | null, expected: string): asserts current is T {
  if (current === null || version(current) !== expected) {
    throw new ExternalError("CONFLICT", "The record changed. Read the current record and retry", {
      current,
      version: current === null ? null : version(current),
    });
  }
}

export function assertOrder(order: string[], expected: string): void {
  assertVersion(order, expected);
}

export function assertNew(current: unknown): void {
  if (current !== undefined)
    throw new ExternalError("CONFLICT", "The record already exists", {
      current,
      version: version(current),
    });
}

export function assertLocalTime(
  date: string | null,
  clock: string | null,
  zone: string,
  choice?: "earlier" | "later" | null,
): void {
  if (!date || !clock) return;
  try {
    const day = Temporal.PlainDate.from(date);
    const hour = Number(clock.slice(0, 2));
    const minute = Number(clock.slice(3, 5));
    const fields = { timeZone: zone, year: day.year, month: day.month, day: day.day, hour, minute };
    const earlier = Temporal.ZonedDateTime.from(fields, { disambiguation: "earlier" });
    const later = Temporal.ZonedDateTime.from(fields, { disambiguation: "later" });
    // Disambiguation moves a clock in a gap. A shifted wall clock is not the requested time.
    if (
      earlier.hour !== hour ||
      earlier.minute !== minute ||
      earlier.toPlainDate().toString() !== date ||
      later.hour !== hour ||
      later.minute !== minute ||
      later.toPlainDate().toString() !== date
    ) {
      throw new ExternalError("INVALID_PARAMS", "Local time is in a daylight-saving gap");
    }
    if (earlier.epochNanoseconds !== later.epochNanoseconds && !choice) {
      throw new ExternalError(
        "INVALID_PARAMS",
        "Choose earlier or later for this ambiguous local time",
        {
          offsets: [earlier.offset, later.offset],
        },
      );
    }
  } catch (error) {
    if (error instanceof ExternalError) throw error;
    throw new ExternalError(
      "INVALID_PARAMS",
      error instanceof Error ? error.message : "Invalid local time",
    );
  }
}

export function assertItemSchedule(item: TripItem, snapshot: TripSnapshot): void {
  if (item.dayId && !snapshot.days.some((day) => day.id === item.dayId)) {
    throw new ExternalError("INVALID_PARAMS", "The item day is outside the trip");
  }
  if (item.type === "reservation" && (!item.dayId || !item.startTime)) {
    throw new ExternalError("INVALID_PARAMS", "A reservation needs a day and time");
  }
  assertLocalTime(item.dayId, item.startTime, snapshot.timeZone, item.timeChoice);
}

export function paginate<T extends { id: string }>(
  records: T[],
  kind: string,
  limit = 100,
  cursor?: string,
) {
  let start = 0;
  if (cursor) {
    try {
      const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (
        !decoded ||
        typeof decoded !== "object" ||
        !("kind" in decoded) ||
        !("after" in decoded) ||
        decoded.kind !== kind ||
        typeof decoded.after !== "string"
      )
        throw new Error("Invalid cursor");
      start = records.findIndex((entry) => entry.id === decoded.after) + 1;
      if (start === 0) throw new Error("Cursor is no longer in this result");
    } catch {
      throw new ExternalError("INVALID_PARAMS", "Invalid or expired cursor");
    }
  }
  const page = records.slice(start, start + limit);
  return {
    records: page.map((record) => ({ record, version: version(record) })),
    nextCursor:
      start + limit < records.length
        ? Buffer.from(JSON.stringify({ kind, after: page.at(-1)?.id })).toString("base64url")
        : null,
  };
}
