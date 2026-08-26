import { describe, expect, it } from "vitest";
import {
  createInitialSnapshot,
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

  it("rejects a trip longer than 30 days", () => {
    expect(() =>
      newTripSchema.parse({
        title: "Too long",
        startDate: "2027-01-01",
        endDate: "2027-02-01",
        destination,
        timeZone: "Asia/Tokyo",
      }),
    ).toThrow(/at most 30 days/);
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
