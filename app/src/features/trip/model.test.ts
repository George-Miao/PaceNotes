import { describe, expect, it } from "vitest";
import {
  arrivalTimeFor,
  createInitialSnapshot,
  durationBetween,
  itemForCreate,
  newTripSchema,
  reorder,
  resolveLocalTime,
  tripDates,
  tripItemSchema,
} from "./model";

const destination = {
  placeId: "place-1",
};

describe("trip model", () => {
  it("creates one fixed-date day for each date in the inclusive range", () => {
    const snapshot = createInitialSnapshot("trip-1", {
      title: "Japan route",
      startDate: "2027-01-01",
      endDate: "2027-01-03",
      destination,
      timeZone: "Asia/Tokyo",
    });

    expect(snapshot.days).toEqual([
      { id: "2027-01-01", date: "2027-01-01" },
      { id: "2027-01-02", date: "2027-01-02" },
      { id: "2027-01-03", date: "2027-01-03" },
    ]);
    expect(snapshot.timeZone).toBe("Asia/Tokyo");
    expect(snapshot).toMatchObject({
      language: "en",
      distanceUnit: "metric",
      defaultTravelMode: "DRIVING",
      calendarHours: 24,
    });
  });

  it("keeps only the Google Place ID in the validated trip", () => {
    const parsed = newTripSchema.parse({
      title: "Japan route",
      startDate: "2027-01-01",
      endDate: "2027-01-03",
      destination: { placeId: "place-1", name: "Google name", address: "Google address" },
      timeZone: "Asia/Tokyo",
    });

    expect(parsed.destination).toEqual({ placeId: "place-1" });
  });

  it("keeps only the Google Place ID in a validated itinerary item", () => {
    const parsed = tripItemSchema.parse({
      ...itemForCreate("place", "2027-01-01"),
      place: { placeId: "place-2", name: "Google name", latitude: 35 },
    });

    expect(parsed.place).toEqual({ placeId: "place-2" });
  });

  it("rejects an empty title for an item without an automatic place label", () => {
    expect(() => itemForCreate("note", null, { title: "   " })).toThrow();
  });

  it("keeps notes untimed even when older data contains timing fields", () => {
    expect(
      itemForCreate("note", "2027-01-01", {
        title: "Untimed note",
        startTime: "09:30",
        durationMinutes: 90,
      }),
    ).toMatchObject({ startTime: null, durationMinutes: 0 });
  });

  it("requires a selected place for new reservations and lodging", () => {
    expect(() => itemForCreate("reservation", "2027-01-01")).toThrow();
    expect(
      itemForCreate("reservation", "2027-01-01", {
        place: destination,
        startTime: "19:30",
      }).title,
    ).toBe("");
    expect(() => itemForCreate("lodging", "2027-01-01")).toThrow();
    expect(itemForCreate("lodging", "2027-01-01", { place: destination }).title).toBe("");
  });

  it("requires a date and time for new reservations", () => {
    expect(() =>
      itemForCreate("reservation", null, { place: destination, startTime: "19:30" }),
    ).toThrow("Choose a date and time");
    expect(() => itemForCreate("reservation", "2027-01-01", { place: destination })).toThrow(
      "Choose a date and time",
    );
  });

  it("allows either transport endpoint and rejects an unnamed custom method", () => {
    const item = itemForCreate("transport", null);
    expect(
      tripItemSchema.parse({
        ...item,
        transport: {
          mode: "plane",
          customMode: "",
          from: { ...destination, name: "Google name" },
          to: null,
        },
      }).transport,
    ).toEqual({ mode: "plane", customMode: "", from: destination, to: null });
    expect(
      tripItemSchema.safeParse({
        ...item,
        transport: { mode: "custom", customMode: " ", from: null, to: destination },
      }).success,
    ).toBe(false);
    expect(
      tripItemSchema.parse({
        ...item,
        transport: { mode: "custom", customMode: "Cable car", from: null, to: destination },
      }).transport?.to,
    ).toEqual(destination);
    expect(
      tripItemSchema.safeParse({
        ...item,
        transport: { mode: "plane", customMode: "", from: { placeId: "" }, to: null },
      }).success,
    ).toBe(false);
  });

  it("converts transport departure, arrival, and overnight durations", () => {
    expect(arrivalTimeFor("09:00", 90)).toBe("10:30");
    expect(durationBetween("09:00", "10:30")).toBe(90);
    expect(arrivalTimeFor("23:30", 105)).toBe("01:15");
    expect(durationBetween("23:30", "01:15")).toBe(105);
    expect(durationBetween("09:00", "09:00")).toBe(0);
  });

  it("shows the clock arrival for transport durations longer than one day", () => {
    expect(arrivalTimeFor("09:00", 25 * 60)).toBe("10:00");
  });

  it("preserves older items without transport metadata", () => {
    const { transport: _, ...legacy } = itemForCreate("note", "2027-01-01", {
      title: "Keep this note",
    });
    expect(tripItemSchema.parse(legacy)).toMatchObject({
      title: "Keep this note",
      transport: null,
    });
  });

  it("rejects a trip longer than 30 days", () => {
    expect(() =>
      newTripSchema.parse({
        title: "Too long",
        startDate: "2027-01-01",
        endDate: "2027-02-01",
        destination,
        timeZone: "Asia/Tokyo",
      }),
    ).toThrow();
  });

  it("does not return more than the validation limit while calculating dates", () => {
    expect(tripDates("2027-01-01", "2027-12-31")).toHaveLength(31);
  });

  it("rejects a local time in a daylight-saving gap", () => {
    expect(() => resolveLocalTime("2027-03-14", "02:30", "America/New_York")).toThrow();
  });

  it("moves an item without changing the input order", () => {
    const input = ["a", "b", "c"];
    expect(reorder(input, 0, 2)).toEqual(["b", "c", "a"]);
    expect(input).toEqual(["a", "b", "c"]);
  });
});
