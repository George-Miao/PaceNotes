import { useEffect, useState } from "react";
import type { TravelMode } from "~/features/trip/model";
import { loadRoutesLibrary } from "./google";

export type MapStop = {
  id: string;
  label: string;
  index: number;
  latitude: number;
  longitude: number;
  color: string;
  travelMode: TravelMode;
};

export type RouteLeg = {
  fromId: string;
  toId: string;
  mode: TravelMode;
  duration: string;
  durationMinutes: number | null;
  distance: string;
  path: google.maps.LatLngAltitudeLiteral[];
  state: "ready" | "stale" | "updating" | "unavailable";
};

export function useRouteLegs(stops: MapStop[]): RouteLeg[] {
  const [legs, setLegs] = useState<RouteLeg[]>([]);

  useEffect(() => {
    let disposed = false;
    if (stops.length < 2) {
      setLegs((current) => (current.length === 0 ? current : []));
      return;
    }
    setLegs((current) =>
      stops.slice(1).map((stop, index) => {
        const fromId = stops[index]?.id ?? "";
        const previous = current.find(
          (leg) => leg.fromId === fromId && leg.toId === stop.id && leg.mode === stop.travelMode,
        );
        return previous?.path.length
          ? { ...previous, state: "stale" }
          : {
              fromId,
              toId: stop.id,
              mode: stop.travelMode,
              duration: "",
              durationMinutes: null,
              distance: "",
              path: [],
              state: "updating",
            };
      }),
    );

    const timeout = window.setTimeout(async () => {
      try {
        const { Route } = await loadRoutesLibrary();
        const computed = await Promise.all(
          stops.slice(1).map(async (stop, index): Promise<RouteLeg> => {
            const from = stops[index];
            if (!from) throw new Error("Route origin is missing");
            try {
              const response = await Route.computeRoutes({
                origin: { lat: from.latitude, lng: from.longitude },
                destination: { lat: stop.latitude, lng: stop.longitude },
                travelMode: stop.travelMode,
                fields: ["path", "durationMillis", "distanceMeters"],
              });
              const route = response.routes?.[0];
              if (!route) throw new Error("No route returned");
              return {
                fromId: from.id,
                toId: stop.id,
                mode: stop.travelMode,
                duration: formatDuration(route.durationMillis ?? 0),
                durationMinutes: Math.max(1, Math.round((route.durationMillis ?? 0) / 60_000)),
                distance: formatDistance(route.distanceMeters ?? 0),
                path: route.path?.map((point) => point.toJSON()) ?? [],
                state: "ready",
              };
            } catch {
              return {
                fromId: from.id,
                toId: stop.id,
                mode: stop.travelMode,
                duration: "Route unavailable",
                durationMinutes: null,
                distance: "",
                path: [],
                state: "unavailable",
              };
            }
          }),
        );
        if (!disposed) {
          setLegs((current) =>
            computed.map((next) => {
              if (next.state !== "unavailable") return next;
              const previous = current.find(
                (leg) =>
                  leg.fromId === next.fromId && leg.toId === next.toId && leg.mode === next.mode,
              );
              return previous?.path.length ? { ...previous, state: "stale" } : next;
            }),
          );
        }
      } catch {
        if (!disposed) {
          setLegs((current) =>
            current.map((leg) =>
              leg.path.length > 0
                ? { ...leg, state: "stale" }
                : { ...leg, state: "unavailable", duration: "Route unavailable" },
            ),
          );
        }
      }
    }, 450);

    return () => {
      disposed = true;
      window.clearTimeout(timeout);
    };
  }, [stops]);

  return legs;
}

function formatDuration(milliseconds: number): string {
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

function formatDistance(meters: number): string {
  if (meters < 1_000) return `${Math.round(meters)} m`;
  return `${(meters / 1_000).toFixed(meters >= 10_000 ? 0 : 1)} km`;
}
