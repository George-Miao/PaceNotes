import type { TravelMode } from "../trip/model";
import type { PlacementTravelTime } from "../trip/place-placement";
import { loadRoutesLibrary } from "./google";

export type PlacementRouteStop = {
  id: string;
  latitude: number;
  longitude: number;
  travelMode: TravelMode;
};

/**
 * Reads every route involving the candidate in bounded matrix batches. A
 * provider failure returns the successful partial result so the placement
 * module can fall back to schedule fit.
 */
export async function readGooglePlacementTravelTimes(
  stops: readonly PlacementRouteStop[],
  candidate: PlacementRouteStop,
): Promise<PlacementTravelTime[]> {
  if (stops.length === 0) return [];

  try {
    const { RouteMatrix } = await loadRoutesLibrary();
    const outboundByMode = new Map<TravelMode, PlacementRouteStop[]>();
    for (const stop of stops) {
      const group = outboundByMode.get(stop.travelMode) ?? [];
      group.push(stop);
      outboundByMode.set(stop.travelMode, group);
    }

    const inboundPromises = chunks(stops, matrixLimit(candidate.travelMode)).map((origins) =>
      readInbound(RouteMatrix, origins, candidate),
    );
    const outboundPromises = [...outboundByMode.entries()].flatMap(([mode, destinations]) =>
      chunks(destinations, matrixLimit(mode)).map((batch) =>
        readOutbound(RouteMatrix, candidate, batch, mode),
      ),
    );
    const results = await Promise.all([...inboundPromises, ...outboundPromises]);
    return results.flat();
  } catch {
    return [];
  }
}

async function readInbound(
  RouteMatrix: typeof google.maps.routes.RouteMatrix,
  origins: readonly PlacementRouteStop[],
  candidate: PlacementRouteStop,
): Promise<PlacementTravelTime[]> {
  try {
    const { matrix } = await RouteMatrix.computeRouteMatrix({
      origins: origins.map(locationOf),
      destinations: [locationOf(candidate)],
      travelMode: candidate.travelMode,
      fields: ["durationMillis"],
    });
    return matrix.rows.flatMap((row, index) => {
      const origin = origins[index];
      const minutes = routeMinutes(row.items[0]);
      return origin && minutes !== null
        ? [{ fromId: origin.id, toId: candidate.id, mode: candidate.travelMode, minutes }]
        : [];
    });
  } catch {
    return [];
  }
}

async function readOutbound(
  RouteMatrix: typeof google.maps.routes.RouteMatrix,
  candidate: PlacementRouteStop,
  destinations: readonly PlacementRouteStop[],
  mode: TravelMode,
): Promise<PlacementTravelTime[]> {
  try {
    const { matrix } = await RouteMatrix.computeRouteMatrix({
      origins: [locationOf(candidate)],
      destinations: destinations.map(locationOf),
      travelMode: mode,
      fields: ["durationMillis"],
    });
    const items = matrix.rows[0]?.items ?? [];
    return items.flatMap((route, index) => {
      const destination = destinations[index];
      const minutes = routeMinutes(route);
      return destination && minutes !== null
        ? [{ fromId: candidate.id, toId: destination.id, mode, minutes }]
        : [];
    });
  } catch {
    return [];
  }
}

function matrixLimit(mode: TravelMode): number {
  return mode === "TRANSIT" ? 100 : 625;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function locationOf(stop: PlacementRouteStop): google.maps.LatLngLiteral {
  return { lat: stop.latitude, lng: stop.longitude };
}

function routeMinutes(route: google.maps.routes.RouteMatrixItem | undefined): number | null {
  const milliseconds = route?.durationMillis;
  if (milliseconds === null || milliseconds === undefined || !Number.isFinite(milliseconds)) {
    return null;
  }
  return Math.max(1, Math.round(milliseconds / 60_000));
}
