import { z } from "zod";
import type { TravelMode } from "~/features/trip/model";

export type MapStop = {
  id: string;
  placeId: string;
  label: string;
  index: number;
  latitude: number;
  longitude: number;
  countryCode: string | null;
  color: string;
  textColor: string;
  travelMode: TravelMode;
  breakBefore?: boolean;
  departureTime?: string;
};

export type RoutePoint = {
  placeId: string;
  latitude: number;
  longitude: number;
};
export type RoutePathPoint = {
  lat: number;
  lng: number;
  altitude: number;
};
export type RouteGeometryQuality = "detailed" | "approximate";

export type RouteLeg = {
  fromId: string;
  toId: string;
  from: RoutePoint;
  to: RoutePoint;
  mode: TravelMode;
  color: string;
  durationMinutes: number | null;
  distanceMeters: number | null;
  geometryQuality: RouteGeometryQuality;
  path: RoutePathPoint[];
  state: "ready" | "stale" | "updating" | "unavailable";
};

export type MapTransport = {
  id: string;
  color: string;
  label: string;
  from: import("~/features/google/google").GooglePlaceView | null;
  to: import("~/features/google/google").GooglePlaceView | null;
};

export type RouteLegPlan = {
  id: string;
  stops: MapStop[];
};

const coordinateSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  countryCode: z.literal("JP"),
});

const departureTimeSchema = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), "Invalid departure time");

export const motisRouteBatchSchema = z.object({
  routes: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        from: coordinateSchema,
        to: coordinateSchema,
        departureTime: departureTimeSchema.optional(),
      }),
    )
    .max(500),
});

export type MotisRouteBatch = z.infer<typeof motisRouteBatchSchema>;

export type MotisRouteResult =
  | {
      id: string;
      state: "ready";
      durationMillis: number;
      distanceMeters: number | null;
      geometryQuality: RouteGeometryQuality;
      path: RoutePathPoint[];
    }
  | { id: string; state: "fallback" };

export type MotisRouteBatchResult = { routes: MotisRouteResult[] };

export type ComputedRoute = {
  durationMillis: number;
  distanceMeters: number | null;
  geometryQuality: RouteGeometryQuality;
  path: RoutePathPoint[];
};
