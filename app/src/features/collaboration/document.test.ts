import { describe, expect, it } from "vitest";
import * as Y from "yjs";
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
  setTripSettings,
  updateTripItem,
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
