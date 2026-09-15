import { describe, expect, it } from "vitest";
import type { RouteLeg } from "../routing/route-legs";
import {
  buildCalendarLayout,
  buildCalendarLodgingLayout,
  calendarMinuteForTime,
  calendarOrder,
  rollingTimeForCalendarMinute,
  timeForCalendarMinute,
} from "./calendar-layout";
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

    const [day] = buildCalendarLayout(days, [first, overlap, untimed], new Map(), 0);

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

  it("places a flexible transport after the prior ordered item", () => {
    const fixed = place("fixed", firstDay, "15:10");
    const flexible = itemForCreate("transport", firstDay, {
      id: "flexible-transport",
      title: "New transport",
      startTime: null,
      durationMinutes: 60,
    });

    const [day] = buildCalendarLayout(days, [fixed, flexible], new Map(), 0);

    expect(day?.segments.find((segment) => segment.item.id === flexible.id)).toMatchObject({
      startMinute: 970,
      endMinute: 1030,
      provisional: true,
    });
  });
  it("keeps a lodging lane through checkout and reports uncovered nights", () => {
    const lodgingDays: TripDay[] = [...days, { id: "2027-04-12", date: "2027-04-12" }];
    const boston = itemForCreate("lodging", firstDay, {
      id: "boston",
      title: "Boston",
      place: { placeId: "boston" },
      lodging: {
        startDate: firstDay,
        endDate: secondDay,
        leaveTimes: { [secondDay]: "09:00" },
      },
    });
    const surry = itemForCreate("lodging", secondDay, {
      id: "surry",
      title: "Surry",
      place: { placeId: "surry" },
      lodging: {
        startDate: secondDay,
        endDate: "2027-04-12",
        leaveTimes: { "2027-04-12": "09:00" },
      },
    });

    const layout = buildCalendarLodgingLayout(lodgingDays, [surry, boston]);

    expect(layout.bars.map((bar) => [bar.item.id, bar.lane])).toEqual([
      ["boston", 0],
      ["surry", 1],
    ]);
    expect(layout.laneCount).toBe(2);
    expect(layout.missingDayIds).toEqual(new Set());
    expect(buildCalendarLodgingLayout(lodgingDays, [boston]).missingDayIds).toEqual(
      new Set([secondDay]),
    );
  });

  it("orders a timed calendar change before flexible items on the same day", () => {
    const first = place("first", firstDay, null);
    const second = place("second", firstDay, null);
    const timed = place("timed", firstDay, "08:00");
    const items = { first, second, timed };
    const snapshot = { order: ["first", "second", "timed"], items, calendarStartHour: 0 as const };

    expect(calendarOrder(snapshot, timed)).toEqual(["timed", "first", "second"]);
  });

  it("uses the visual insertion point for a calendar drag", () => {
    const first = place("first", firstDay, null);
    const second = place("second", firstDay, null);
    const timed = place("timed", firstDay, "08:00");
    const items = { first, second, timed };
    const snapshot = { order: ["first", "second", "timed"], items, calendarStartHour: 0 as const };

    expect(calendarOrder(snapshot, timed, null)).toEqual(["first", "second", "timed"]);
    expect(calendarOrder(snapshot, timed, "second")).toEqual(["first", "timed", "second"]);
  });

  it("spaces a flexible item after its transportation leg", () => {
    const source = place("source", firstDay, "08:00");
    const flexible = place("flexible", firstDay, null);
    const leg: RouteLeg = {
      fromId: source.id,
      toId: flexible.id,
      from: { placeId: "source-place", latitude: 0, longitude: 0 },
      to: { placeId: "flexible-place", latitude: 1, longitude: 1 },
      mode: "DRIVING",
      color: "#000000",
      durationMinutes: 10,
      distanceMeters: 1,
      geometryQuality: "detailed",
      path: [],
      state: "ready",
    };

    const [day] = buildCalendarLayout(days, [source, flexible], new Map([[firstDay, [leg]]]), 0);

    expect(day?.segments.find((segment) => segment.item.id === flexible.id)).toMatchObject({
      startMinute: 555,
      provisional: true,
    });
    expect(day?.routeGaps).toEqual([
      expect.objectContaining({
        startMinute: 540,
        durationMinutes: 15,
        conflict: false,
      }),
    ]);
  });

  it("routes from a transport destination endpoint to the next flexible item", () => {
    const flight = itemForCreate("transport", firstDay, {
      id: "flight",
      title: "AA",
      durationMinutes: 60,
      transport: {
        from: { placeId: "airport-a" },
        to: { placeId: "airport-b" },
        mode: "plane",
        customMode: "",
      },
    });
    const destination = place("boston", firstDay, null);
    const leg: RouteLeg = {
      fromId: `${flight.id}:to`,
      toId: destination.id,
      from: { placeId: "airport-b", latitude: 0, longitude: 0 },
      to: { placeId: "boston-place", latitude: 1, longitude: 1 },
      mode: "TRANSIT",
      color: "#000000",
      durationMinutes: 30,
      distanceMeters: 1,
      geometryQuality: "detailed",
      path: [],
      state: "ready",
    };

    const [day] = buildCalendarLayout(days, [flight, destination], new Map([[firstDay, [leg]]]), 0);

    expect(day?.routeGaps).toEqual([
      expect.objectContaining({
        startMinute: 540,
        durationMinutes: 30,
        mode: "TRANSIT",
      }),
    ]);
    expect(day?.segments.find((segment) => segment.item.id === destination.id)).toMatchObject({
      startMinute: 570,
      provisional: true,
    });
  });

  it("starts a day at lodging and routes from its leave time", () => {
    const lodging = itemForCreate("lodging", firstDay, {
      id: "lodging",
      title: "Hotel",
      place: { placeId: "hotel" },
      lodging: {
        startDate: firstDay,
        endDate: secondDay,
        leaveTimes: { [secondDay]: "09:00" },
      },
    });
    const flexible = place("flexible", secondDay, null);
    const leg: RouteLeg = {
      fromId: `${lodging.id}:start`,
      toId: flexible.id,
      from: { placeId: "hotel", latitude: 0, longitude: 0 },
      to: { placeId: "flexible-place", latitude: 1, longitude: 1 },
      mode: "DRIVING",
      color: "#000000",
      durationMinutes: 30,
      distanceMeters: 1,
      geometryQuality: "detailed",
      path: [],
      state: "ready",
    };

    const layout = buildCalendarLayout(days, [lodging, flexible], new Map([[secondDay, [leg]]]), 0);

    expect(layout[1]?.stays).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({ id: lodging.id }),
        endMinute: 540,
      }),
    ]);
    expect(layout[1]?.routeGaps).toEqual([
      expect.objectContaining({ startMinute: 540, durationMinutes: 30, conflict: false }),
    ]);
    expect(layout[1]?.segments).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({ id: flexible.id }),
        startMinute: 570,
      }),
    ]);
  });
  it("starts a flexible item at lodging leave time before and while its route updates", () => {
    const lodging = itemForCreate("lodging", firstDay, {
      id: "updating-lodging",
      title: "Hotel",
      place: { placeId: "hotel" },
      lodging: {
        startDate: firstDay,
        endDate: secondDay,
        leaveTimes: { [secondDay]: "09:00" },
      },
    });
    const flexible = place("updating-flexible", secondDay, null);
    const leg: RouteLeg = {
      fromId: `${lodging.id}:start`,
      toId: flexible.id,
      from: { placeId: "hotel", latitude: 0, longitude: 0 },
      to: { placeId: "flexible-place", latitude: 1, longitude: 1 },
      mode: "DRIVING",
      color: "#000000",
      durationMinutes: null,
      distanceMeters: null,
      geometryQuality: "approximate",
      path: [],
      state: "updating",
    };

    const initialLayout = buildCalendarLayout(days, [lodging, flexible], new Map(), 0);
    expect(initialLayout[1]?.segments).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({ id: flexible.id }),
        startMinute: 540,
      }),
    ]);

    const layout = buildCalendarLayout(days, [lodging, flexible], new Map([[secondDay, [leg]]]), 0);

    expect(layout[1]?.segments).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({ id: flexible.id }),
        startMinute: 540,
      }),
    ]);
  });

  it("hides a lodging route when the next item begins before leave time", () => {
    const lodging = itemForCreate("lodging", firstDay, {
      id: "lodging-conflict",
      title: "Hotel",
      place: { placeId: "hotel" },
      lodging: {
        startDate: firstDay,
        endDate: secondDay,
        leaveTimes: { [secondDay]: "09:00" },
      },
    });
    const early = place("early", secondDay, "08:30");
    const leg: RouteLeg = {
      fromId: `${lodging.id}:start`,
      toId: early.id,
      from: { placeId: "hotel", latitude: 0, longitude: 0 },
      to: { placeId: "early-place", latitude: 1, longitude: 1 },
      mode: "DRIVING",
      color: "#000000",
      durationMinutes: 30,
      distanceMeters: 1,
      geometryQuality: "detailed",
      path: [],
      state: "ready",
    };

    const layout = buildCalendarLayout(days, [lodging, early], new Map([[secondDay, [leg]]]), 0);

    expect(layout[1]?.routeGaps).toEqual([]);
    expect(layout[1]?.stays).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({ id: lodging.id }),
        conflict: true,
      }),
    ]);
  });

  it("splits overnight items and keeps notes attached by itinerary order", () => {
    const leading = itemForCreate("note", firstDay, { id: "leading", title: "Leading" });
    const overnight = place("overnight", firstDay, "23:30", 120);
    const attached = itemForCreate("note", firstDay, { id: "attached", title: "Attached" });

    const layout = buildCalendarLayout(days, [leading, overnight, attached], new Map(), 0);

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
      durationMinutes: 120,
      distanceMeters: 1,
      geometryQuality: "detailed",
      path: [],
      state: "ready",
    };

    const layout = buildCalendarLayout(
      days,
      [source, destination],
      new Map([[firstDay, [leg]]]),
      0,
    );

    expect(layout[0]?.routeGaps).toEqual([
      expect.objectContaining({
        startMinute: 1380,
        durationMinutes: 60,
        mode: "DRIVING",
        conflict: true,
      }),
    ]);
    expect(layout[1]?.routeGaps).toEqual([
      expect.objectContaining({
        startMinute: 0,
        durationMinutes: 60,
        mode: "DRIVING",
        conflict: true,
      }),
    ]);
  });

  it("keeps route gaps in the source block lane", () => {
    const source = place("source", firstDay, "09:00");
    const overlap = place("overlap", firstDay, "09:30");
    const destination = place("destination", firstDay, "10:30");
    const leg: RouteLeg = {
      fromId: source.id,
      toId: destination.id,
      from: { placeId: "source-place", latitude: 0, longitude: 0 },
      to: { placeId: "destination-place", latitude: 1, longitude: 1 },
      mode: "DRIVING",
      color: "#000000",
      durationMinutes: 10,
      distanceMeters: 1,
      geometryQuality: "detailed",
      path: [],
      state: "ready",
    };

    const [day] = buildCalendarLayout(
      days,
      [source, overlap, destination],
      new Map([[firstDay, [leg]]]),
      0,
    );

    expect(day?.segments.find((segment) => segment.item.id === source.id)).toMatchObject({
      lane: 0,
      laneCount: 2,
    });
    expect(day?.routeGaps).toEqual([
      expect.objectContaining({
        lane: 0,
        laneCount: 2,
      }),
    ]);
  });

  it("starts a planning day at the selected hour and keeps rolling labels", () => {
    const morning = place("morning", firstDay, "06:00");
    const afterMidnight = place("after-midnight", firstDay, "02:00");
    const boundary = place("boundary", firstDay, "05:30", 60);

    const layout = buildCalendarLayout(days, [morning, afterMidnight, boundary], new Map(), 6);

    expect(layout[0]?.segments.find((segment) => segment.item.id === "morning")).toMatchObject({
      startMinute: 0,
      endMinute: 60,
    });
    expect(
      layout[0]?.segments.find((segment) => segment.item.id === "after-midnight"),
    ).toMatchObject({
      startMinute: 1200,
      endMinute: 1260,
    });
    expect(layout[0]?.segments.find((segment) => segment.item.id === "boundary")).toMatchObject({
      startMinute: 1410,
      endMinute: 1440,
      continuesAfter: true,
    });
    expect(layout[1]?.segments.find((segment) => segment.item.id === "boundary")).toMatchObject({
      startMinute: 0,
      endMinute: 30,
      continuesBefore: true,
    });
    expect(calendarMinuteForTime("05:30", 6)).toBe(1410);
    expect(timeForCalendarMinute(1410, 6)).toBe("05:30");
    expect(rollingTimeForCalendarMinute(1410, 6)).toBe("29:30");
  });
});
