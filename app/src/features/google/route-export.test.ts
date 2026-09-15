import { describe, expect, it } from "vitest";
import type { MapStop, RouteLeg } from "~/features/routing/route-legs";
import { buildDayRouteExport, googleMapsRouteUrl } from "./route-export";

const stops: MapStop[] = [
  stop("a", "place-a", 35.1, 139.1, "DRIVING"),
  stop("b", "place-b", 35.2, 139.2, "DRIVING"),
  stop("c", "place-c", 35.3, 139.3, "DRIVING"),
];

it("opens a Google Maps route with place IDs and ordered waypoints", () => {
  const url = googleMapsRouteUrl(stops, "DRIVING");
  expect(url).not.toBeNull();
  const parsed = new URL(url ?? "");
  expect(parsed.origin).toBe("https://www.google.com");
  expect(parsed.searchParams.get("origin_place_id")).toBe("place-a");
  expect(parsed.searchParams.get("destination_place_id")).toBe("place-c");
  expect(parsed.searchParams.get("waypoint_place_ids")).toBe("place-b");
  expect(parsed.searchParams.get("travelmode")).toBe("driving");
});

describe("whole-day route export", () => {
  it("requires every adjacent stop and one travel mode", () => {
    expect(
      buildDayRouteExport(stops, [leg(stops[0], stops[1]), leg(stops[1], stops[2])]),
    ).toMatchObject({
      reason: null,
    });

    expect(buildDayRouteExport(stops, [leg(stops[0], stops[1])])).toEqual({
      url: null,
      reason: "open-gap",
    });

    expect(
      buildDayRouteExport(stops, [leg(stops[0], stops[1]), leg(stops[1], stops[2], "WALKING")]),
    ).toEqual({ url: null, reason: "mixed-modes" });
  });

  it("rejects explicit gaps and unavailable routes", () => {
    const gapStops = stops.map((stop, index) =>
      index === 1 ? { ...stop, breakBefore: true } : stop,
    );
    expect(buildDayRouteExport(gapStops, [])).toEqual({ url: null, reason: "open-gap" });
    expect(
      buildDayRouteExport(stops, [
        leg(stops[0], stops[1]),
        { ...leg(stops[1], stops[2]), state: "unavailable" },
      ]),
    ).toEqual({ url: null, reason: "routes-unavailable" });

    const repeatedPlace = [
      stop("start", "same-lodging", 35.1, 139.1, "DRIVING"),
      stop("end", "same-lodging", 35.1, 139.1, "DRIVING"),
    ];
    expect(buildDayRouteExport(repeatedPlace, [leg(repeatedPlace[0], repeatedPlace[1])])).toEqual({
      url: null,
      reason: "open-gap",
    });
  });
});

function stop(
  id: string,
  placeId: string,
  latitude: number,
  longitude: number,
  travelMode: MapStop["travelMode"],
): MapStop {
  return {
    id,
    placeId,
    label: id,
    index: 1,
    latitude,
    longitude,
    countryCode: null,
    color: "#007bb8",
    textColor: "#fff",
    travelMode,
  };
}

function leg(
  from: MapStop | undefined,
  to: MapStop | undefined,
  mode: RouteLeg["mode"] = "DRIVING",
): RouteLeg {
  if (!from || !to) throw new Error("Test stop is missing");
  return {
    fromId: from.id,
    toId: to.id,
    from,
    to,
    mode,
    color: "#007bb8",
    durationMinutes: 10,
    distanceMeters: 1000,
    geometryQuality: "detailed",
    path: [],
    state: "ready",
  };
}
