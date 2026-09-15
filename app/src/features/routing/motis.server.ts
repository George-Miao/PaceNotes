import { z } from "zod";
import type {
  MotisRouteBatch,
  MotisRouteBatchResult,
  MotisRouteResult,
  RouteGeometryQuality,
  RoutePathPoint,
} from "./model";

const defaultTimeoutMs = 5_000;
const maximumTimeoutMs = 60_000;
const concurrency = 8;
const maximumResponseBytes = 8 * 1024 * 1024;
const maximumPolylinePoints = 200_000;
const transitStopRadiusMeters = 1_000;
const maximumDetailedSegmentMeters = 25_000;

const encodedPolylineSchema = z.object({
  points: z.string().max(maximumResponseBytes),
  precision: z.number().int().min(0).max(10),
  length: z.number().int().min(0).max(maximumPolylinePoints),
});

const planResponseSchema = z.object({
  itineraries: z
    .array(
      z.object({
        duration: z.number().int().nonnegative(),
        legs: z
          .array(
            z.object({
              mode: z.string().min(1).max(100),
              startTime: z.string().datetime({ offset: true }),
              endTime: z.string().datetime({ offset: true }),
              duration: z.number().int().nonnegative(),
              distance: z.number().nonnegative().optional(),
              legGeometry: encodedPolylineSchema,
            }),
          )
          .max(128),
      }),
    )
    .max(16),
});

export type RoutingProviderHealth = {
  status: "disabled" | "ready" | "degraded";
};

type MotisConfig = { baseUrl: string; timeoutMs: number };

export async function computeMotisRoutes(batch: MotisRouteBatch): Promise<MotisRouteBatchResult> {
  const config = readMotisConfig();
  if (!config) return fallbackBatch(batch);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const results = new Array<MotisRouteResult>(batch.routes.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, batch.routes.length) }, async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        const request = batch.routes[index];
        if (!request) return;
        results[index] = await computeMotisRoute(config.baseUrl, request, controller.signal);
      }
    });
    await Promise.all(workers);
    return { routes: results };
  } catch {
    return fallbackBatch(batch);
  } finally {
    clearTimeout(timeout);
  }
}

export async function readRoutingProviderHealth(): Promise<RoutingProviderHealth> {
  const config = readMotisConfig();
  if (!config) return { status: "disabled" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/api/v1/health`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    return { status: response.ok ? "ready" : "degraded" };
  } catch {
    return { status: "degraded" };
  } finally {
    clearTimeout(timeout);
  }
}

function readMotisConfig(): MotisConfig | null {
  const rawUrl = process.env.MOTIS_URL?.trim();
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const rawTimeout = process.env.MOTIS_TIMEOUT_MS?.trim();
    const timeoutMs = rawTimeout ? Number(rawTimeout) : defaultTimeoutMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > maximumTimeoutMs) return null;
    return { baseUrl: url.toString().replace(/\/$/, ""), timeoutMs };
  } catch {
    return null;
  }
}

async function computeMotisRoute(
  baseUrl: string,
  request: MotisRouteBatch["routes"][number],
  signal: AbortSignal,
): Promise<MotisRouteResult> {
  const url = new URL(`${baseUrl}/api/v6/plan`);
  url.searchParams.set("fromPlace", coordinates(request.from));
  url.searchParams.set("toPlace", coordinates(request.to));
  url.searchParams.set("transitModes", "TRANSIT");
  url.searchParams.set("radius", String(transitStopRadiusMeters));
  if (request.departureTime) url.searchParams.set("time", request.departureTime);

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("MOTIS request failed");
  const itinerary = planResponseSchema.parse(await readBoundedJson(response)).itineraries[0];
  if (!itinerary) return { id: request.id, state: "fallback" };

  let distanceMeters = 0;
  let hasCompleteDistance = itinerary.legs.length > 0;
  const path: RoutePathPoint[] = [];
  for (const leg of itinerary.legs) {
    if (leg.distance === undefined) {
      hasCompleteDistance = false;
    } else {
      distanceMeters += leg.distance;
    }
    const legPath = decodePolyline(leg.legGeometry.points, leg.legGeometry.precision);
    if (legPath.length !== leg.legGeometry.length) throw new Error("Invalid MOTIS geometry length");
    appendPath(path, legPath);
  }

  return {
    id: request.id,
    state: "ready",
    durationMillis: itinerary.duration * 1_000,
    distanceMeters: hasCompleteDistance ? distanceMeters : null,
    geometryQuality: routeGeometryQuality(path),
    path,
  };
}

function fallbackBatch(batch: MotisRouteBatch): MotisRouteBatchResult {
  return { routes: batch.routes.map(({ id }) => ({ id, state: "fallback" })) };
}

function coordinates(point: { latitude: number; longitude: number }): string {
  return `${point.latitude},${point.longitude}`;
}

function appendPath(target: RoutePathPoint[], source: RoutePathPoint[]): void {
  const first = source[0];
  const previous = target.at(-1);
  const start =
    first && previous && first.lat === previous.lat && first.lng === previous.lng ? 1 : 0;
  for (let index = start; index < source.length; index += 1) {
    const point = source[index];
    if (point) target.push(point);
  }
}

function routeGeometryQuality(path: RoutePathPoint[]): RouteGeometryQuality {
  if (path.length < 2) return "approximate";
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const current = path[index];
    if (!previous || !current) return "approximate";
    if (distanceBetween(previous, current) > maximumDetailedSegmentMeters) return "approximate";
  }
  return "detailed";
}

function distanceBetween(first: RoutePathPoint, second: RoutePathPoint): number {
  const radians = Math.PI / 180;
  const firstLatitude = first.lat * radians;
  const secondLatitude = second.lat * radians;
  const latitudeDelta = (second.lat - first.lat) * radians;
  const longitudeDelta = (second.lng - first.lng) * radians;
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function decodePolyline(encoded: string, precision: number): RoutePathPoint[] {
  const factor = 10 ** precision;
  const path: RoutePathPoint[] = [];
  let latitude = 0;
  let longitude = 0;
  let index = 0;

  while (index < encoded.length) {
    const latitudeResult = decodeValue(encoded, index);
    index = latitudeResult.index;
    latitude += latitudeResult.value;
    const longitudeResult = decodeValue(encoded, index);
    index = longitudeResult.index;
    longitude += longitudeResult.value;
    path.push({ lat: latitude / factor, lng: longitude / factor, altitude: 0 });
  }

  return path;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumResponseBytes) {
    throw new Error("MOTIS response is too large");
  }

  if (!response.body) return response.json();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumResponseBytes) {
      await reader.cancel();
      throw new Error("MOTIS response is too large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function decodeValue(encoded: string, start: number): { value: number; index: number } {
  let result = 0;
  let shift = 0;
  let index = start;
  while (index < encoded.length) {
    const value = encoded.charCodeAt(index) - 63;
    index += 1;
    result |= (value & 0x1f) << shift;
    if (value < 0x20) return { value: result & 1 ? ~(result >> 1) : result >> 1, index };
    shift += 5;
  }
  throw new Error("Invalid encoded polyline");
}
