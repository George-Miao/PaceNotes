import { resolveLocalTime, type TravelMode, type TripItem } from "./model";

export type PlacementTravelTime = {
  fromId: string;
  toId: string;
  mode: TravelMode;
  minutes: number;
};

export type PlacePlacementInput = {
  items: readonly TripItem[];
  item: TripItem;
  travelTimes: readonly PlacementTravelTime[];
  date: string;
  timeZone: string;
};

/**
 * Returns the visible-day index that best preserves the day's schedule, then
 * minimizes the route minutes introduced by the new place.
 */
export function findBestPlaceInsertion({
  items,
  item,
  travelTimes,
  date,
  timeZone,
}: PlacePlacementInput): number {
  if (!item.place || item.startTime) return items.length;

  const minutesByLeg = new Map(
    travelTimes.map((leg) => [legKey(leg.fromId, leg.toId, leg.mode), leg.minutes]),
  );
  const readMinutes = (from: TripItem, to: TripItem): number | null => {
    const minutes = minutesByLeg.get(legKey(from.id, to.id, to.travelMode));
    return minutes === undefined ? null : minutes;
  };

  const candidates = Array.from({ length: items.length + 1 }, (_, index) => {
    const withItem = items.toSpliced(index, 0, item);
    const schedule = scheduleCost(withItem, index, readMinutes, date, timeZone);
    const route = routeCost(withItem, index, readMinutes);
    return {
      index,
      overflowMinutes: schedule.overflowMinutes,
      unknownScheduleLegs: schedule.unknownLegs,
      routeKnown: route !== null,
      routeMinutes: route ?? Number.POSITIVE_INFINITY,
      distanceFromAppend: items.length - index,
    };
  });

  candidates.sort(
    (left, right) =>
      left.overflowMinutes - right.overflowMinutes ||
      left.unknownScheduleLegs - right.unknownScheduleLegs ||
      Number(right.routeKnown) - Number(left.routeKnown) ||
      left.routeMinutes - right.routeMinutes ||
      left.distanceFromAppend - right.distanceFromAppend,
  );
  return candidates[0]?.index ?? items.length;
}

function scheduleCost(
  items: readonly TripItem[],
  itemIndex: number,
  readMinutes: (from: TripItem, to: TripItem) => number | null,
  date: string,
  timeZone: string,
): { overflowMinutes: number; unknownLegs: number } {
  let previousTimedIndex = -1;
  for (let index = itemIndex - 1; index >= 0; index -= 1) {
    if (items[index]?.startTime) {
      previousTimedIndex = index;
      break;
    }
  }
  let nextTimedIndex = items.length;
  for (let index = itemIndex + 1; index < items.length; index += 1) {
    if (items[index]?.startTime) {
      nextTimedIndex = index;
      break;
    }
  }

  const previousTimed = items[previousTimedIndex];
  const nextTimed = items[nextTimedIndex];
  const timeline = scheduleTimeline(previousTimed, nextTimed, date, timeZone);
  const windowStart = timeline.previousStart + (previousTimed?.durationMinutes ?? 0);
  const windowEnd = timeline.nextStart;
  const openItems = items.slice(previousTimedIndex + 1, nextTimedIndex);
  let requiredMinutes = openItems.reduce((total, openItem) => {
    return total + (openItem.startTime ? 0 : openItem.durationMinutes);
  }, 0);

  const routeItems = [
    ...(previousTimed?.place ? [previousTimed] : []),
    ...openItems.filter((openItem) => openItem.place),
    ...(nextTimed?.place ? [nextTimed] : []),
  ];
  let unknownLegs = 0;
  for (let index = 1; index < routeItems.length; index += 1) {
    const from = routeItems[index - 1];
    const to = routeItems[index];
    if (!from || !to) continue;
    const minutes = readMinutes(from, to);
    if (minutes === null) unknownLegs += 1;
    else requiredMinutes += minutes;
  }

  const availableMinutes = Math.max(0, windowEnd - windowStart);
  return {
    overflowMinutes: Math.max(0, requiredMinutes - availableMinutes),
    unknownLegs,
  };
}

function routeCost(
  items: readonly TripItem[],
  itemIndex: number,
  readMinutes: (from: TripItem, to: TripItem) => number | null,
): number | null {
  const item = items[itemIndex];
  if (!item) return null;
  const previous = items
    .slice(0, itemIndex)
    .toReversed()
    .find((candidate) => candidate.place);
  const next = items.slice(itemIndex + 1).find((candidate) => candidate.place);

  let introducedMinutes = 0;
  if (previous) {
    const inbound = readMinutes(previous, item);
    if (inbound === null) return null;
    introducedMinutes += inbound;
  }
  if (next) {
    const outbound = readMinutes(item, next);
    if (outbound === null) return null;
    introducedMinutes += outbound;
  }
  if (previous && next) {
    const replaced = readMinutes(previous, next);
    if (replaced === null) return null;
    introducedMinutes -= replaced;
  }
  return introducedMinutes;
}

function scheduleTimeline(
  previous: TripItem | undefined,
  next: TripItem | undefined,
  date: string,
  timeZone: string,
): { previousStart: number; nextStart: number } {
  try {
    const dayStart = epochMinute(resolveLocalTime(date, "00:00", timeZone));
    const dayEnd = epochMinute(resolveLocalTime(nextDate(date), "00:00", timeZone));
    return {
      previousStart: previous?.startTime
        ? epochMinute(resolveLocalTime(date, previous.startTime, timeZone))
        : dayStart,
      nextStart: next?.startTime
        ? epochMinute(resolveLocalTime(date, next.startTime, timeZone))
        : dayEnd,
    };
  } catch {
    return {
      previousStart: previous?.startTime ? parseTime(previous.startTime) : 0,
      nextStart: next?.startTime ? parseTime(next.startTime) : 24 * 60,
    };
  }
}

function epochMinute(instant: string): number {
  return Date.parse(instant) / 60_000;
}

function nextDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function legKey(fromId: string, toId: string, mode: TravelMode): string {
  return `${fromId}\u0000${toId}\u0000${mode}`;
}

function parseTime(time: string): number {
  const [hour = "0", minute = "0"] = time.split(":");
  return Number(hour) * 60 + Number(minute);
}
