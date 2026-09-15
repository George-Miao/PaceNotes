import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeDepartureTime } from "./route-legs";

describe("route departure time", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("omits past and near-current provider timestamps", () => {
    expect(routeDepartureTime("DRIVING", "2026-09-10T09:00:00Z")).toBeUndefined();
    expect(routeDepartureTime("TRANSIT", "2026-09-11T12:00:30Z")).toBeUndefined();
  });

  it("keeps future driving and transit timestamps", () => {
    expect(routeDepartureTime("DRIVING", "2026-09-11T12:01:00Z")?.toISOString()).toBe(
      "2026-09-11T12:01:00.000Z",
    );
    expect(routeDepartureTime("TRANSIT", "2026-09-12T09:00:00Z")?.toISOString()).toBe(
      "2026-09-12T09:00:00.000Z",
    );
  });

  it("omits departure timestamps for walking routes", () => {
    expect(routeDepartureTime("WALKING", "2026-09-12T09:00:00Z")).toBeUndefined();
  });
});
