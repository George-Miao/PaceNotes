import * as Y from "yjs";
import {
  calendarStartHourSchema,
  defaultCalendarStartHour,
  distanceUnitSchema,
  lodgingForDates,
  placeReferenceSchema,
  type TripItem,
  type TripSettings,
  type TripSnapshot,
  travelModeSchema,
  tripDates,
  tripItemSchema,
  tripLanguageSchema,
  tripSettingsSchema,
} from "../trip/model";

const metadataKey = "metadata";
const daysKey = "days";
const orderKey = "order";
const itemsKey = "items";

export function initializeTripDocument(document: Y.Doc, snapshot: TripSnapshot): void {
  document.transact(() => {
    const metadata = document.getMap<unknown>(metadataKey);
    metadata.set("id", snapshot.id);
    metadata.set("title", snapshot.title);
    metadata.set("startDate", snapshot.startDate);
    metadata.set("endDate", snapshot.endDate);
    metadata.set("timeZone", snapshot.timeZone);
    metadata.set("destination", snapshot.destination);
    metadata.set("defaultTravelMode", snapshot.defaultTravelMode);
    metadata.set("tripLanguage", snapshot.tripLanguage);
    metadata.delete("language");
    metadata.delete("uiLanguage");
    metadata.set("distanceUnit", snapshot.distanceUnit);
    metadata.set("calendarStartHour", snapshot.calendarStartHour);
    metadata.delete("calendarHours");

    const days = document.getArray<{ id: string; date: string }>(daysKey);
    if (days.length > 0) days.delete(0, days.length);
    days.insert(0, snapshot.days);

    const order = document.getArray<string>(orderKey);
    if (order.length > 0) order.delete(0, order.length);
    order.insert(0, snapshot.order);

    const items = document.getMap<Y.Map<unknown>>(itemsKey);
    for (const [id, item] of Object.entries(snapshot.items)) items.set(id, itemToMap(item));
  }, "initialize");
}

export function readTripDocument(document: Y.Doc): TripSnapshot {
  const metadata = document.getMap<unknown>(metadataKey);
  const itemsMap = document.getMap<Y.Map<unknown>>(itemsKey);
  const items: Record<string, TripItem> = {};
  itemsMap.forEach((value, key) => {
    const parsed = tripItemSchema.safeParse(value.toJSON());
    if (parsed.success) items[key] = parsed.data;
  });
  const destination = placeReferenceSchema.safeParse(metadata.get("destination"));
  const legacyLanguage = tripLanguageSchema.safeParse(metadata.get("language"));
  const tripLanguage = tripLanguageSchema.nullable().safeParse(metadata.get("tripLanguage"));
  const distanceUnit = distanceUnitSchema.safeParse(metadata.get("distanceUnit"));
  const defaultTravelMode = travelModeSchema.safeParse(metadata.get("defaultTravelMode"));
  const calendarStartHour = calendarStartHourSchema.safeParse(metadata.get("calendarStartHour"));

  return {
    id: String(metadata.get("id") ?? ""),
    title: String(metadata.get("title") ?? "Untitled trip"),
    startDate: String(metadata.get("startDate") ?? ""),
    endDate: String(metadata.get("endDate") ?? ""),
    timeZone: String(metadata.get("timeZone") ?? "UTC"),
    destination: destination.success ? destination.data : { placeId: "" },
    tripLanguage: tripLanguage.success
      ? tripLanguage.data
      : legacyLanguage.success
        ? legacyLanguage.data
        : null,
    distanceUnit: distanceUnit.success ? distanceUnit.data : "metric",
    defaultTravelMode: defaultTravelMode.success ? defaultTravelMode.data : "DRIVING",
    calendarStartHour: calendarStartHour.success
      ? calendarStartHour.data
      : defaultCalendarStartHour,
    days: document.getArray<{ id: string; date: string }>(daysKey).toArray(),
    order: document.getArray<string>(orderKey).toArray(),
    items,
  };
}

export function setTripField(
  document: Y.Doc,
  field: "title" | "defaultTravelMode" | "destination" | "timeZone",
  value: unknown,
): void {
  document.transact(() => document.getMap(metadataKey).set(field, value), "trip-field");
}

export function setTripSettings(document: Y.Doc, settings: TripSettings): void {
  const parsed = tripSettingsSchema.parse(settings);
  const nextDays = tripDates(parsed.startDate, parsed.endDate).map((date) => ({
    id: date,
    date,
  }));
  const items = document.getMap<Y.Map<unknown>>(itemsKey);
  const nextItems = Array.from(items.values()).map((item) => {
    const current = tripItemSchema.parse(item.toJSON());
    if (
      current.type === "reservation" &&
      current.dayId &&
      (current.dayId < parsed.startDate || current.dayId > parsed.endDate)
    ) {
      throw new Error("Move or delete reservations before changing the trip dates");
    }
    return { item, next: itemForTripRange(current, parsed.startDate, parsed.endDate) };
  });
  document.transact(() => {
    const metadata = document.getMap(metadataKey);
    metadata.set("startDate", parsed.startDate);
    metadata.set("endDate", parsed.endDate);
    metadata.set("tripLanguage", parsed.tripLanguage);
    metadata.delete("language");
    metadata.delete("uiLanguage");
    metadata.set("distanceUnit", parsed.distanceUnit);
    metadata.set("defaultTravelMode", parsed.defaultTravelMode);
    metadata.set("calendarStartHour", parsed.calendarStartHour);
    metadata.delete("calendarHours");
    const days = document.getArray<{ id: string; date: string }>(daysKey);
    if (days.length > 0) days.delete(0, days.length);
    days.insert(0, nextDays);
    for (const { item, next } of nextItems) {
      for (const [key, value] of Object.entries(next)) item.set(key, value);
    }
  }, "trip-settings");
}

export function addTripDay(document: Y.Doc, edge: "before" | "after"): string | null {
  const metadata = document.getMap<unknown>(metadataKey);
  const startDate = String(metadata.get("startDate") ?? "");
  const endDate = String(metadata.get("endDate") ?? "");
  if (tripDates(startDate, endDate).length >= 30) return null;
  const date = edge === "before" ? shiftDate(startDate, -1) : shiftDate(endDate, 1);
  document.transact(() => {
    const days = document.getArray<{ id: string; date: string }>(daysKey);
    if (edge === "before") {
      metadata.set("startDate", date);
      days.insert(0, [{ id: date, date }]);
    } else {
      metadata.set("endDate", date);
      days.insert(days.length, [{ id: date, date }]);
    }
  }, "add-day");
  return date;
}

function requireReservationSchedule(item: TripItem): TripItem {
  if (item.type === "reservation" && (!item.dayId || !item.startTime)) {
    throw new Error("Choose a date and time for this reservation");
  }
  return item;
}

export function addTripItem(document: Y.Doc, item: TripItem, destinationIndex?: number): void {
  addTripItemWithNextTravelMode(document, item, null, destinationIndex);
}

export function addTripItemWithNextTravelMode(
  document: Y.Doc,
  item: TripItem,
  next: { id: string; travelMode: TripItem["travelMode"] } | null,
  destinationIndex?: number,
): void {
  const parsed = requireReservationSchedule(tripItemSchema.parse(item));
  const items = document.getMap<Y.Map<unknown>>(itemsKey);
  const nextMap = next ? items.get(next.id) : undefined;
  const parsedNext =
    next && nextMap
      ? requireReservationSchedule(
          tripItemSchema.parse({ ...nextMap.toJSON(), travelMode: next.travelMode, id: next.id }),
        )
      : null;
  document.transact(() => {
    items.set(parsed.id, itemToMap(parsed));
    const order = document.getArray<string>(orderKey);
    const index =
      destinationIndex === undefined
        ? order.length
        : Math.max(0, Math.min(destinationIndex, order.length));
    order.insert(index, [parsed.id]);
    if (nextMap && parsedNext) nextMap.set("travelMode", parsedNext.travelMode);
  }, "add-item");
}

export function updateTripItem(document: Y.Doc, id: string, patch: Partial<TripItem>): void {
  const items = document.getMap<Y.Map<unknown>>(itemsKey);
  const item = items.get(id);
  if (!item) return;
  const current = tripItemSchema.parse(item.toJSON());
  const next = requireReservationSchedule(tripItemSchema.parse({ ...current, ...patch, id }));
  document.transact(() => {
    for (const [key, value] of Object.entries(next)) item.set(key, value);
  }, "update-item");
}

export function removeTripItem(document: Y.Doc, id: string): void {
  document.transact(() => {
    document.getMap<Y.Map<unknown>>(itemsKey).delete(id);
    const order = document.getArray<string>(orderKey);
    const index = order.toArray().indexOf(id);
    if (index >= 0) order.delete(index, 1);
  }, "delete-item");
}

export function reorderTripItems(document: Y.Doc, source: number, destination: number): void {
  const order = document.getArray<string>(orderKey);
  if (
    source === destination ||
    source < 0 ||
    source >= order.length ||
    destination < 0 ||
    destination >= order.length
  )
    return;
  document.transact(() => {
    const [id] = order.slice(source, source + 1);
    if (!id) return;
    order.delete(source, 1);
    order.insert(destination, [id]);
  }, "reorder-item");
}

export function setTripOrder(document: Y.Doc, ids: string[]): void {
  const order = document.getArray<string>(orderKey);
  document.transact(() => {
    if (order.length > 0) order.delete(0, order.length);
    if (ids.length > 0) order.insert(0, ids);
  }, "reorder-item");
}

export function moveTripItem(
  document: Y.Doc,
  id: string,
  dayId: string | null,
  startTime: string | null,
  ids: string[],
  travelMode: TripItem["travelMode"] | undefined = undefined,
): void {
  const item = document.getMap<Y.Map<unknown>>(itemsKey).get(id);
  if (!item) return;
  const next = requireReservationSchedule(
    tripItemSchema.parse({
      ...item.toJSON(),
      id,
      dayId,
      startTime,
      ...(travelMode ? { travelMode } : {}),
    }),
  );
  const order = document.getArray<string>(orderKey);
  document.transact(() => {
    item.set("dayId", next.dayId);
    item.set("startTime", next.startTime);
    if (travelMode) item.set("travelMode", next.travelMode);
    if (order.length > 0) order.delete(0, order.length);
    if (ids.length > 0) order.insert(0, ids);
  }, "reorder-item");
}

export function scheduleTripItem(
  document: Y.Doc,
  id: string,
  startTime: string,
  ids: string[],
): void {
  const item = document.getMap<Y.Map<unknown>>(itemsKey).get(id);
  if (!item) return;
  const next = requireReservationSchedule(
    tripItemSchema.parse({ ...item.toJSON(), id, startTime }),
  );
  const order = document.getArray<string>(orderKey);
  document.transact(() => {
    item.set("startTime", next.startTime);
    if (order.length > 0) order.delete(0, order.length);
    if (ids.length > 0) order.insert(0, ids);
  }, "reorder-item");
}

export type CalendarItemChange = {
  id: string;
  patch: Partial<Pick<TripItem, "dayId" | "startTime" | "durationMinutes" | "lodging">>;
  order?: string[];
  extendThrough?: string;
};

export function applyCalendarItemChange(
  document: Y.Doc,
  change: CalendarItemChange,
): { endDate: string; clamped: boolean } {
  return applyCalendarItemChanges(document, [change], change.order);
}

export function applyCalendarItemChanges(
  document: Y.Doc,
  changes: readonly CalendarItemChange[],
  order?: readonly string[],
): { endDate: string; clamped: boolean } {
  const metadata = document.getMap<unknown>(metadataKey);
  const currentEnd = String(metadata.get("endDate") ?? "");
  const startDate = String(metadata.get("startDate") ?? "");
  const requestedEnd = changes.reduce(
    (end, change) =>
      change.extendThrough && change.extendThrough > end ? change.extendThrough : end,
    currentEnd,
  );
  const requestedDays = tripDates(startDate, requestedEnd);
  const nextDays = requestedDays.slice(0, 30).map((date) => ({ id: date, date }));
  const endDate = nextDays.at(-1)?.date ?? currentEnd;
  const items = document.getMap<Y.Map<unknown>>(itemsKey);
  const prepared = changes.flatMap((change) => {
    const item = items.get(change.id);
    if (!item) return [];
    const parsed = requireReservationSchedule(
      tripItemSchema.parse({ ...item.toJSON(), ...change.patch, id: change.id }),
    );
    return [{ item, parsed, next: clampCalendarItem(parsed, endDate) }];
  });
  const clamped =
    requestedEnd > endDate ||
    prepared.some(
      ({ parsed, next }) =>
        next.dayId !== parsed.dayId ||
        next.startTime !== parsed.startTime ||
        next.durationMinutes !== parsed.durationMinutes ||
        next.lodging?.startDate !== parsed.lodging?.startDate ||
        next.lodging?.endDate !== parsed.lodging?.endDate,
    );

  document.transact(() => {
    for (const { item, next } of prepared) {
      for (const [key, value] of Object.entries(next)) item.set(key, value);
    }
    if (endDate !== currentEnd) {
      metadata.set("endDate", endDate);
      const days = document.getArray<{ id: string; date: string }>(daysKey);
      if (days.length > 0) days.delete(0, days.length);
      days.insert(0, nextDays);
    }
    if (order) {
      const currentOrder = document.getArray<string>(orderKey);
      if (currentOrder.length > 0) currentOrder.delete(0, currentOrder.length);
      if (order.length > 0) currentOrder.insert(0, [...order]);
    }
  }, "calendar-item");
  return { endDate, clamped };
}

export function normalizeTripDocument(document: Y.Doc): void {
  const metadata = document.getMap<unknown>(metadataKey);
  const storedCalendarStartHour = calendarStartHourSchema.safeParse(
    metadata.get("calendarStartHour"),
  );
  const legacyCalendarHours = metadata.get("calendarHours");
  const calendarStartHour = storedCalendarStartHour.success
    ? storedCalendarStartHour.data
    : legacyCalendarHours === 24
      ? 0
      : legacyCalendarHours === 30
        ? 6
        : defaultCalendarStartHour;
  const migrateCalendarStartHour =
    !storedCalendarStartHour.success || metadata.has("calendarHours");
  const legacyLanguage = tripLanguageSchema.safeParse(metadata.get("language"));
  const storedTripLanguage = tripLanguageSchema.nullable().safeParse(metadata.get("tripLanguage"));
  const migrateLanguage =
    !storedTripLanguage.success || metadata.has("language") || metadata.has("uiLanguage");
  const tripLanguage = storedTripLanguage.success
    ? storedTripLanguage.data
    : legacyLanguage.success
      ? legacyLanguage.data
      : null;
  const items = Array.from(document.getMap<Y.Map<unknown>>(itemsKey).values());
  const notes = items.filter(
    (item) =>
      item.get("type") === "note" &&
      (item.get("startTime") !== null || item.get("durationMinutes") !== 0),
  );
  const lodgings = items.flatMap((item) => {
    if (item.get("type") !== "lodging") return [];
    const raw = item.get("lodging");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const value = raw as Record<string, unknown>;
    if (typeof value.startDate !== "string" || typeof value.endDate !== "string") return [];
    const previous =
      value.leaveTimes && typeof value.leaveTimes === "object" && !Array.isArray(value.leaveTimes)
        ? Object.fromEntries(
            Object.entries(value.leaveTimes).flatMap(([date, time]) =>
              typeof time === "string" ? [[date, time]] : [],
            ),
          )
        : {};
    const lodging = lodgingForDates(value.startDate, value.endDate, previous);
    return JSON.stringify(raw) === JSON.stringify(lodging) ? [] : [{ item, lodging }];
  });
  if (!migrateCalendarStartHour && !migrateLanguage && notes.length === 0 && lodgings.length === 0)
    return;
  document.transact(() => {
    if (migrateCalendarStartHour) {
      metadata.set("calendarStartHour", calendarStartHour);
      metadata.delete("calendarHours");
    }
    if (migrateLanguage) {
      metadata.set("tripLanguage", tripLanguage);
      metadata.delete("language");
      metadata.delete("uiLanguage");
    }
    for (const note of notes) {
      note.set("startTime", null);
      note.set("durationMinutes", 0);
    }
    for (const { item, lodging } of lodgings) item.set("lodging", lodging);
  }, "normalize-document");
}

function itemForTripRange(item: TripItem, startDate: string, endDate: string): TripItem {
  if (item.type === "lodging" && item.lodging) {
    const lodgingStart = item.lodging.startDate < startDate ? startDate : item.lodging.startDate;
    const lodgingEnd = item.lodging.endDate > endDate ? endDate : item.lodging.endDate;
    if (lodgingStart >= lodgingEnd) return { ...item, dayId: null };
    return {
      ...item,
      dayId: lodgingStart,
      lodging: lodgingForDates(lodgingStart, lodgingEnd, item.lodging.leaveTimes),
    };
  }
  if (item.dayId && (item.dayId < startDate || item.dayId > endDate)) {
    return { ...item, dayId: null };
  }
  return clampCalendarItem(item, endDate);
}

function clampCalendarItem(item: TripItem, endDate: string): TripItem {
  if (item.type === "lodging" && item.lodging) {
    const lodgingEnd = item.lodging.endDate > endDate ? endDate : item.lodging.endDate;
    const lodgingStart =
      item.lodging.startDate >= lodgingEnd ? shiftDate(lodgingEnd, -1) : item.lodging.startDate;
    return {
      ...item,
      dayId: lodgingStart,
      lodging: lodgingForDates(lodgingStart, lodgingEnd, item.lodging.leaveTimes),
    };
  }
  if (!item.dayId || !item.startTime) return item;
  if (item.dayId > endDate) {
    return { ...item, dayId: endDate, startTime: "23:45", durationMinutes: 15 };
  }
  const [hour = "0", minute = "0"] = item.startTime.split(":");
  const startMinute = Number(hour) * 60 + Number(minute);
  const available = tripDates(item.dayId, endDate).length * 1440 - startMinute;
  if (available < 15) {
    return { ...item, startTime: "23:45", durationMinutes: 15 };
  }
  return { ...item, durationMinutes: Math.max(15, Math.min(item.durationMinutes, available)) };
}
export function deleteTripDay(document: Y.Doc, dayId: string): void {
  document.transact(() => {
    const days = document.getArray<{ id: string; date: string }>(daysKey);
    const current = days.toArray();
    const deletedIndex = current.findIndex((day) => day.id === dayId);
    if (deletedIndex < 0 || current.length === 1) return;
    if (deletedIndex !== 0 && deletedIndex !== current.length - 1) {
      throw new Error("Only the first or last trip day can be deleted");
    }
    const items = document.getMap<Y.Map<unknown>>(itemsKey);
    const containsReservation = Array.from(items.values()).some(
      (item) => item.get("type") === "reservation" && item.get("dayId") === dayId,
    );
    if (containsReservation) {
      throw new Error("Move or delete reservations before deleting this day");
    }

    days.delete(deletedIndex, 1);
    const remaining = days.toArray();

    items.forEach((item) => {
      if (item.get("dayId") === dayId) item.set("dayId", null);
    });

    const metadata = document.getMap(metadataKey);
    metadata.set("startDate", remaining[0]?.date ?? "");
    metadata.set("endDate", remaining.at(-1)?.date ?? "");
  }, "delete-day");
}

function itemToMap(item: TripItem): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(item)) map.set(key, value);
  return map;
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
