import { describe, expect, it } from "vitest";
import { itemForCreate, type TravelMode, type TripItem } from "./model";
import { findBestPlaceInsertion, type PlacementTravelTime } from "./place-placement";

const day = "2027-01-01";
const mode: TravelMode = "WALKING";

function place(id: string, startTime: string | null = null, durationMinutes = 60): TripItem {
  return itemForCreate("place", day, {
    id,
    title: id,
    place: { placeId: `google-${id}` },
    startTime,
    durationMinutes,
    travelMode: mode,
  });
}

function leg(fromId: string, toId: string, minutes: number): PlacementTravelTime {
  return { fromId, toId, mode, minutes };
}

function insertion(
  items: readonly TripItem[],
  candidate: TripItem,
  travelTimes: readonly PlacementTravelTime[],
  date = day,
  timeZone = "UTC",
): number {
  return findBestPlaceInsertion({ items, item: candidate, travelTimes, date, timeZone });
}

describe("smart place placement", () => {
  it("inserts where the place adds the least route time", () => {
    const items = [place("a"), place("b")];
    const candidate = place("new");
    const travelTimes = [
      leg("new", "a", 30),
      leg("a", "new", 5),
      leg("new", "b", 5),
      leg("a", "b", 20),
      leg("b", "new", 30),
    ];

    expect(insertion(items, candidate, travelTimes)).toBe(1);
  });

  it("prefers a schedule gap that fits over a cheaper route that does not", () => {
    const items = [place("a", "09:00"), place("b", "10:30"), place("c", "13:00")];
    const candidate = place("new");
    const travelTimes = [
      leg("new", "a", 100),
      leg("a", "new", 5),
      leg("new", "b", 5),
      leg("a", "b", 60),
      leg("b", "new", 10),
      leg("new", "c", 10),
      leg("b", "c", 60),
      leg("c", "new", 100),
    ];

    expect(insertion(items, candidate, travelTimes)).toBe(2);
  });

  it("counts existing open-item durations when checking a schedule gap", () => {
    const items = [
      place("a", "09:00"),
      itemForCreate("note", day, { id: "museum-notes", durationMinutes: 60 }),
      place("b", "11:00"),
    ];
    const candidate = place("new");
    const travelTimes = [
      leg("new", "a", 100),
      leg("a", "new", 0),
      leg("new", "b", 0),
      leg("a", "b", 0),
      leg("b", "new", 10),
    ];

    expect(insertion(items, candidate, travelTimes)).toBe(3);
  });

  it("uses elapsed time across a daylight-saving clock change", () => {
    const transitionDay = "2027-03-14";
    const items = [
      place("a", "01:00"),
      itemForCreate("note", transitionDay, { id: "open-stop", durationMinutes: 60 }),
      place("b", "04:00"),
    ];
    const candidate = itemForCreate("place", transitionDay, {
      ...place("new"),
      dayId: transitionDay,
    });
    const travelTimes = [
      leg("new", "a", 100),
      leg("a", "new", 0),
      leg("new", "b", 0),
      leg("a", "b", 0),
      leg("b", "new", 100),
    ];

    expect(insertion(items, candidate, travelTimes, transitionDay, "America/New_York")).toBe(3);
  });

  it("falls back to schedule fit when routing is unavailable", () => {
    const items = [place("a", "00:00", 1_000), place("b", "23:00", 60)];
    const candidate = place("new");

    expect(insertion(items, candidate, [])).toBe(1);
  });

  it("keeps the existing append behavior when every score ties", () => {
    const items = [
      itemForCreate("note", day, { id: "a", durationMinutes: 0 }),
      itemForCreate("note", day, { id: "b", durationMinutes: 0 }),
    ];
    const candidate = place("new", null, 0);
    const originalIds = items.map((item) => item.id);

    expect(insertion(items, candidate, [])).toBe(2);
    expect(items.map((item) => item.id)).toEqual(originalIds);
  });
});
