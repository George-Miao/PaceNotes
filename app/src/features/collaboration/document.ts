import * as Y from "yjs";
import {
  currencySchema,
  type Expense,
  expenseSchema,
  type Friend,
  financialIdSchema,
  friendSchema,
  type Settlement,
  settlementSchema,
} from "../expense/model";
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
const friendsKey = "friends";
const expensesKey = "expenses";
const settlementsKey = "settlements";

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
    metadata.set("currency", snapshot.currency ?? null);
    metadata.delete("calendarHours");

    const days = document.getArray<{ id: string; date: string }>(daysKey);
    if (days.length > 0) days.delete(0, days.length);
    days.insert(0, snapshot.days);

    const order = document.getArray<string>(orderKey);
    if (order.length > 0) order.delete(0, order.length);
    order.insert(0, snapshot.order);

    const items = document.getMap<Y.Map<unknown>>(itemsKey);
    for (const [id, item] of Object.entries(snapshot.items)) items.set(id, recordToMap(item));
    const friends = document.getMap<Y.Map<unknown>>(friendsKey);
    for (const [id, friend] of Object.entries(snapshot.friends ?? {}))
      friends.set(id, recordToMap(friend));
    const expenses = document.getMap<Y.Map<unknown>>(expensesKey);
    for (const [id, expense] of Object.entries(snapshot.expenses ?? {}))
      expenses.set(id, recordToMap(expense));
    const settlements = document.getMap<Y.Map<unknown>>(settlementsKey);
    for (const [id, settlement] of Object.entries(snapshot.settlements ?? {}))
      settlements.set(id, recordToMap(settlement));
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

  const storedCurrency = currencySchema.nullable().safeParse(metadata.get("currency"));
  const { friends } = projectFriends(document.getMap<Y.Map<unknown>>(friendsKey));
  const expenses: Record<string, Expense> = {};
  document.getMap<Y.Map<unknown>>(expensesKey).forEach((value, key) => {
    if (!(value instanceof Y.Map)) return;
    const parsed = expenseSchema.safeParse(value.toJSON());
    if (parsed.success && parsed.data.id === key) expenses[key] = parsed.data;
  });
  // A concurrent attachment race can leave two CRDT records pointing at one item.
  // Project the same lexical winner on every replica, even before normalization syncs.
  const occupied = new Set<string>();
  for (const id of Object.keys(expenses).sort()) {
    const expense = expenses[id];
    if (!expense) continue;
    if (!expense.itemId) {
      if (expense.followsItemDate) expenses[id] = detachedExpense(expense);
      continue;
    }
    const item = items[expense.itemId];
    if (!item || occupied.has(expense.itemId)) {
      expenses[id] = detachedExpense(expense);
      continue;
    }
    occupied.add(expense.itemId);
    if (expense.followsItemDate && validItemDate(item.dayId) && expense.date !== item.dayId) {
      expenses[id] = datedExpense(expense, item.dayId);
    }
  }
  const settlements: Record<string, Settlement> = {};
  document.getMap<Y.Map<unknown>>(settlementsKey).forEach((value, key) => {
    if (!(value instanceof Y.Map)) return;
    const parsed = settlementSchema.safeParse(value.toJSON());
    if (parsed.success && parsed.data.id === key) settlements[key] = parsed.data;
  });
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
    currency: storedCurrency.success ? storedCurrency.data : null,
    friends,
    expenses,
    settlements,
  };
}

export function setTripField(
  document: Y.Doc,
  field: "title" | "defaultTravelMode" | "destination" | "timeZone",
  value: unknown,
): void {
  document.transact(() => document.getMap(metadataKey).set(field, value), "trip-field");
}

function writeTripCurrency(document: Y.Doc, currency: string, origin: string): void {
  const parsed = currencySchema.parse(currency);
  const metadata = document.getMap<unknown>(metadataKey);
  const current = metadata.get("currency");
  if (
    current !== null &&
    current !== undefined &&
    current !== parsed &&
    (document.getMap(expensesKey).size > 0 || document.getMap(settlementsKey).size > 0)
  ) {
    throw new Error("Rebase expenses and settlements before changing the trip currency");
  }
  if (current !== parsed) {
    document.transact(() => metadata.set("currency", parsed), origin);
  }
}

export function setTripCurrency(document: Y.Doc, currency: string): void {
  writeTripCurrency(document, currency, "trip-currency");
}

export function initializeTripCurrency(document: Y.Doc, currency: string): void {
  writeTripCurrency(document, currency, "initialize-trip-currency");
}

function writeFriends(document: Y.Doc, updates: readonly Friend[], origin: string): void {
  if (!updates.length) return;
  const parsed = updates.map((friend) => friendSchema.parse(friend));
  const friends = document.getMap<Y.Map<unknown>>(friendsKey);
  const names = new Map(
    Object.values(projectFriends(friends).friends).map((friend) => [
      friend.id,
      friend.name.toLowerCase(),
    ]),
  );
  for (const friend of parsed) names.set(friend.id, friend.name.toLowerCase());
  if (new Set(names.values()).size !== names.size) {
    throw new Error("A tripmate with this name already exists");
  }
  document.transact(() => {
    for (const friend of parsed) upsertRecord(friends, friend);
  }, origin);
}

export function upsertFriends(document: Y.Doc, updates: readonly Friend[]): void {
  writeFriends(document, updates, "upsert-friend");
}

export function upsertFriend(document: Y.Doc, friend: Friend): void {
  upsertFriends(document, [friend]);
}

export function createTripmate(document: Y.Doc, friend: Friend): void {
  writeFriends(document, [friend], "create-tripmate");
}

function writeExpense(document: Y.Doc, expense: Expense, origin: string): void {
  const parsed = expenseSchema.parse(expense);
  if (!currencySchema.safeParse(document.getMap(metadataKey).get("currency")).success) {
    throw new Error("Choose a trip currency before adding expenses");
  }
  const expenses = document.getMap<Y.Map<unknown>>(expensesKey);
  const stored = expenses.get(parsed.id);
  const previous = stored instanceof Y.Map ? expenseSchema.safeParse(stored.toJSON()) : null;
  const prior = previous?.success ? previous.data : null;
  const friends = document.getMap<Y.Map<unknown>>(friendsKey);
  const oldSplit = prior ? splitParticipants(prior) : new Set<string>();
  const nextSplit = splitParticipants(parsed);
  const participants = new Set([parsed.payerId, ...nextSplit]);
  for (const id of participants) {
    const friend = friends.get(id);
    const valid = friend instanceof Y.Map ? friendSchema.safeParse(friend.toJSON()) : null;
    if (!valid?.success) throw new Error("Choose a tripmate on this trip");
    if (
      valid.data.archived &&
      ((id === parsed.payerId && prior?.payerId !== id) || (nextSplit.has(id) && !oldSplit.has(id)))
    ) {
      throw new Error("Archived tripmates cannot be added as payers or split participants");
    }
  }
  let next = parsed;
  if (parsed.itemId) {
    const item = document.getMap<Y.Map<unknown>>(itemsKey).get(parsed.itemId);
    if (!(item instanceof Y.Map)) throw new Error("Attached item no longer exists");
    for (const [id, record] of expenses) {
      if (id === parsed.id || !(record instanceof Y.Map)) continue;
      if (record.get("itemId") === parsed.itemId) {
        throw new Error("This item already has an expense");
      }
    }
    const dayId = item.get("dayId");
    if (parsed.followsItemDate && validItemDate(dayId)) {
      next = datedExpense(parsed, dayId);
    }
  } else if (
    parsed.followsItemDate ||
    (prior?.itemId && prior.followsItemDate && parsed.date === prior.date)
  ) {
    next = detachedExpense({ ...parsed, followsItemDate: true });
  }
  if (
    prior &&
    prior.date !== next.date &&
    next.conversion.source !== "identity" &&
    next.conversion.requestedDate !== next.date &&
    !next.conversion.stale
  ) {
    next = { ...next, conversion: { ...next.conversion, stale: true } };
  }
  document.transact(() => upsertRecord(expenses, next), origin);
}

export function upsertExpense(document: Y.Doc, expense: Expense): void {
  writeExpense(document, expense, "upsert-expense");
}

export function refreshExpenseConversion(document: Y.Doc, expense: Expense): void {
  writeExpense(document, expense, "refresh-expense-conversion");
}

export function removeExpense(document: Y.Doc, id: string): void {
  const parsed = financialIdSchema.parse(id);
  document.transact(() => document.getMap(expensesKey).delete(parsed), "remove-expense");
}

function writeSettlement(document: Y.Doc, settlement: Settlement, origin: string): void {
  const parsed = settlementSchema.parse(settlement);
  if (!currencySchema.safeParse(document.getMap(metadataKey).get("currency")).success) {
    throw new Error("Choose a trip currency before recording settlements");
  }
  const friends = document.getMap<Y.Map<unknown>>(friendsKey);
  for (const id of [parsed.fromId, parsed.toId]) {
    const friend = friends.get(id);
    if (!(friend instanceof Y.Map) || !friendSchema.safeParse(friend.toJSON()).success) {
      throw new Error("Choose a tripmate on this trip");
    }
  }
  document.transact(
    () => upsertRecord(document.getMap<Y.Map<unknown>>(settlementsKey), parsed),
    origin,
  );
}

export function upsertSettlement(document: Y.Doc, settlement: Settlement): void {
  writeSettlement(document, settlement, "upsert-settlement");
}

export function refreshSettlementConversion(document: Y.Doc, settlement: Settlement): void {
  writeSettlement(document, settlement, "refresh-settlement-conversion");
}

export function removeSettlement(document: Y.Doc, id: string): void {
  const parsed = financialIdSchema.parse(id);
  document.transact(() => document.getMap(settlementsKey).delete(parsed), "remove-settlement");
}

function prepareTripSettings(document: Y.Doc, settings: TripSettings) {
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
  return { parsed, nextDays, nextItems };
}

export function validateTripSettings(document: Y.Doc, settings: TripSettings): void {
  prepareTripSettings(document, settings);
}

export function setTripSettings(document: Y.Doc, settings: TripSettings): void {
  const { parsed, nextDays, nextItems } = prepareTripSettings(document, settings);
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
      if (item.get("dayId") !== next.dayId) syncExpenseDateForItem(document, next.id, next.dayId);
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
    items.set(parsed.id, recordToMap(parsed));
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
    if (current.dayId !== next.dayId) syncExpenseDateForItem(document, id, next.dayId);
    for (const [key, value] of Object.entries(next)) item.set(key, value);
  }, "update-item");
}

export function removeTripItem(document: Y.Doc, id: string): void {
  document.transact(() => {
    detachExpensesForItem(document, id);
    document.getMap<Y.Map<unknown>>(itemsKey).delete(id);
    const order = document.getArray<string>(orderKey);
    const index = order.toArray().indexOf(id);
    if (index >= 0) order.delete(index, 1);
  }, "delete-item");
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
    if (item.get("dayId") !== next.dayId) syncExpenseDateForItem(document, id, next.dayId);
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
      if (item.get("dayId") !== next.dayId) syncExpenseDateForItem(document, next.id, next.dayId);
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
  const corrections = expenseCorrections(document);
  const friendCorrections = projectFriends(document.getMap<Y.Map<unknown>>(friendsKey)).corrections;
  if (
    !migrateCalendarStartHour &&
    !migrateLanguage &&
    notes.length === 0 &&
    lodgings.length === 0 &&
    corrections.length === 0 &&
    friendCorrections.length === 0
  )
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
    for (const { record, name } of friendCorrections) record.set("name", name);
    for (const { record, next } of corrections) {
      for (const [key, value] of Object.entries(next)) {
        const previous = record.get(key);
        if (JSON.stringify(previous) !== JSON.stringify(value)) record.set(key, value);
      }
    }
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

    items.forEach((item, id) => {
      if (item.get("dayId") !== dayId) return;
      syncExpenseDateForItem(document, id, null);
      item.set("dayId", null);
    });

    const metadata = document.getMap(metadataKey);
    metadata.set("startDate", remaining[0]?.date ?? "");
    metadata.set("endDate", remaining.at(-1)?.date ?? "");
  }, "delete-day");
}

function recordToMap(record: object): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(record)) map.set(key, value);
  return map;
}

function upsertRecord<T extends { id: string }>(root: Y.Map<Y.Map<unknown>>, record: T): void {
  const map = root.get(record.id);
  if (!(map instanceof Y.Map)) {
    root.set(record.id, recordToMap(record));
    return;
  }
  for (const [key, value] of Object.entries(record)) {
    const previous = map.get(key);
    if (
      Object.is(previous, value) ||
      (previous !== null &&
        value !== null &&
        typeof previous === "object" &&
        typeof value === "object" &&
        JSON.stringify(previous) === JSON.stringify(value))
    ) {
      continue;
    }
    map.set(key, value);
  }
}

function projectFriends(root: Y.Map<Y.Map<unknown>>): {
  friends: Record<string, Friend>;
  corrections: Array<{ record: Y.Map<unknown>; name: string }>;
} {
  const entries: Array<{ id: string; record: Y.Map<unknown>; friend: Friend }> = [];
  for (const [id, record] of root) {
    if (!(record instanceof Y.Map)) continue;
    const parsed = friendSchema.safeParse(record.toJSON());
    if (parsed.success && parsed.data.id === id) {
      entries.push({ id, record, friend: parsed.data });
    }
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const reserved = new Set(entries.map(({ friend }) => friend.name.toLowerCase()));
  const used = new Set<string>();
  const friends: Record<string, Friend> = {};
  const corrections: Array<{ record: Y.Map<unknown>; name: string }> = [];
  for (const { id, record, friend } of entries) {
    let name = friend.name;
    if (used.has(name.toLowerCase())) {
      let suffix = 2;
      do {
        const marker = ` (${suffix++})`;
        name = `${friend.name.slice(0, 100 - marker.length).trimEnd()}${marker}`;
      } while (reserved.has(name.toLowerCase()) || used.has(name.toLowerCase()));
    }
    used.add(name.toLowerCase());
    friends[id] = name === friend.name ? friend : { ...friend, name };
    if (name !== friend.name) corrections.push({ record, name });
  }
  return { friends, corrections };
}

function splitParticipants(expense: Expense): Set<string> {
  switch (expense.split.kind) {
    case "payer":
      return new Set();
    case "equal":
    case "mixed":
      return new Set(expense.split.friendIds);
    case "exact":
      return new Set(Object.keys(expense.split.shares));
  }
}

function datedExpense(expense: Expense, date: string | null): Expense {
  if (expense.date === date) return expense;
  const conversion = expense.conversion;
  return {
    ...expense,
    date,
    conversion:
      conversion.source === "identity" || conversion.stale
        ? conversion
        : { ...conversion, stale: true },
  };
}

function detachedExpense(expense: Expense): Expense {
  const dated = expense.followsItemDate ? datedExpense(expense, null) : expense;
  return { ...dated, itemId: null, followsItemDate: false };
}

function validItemDate(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && tripDates(value, value).length === 1);
}

function syncExpenseDateForItem(document: Y.Doc, itemId: string, dayId: string | null): void {
  if (!validItemDate(dayId)) return;
  const expenses = document.getMap<Y.Map<unknown>>(expensesKey);
  for (const record of expenses.values()) {
    if (!(record instanceof Y.Map)) continue;
    if (record.get("itemId") !== itemId || record.get("followsItemDate") !== true) continue;
    const parsed = expenseSchema.safeParse(record.toJSON());
    if (parsed.success) upsertRecord(expenses, datedExpense(parsed.data, dayId));
  }
}

function detachExpensesForItem(document: Y.Doc, itemId: string): void {
  const expenses = document.getMap<Y.Map<unknown>>(expensesKey);
  for (const record of expenses.values()) {
    if (!(record instanceof Y.Map) || record.get("itemId") !== itemId) continue;
    const parsed = expenseSchema.safeParse(record.toJSON());
    if (parsed.success) {
      upsertRecord(expenses, detachedExpense(parsed.data));
    } else {
      record.set("itemId", null);
      record.set("followsItemDate", false);
    }
  }
}

function expenseCorrections(document: Y.Doc): Array<{ record: Y.Map<unknown>; next: Expense }> {
  const expenses = document.getMap<Y.Map<unknown>>(expensesKey);
  const items = document.getMap<Y.Map<unknown>>(itemsKey);
  const occupied = new Set<string>();
  const corrections: Array<{ record: Y.Map<unknown>; next: Expense }> = [];
  for (const [id, record] of Array.from(expenses.entries()).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (!(record instanceof Y.Map)) continue;
    const parsed = expenseSchema.safeParse(record.toJSON());
    if (!parsed.success || parsed.data.id !== id) continue;
    const itemId = parsed.data.itemId;
    if (!itemId) {
      if (parsed.data.followsItemDate) {
        corrections.push({ record, next: detachedExpense(parsed.data) });
      }
      continue;
    }
    const expense = parsed.data;
    const item = items.get(itemId);
    const validItem = item instanceof Y.Map ? tripItemSchema.safeParse(item.toJSON()) : null;
    if (!validItem?.success || occupied.has(itemId)) {
      corrections.push({ record, next: detachedExpense(expense) });
      continue;
    }
    occupied.add(itemId);
    const dayId = validItem.data.dayId;
    if (expense.followsItemDate && validItemDate(dayId) && dayId !== expense.date) {
      corrections.push({ record, next: datedExpense(expense, dayId) });
    }
  }
  return corrections;
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
