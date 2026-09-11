import type { TravelMode } from "~/features/trip/model";
import type { MapStop, RouteLeg } from "./route-legs";

export type DayRouteExportReason =
  | "not-enough-places"
  | "open-gap"
  | "mixed-modes"
  | "routes-unavailable";

export type DayRouteExport =
  | { url: string; reason: null }
  | { url: null; reason: DayRouteExportReason };

type RoutePoint = Pick<MapStop, "placeId" | "latitude" | "longitude">;

export function googleMapsRouteUrl(stops: readonly RoutePoint[], mode: TravelMode): string | null {
  const origin = stops[0];
  const destination = stops.at(-1);
  if (!origin || !destination || stops.length < 2) return null;

  const parameters = new URLSearchParams({
    api: "1",
    origin: coordinates(origin),
    origin_place_id: origin.placeId,
    destination: coordinates(destination),
    destination_place_id: destination.placeId,
    travelmode: mode.toLowerCase(),
  });
  const waypoints = stops.slice(1, -1);
  if (waypoints.length > 0) {
    parameters.set("waypoints", waypoints.map(coordinates).join("|"));
    parameters.set("waypoint_place_ids", waypoints.map((stop) => stop.placeId).join("|"));
  }
  return `https://www.google.com/maps/dir/?${parameters.toString()}`;
}

export function buildDayRouteExport(
  stops: readonly MapStop[],
  legs: readonly RouteLeg[],
): DayRouteExport {
  if (stops.length < 2) return { url: null, reason: "not-enough-places" };
  if (stops.slice(1).some((stop, index) => stop.placeId === stops[index]?.placeId)) {
    return { url: null, reason: "open-gap" };
  }
  if (stops.slice(1).some((stop) => stop.breakBefore)) return { url: null, reason: "open-gap" };
  const routeLegs = stops.slice(1).map((stop, index) => {
    const from = stops[index];
    return from ? legs.find((leg) => leg.fromId === from.id && leg.toId === stop.id) : undefined;
  });
  if (routeLegs.some((leg) => !leg)) return { url: null, reason: "open-gap" };
  const availableLegs = routeLegs.filter((leg): leg is RouteLeg => Boolean(leg));
  if (availableLegs.some((leg) => leg.state !== "ready" && leg.state !== "stale")) {
    return { url: null, reason: "routes-unavailable" };
  }
  const mode = availableLegs[0]?.mode;
  if (!mode) return { url: null, reason: "routes-unavailable" };
  if (availableLegs.some((leg) => leg.mode !== mode)) {
    return { url: null, reason: "mixed-modes" };
  }
  const url = googleMapsRouteUrl(stops, mode);
  return url ? { url, reason: null } : { url: null, reason: "not-enough-places" };
}

function coordinates(point: RoutePoint): string {
  return `${point.latitude},${point.longitude}`;
}
