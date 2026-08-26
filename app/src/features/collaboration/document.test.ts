import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createInitialSnapshot, itemForCreate } from "../trip/model";
import {
  addTripItem,
  deleteTripDay,
  initializeTripDocument,
  readTripDocument,
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
  it("returns a loading snapshot for an empty document", () => {
    expect(readTripDocument(new Y.Doc()).destination).toEqual({ placeId: "" });
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

  it("deletes a middle day, shifts later planning days, and preserves lodging dates", () => {
    const document = seedDocument();
    addTripItem(document, itemForCreate("note", "2027-01-03", { id: "deleted-day" }));
    addTripItem(
      document,
      itemForCreate("reservation", "2027-01-04", {
        id: "later",
        reservation: { provider: "Rail", confirmation: "A1", bookingDate: "2027-01-04" },
      }),
    );
    addTripItem(
      document,
      itemForCreate("lodging", "2027-01-04", {
        id: "stay",
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
    expect(snapshot.items.later?.reservation?.bookingDate).toBe("2027-01-03");
    expect(snapshot.items.stay?.lodging).toEqual({
      startDate: "2027-01-01",
      endDate: "2027-01-05",
    });
  });
});
