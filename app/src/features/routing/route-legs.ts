import { useEffect, useRef, useState } from "react";
import { createGoogleRouteAdapter } from "~/features/google/route-adapter";
import type { TravelMode, TripLanguage } from "~/features/trip/model";
import type {
  ComputedRoute,
  MapStop,
  MotisRouteResult,
  RouteLeg,
  RouteLegPlan,
  RoutePoint,
} from "./model";
import { readMotisRoutes } from "./routes.functions";

export type { MapStop, MapTransport, RouteLeg, RouteLegPlan, RoutePoint } from "./model";

const minimumFutureDepartureMs = 60_000;

type RoutePair = {
  id: string;
  planId: string;
  from: MapStop;
  to: MapStop;
};

export function routeDepartureTime(
  travelMode: TravelMode,
  departureTime: string | undefined,
  now = Date.now(),
): Date | undefined {
  if ((travelMode !== "DRIVING" && travelMode !== "TRANSIT") || !departureTime) return undefined;
  const timestamp = Date.parse(departureTime);
  if (!Number.isFinite(timestamp) || timestamp < now + minimumFutureDepartureMs) return undefined;
  return new Date(timestamp);
}

export function useRouteLegs(
  plans: RouteLegPlan[],
  language: TripLanguage,
): ReadonlyMap<string, RouteLeg[]> {
  const [legsByPlan, setLegsByPlan] = useState<ReadonlyMap<string, RouteLeg[]>>(() => new Map());
  const plansRef = useRef(plans);
  const completedKey = useRef<string | null>(null);
  const task = useRef<{ key: string; cancel: () => void } | null>(null);
  plansRef.current = plans;
  const routeKey = routePlansInputKey(plans, language);
  const colorKey = routePlansColorKey(plans);

  useEffect(
    () => () => {
      task.current?.cancel();
      task.current = null;
    },
    [],
  );

  useEffect(() => {
    if (routeKey !== routePlansInputKey(plansRef.current, language)) return;
    if (completedKey.current === routeKey || task.current?.key === routeKey) return;
    task.current?.cancel();

    const activePlanIds = new Set(plansRef.current.map((plan) => plan.id));
    const pairs = routePairs(plansRef.current);
    setLegsByPlan((current) => initializeLegs(current, plansRef.current, activePlanIds));
    if (pairs.length === 0) {
      completedKey.current = routeKey;
      task.current = null;
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      const eligible = pairs.filter(isMotisPair);
      let motisResults = new Map<string, MotisRouteResult>();
      if (eligible.length > 0) {
        try {
          const response = await readMotisRoutes({
            data: {
              routes: eligible.map(({ id, from, to }) => ({
                id,
                from: motisPoint(from),
                to: motisPoint(to),
                ...motisDeparture(from, to),
              })),
            },
          });
          motisResults = new Map(response.routes.map((result) => [result.id, result]));
        } catch {
          motisResults = new Map();
        }
      }

      const needsGoogle = pairs.some((pair) => motisResults.get(pair.id)?.state !== "ready");
      const googleAdapter = needsGoogle
        ? await createGoogleRouteAdapter(language).catch(() => null)
        : null;
      const computed = await Promise.all(
        pairs.map(async (pair): Promise<RouteLeg> => {
          const motis = motisResults.get(pair.id);
          if (motis?.state === "ready") return readyLeg(pair, motis);
          if (!googleAdapter) return unavailableLeg(pair);
          try {
            const route = await googleAdapter.compute(
              pair.from,
              pair.to,
              routeDepartureTime(pair.to.travelMode, pair.from.departureTime),
            );
            return readyLeg(pair, route);
          } catch {
            return unavailableLeg(pair);
          }
        }),
      );

      if (cancelled || task.current?.key !== routeKey) return;
      const byPlan = new Map<string, RouteLeg[]>();
      for (const [index, pair] of pairs.entries()) {
        const leg = computed[index];
        if (!leg) continue;
        const legs = byPlan.get(pair.planId) ?? [];
        legs.push(leg);
        byPlan.set(pair.planId, legs);
      }
      setLegsByPlan((current) => mergeComputedLegs(current, plansRef.current, byPlan));
      completedKey.current = routeKey;
      task.current = null;
    }, 450);

    task.current = {
      key: routeKey,
      cancel: () => {
        cancelled = true;
        window.clearTimeout(timeout);
      },
    };
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

function routePairs(plans: RouteLegPlan[]): RoutePair[] {
  let index = 0;
  return plans.flatMap((plan) =>
    plan.stops.flatMap((to, stopIndex) => {
      const from = plan.stops[stopIndex - 1];
      if (!from || to.breakBefore || from.placeId === to.placeId) return [];
      const pair = { id: `route-${index}`, planId: plan.id, from, to };
      index += 1;
      return [pair];
    }),
  );
}

function initializeLegs(
  current: ReadonlyMap<string, RouteLeg[]>,
  plans: RouteLegPlan[],
  activePlanIds: ReadonlySet<string>,
): ReadonlyMap<string, RouteLeg[]> {
  const next = new Map([...current].filter(([planId]) => activePlanIds.has(planId)));
  for (const plan of plans) {
    const currentLegs = current.get(plan.id) ?? [];
    const pairs = routePairs([plan]);
    next.set(
      plan.id,
      pairs.map((pair) => {
        const previous = currentLegs.find(
          (leg) =>
            leg.fromId === pair.from.id &&
            leg.toId === pair.to.id &&
            leg.mode === pair.to.travelMode,
        );
        return previous?.path.length
          ? { ...previous, color: pair.to.color, state: "stale" }
          : {
              fromId: pair.from.id,
              toId: pair.to.id,
              from: routePoint(pair.from),
              to: routePoint(pair.to),
              mode: pair.to.travelMode,
              color: pair.to.color,
              durationMinutes: null,
              distanceMeters: null,
              geometryQuality: "approximate",
              path: [],
              state: "updating",
            };
      }),
    );
  }
  return next;
}

function mergeComputedLegs(
  current: ReadonlyMap<string, RouteLeg[]>,
  plans: RouteLegPlan[],
  computed: ReadonlyMap<string, RouteLeg[]>,
): ReadonlyMap<string, RouteLeg[]> {
  const next = new Map(current);
  for (const plan of plans) {
    const currentLegs = current.get(plan.id) ?? [];
    next.set(
      plan.id,
      (computed.get(plan.id) ?? []).map((leg) => {
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
  }
  return next;
}

function readyLeg(pair: RoutePair, route: ComputedRoute): RouteLeg {
  const durationMinutes = Math.max(1, Math.round(route.durationMillis / 60_000));
  return {
    fromId: pair.from.id,
    toId: pair.to.id,
    from: routePoint(pair.from),
    to: routePoint(pair.to),
    mode: pair.to.travelMode,
    color: pair.to.color,
    durationMinutes,
    distanceMeters: route.distanceMeters,
    geometryQuality: route.geometryQuality,
    path: route.path,
    state: "ready",
  };
}

function unavailableLeg(pair: RoutePair): RouteLeg {
  return {
    fromId: pair.from.id,
    toId: pair.to.id,
    from: routePoint(pair.from),
    to: routePoint(pair.to),
    mode: pair.to.travelMode,
    color: pair.to.color,
    durationMinutes: null,
    distanceMeters: null,
    geometryQuality: "approximate",
    path: [],
    state: "unavailable",
  };
}

function isMotisPair(pair: RoutePair): boolean {
  return (
    pair.to.travelMode === "TRANSIT" &&
    pair.from.countryCode === "JP" &&
    pair.to.countryCode === "JP"
  );
}

function motisPoint(stop: MapStop): { latitude: number; longitude: number; countryCode: "JP" } {
  if (stop.countryCode !== "JP") throw new Error("MOTIS route is outside Japan");
  return { latitude: stop.latitude, longitude: stop.longitude, countryCode: "JP" };
}

function motisDeparture(from: MapStop, to: MapStop): { departureTime?: string } {
  const departure = routeDepartureTime(to.travelMode, from.departureTime);
  return departure ? { departureTime: departure.toISOString() } : {};
}

function routePlansInputKey(plans: RouteLegPlan[], language: TripLanguage): string {
  return `${language}:${JSON.stringify(plans.map((plan) => [plan.id, routePlanInputKey(plan)]))}`;
}

function routePlanInputKey(plan: RouteLegPlan): string {
  return JSON.stringify(
    plan.stops.map((stop) => [
      stop.id,
      stop.placeId,
      stop.countryCode,
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

function routePoint(stop: MapStop): RoutePoint {
  return {
    placeId: stop.placeId,
    latitude: stop.latitude,
    longitude: stop.longitude,
  };
}
