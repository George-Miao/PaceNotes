import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { Expense, Friend, Settlement } from "../expense/model";
import { createInitialSnapshot, itemForCreate, lodgingForDates } from "../trip/model";
import {
  addTripDay,
  addTripItem,
  applyCalendarItemChange,
  applyCalendarItemChanges,
  deleteTripDay,
  initializeTripDocument,
  moveTripItem,
  normalizeTripDocument,
  readTripDocument,
  removeExpense,
  removeSettlement,
  removeTripItem,
  setTripCurrency,
  setTripSettings,
  updateTripItem,
  upsertExpense,
  upsertFriend,
  upsertFriends,
  upsertSettlement,
} from "./document";

const destination = {
  placeId: "tokyo",
};

function seedDocument(): Y.Doc {
  const document = new Y.Doc();
  initializeTripDocument(
    document,
    createInitialSnapshot("trip-1", {
      title: "Japan route",
      startDate: "2027-01-01",
      endDate: "2027-01-05",
      destination,
      timeZone: "Asia/Tokyo",
    }),
  );
  return document;
}

const financeIds = {
  alice: "00000000-0000-4000-8000-000000000001",
  bob: "00000000-0000-4000-8000-000000000002",
  meal: "00000000-0000-4000-8000-000000000003",
  historical: "00000000-0000-4000-8000-000000000004",
  other: "00000000-0000-4000-8000-000000000005",
  newPayer: "00000000-0000-4000-8000-000000000006",
  newShare: "00000000-0000-4000-8000-000000000007",
  shared: "00000000-0000-4000-8000-000000000008",
  first: "00000000-0000-4000-8000-000000000009",
  second: "00000000-0000-4000-8000-00000000000a",
  manualDate: "00000000-0000-4000-8000-00000000000b",
  linked: "00000000-0000-4000-8000-00000000000c",
  manual: "00000000-0000-4000-8000-00000000000d",
  attached: "00000000-0000-4000-8000-00000000000e",
  zExpense: "00000000-0000-4000-8000-000000000010",
  aExpense: "00000000-0000-4000-8000-00000000000f",
  payment: "00000000-0000-4000-8000-000000000011",
} as const;

function friendFor(id: string, name: string, archived = false): Friend {
  return { id, name, color: "#397257", archived };
}

function expenseFor(id: string, itemId: string | null = null): Expense {
  return {
    id,
    description: "Lunch",
    category: "food",
    amountMinor: 1000,
    currency: "EUR",
    payerId: financeIds.alice,
    split: { kind: "equal", friendIds: [financeIds.alice, financeIds.bob] },
    itemId,
    date: "2027-01-01",
    followsItemDate: itemId !== null,
    conversion: {
      amountMinor: 1000,
      rate: 1,
      requestedDate: null,
      observedDate: "2027-01-01",
      source: "identity",
      stale: false,
    },
  };
}

function financialDocument(): Y.Doc {
  const document = seedDocument();
  setTripCurrency(document, "EUR");
  upsertFriend(document, friendFor(financeIds.alice, "Alice"));
  upsertFriend(document, friendFor(financeIds.bob, "Bob"));
  return document;
}

describe("collaboration document", () => {
  it("uses default settings for documents without settings metadata", () => {
    expect(readTripDocument(new Y.Doc())).toMatchObject({
      destination: { placeId: "" },
      tripLanguage: null,
      distanceUnit: "metric",
      defaultTravelMode: "DRIVING",
      calendarStartHour: 6,
    });
  });
  it.each([
    [undefined, 6],
    [24, 0],
    [30, 6],
  ] as const)("normalizes legacy calendar hours %s to start hour %s", (legacyHours, startHour) => {
    const document = new Y.Doc();
    const metadata = document.getMap<unknown>("metadata");
    if (legacyHours !== undefined) metadata.set("calendarHours", legacyHours);

    normalizeTripDocument(document);

    expect(readTripDocument(document).calendarStartHour).toBe(startHour);
    expect(metadata.get("calendarStartHour")).toBe(startHour);
    expect(metadata.has("calendarHours")).toBe(false);
  });

  it("migrates the shared legacy language to a trip language override", () => {
    const document = new Y.Doc();
    const metadata = document.getMap<unknown>("metadata");
    metadata.set("language", "ja");

    normalizeTripDocument(document);

    expect(readTripDocument(document).tripLanguage).toBe("ja");
    expect(metadata.has("language")).toBe(false);
    expect(metadata.has("uiLanguage")).toBe(false);
  });

  it("updates all trip settings in one transaction", () => {
    const document = seedDocument();
    addTripItem(
      document,
      itemForCreate("note", "2027-01-01", { id: "outside-range", title: "Outside range" }),
    );
    let transactions = 0;
    document.on("afterTransaction", (transaction) => {
      if (transaction.origin === "trip-settings") transactions += 1;
    });

    setTripSettings(document, {
      startDate: "2027-01-02",
      endDate: "2027-01-04",
      tripLanguage: "fr",
      distanceUnit: "imperial",
      defaultTravelMode: "WALKING",
      calendarStartHour: 17,
    });

    expect(transactions).toBe(1);
    expect(readTripDocument(document)).toMatchObject({
      startDate: "2027-01-02",
      endDate: "2027-01-04",
      days: [
        { id: "2027-01-02", date: "2027-01-02" },
        { id: "2027-01-03", date: "2027-01-03" },
        { id: "2027-01-04", date: "2027-01-04" },
      ],
      items: {
        "outside-range": { dayId: null },
      },
      tripLanguage: "fr",
      distanceUnit: "imperial",
      defaultTravelMode: "WALKING",
      calendarStartHour: 17,
    });
  });

  it("adds one trip day at either edge", () => {
    const document = seedDocument();

    expect(addTripDay(document, "before")).toBe("2026-12-31");
    expect(addTripDay(document, "after")).toBe("2027-01-06");

    const snapshot = readTripDocument(document);
    expect(snapshot).toMatchObject({
      startDate: "2026-12-31",
      endDate: "2027-01-06",
    });
    expect(snapshot.days.map((day) => day.date)).toEqual([
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
      "2027-01-04",
      "2027-01-05",
      "2027-01-06",
    ]);
  });

  it("converges after ten editors add items at the same time", () => {
    const source = seedDocument();
    const seed = Y.encodeStateAsUpdate(source);
    const editors = Array.from({ length: 10 }, (_, index) => {
      const document = new Y.Doc();
      Y.applyUpdate(document, seed);
      addTripItem(
        document,
        itemForCreate("note", "2027-01-01", { id: `note-${index}`, title: `Editor ${index}` }),
      );
      return document;
    });
    const updates = editors.map((document) => Y.encodeStateAsUpdate(document));
    for (const editor of editors) {
      for (const update of updates) Y.applyUpdate(editor, update);
    }

    const snapshots = editors.map((document) => readTripDocument(document));
    expect(snapshots[0]?.order).toHaveLength(10);
    expect(new Set(snapshots.map((snapshot) => snapshot.order.join(","))).size).toBe(1);
    expect(snapshots[0] ? Object.keys(snapshots[0].items).sort() : []).toEqual(
      Array.from({ length: 10 }, (_, index) => `note-${index}`).sort(),
    );
  });

  it("uses one deterministic winner for simultaneous edits to the same field", () => {
    const source = seedDocument();
    addTripItem(source, itemForCreate("note", "2027-01-01", { id: "shared", title: "Original" }));
    const seed = Y.encodeStateAsUpdate(source);
    const first = new Y.Doc();
    const second = new Y.Doc();
    Y.applyUpdate(first, seed);
    Y.applyUpdate(second, seed);
    updateTripItem(first, "shared", { title: "First" });
    updateTripItem(second, "shared", { title: "Second" });
    const firstUpdate = Y.encodeStateAsUpdate(first);
    const secondUpdate = Y.encodeStateAsUpdate(second);
    Y.applyUpdate(first, secondUpdate);
    Y.applyUpdate(second, firstUpdate);

    expect(readTripDocument(first).items.shared?.title).toBe(
      readTripDocument(second).items.shared?.title,
    );
  });

  it("keeps a place when its custom label is cleared and synchronized", () => {
    const source = seedDocument();
    const copy = new Y.Doc();
    addTripItem(
      source,
      itemForCreate("place", "2027-01-01", {
        id: "meeting-point",
        title: "Meeting point",
        place: { placeId: "place-2" },
      }),
    );
    updateTripItem(source, "meeting-point", { title: "   " });
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(source));
    expect(readTripDocument(copy).items["meeting-point"]).toMatchObject({
      title: "",
      dayId: "2027-01-01",
      place: { placeId: "place-2" },
    });
    source.destroy();
    copy.destroy();
  });

  it("does not save a reservation without its date and time", () => {
    const document = seedDocument();
    const reservation = itemForCreate("reservation", "2027-01-01", {
      id: "reservation",
      place: { placeId: "restaurant" },
      startTime: "19:30",
      reservation: { provider: "", confirmation: "" },
    });
    addTripItem(document, reservation);

    expect(() =>
      addTripItem(document, { ...reservation, id: "missing-time", startTime: null }),
    ).toThrow("Choose a date and time");
    expect(() => updateTripItem(document, reservation.id, { dayId: null })).toThrow(
      "Choose a date and time",
    );
    expect(() => moveTripItem(document, reservation.id, null, null, [reservation.id])).toThrow(
      "Choose a date and time",
    );
    expect(() =>
      applyCalendarItemChange(document, {
        id: reservation.id,
        patch: { startTime: null, durationMinutes: 0 },
      }),
    ).toThrow("Choose a date and time");
    expect(readTripDocument(document).items.reservation).toMatchObject({
      dayId: "2027-01-01",
      startTime: "19:30",
    });
    expect(() => deleteTripDay(document, "2027-01-01")).toThrow(
      "Move or delete reservations before deleting this day",
    );
    expect(readTripDocument(document).days).toHaveLength(5);
    document.destroy();
  });

  it("rejects deletion of a middle day", () => {
    const document = seedDocument();
    addTripItem(document, itemForCreate("note", "2027-01-03", { id: "middle" }));
    addTripItem(document, itemForCreate("note", "2027-01-04", { id: "later" }));

    expect(() => deleteTripDay(document, "2027-01-03")).toThrow(
      "Only the first or last trip day can be deleted",
    );
    const snapshot = readTripDocument(document);
    expect(snapshot.days.map((day) => day.date)).toEqual([
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
      "2027-01-04",
      "2027-01-05",
    ]);
    expect(snapshot.items.middle?.dayId).toBe("2027-01-03");
    expect(snapshot.items.later?.dayId).toBe("2027-01-04");
    expect(snapshot.endDate).toBe("2027-01-05");
    document.destroy();
  });

  it.each([
    {
      deletedDay: "2027-01-01",
      otherDay: "2027-01-02",
      remainingDates: ["2027-01-02", "2027-01-03", "2027-01-04", "2027-01-05"],
      startDate: "2027-01-02",
      endDate: "2027-01-05",
    },
    {
      deletedDay: "2027-01-05",
      otherDay: "2027-01-04",
      remainingDates: ["2027-01-01", "2027-01-02", "2027-01-03", "2027-01-04"],
      startDate: "2027-01-01",
      endDate: "2027-01-04",
    },
  ])(
    "deletes boundary day $deletedDay without moving items on other days",
    ({ deletedDay, otherDay, remainingDates, startDate, endDate }) => {
      const document = seedDocument();
      addTripItem(document, itemForCreate("note", deletedDay, { id: "deleted-day" }));
      addTripItem(document, itemForCreate("note", otherDay, { id: "other-day" }));

      deleteTripDay(document, deletedDay);
      const snapshot = readTripDocument(document);
      expect(snapshot.days.map((day) => day.date)).toEqual(remainingDates);
      expect(snapshot.items["deleted-day"]?.dayId).toBeNull();
      expect(snapshot.items["other-day"]?.dayId).toBe(otherDay);
      expect(snapshot.startDate).toBe(startDate);
      expect(snapshot.endDate).toBe(endDate);
      document.destroy();
    },
  );

  it("applies calendar scheduling and trip extension in one transaction", () => {
    const document = seedDocument();
    addTripItem(
      document,
      itemForCreate("place", "2027-01-01", {
        id: "calendar-item",
        title: "Calendar item",
        startTime: "10:00",
      }),
    );
    let transactions = 0;
    document.on("afterTransaction", (transaction) => {
      if (transaction.origin === "calendar-item") transactions += 1;
    });

    const extended = applyCalendarItemChange(document, {
      id: "calendar-item",
      patch: { dayId: "2027-01-07", startTime: "22:30", durationMinutes: 180 },
      extendThrough: "2027-01-08",
      order: ["calendar-item"],
    });

    expect(transactions).toBe(1);
    expect(extended).toEqual({ endDate: "2027-01-08", clamped: false });
    expect(readTripDocument(document)).toMatchObject({
      endDate: "2027-01-08",
      order: ["calendar-item"],
      items: {
        "calendar-item": {
          dayId: "2027-01-07",
          startTime: "22:30",
          durationMinutes: 180,
        },
      },
    });
    applyCalendarItemChange(document, {
      id: "calendar-item",
      patch: { startTime: null, durationMinutes: 0 },
    });
    expect(readTripDocument(document).items["calendar-item"]).toMatchObject({
      dayId: "2027-01-07",
      startTime: null,
      durationMinutes: 0,
    });

    const clamped = applyCalendarItemChange(document, {
      id: "calendar-item",
      patch: { dayId: "2027-02-15", startTime: "12:00", durationMinutes: 60 },
      extendThrough: "2027-02-15",
    });

    expect(clamped).toEqual({ endDate: "2027-01-30", clamped: true });
    expect(readTripDocument(document).items["calendar-item"]).toMatchObject({
      dayId: "2027-01-30",
      startTime: "23:45",
      durationMinutes: 15,
    });

    const lateStart = applyCalendarItemChange(document, {
      id: "calendar-item",
      patch: { dayId: "2027-01-30", startTime: "23:59", durationMinutes: 60 },
      extendThrough: "2027-01-30",
    });

    expect(lateStart).toEqual({ endDate: "2027-01-30", clamped: true });
    expect(readTripDocument(document).items["calendar-item"]).toMatchObject({
      dayId: "2027-01-30",
      startTime: "23:45",
      durationMinutes: 15,
    });
    document.destroy();
  });
  it("moves calendar items together in one transaction", () => {
    const document = seedDocument();
    addTripItem(
      document,
      itemForCreate("place", "2027-01-01", {
        id: "group-first",
        title: "First",
        startTime: "09:00",
      }),
    );
    addTripItem(
      document,
      itemForCreate("place", "2027-01-01", {
        id: "group-second",
        title: "Second",
        startTime: "11:00",
      }),
    );
    let transactions = 0;
    document.on("afterTransaction", (transaction) => {
      if (transaction.origin === "calendar-item") transactions += 1;
    });

    applyCalendarItemChanges(document, [
      { id: "group-first", patch: { dayId: "2027-01-02", startTime: "10:00" } },
      { id: "group-second", patch: { dayId: "2027-01-02", startTime: "12:00" } },
    ]);

    expect(transactions).toBe(1);
    const snapshot = readTripDocument(document);
    expect(snapshot.items["group-first"]).toMatchObject({
      dayId: "2027-01-02",
      startTime: "10:00",
    });
    expect(snapshot.items["group-second"]).toMatchObject({
      dayId: "2027-01-02",
      startTime: "12:00",
    });
  });

  it("normalizes legacy note schedule fields in the shared document", () => {
    const document = seedDocument();
    addTripItem(
      document,
      itemForCreate("note", "2027-01-02", {
        id: "legacy-note",
        title: "Legacy note",
      }),
    );
    const note = document.getMap<Y.Map<unknown>>("items").get("legacy-note");
    expect(note).toBeDefined();
    note?.set("startTime", "09:30");
    note?.set("durationMinutes", 45);
    let transactions = 0;
    document.on("afterTransaction", (transaction) => {
      if (transaction.origin === "normalize-document") transactions += 1;
    });

    normalizeTripDocument(document);

    expect(transactions).toBe(1);
    expect(note?.get("startTime")).toBeNull();
    expect(note?.get("durationMinutes")).toBe(0);
    document.destroy();
  });

  it("migrates daily leave times into legacy lodging records", () => {
    const document = seedDocument();
    addTripItem(
      document,
      itemForCreate("lodging", "2027-01-01", {
        id: "legacy-stay",
        place: { placeId: "hotel" },
        lodging: lodgingForDates("2027-01-01", "2027-01-03"),
      }),
    );
    const item = document.getMap<Y.Map<unknown>>("items").get("legacy-stay");
    item?.set("lodging", { startDate: "2027-01-01", endDate: "2027-01-03" });

    normalizeTripDocument(document);

    expect(item?.get("lodging")).toEqual(lodgingForDates("2027-01-01", "2027-01-03"));
    expect(readTripDocument(document).items["legacy-stay"]?.lodging).toEqual(
      lodgingForDates("2027-01-01", "2027-01-03"),
    );
    document.destroy();
  });

  it("clamps a lodging change to the 30-day trip limit", () => {
    const document = seedDocument();
    addTripItem(
      document,
      itemForCreate("lodging", "2027-01-02", {
        id: "calendar-stay",
        title: "Calendar stay",
        place: { placeId: "calendar-hotel" },
        lodging: lodgingForDates("2027-01-02", "2027-01-05"),
      }),
    );

    const clamped = applyCalendarItemChange(document, {
      id: "calendar-stay",
      patch: {
        dayId: "2027-02-15",
        startTime: null,
        lodging: lodgingForDates("2027-02-15", "2027-02-18"),
      },
      extendThrough: "2027-02-18",
    });

    expect(clamped).toEqual({ endDate: "2027-01-30", clamped: true });
    expect(readTripDocument(document)).toMatchObject({
      endDate: "2027-01-30",
      items: {
        "calendar-stay": {
          dayId: "2027-01-29",
          lodging: {
            startDate: "2027-01-29",
            endDate: "2027-01-30",
          },
        },
      },
    });
    document.destroy();
  });
});

describe("financial document records", () => {
  it("reads legacy trips with empty finance defaults without erasing existing records", () => {
    const document = financialDocument();
    upsertExpense(document, expenseFor(financeIds.meal));
    document.getMap("metadata").delete("currency");

    expect(readTripDocument(document)).toMatchObject({
      currency: null,
      friends: { [financeIds.alice]: { name: "Alice" } },
      expenses: { [financeIds.meal]: { description: "Lunch" } },
      settlements: {},
    });
    normalizeTripDocument(document);
    expect(readTripDocument(document).expenses[financeIds.meal]?.amountMinor).toBe(1000);
    expect(readTripDocument(new Y.Doc())).toMatchObject({
      currency: null,
      friends: {},
      expenses: {},
      settlements: {},
    });
  });

  it("keeps names unique across archived friends and prevents new archived participation", () => {
    const document = financialDocument();
    upsertExpense(document, expenseFor(financeIds.historical));
    upsertFriend(document, friendFor(financeIds.bob, "Bob", true));

    expect(() => upsertFriend(document, friendFor(financeIds.other, " bOb "))).toThrow(
      "already exists",
    );
    expect(() =>
      upsertExpense(document, { ...expenseFor(financeIds.newPayer), payerId: financeIds.bob }),
    ).toThrow();
    expect(() =>
      upsertExpense(document, {
        ...expenseFor(financeIds.newShare),
        split: { kind: "equal", friendIds: [financeIds.bob] },
      }),
    ).toThrow();
    upsertExpense(document, { ...expenseFor(financeIds.historical), description: "Dinner" });
    expect(readTripDocument(document).expenses[financeIds.historical]?.description).toBe("Dinner");
    expect(() => setTripCurrency(document, "USD")).toThrow("Rebase");
    expect(readTripDocument(document).currency).toBe("EUR");
  });

  it("applies valid tripmate renames together and rejects an invalid set without changes", () => {
    const document = financialDocument();
    const alice = friendFor(financeIds.alice, "Alice");
    const bob = friendFor(financeIds.bob, "Bob");

    upsertFriends(document, [
      { ...alice, name: "Bob" },
      { ...bob, name: "Alice" },
    ]);
    expect(readTripDocument(document).friends[alice.id]?.name).toBe("Bob");
    expect(readTripDocument(document).friends[bob.id]?.name).toBe("Alice");

    expect(() =>
      upsertFriends(document, [
        { ...alice, name: "Same" },
        { ...bob, name: "Same" },
      ]),
    ).toThrow("A tripmate with this name already exists");
    expect(readTripDocument(document).friends[alice.id]?.name).toBe("Bob");
    expect(readTripDocument(document).friends[bob.id]?.name).toBe("Alice");
    document.destroy();
  });

  it("resolves concurrent case-insensitive friend names, including archived reservations", () => {
    const source = financialDocument();
    upsertFriend(source, friendFor(financeIds.manual, "Casey (2)", true));
    const seed = Y.encodeStateAsUpdate(source);
    const first = new Y.Doc();
    const second = new Y.Doc();
    Y.applyUpdate(first, seed);
    Y.applyUpdate(second, seed);
    upsertFriend(first, friendFor(financeIds.other, "cAsEy", true));
    upsertFriend(second, friendFor(financeIds.newPayer, "Casey"));
    const firstUpdate = Y.encodeStateAsUpdate(first);
    const secondUpdate = Y.encodeStateAsUpdate(second);
    Y.applyUpdate(first, secondUpdate);
    Y.applyUpdate(second, firstUpdate);

    expect(readTripDocument(first).friends[financeIds.other]?.name).toBe("cAsEy");
    expect(readTripDocument(first).friends[financeIds.newPayer]?.name).toBe("Casey (3)");
    expect(readTripDocument(second).friends).toEqual(readTripDocument(first).friends);
    expect(() => upsertFriend(first, friendFor(financeIds.newShare, "casey (3)"))).toThrow(
      "already exists",
    );
    normalizeTripDocument(first);
    normalizeTripDocument(second);
    expect(first.getMap<Y.Map<unknown>>("friends").get(financeIds.newPayer)?.get("name")).toBe(
      "Casey (3)",
    );
    expect(readTripDocument(second).friends).toEqual(readTripDocument(first).friends);
  });

  it("preserves independent concurrent edits to different expense fields", () => {
    const source = financialDocument();
    upsertExpense(source, expenseFor(financeIds.shared));
    const seed = Y.encodeStateAsUpdate(source);
    const first = new Y.Doc();
    const second = new Y.Doc();
    Y.applyUpdate(first, seed);
    Y.applyUpdate(second, seed);

    upsertExpense(first, {
      ...expenseFor(financeIds.shared),
      description: "Edited lunch",
    });
    upsertExpense(second, {
      ...expenseFor(financeIds.shared),
      category: "transport",
    });
    const firstUpdate = Y.encodeStateAsUpdate(first);
    const secondUpdate = Y.encodeStateAsUpdate(second);
    Y.applyUpdate(first, secondUpdate);
    Y.applyUpdate(second, firstUpdate);

    expect(readTripDocument(first).expenses[financeIds.shared]).toMatchObject({
      description: "Edited lunch",
      category: "transport",
    });
    expect(readTripDocument(second).expenses[financeIds.shared]).toEqual(
      readTripDocument(first).expenses[financeIds.shared],
    );
  });

  it("rejects an occupied item, follows item dates, and detaches on deletion", () => {
    const document = financialDocument();
    addTripItem(document, itemForCreate("note", "2027-01-01", { id: "visit" }));
    const foreign = {
      ...expenseFor(financeIds.first, "visit"),
      currency: "USD",
      conversion: {
        amountMinor: 900,
        rate: 0.9,
        requestedDate: "2027-01-01",
        observedDate: "2027-01-01",
        source: "frankfurter",
        stale: false,
      },
    } satisfies Expense;
    upsertExpense(document, foreign);
    expect(() => upsertExpense(document, expenseFor(financeIds.second, "visit"))).toThrow(
      "already has",
    );

    updateTripItem(document, "visit", { dayId: "2027-01-02" });
    expect(readTripDocument(document).expenses[financeIds.first]).toMatchObject({
      date: "2027-01-02",
      conversion: { stale: true },
    });
    removeTripItem(document, "visit");
    expect(readTripDocument(document).expenses[financeIds.first]).toMatchObject({
      itemId: null,
      followsItemDate: false,
      date: null,
      category: "food",
      conversion: { stale: true },
    });
    addTripItem(document, itemForCreate("note", "2027-01-01", { id: "other-visit" }));
    upsertExpense(document, {
      ...expenseFor(financeIds.manualDate, "other-visit"),
      date: "2027-01-04",
      followsItemDate: false,
      category: "lodging",
    });
    removeTripItem(document, "other-visit");
    expect(readTripDocument(document).expenses[financeIds.manualDate]).toMatchObject({
      itemId: null,
      date: "2027-01-04",
      category: "lodging",
    });
  });

  it("clears a followed date on explicit detachment and stales its conversion", () => {
    const document = financialDocument();
    addTripItem(document, itemForCreate("note", "2027-01-01", { id: "visit" }));
    const linkedExpense: Expense = {
      ...expenseFor(financeIds.linked, "visit"),
      currency: "USD",
      conversion: {
        amountMinor: 900,
        rate: 0.9,
        requestedDate: "2027-01-01",
        observedDate: "2027-01-01",
        source: "frankfurter",
        stale: false,
      },
    };
    upsertExpense(document, linkedExpense);
    upsertExpense(document, {
      ...linkedExpense,
      itemId: null,
      followsItemDate: false,
    });
    expect(readTripDocument(document).expenses[financeIds.linked]).toMatchObject({
      itemId: null,
      date: null,
      followsItemDate: false,
      conversion: { stale: true },
    });
  });

  it("keeps manual and inbox-attached expenses undated until an item receives a date", () => {
    const document = financialDocument();
    addTripItem(document, itemForCreate("note", null, { id: "inbox" }));
    upsertExpense(document, { ...expenseFor(financeIds.manual), date: null });
    upsertExpense(document, expenseFor(financeIds.attached, "inbox"));
    expect(readTripDocument(document).expenses[financeIds.manual]?.date).toBeNull();
    expect(readTripDocument(document).expenses[financeIds.attached]?.date).toBeNull();

    updateTripItem(document, "inbox", { dayId: "2027-01-03" });
    expect(readTripDocument(document).expenses[financeIds.attached]?.date).toBe("2027-01-03");
    updateTripItem(document, "inbox", { dayId: null });
    expect(readTripDocument(document).expenses[financeIds.attached]?.date).toBeNull();
    expect(readTripDocument(document).expenses[financeIds.manual]?.date).toBeNull();
  });

  it("resolves concurrent attachments by the lowest expense ID and persists the loser as manual", () => {
    const source = financialDocument();
    addTripItem(source, itemForCreate("note", "2027-01-01", { id: "visit" }));
    const seed = Y.encodeStateAsUpdate(source);
    const first = new Y.Doc();
    const second = new Y.Doc();
    Y.applyUpdate(first, seed);
    Y.applyUpdate(second, seed);
    upsertExpense(first, expenseFor(financeIds.zExpense, "visit"));
    upsertExpense(second, expenseFor(financeIds.aExpense, "visit"));
    const firstUpdate = Y.encodeStateAsUpdate(first);
    const secondUpdate = Y.encodeStateAsUpdate(second);
    Y.applyUpdate(first, secondUpdate);
    Y.applyUpdate(second, firstUpdate);

    expect(readTripDocument(first).expenses[financeIds.zExpense]).toMatchObject({
      itemId: null,
      followsItemDate: false,
      date: null,
    });
    normalizeTripDocument(first);
    normalizeTripDocument(second);
    expect(
      first.getMap<Y.Map<unknown>>("expenses").get(financeIds.zExpense)?.get("itemId"),
    ).toBeNull();
    expect(readTripDocument(first).expenses[financeIds.aExpense]?.itemId).toBe("visit");
    expect(readTripDocument(second).expenses).toEqual(readTripDocument(first).expenses);
  });

  it("undoes a local field edit without reversing another editor's field on the same expense", () => {
    const source = financialDocument();
    upsertExpense(source, expenseFor(financeIds.shared));
    const seed = Y.encodeStateAsUpdate(source);
    const local = new Y.Doc();
    const remote = new Y.Doc();
    Y.applyUpdate(local, seed);
    Y.applyUpdate(remote, seed);
    const undo = new Y.UndoManager(local.getMap("expenses"), {
      trackedOrigins: new Set(["upsert-expense"]),
      captureTimeout: 0,
    });
    upsertExpense(local, { ...expenseFor(financeIds.shared), description: "Local description" });
    upsertExpense(remote, { ...expenseFor(financeIds.shared), category: "transport" });
    Y.applyUpdate(local, Y.encodeStateAsUpdate(remote));

    undo.undo();

    expect(readTripDocument(local).expenses[financeIds.shared]).toMatchObject({
      description: "Lunch",
      category: "transport",
    });
    undo.destroy();
  });

  it("rejects invalid settlements and requires an empty ledger to change currency", () => {
    const document = financialDocument();
    const settlement: Settlement = {
      id: financeIds.payment,
      fromId: financeIds.bob,
      toId: financeIds.alice,
      amountMinor: 300,
      currency: "EUR",
      conversion: {
        amountMinor: 300,
        rate: 1,
        requestedDate: null,
        observedDate: "2027-01-02",
        source: "identity",
        stale: false,
      },
      note: "",
      paidAt: "2027-01-02T12:00:00Z",
    };
    expect(() => upsertSettlement(document, { ...settlement, toId: financeIds.bob })).toThrow();
    expect(() => upsertSettlement(document, { ...settlement, amountMinor: -1 })).toThrow();
    upsertSettlement(document, settlement);
    expect(readTripDocument(document).settlements[financeIds.payment]?.amountMinor).toBe(300);
    expect(() => setTripCurrency(document, "USD")).toThrow("Rebase");
    removeSettlement(document, settlement.id);
    upsertExpense(document, expenseFor(financeIds.meal));
    removeExpense(document, financeIds.meal);
    setTripCurrency(document, "USD");
    expect(readTripDocument(document).currency).toBe("USD");
  });
});
