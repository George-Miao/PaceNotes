import * as Y from "yjs";
import {
  placeReferenceSchema,
  type TripItem,
  type TripSnapshot,
  tripItemSchema,
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

  return {
    id: String(metadata.get("id") ?? ""),
    title: String(metadata.get("title") ?? "Untitled trip"),
    startDate: String(metadata.get("startDate") ?? ""),
    endDate: String(metadata.get("endDate") ?? ""),
    timeZone: String(metadata.get("timeZone") ?? "UTC"),
    destination: destination.success ? destination.data : { placeId: "" },
    defaultTravelMode: (metadata.get("defaultTravelMode") ??
      "DRIVING") as TripSnapshot["defaultTravelMode"],
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

export function addTripItem(document: Y.Doc, item: TripItem, destinationIndex?: number): void {
  const parsed = tripItemSchema.parse(item);
  document.transact(() => {
    document.getMap<Y.Map<unknown>>(itemsKey).set(parsed.id, itemToMap(parsed));
    const order = document.getArray<string>(orderKey);
    const index =
      destinationIndex === undefined
        ? order.length
        : Math.max(0, Math.min(destinationIndex, order.length));
    order.insert(index, [parsed.id]);
  }, "add-item");
}

export function updateTripItem(document: Y.Doc, id: string, patch: Partial<TripItem>): void {
  const items = document.getMap<Y.Map<unknown>>(itemsKey);
  const item = items.get(id);
  if (!item) return;
  const current = tripItemSchema.parse(item.toJSON());
  const next = tripItemSchema.parse({ ...current, ...patch, id });
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

export function scheduleTripItem(
  document: Y.Doc,
  id: string,
  startTime: string,
  ids: string[],
): void {
  const item = document.getMap<Y.Map<unknown>>(itemsKey).get(id);
  if (!item) return;
  const next = tripItemSchema.parse({ ...item.toJSON(), id, startTime });
  const order = document.getArray<string>(orderKey);
  document.transact(() => {
    item.set("startTime", next.startTime);
    if (order.length > 0) order.delete(0, order.length);
    if (ids.length > 0) order.insert(0, ids);
  }, "reorder-item");
}

export function deleteTripDay(document: Y.Doc, dayId: string): void {
  document.transact(() => {
    const days = document.getArray<{ id: string; date: string }>(daysKey);
    const current = days.toArray();
    const deletedIndex = current.findIndex((day) => day.id === dayId);
    if (deletedIndex < 0 || current.length === 1) return;

    const shiftedIds = new Map<string, string>();
    const remaining = current.flatMap((day, index) => {
      if (index === deletedIndex) return [];
      if (index < deletedIndex) return [day];
      const shifted = shiftDate(day.date, -1);
      shiftedIds.set(day.id, shifted);
      return [{ id: shifted, date: shifted }];
    });
    days.delete(0, days.length);
    days.insert(0, remaining);

    const items = document.getMap<Y.Map<unknown>>(itemsKey);
    items.forEach((item) => {
      const itemDay = item.get("dayId");
      if (itemDay === dayId) item.set("dayId", null);
      else if (typeof itemDay === "string") {
        const shiftedDay = shiftedIds.get(itemDay);
        if (shiftedDay) item.set("dayId", shiftedDay);
      }

      const reservation = item.get("reservation") as TripItem["reservation"];
      if (reservation?.bookingDate && reservation.bookingDate >= dayId) {
        item.set("reservation", {
          ...reservation,
          bookingDate: shiftDate(reservation.bookingDate, -1),
        });
      }
    });

    const metadata = document.getMap(metadataKey);
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
