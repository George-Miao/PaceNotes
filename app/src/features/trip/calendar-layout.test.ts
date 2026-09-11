import { describe, expect, it } from "vitest";
import type { RouteLeg } from "../google/route-legs";
import { buildCalendarLayout } from "./calendar-layout";
import { itemForCreate, type TripDay } from "./model";

const days: TripDay[] = [
  { id: "2027-04-10", date: "2027-04-10" },
  { id: "2027-04-11", date: "2027-04-11" },
];

const firstDay = days[0]?.id ?? "";
const secondDay = days[1]?.id ?? "";

function place(id: string, dayId: string, startTime: string | null, durationMinutes = 60) {
  return itemForCreate("place", dayId, { id, title: id, startTime, durationMinutes });
}

describe("calendar layout", () => {
  it("places untimed items after occupied slots and assigns overlap lanes", () => {
    const first = place("first", firstDay, "08:00", 120);
    const overlap = place("overlap", firstDay, "09:00");
    const untimed = place("untimed", firstDay, null);

    const [day] = buildCalendarLayout(days, [first, overlap, untimed], new Map());

    expect(day?.segments.map((segment) => [segment.item.id, segment.startMinute])).toEqual([
      ["first", 480],
      ["overlap", 540],
      ["untimed", 600],
    ]);
    expect(day?.segments.filter((segment) => segment.item.id !== "untimed")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ item: expect.objectContaining({ id: "first" }), laneCount: 2 }),
        expect.objectContaining({ item: expect.objectContaining({ id: "overlap" }), laneCount: 2 }),
      ]),
    );
    expect(day?.segments.find((segment) => segment.item.id === "untimed")?.provisional).toBe(true);
  });

  it("splits overnight items and keeps notes attached by itinerary order", () => {
    const leading = itemForCreate("note", firstDay, { id: "leading", title: "Leading" });
    const overnight = place("overnight", firstDay, "23:30", 120);
    const attached = itemForCreate("note", firstDay, { id: "attached", title: "Attached" });

    const layout = buildCalendarLayout(days, [leading, overnight, attached], new Map());

    expect(layout[0]?.segments[0]).toMatchObject({
      item: { id: "overnight" },
      startMinute: 1410,
      endMinute: 1440,
      continuesAfter: true,
    });
    expect(layout[1]?.segments[0]).toMatchObject({
      item: { id: "overnight" },
      startMinute: 0,
      endMinute: 90,
      continuesBefore: true,
    });
    expect(layout[0]?.noteGroups).toEqual([
      { anchorItemId: null, notes: [expect.objectContaining({ id: "leading" })] },
      { anchorItemId: "overnight", notes: [expect.objectContaining({ id: "attached" })] },
    ]);
  });

  it("splits route gaps across midnight and marks a short gap as a conflict", () => {
    const source = place("source", firstDay, "22:30", 30);
    const destination = place("destination", secondDay, "00:30", 60);
    const leg: RouteLeg = {
      fromId: source.id,
      toId: destination.id,
      from: { placeId: "source-place", latitude: 0, longitude: 0 },
      to: { placeId: "destination-place", latitude: 1, longitude: 1 },
      mode: "DRIVING",
      color: "#000000",
      duration: "2 hr",
      durationMinutes: 120,
      distanceMeters: 1,
      path: [],
      state: "ready",
    };

    const layout = buildCalendarLayout(days, [source, destination], new Map([[firstDay, [leg]]]));

    expect(layout[0]?.routeGaps).toEqual([
      expect.objectContaining({ startMinute: 1380, durationMinutes: 60, conflict: true }),
    ]);
    expect(layout[1]?.routeGaps).toEqual([
      expect.objectContaining({ startMinute: 0, durationMinutes: 60, conflict: true }),
    ]);
  });
});
