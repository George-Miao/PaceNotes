import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createInitialSnapshot, itemForCreate } from "../trip/model";
import {
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
      language: "en",
      distanceUnit: "metric",
      defaultTravelMode: "DRIVING",
      calendarHours: 24,
    });
  });

  it("updates all trip settings in one transaction", () => {
    const document = seedDocument();
    let transactions = 0;
    document.on("afterTransaction", (transaction) => {
      if (transaction.origin === "trip-settings") transactions += 1;
    });

    setTripSettings(document, {
      language: "fr",
      distanceUnit: "imperial",
      defaultTravelMode: "WALKING",
      calendarHours: 30,
    });

    expect(transactions).toBe(1);
    expect(readTripDocument(document)).toMatchObject({
      language: "fr",
      distanceUnit: "imperial",
      defaultTravelMode: "WALKING",
      calendarHours: 30,
    });
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

  it("deletes a middle day, shifts later planning days, and preserves lodging dates", () => {
    const document = seedDocument();
    addTripItem(document, itemForCreate("note", "2027-01-03", { id: "deleted-day" }));
    addTripItem(
      document,
      itemForCreate("reservation", "2027-01-04", {
        id: "later",
        place: { placeId: "station" },
        startTime: "12:00",
        reservation: { provider: "Rail", confirmation: "A1" },
      }),
    );
    addTripItem(
      document,
      itemForCreate("lodging", "2027-01-04", {
        id: "stay",
        place: { placeId: "hotel" },
        lodging: { startDate: "2027-01-01", endDate: "2027-01-05" },
      }),
    );

    deleteTripDay(document, "2027-01-03");
    const snapshot = readTripDocument(document);
    expect(snapshot.days.map((day) => day.date)).toEqual([
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
      "2027-01-04",
    ]);
    expect(snapshot.endDate).toBe("2027-01-04");
    expect(snapshot.items["deleted-day"]?.dayId).toBeNull();
    expect(snapshot.items.later?.dayId).toBe("2027-01-03");
    expect(snapshot.items.stay?.lodging).toEqual({
      startDate: "2027-01-01",
      endDate: "2027-01-05",
    });
  });

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

  it("clamps a lodging change to the 30-day trip limit", () => {
    const document = seedDocument();
    addTripItem(
      document,
      itemForCreate("lodging", "2027-01-02", {
        id: "calendar-stay",
        title: "Calendar stay",
        place: { placeId: "calendar-hotel" },
        lodging: {
          startDate: "2027-01-02",
          endDate: "2027-01-05",
        },
      }),
    );

    const clamped = applyCalendarItemChange(document, {
      id: "calendar-stay",
      patch: {
        dayId: "2027-02-15",
        startTime: null,
        lodging: {
          startDate: "2027-02-15",
          endDate: "2027-02-18",
        },
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
