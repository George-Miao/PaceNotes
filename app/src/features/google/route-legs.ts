import { useEffect, useRef, useState } from "react";
import { createTripText, languageTag } from "~/features/trip/language";
import type { TravelMode, TripLanguage } from "~/features/trip/model";
import { type GooglePlaceView, loadRoutesLibrary } from "./google";

export type MapStop = {
  id: string;
  placeId: string;
  label: string;
  index: number;
  latitude: number;
  longitude: number;
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

export type RouteLeg = {
  fromId: string;
  toId: string;
  from: RoutePoint;
  to: RoutePoint;
  mode: TravelMode;
  color: string;
  duration: string;
  durationMinutes: number | null;
  distanceMeters: number | null;
  path: google.maps.LatLngAltitudeLiteral[];
  state: "ready" | "stale" | "updating" | "unavailable";
};

export type MapTransport = {
  id: string;
  color: string;
  label: string;
  from: GooglePlaceView | null;
  to: GooglePlaceView | null;
};

export type RouteLegPlan = {
  id: string;
  stops: MapStop[];
};

export function useRouteLegs(
  plans: RouteLegPlan[],
  language: TripLanguage,
): ReadonlyMap<string, RouteLeg[]> {
  const [legsByPlan, setLegsByPlan] = useState<ReadonlyMap<string, RouteLeg[]>>(() => new Map());
  const plansRef = useRef(plans);
  const completedKeys = useRef(new Map<string, string>());
  const tasks = useRef(new Map<string, { key: string; cancel: () => void }>());
  plansRef.current = plans;
  const routeKey = routePlansInputKey(plans, language);
  const colorKey = routePlansColorKey(plans);

  useEffect(
    () => () => {
      for (const task of tasks.current.values()) task.cancel();
      tasks.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (routeKey !== routePlansInputKey(plansRef.current, language)) return;
    const activePlanIds = new Set(plansRef.current.map((plan) => plan.id));
    for (const [planId, task] of tasks.current) {
      if (activePlanIds.has(planId)) continue;
      task.cancel();
      tasks.current.delete(planId);
      completedKeys.current.delete(planId);
    }
    setLegsByPlan((current) => {
      if ([...current.keys()].every((planId) => activePlanIds.has(planId))) return current;
      return new Map([...current].filter(([planId]) => activePlanIds.has(planId)));
    });
    for (const plan of plansRef.current) {
      const planKey = `${language}:${routePlanInputKey(plan)}`;
      const activeTask = tasks.current.get(plan.id);
      if (completedKeys.current.get(plan.id) === planKey || activeTask?.key === planKey) continue;
      activeTask?.cancel();
      tasks.current.delete(plan.id);

      const pairs = plan.stops.flatMap((stop, index) => {
        const from = plan.stops[index - 1];
        return from && !stop.breakBefore && from.placeId !== stop.placeId ? [{ from, stop }] : [];
      });
      setLegsByPlan((current) => {
        const currentLegs = current.get(plan.id) ?? [];
        const next = new Map(current);
        next.set(
          plan.id,
          pairs.map(({ from, stop }) => {
            const previous = currentLegs.find(
              (leg) =>
                leg.fromId === from.id && leg.toId === stop.id && leg.mode === stop.travelMode,
            );
            return previous?.path.length
              ? { ...previous, color: stop.color, state: "stale" }
              : {
                  fromId: from.id,
                  toId: stop.id,
                  from: routePoint(from),
                  to: routePoint(stop),
                  mode: stop.travelMode,
                  color: stop.color,
                  duration: "",
                  durationMinutes: null,
                  distanceMeters: null,
                  path: [],
                  state: "updating",
                };
          }),
        );
        return next;
      });
      if (pairs.length === 0) {
        completedKeys.current.set(plan.id, planKey);
        continue;
      }

      let cancelled = false;
      const timeout = window.setTimeout(async () => {
        try {
          const { Route, RoutingPreference } = await loadRoutesLibrary(language);
          const computed = await Promise.all(
            pairs.map(async ({ from, stop }): Promise<RouteLeg> => {
              try {
                const departureTime =
                  stop.travelMode === "DRIVING" || stop.travelMode === "TRANSIT"
                    ? from.departureTime
                    : undefined;
                const response = await Route.computeRoutes({
                  origin: { lat: from.latitude, lng: from.longitude },
                  destination: { lat: stop.latitude, lng: stop.longitude },
                  travelMode: stop.travelMode,
                  ...(departureTime ? { departureTime: new Date(departureTime) } : {}),
                  ...(departureTime && stop.travelMode === "DRIVING"
                    ? { routingPreference: RoutingPreference.TRAFFIC_AWARE }
                    : {}),
                  language: languageTag(language),
                  fields: ["path", "durationMillis", "distanceMeters"],
                });
                const route = response.routes?.[0];
                if (!route) throw new Error("No route returned");
                return {
                  fromId: from.id,
                  toId: stop.id,
                  from: routePoint(from),
                  to: routePoint(stop),
                  mode: stop.travelMode,
                  color: stop.color,
                  duration: formatDuration(route.durationMillis ?? 0, language),
                  durationMinutes: Math.max(1, Math.round((route.durationMillis ?? 0) / 60_000)),
                  distanceMeters: route.distanceMeters ?? null,
                  path: route.path?.map((point) => point.toJSON()) ?? [],
                  state: "ready",
                };
              } catch {
                return {
                  fromId: from.id,
                  toId: stop.id,
                  from: routePoint(from),
                  to: routePoint(stop),
                  mode: stop.travelMode,
                  color: stop.color,
                  duration: createTripText(language)("routeUnavailable"),
                  durationMinutes: null,
                  distanceMeters: null,
                  path: [],
                  state: "unavailable",
                };
              }
            }),
          );
          const task = tasks.current.get(plan.id);
          if (cancelled || task?.key !== planKey) return;
          setLegsByPlan((current) => {
            const currentLegs = current.get(plan.id) ?? [];
            const next = new Map(current);
            next.set(
              plan.id,
              computed.map((leg) => {
                if (leg.state !== "unavailable") return leg;
                const previous = currentLegs.find(
                  (candidate) =>
                    candidate.fromId === leg.fromId &&
                    candidate.toId === leg.toId &&
                    candidate.mode === leg.mode,
                );
                return previous?.path.length ? { ...previous, state: "stale" } : leg;
              }),
            );
            return next;
          });
          completedKeys.current.set(plan.id, planKey);
          tasks.current.delete(plan.id);
        } catch {
          const task = tasks.current.get(plan.id);
          if (cancelled || task?.key !== planKey) return;
          setLegsByPlan((current) => {
            const next = new Map(current);
            next.set(
              plan.id,
              (current.get(plan.id) ?? []).map((leg) =>
                leg.path.length > 0
                  ? { ...leg, state: "stale" }
                  : {
                      ...leg,
                      state: "unavailable",
                      duration: createTripText(language)("routeUnavailable"),
                    },
              ),
            );
            return next;
          });
          completedKeys.current.set(plan.id, planKey);
          tasks.current.delete(plan.id);
        }
      }, 450);
      tasks.current.set(plan.id, {
        key: planKey,
        cancel: () => {
          cancelled = true;
          window.clearTimeout(timeout);
        },
      });
    }
  }, [routeKey, language]);

  useEffect(() => {
    if (colorKey !== routePlansColorKey(plansRef.current)) return;
    const colorsByPlan = new Map(
      plansRef.current.map((plan) => [
        plan.id,
        new Map(plan.stops.map((stop) => [stop.id, stop.color])),
      ]),
    );
    setLegsByPlan((current) => {
      let changed = false;
      const next = new Map(current);
      for (const [planId, colors] of colorsByPlan) {
        const legs = current.get(planId);
        if (!legs) continue;
        let planChanged = false;
        const nextLegs = legs.map((leg) => {
          const color = colors.get(leg.toId);
          if (!color || color === leg.color) return leg;
          changed = true;
          planChanged = true;
          return { ...leg, color };
        });
        if (planChanged) next.set(planId, nextLegs);
      }
      return changed ? next : current;
    });
  }, [colorKey]);

  const activePlanIds = new Set(plans.map((plan) => plan.id));
  if ([...legsByPlan.keys()].every((planId) => activePlanIds.has(planId))) return legsByPlan;
  return new Map([...legsByPlan].filter(([planId]) => activePlanIds.has(planId)));
}

function routePlansInputKey(plans: RouteLegPlan[], language: TripLanguage): string {
  return `${language}:${JSON.stringify(plans.map((plan) => [plan.id, routePlanInputKey(plan)]))}`;
}

function routePlanInputKey(plan: RouteLegPlan): string {
  return JSON.stringify(
    plan.stops.map((stop) => [
      stop.id,
      stop.placeId,
      stop.travelMode,
      stop.breakBefore === true,
      stop.departureTime ?? null,
    ]),
  );
}

function routePlansColorKey(plans: RouteLegPlan[]): string {
  return JSON.stringify(
    plans.map((plan) => [plan.id, plan.stops.map((stop) => [stop.id, stop.color])]),
  );
}

function formatDuration(milliseconds: number, language: TripLanguage): string {
  const totalMinutes = Math.max(1, Math.round(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const format = (value: number, unit: "hour" | "minute") =>
    new Intl.NumberFormat(languageTag(language), {
      style: "unit",
      unit,
      unitDisplay: "short",
    }).format(value);
  return [hours ? format(hours, "hour") : "", minutes ? format(minutes, "minute") : ""]
    .filter(Boolean)
    .join(" ");
}

function routePoint(stop: MapStop): RoutePoint {
  return {
    placeId: stop.placeId,
    latitude: stop.latitude,
    longitude: stop.longitude,
  };
}
