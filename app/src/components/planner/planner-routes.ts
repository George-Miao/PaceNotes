import { useMemo, useRef } from "react";
import type { GooglePlaceView } from "~/features/google/google";
import { itemTitle } from "~/features/google/item-title";
import { type MapStop, type MapTransport, useRouteLegs } from "~/features/routing/route-legs";
import { dayColor } from "~/features/trip/day-colors";
import type { DayPlan } from "~/features/trip/day-plan";
import { createTripText } from "~/features/trip/language";
import {
  lodgingLeaveTime,
  resolveLocalTime,
  type TripDay,
  type TripItem,
  type TripLanguage,
  type TripSnapshot,
} from "~/features/trip/model";

export function usePlannerRoutes(
  dayPlans: DayPlan[],
  inboxItems: TripItem[],
  orderedItems: TripItem[],
  placeViews: ReadonlyMap<string, GooglePlaceView>,
  snapshot: Pick<TripSnapshot, "days" | "timeZone">,
  tripLanguage: TripLanguage,
) {
  const markerItems = useMemo(() => {
    const entries: Array<{ item: TripItem; key: string }> = [];
    const itemIds = new Set<string>();
    const append = (items: readonly TripItem[]) => {
      for (const item of items) {
        if (itemIds.has(item.id)) continue;
        itemIds.add(item.id);
        entries.push({ item, key: item.id });
      }
    };
    for (const plan of dayPlans) {
      append(plan.start);
      append(plan.items);
      append(plan.end);
    }
    append(inboxItems);
    return entries;
  }, [dayPlans, inboxItems]);
  const nextStops = useMemo(
    () =>
      buildMapStops(
        markerItems,
        placeViews,
        snapshot.days.map((day) => day.id),
        tripLanguage,
      ),
    [markerItems, placeViews, snapshot.days, tripLanguage],
  );
  const stops = useStableArray(nextStops, sameMapStop);
  const routeData = useMemo(() => {
    const exportStops = new Map<string, MapStop[]>();
    const predecessorDayIds = new Set<string>();
    const plans = dayPlans.map((plan, dayIndex) => {
      const ownedEntries = [
        ...plan.start.map((item) => ({ item, key: `${item.id}:start` })),
        ...plan.items.map((item) => ({ item, key: item.id })),
        ...plan.end.map((item) => ({ item, key: `${item.id}:end` })),
      ];
      const ownedStops = buildRouteStops(
        ownedEntries,
        placeViews,
        snapshot.days,
        plan.day.id,
        tripLanguage,
        snapshot.timeZone,
      );
      exportStops.set(plan.day.id, ownedStops);
      const previous = dayPlans[dayIndex - 1];
      let predecessor: { item: TripItem; key: string } | null = null;
      if (previous && plan.start.length === 0 && previous.end.length === 0) {
        const entries = previous.items.map((item) => ({ item, key: item.id }));
        for (let index = entries.length - 1; index >= 0; index -= 1) {
          const entry = entries[index];
          if (!entry) continue;
          if (entry.item.type === "transport") break;
          if (entry.item.place) {
            predecessor = entry;
            break;
          }
        }
      }
      if (ownedStops.length === 0) predecessor = null;
      if (predecessor) predecessorDayIds.add(plan.day.id);
      return {
        id: plan.day.id,
        stops: predecessor
          ? buildRouteStops(
              [predecessor, ...ownedEntries],
              placeViews,
              snapshot.days,
              plan.day.id,
              tripLanguage,
              snapshot.timeZone,
            )
          : ownedStops,
      };
    });
    return { plans, exportStops, predecessorDayIds };
  }, [dayPlans, placeViews, snapshot.days, snapshot.timeZone, tripLanguage]);
  const routeLegs = useRouteLegs(routeData.plans, tripLanguage);
  const nextTransports = useMemo<MapTransport[]>(() => {
    const items = orderedItems.filter((item) => item.type === "transport");
    return items.map((item) => ({
      id: item.id,
      label: item.title,
      color: dayColor(
        Math.max(
          0,
          snapshot.days.findIndex((day) => day.id === item.dayId),
        ),
      ).background,
      from: item.transport?.from ? (placeViews.get(item.transport.from.placeId) ?? null) : null,
      to: item.transport?.to ? (placeViews.get(item.transport.to.placeId) ?? null) : null,
    }));
  }, [orderedItems, placeViews, snapshot.days]);
  const transports = useStableArray(nextTransports, sameMapTransport);
  return { stops, routeData, routeLegs, transports };
}

function useStableArray<T>(next: T[], equal: (left: T, right: T) => boolean): T[] {
  const current = useRef(next);
  if (
    current.current.length !== next.length ||
    current.current.some((value, index) => {
      const candidate = next[index];
      return candidate === undefined || !equal(value, candidate);
    })
  ) {
    current.current = next;
  }
  return current.current;
}

function sameMapStop(left: MapStop, right: MapStop): boolean {
  return (
    left.id === right.id &&
    left.placeId === right.placeId &&
    left.label === right.label &&
    left.index === right.index &&
    left.latitude === right.latitude &&
    left.longitude === right.longitude &&
    left.countryCode === right.countryCode &&
    left.color === right.color &&
    left.textColor === right.textColor &&
    left.travelMode === right.travelMode &&
    left.departureTime === right.departureTime &&
    left.breakBefore === right.breakBefore
  );
}

function sameMapTransport(left: MapTransport, right: MapTransport): boolean {
  return (
    left.id === right.id &&
    left.label === right.label &&
    left.color === right.color &&
    sameTransportPlace(left.from, right.from) &&
    sameTransportPlace(left.to, right.to)
  );
}

function sameTransportPlace(left: GooglePlaceView | null, right: GooglePlaceView | null): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.placeId === right.placeId &&
    left.displayName === right.displayName &&
    left.latitude === right.latitude &&
    left.longitude === right.longitude &&
    left.countryCode === right.countryCode
  );
}

function buildMapStops(
  entries: Array<{ item: TripItem; key: string }>,
  places: ReadonlyMap<string, GooglePlaceView>,
  dayIds: string[],
  language: TripLanguage,
): MapStop[] {
  let stopDayId: string | null | undefined;
  let stopIndex = 0;
  const text = createTripText(language);
  const stops: MapStop[] = [];
  const placeIds = new Set<string>();
  const add = (item: TripItem, id: string, place: GooglePlaceView, label: string) => {
    if (placeIds.has(place.placeId)) return;
    placeIds.add(place.placeId);
    if (item.dayId !== stopDayId) {
      stopDayId = item.dayId;
      stopIndex = 0;
    }
    stopIndex += 1;
    const palette = dayColor(Math.max(0, dayIds.indexOf(item.dayId ?? "")));
    stops.push({
      id,
      placeId: place.placeId,
      label,
      index: stopIndex,
      latitude: place.latitude,
      longitude: place.longitude,
      countryCode: place.countryCode,
      color: palette.background,
      textColor: palette.text,
      travelMode: item.travelMode,
    });
  };
  for (const { item, key } of entries) {
    if (item.type === "transport") {
      const from = item.transport?.from ? places.get(item.transport.from.placeId) : undefined;
      const to = item.transport?.to ? places.get(item.transport.to.placeId) : undefined;
      if (from) {
        add(item, `${key}:from`, from, from.displayName || item.title || text("transportOrigin"));
      }
      if (to) {
        add(item, `${key}:to`, to, to.displayName || item.title || text("transportDestination"));
      }
      continue;
    }
    if (!item.place) continue;
    const place = places.get(item.place.placeId);
    if (place) add(item, key, place, itemTitle(item, places));
  }
  return stops;
}

export function buildRouteStops(
  entries: Array<{ item: TripItem; key: string }>,
  places: ReadonlyMap<string, GooglePlaceView>,
  days: TripDay[],
  routeDayId: string,
  language: TripLanguage,
  timeZone: string,
): MapStop[] {
  const palette = dayColor(
    Math.max(
      0,
      days.findIndex((day) => day.id === routeDayId),
    ),
  );
  const text = createTripText(language);
  const dateByDayId = new Map(days.map((day) => [day.id, day.date]));
  const routeDate = dateByDayId.get(routeDayId);
  const departureTime = (item: TripItem, key: string) => {
    const startTime =
      item.type === "lodging" && item.lodging && key.endsWith(":start")
        ? lodgingLeaveTime(item.lodging, routeDayId)
        : item.startTime;
    if (!startTime) return null;
    const date =
      item.type === "lodging"
        ? routeDate
        : ((item.dayId ? dateByDayId.get(item.dayId) : undefined) ?? routeDate);
    if (!date) return null;
    try {
      return resolveLocalTime(date, startTime, timeZone);
    } catch {
      return null;
    }
  };
  let stopIndex = 0;
  let breakBeforeNext = false;
  return entries.flatMap(({ item, key }) => {
    const itemDepartureTime = departureTime(item, key);
    const schedule = itemDepartureTime ? { departureTime: itemDepartureTime } : {};
    if (item.type === "transport") {
      const from = item.transport?.from ? places.get(item.transport.from.placeId) : undefined;
      const to = item.transport?.to ? places.get(item.transport.to.placeId) : undefined;
      const endpoints: MapStop[] = [];
      if (from) {
        stopIndex += 1;
        endpoints.push({
          id: key,
          placeId: from.placeId,
          label: from.displayName || item.title || text("transportOrigin"),
          index: stopIndex,
          latitude: from.latitude,
          longitude: from.longitude,
          countryCode: from.countryCode,
          color: palette.background,
          textColor: palette.text,
          travelMode: item.travelMode,
          breakBefore: breakBeforeNext,
          ...schedule,
        });
      }
      if (to) {
        stopIndex += 1;
        endpoints.push({
          id: `${key}:to`,
          placeId: to.placeId,
          label: to.displayName || item.title || text("transportDestination"),
          index: stopIndex,
          latitude: to.latitude,
          longitude: to.longitude,
          countryCode: to.countryCode,
          color: palette.background,
          textColor: palette.text,
          travelMode: item.travelMode,
          breakBefore: true,
          ...schedule,
        });
      }
      breakBeforeNext = !to;
      return endpoints;
    }
    if (!item.place) return [];
    const place = places.get(item.place.placeId);
    if (!place) return [];
    stopIndex += 1;
    const breakBefore = breakBeforeNext;
    breakBeforeNext = false;
    return [
      {
        id: key,
        breakBefore,
        placeId: item.place.placeId,
        label: itemTitle(item, places),
        index: stopIndex,
        latitude: place.latitude,
        longitude: place.longitude,
        countryCode: place.countryCode,
        color: palette.background,
        textColor: palette.text,
        travelMode: item.travelMode,
        ...schedule,
      },
    ];
  });
}

export function placeReferences(item: TripItem): string[] {
  const ids: string[] = [];
  if (item.place) ids.push(item.place.placeId);
  if (item.transport?.from) ids.push(item.transport.from.placeId);
  if (item.transport?.to) ids.push(item.transport.to.placeId);
  return ids;
}
