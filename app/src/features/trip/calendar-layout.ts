import type { RouteLeg } from "~/features/routing/route-legs";
import {
  type CalendarStartHour,
  type Lodging,
  lodgingLeaveTime,
  type TripDay,
  type TripItem,
  type TripSnapshot,
} from "./model";

export const calendarHourEm = 4;
export const calendarSnapMinutes = 15;
export const calendarMinimumMinutes = 15;
export const calendarDayMinutes = 24 * 60;

export type CalendarSegment = {
  key: string;
  item: TripItem;
  dayId: string;
  startMinute: number;
  endMinute: number;
  provisional: boolean;
  continuesBefore: boolean;
  continuesAfter: boolean;
  lane: number;
  laneCount: number;
};

export type CalendarStay = {
  key: string;
  item: TripItem;
  dayId: string;
  endMinute: number;
  conflict: boolean;
};
export type CalendarLodgingBar = {
  key: string;
  item: TripItem;
  lodging: Pick<Lodging, "startDate" | "endDate">;
  startIndex: number;
  endIndex: number;
  lane: number;
};

export type CalendarLodgingLayout = {
  bars: CalendarLodgingBar[];
  laneCount: number;
  missingDayIds: ReadonlySet<string>;
};

export type CalendarNoteGroup = {
  anchorItemId: string | null;
  notes: TripItem[];
};

export type CalendarRouteGap = {
  key: string;
  dayId: string;
  startMinute: number;
  durationMinutes: number;
  totalDurationMinutes: number;
  state: RouteLeg["state"];
  mode: RouteLeg["mode"];
  conflict: boolean;
  lane: number;
  laneCount: number;
};

export type CalendarDayLayout = {
  day: TripDay;
  segments: CalendarSegment[];
  noteGroups: CalendarNoteGroup[];
  overflow: TripItem[];
  stays: CalendarStay[];
  routeGaps: CalendarRouteGap[];
};

export function buildCalendarLayout(
  days: readonly TripDay[],
  orderedItems: readonly TripItem[],
  legsByDay: ReadonlyMap<string, readonly RouteLeg[]>,
  calendarStartHour: CalendarStartHour,
): CalendarDayLayout[] {
  const dayIndex = new Map(days.map((day, index) => [day.id, index]));
  const segmentsByDay = new Map(days.map((day) => [day.id, [] as CalendarSegment[]]));
  const overflowByDay = new Map(days.map((day) => [day.id, [] as TripItem[]]));
  const notesByDay = buildNoteGroups(days, orderedItems);
  const staysByDay = buildCalendarStays(days, orderedItems, calendarStartHour);

  for (const item of orderedItems) {
    if (!item.dayId || item.type === "note" || item.type === "lodging") continue;
    const index = dayIndex.get(item.dayId);
    if (index === undefined) continue;
    const duration = Math.max(calendarMinimumMinutes, item.durationMinutes || 60);
    if (item.startTime) {
      addSegments(
        days,
        segmentsByDay,
        item,
        index,
        calendarMinuteForTime(item.startTime, calendarStartHour),
        duration,
        false,
      );
      continue;
    }
    const daySegments = segmentsByDay.get(item.dayId);
    if (!daySegments) continue;
    const orderedFloor = daySegments.reduce(
      (latest, segment) => Math.max(latest, segment.endMinute),
      0,
    );
    const lodgingFloor = (staysByDay.get(item.dayId) ?? []).reduce(
      (latest, stay) => Math.max(latest, stay.endMinute),
      0,
    );
    const start = firstOpenMinute(
      daySegments,
      Math.max(
        calendarMinuteForTime("08:00", calendarStartHour),
        orderedFloor,
        lodgingFloor,
        incomingRouteArrivalMinute(item, index, dayIndex, segmentsByDay, staysByDay, legsByDay),
      ),
      duration,
    );
    if (start + duration > calendarDayMinutes) {
      overflowByDay.get(item.dayId)?.push(item);
      continue;
    }
    addSegments(days, segmentsByDay, item, index, start, duration, true);
  }

  const laidOutByDay = new Map(
    days.map((day) => [day.id, assignLanes(segmentsByDay.get(day.id) ?? [])]),
  );
  const routeGapsByDay = buildRouteGaps(days, laidOutByDay, staysByDay, legsByDay);
  const result = days.map((day) => {
    const segments = laidOutByDay.get(day.id) ?? [];
    return {
      day,
      segments,
      noteGroups: notesByDay.get(day.id) ?? [],
      overflow: overflowByDay.get(day.id) ?? [],
      stays: staysByDay.get(day.id) ?? [],
      routeGaps: routeGapsByDay.get(day.id) ?? [],
    };
  });
  return result;
}
export function buildCalendarLodgingLayout(
  days: readonly TripDay[],
  orderedItems: readonly TripItem[],
  override?: {
    itemId: string;
    lodging: Pick<Lodging, "startDate" | "endDate">;
  },
): CalendarLodgingLayout {
  const firstDate = days[0]?.date;
  const lastDate = days.at(-1)?.date;
  if (!firstDate || !lastDate) {
    return { bars: [], laneCount: 0, missingDayIds: new Set() };
  }
  const candidates: (Omit<CalendarLodgingBar, "lane"> & { order: number })[] = [];
  for (const [order, item] of orderedItems.entries()) {
    if (item.type !== "lodging" || !item.lodging) continue;
    const lodging = override?.itemId === item.id ? override.lodging : item.lodging;
    if (lodging.endDate < firstDate || lodging.startDate > lastDate) continue;
    const startIndex = days.findIndex((day) => day.date >= lodging.startDate);
    let endIndex = -1;
    for (let index = days.length - 1; index >= 0; index -= 1) {
      const day = days[index];
      if (day && day.date <= lodging.endDate) {
        endIndex = index;
        break;
      }
    }
    if (startIndex < 0 || endIndex < startIndex) continue;
    candidates.push({
      key: item.id,
      item,
      lodging,
      startIndex,
      endIndex,
      order,
    });
  }
  candidates.sort(
    (left, right) =>
      left.startIndex - right.startIndex ||
      left.lodging.startDate.localeCompare(right.lodging.startDate) ||
      left.endIndex - right.endIndex ||
      left.order - right.order,
  );
  const laneEnds: number[] = [];
  const bars = candidates.map(({ order: _order, ...bar }) => {
    let lane = laneEnds.findIndex((endIndex) => endIndex < bar.startIndex);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = bar.endIndex;
    return { ...bar, lane };
  });
  const missingDayIds = new Set(
    days
      .slice(0, -1)
      .filter(
        (day) =>
          !bars.some((bar) => bar.lodging.startDate <= day.date && day.date < bar.lodging.endDate),
      )
      .map((day) => day.id),
  );
  return { bars, laneCount: laneEnds.length, missingDayIds };
}

export function calendarOrder(
  snapshot: Pick<TripSnapshot, "calendarStartHour" | "items" | "order">,
  changed: TripItem,
  beforeItemId?: string | null,
): string[] {
  const next = snapshot.order.filter((id) => id !== changed.id);
  const sameDay = next.filter((id) => snapshot.items[id]?.dayId === changed.dayId);
  const changedMinute = changed.startTime
    ? calendarMinuteForTime(changed.startTime, snapshot.calendarStartHour)
    : Number.POSITIVE_INFINITY;
  const before =
    beforeItemId === undefined
      ? changed.startTime
        ? sameDay.find((id) => {
            const item = snapshot.items[id];
            if (!item) return false;
            if (!item.startTime) return true;
            const minute = calendarMinuteForTime(item.startTime, snapshot.calendarStartHour);
            return minute > changedMinute;
          })
        : undefined
      : beforeItemId && sameDay.includes(beforeItemId)
        ? beforeItemId
        : undefined;
  const last = sameDay.at(-1);
  const insertion = before
    ? next.indexOf(before)
    : last
      ? next.indexOf(last) + 1
      : next.findIndex((id) => {
          const item = snapshot.items[id];
          if (!item?.dayId || !changed.dayId) return false;
          return item.dayId > changed.dayId;
        });
  next.splice(insertion < 0 ? next.length : insertion, 0, changed.id);
  return next;
}

export function snapCalendarMinute(value: number): number {
  return Math.max(0, Math.round(value / calendarSnapMinutes) * calendarSnapMinutes);
}

export function calendarMinuteForTime(value: string, calendarStartHour: CalendarStartHour): number {
  const minute = minutesForTime(value);
  const origin = calendarStartHour * 60;
  return minute >= origin ? minute - origin : minute + calendarDayMinutes - origin;
}

export function rollingTimeForCalendarMinute(
  value: number,
  calendarStartHour: CalendarStartHour,
): string {
  const minute = Math.floor(value) + calendarStartHour * 60;
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export function timeForCalendarMinute(value: number, calendarStartHour: CalendarStartHour): string {
  const origin = calendarStartHour * 60;
  const minute =
    (((Math.floor(value) + origin) % calendarDayMinutes) + calendarDayMinutes) % calendarDayMinutes;
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function minutesForTime(value: string): number {
  const [hour = "0", minute = "0"] = value.split(":");
  return Number(hour) * 60 + Number(minute);
}

function addSegments(
  days: readonly TripDay[],
  byDay: Map<string, CalendarSegment[]>,
  item: TripItem,
  startDay: number,
  startMinute: number,
  durationMinutes: number,
  provisional: boolean,
): void {
  let remaining = durationMinutes;
  let dayOffset = 0;
  let minute = startMinute;
  while (remaining > 0) {
    const day = days[startDay + dayOffset];
    if (!day) return;
    const available = calendarDayMinutes - minute;
    const used = Math.min(remaining, available);
    byDay.get(day.id)?.push({
      key: `${item.id}:${day.id}:${dayOffset}`,
      item,
      dayId: day.id,
      startMinute: minute,
      endMinute: minute + used,
      provisional,
      continuesBefore: dayOffset > 0,
      continuesAfter: remaining > used,
      lane: 0,
      laneCount: 1,
    });
    remaining -= used;
    dayOffset += 1;
    minute = 0;
  }
}

function firstOpenMinute(
  segments: readonly CalendarSegment[],
  initial: number,
  duration: number,
): number {
  let candidate = initial;
  const occupied = segments
    .map((segment) => [segment.startMinute, segment.endMinute] as const)
    .sort((left, right) => left[0] - right[0]);
  for (const [start, end] of occupied) {
    if (candidate + duration <= start) return candidate;
    if (candidate < end) candidate = end;
  }
  return candidate;
}

function incomingRouteArrivalMinute(
  item: TripItem,
  itemDayIndex: number,
  dayIndex: ReadonlyMap<string, number>,
  segmentsByDay: ReadonlyMap<string, readonly CalendarSegment[]>,
  staysByDay: ReadonlyMap<string, readonly CalendarStay[]>,
  legsByDay: ReadonlyMap<string, readonly RouteLeg[]>,
): number {
  let latestArrival = 0;
  for (const leg of legsByDay.get(item.dayId ?? "") ?? []) {
    if (baseItemId(leg.toId) !== baseItemId(item.id)) continue;
    const duration =
      leg.durationMinutes === null ? 0 : Math.max(calendarMinimumMinutes, leg.durationMinutes);
    for (const stay of staysByDay.get(item.dayId ?? "") ?? []) {
      if (`${stay.item.id}:start` === leg.fromId) {
        latestArrival = Math.max(latestArrival, stay.endMinute + duration);
      }
    }
    for (const segments of segmentsByDay.values()) {
      for (const source of segments) {
        if (source.continuesAfter || baseItemId(source.item.id) !== baseItemId(leg.fromId)) {
          continue;
        }
        const sourceDayIndex = dayIndex.get(source.dayId);
        if (sourceDayIndex === undefined) continue;
        const arrival =
          (sourceDayIndex - itemDayIndex) * calendarDayMinutes + source.endMinute + duration;
        latestArrival = Math.max(latestArrival, arrival);
      }
    }
  }
  return latestArrival;
}

function assignLanes(input: readonly CalendarSegment[]): CalendarSegment[] {
  const segments = [...input].sort(
    (left, right) =>
      left.startMinute - right.startMinute || left.item.id.localeCompare(right.item.id),
  );
  let groupStart = 0;
  while (groupStart < segments.length) {
    let groupEnd = groupStart + 1;
    let latestEnd = segments[groupStart]?.endMinute ?? 0;
    while (groupEnd < segments.length && (segments[groupEnd]?.startMinute ?? 0) < latestEnd) {
      latestEnd = Math.max(latestEnd, segments[groupEnd]?.endMinute ?? 0);
      groupEnd += 1;
    }
    const laneEnds: number[] = [];
    for (let index = groupStart; index < groupEnd; index += 1) {
      const segment = segments[index];
      if (!segment) continue;
      let lane = laneEnds.findIndex((end) => end <= segment.startMinute);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = segment.endMinute;
      segment.lane = lane;
    }
    for (let index = groupStart; index < groupEnd; index += 1) {
      const segment = segments[index];
      if (segment) segment.laneCount = laneEnds.length;
    }
    groupStart = groupEnd;
  }
  return segments;
}

function buildCalendarStays(
  days: readonly TripDay[],
  orderedItems: readonly TripItem[],
  calendarStartHour: CalendarStartHour,
): Map<string, CalendarStay[]> {
  const stays = new Map(days.map((day) => [day.id, [] as CalendarStay[]]));
  for (const item of orderedItems) {
    if (item.type !== "lodging" || !item.lodging) continue;
    for (const day of days) {
      if (item.lodging.startDate >= day.date || day.date > item.lodging.endDate) continue;
      stays.get(day.id)?.push({
        key: `${item.id}:${day.id}`,
        item,
        dayId: day.id,
        endMinute: calendarMinuteForTime(
          lodgingLeaveTime(item.lodging, day.date),
          calendarStartHour,
        ),
        conflict: false,
      });
    }
  }
  return stays;
}

function buildNoteGroups(
  days: readonly TripDay[],
  orderedItems: readonly TripItem[],
): Map<string, CalendarNoteGroup[]> {
  const groups = new Map(days.map((day) => [day.id, [] as CalendarNoteGroup[]]));
  for (const day of days) {
    let anchorItemId: string | null = null;
    for (const item of orderedItems) {
      if (item.dayId !== day.id) continue;
      if (item.type !== "note") {
        if (item.type !== "lodging") anchorItemId = item.id;
        continue;
      }
      const dayGroups = groups.get(day.id);
      if (!dayGroups) continue;
      const existing = dayGroups.find((group) => group.anchorItemId === anchorItemId);
      if (existing) existing.notes.push(item);
      else dayGroups.push({ anchorItemId, notes: [item] });
    }
  }
  return groups;
}

function buildRouteGaps(
  days: readonly TripDay[],
  segmentsByDay: ReadonlyMap<string, readonly CalendarSegment[]>,
  staysByDay: ReadonlyMap<string, readonly CalendarStay[]>,
  legsByDay: ReadonlyMap<string, readonly RouteLeg[]>,
): Map<string, CalendarRouteGap[]> {
  const gaps = new Map(days.map((day) => [day.id, [] as CalendarRouteGap[]]));
  const dayIndex = new Map(days.map((day, index) => [day.id, index]));
  const segments = [...segmentsByDay.values()].flat();
  const absoluteStart = (segment: CalendarSegment) =>
    (dayIndex.get(segment.dayId) ?? 0) * calendarDayMinutes + segment.startMinute;
  const absoluteEnd = (segment: CalendarSegment) =>
    (dayIndex.get(segment.dayId) ?? 0) * calendarDayMinutes + segment.endMinute;
  for (const [routeDayId, legs] of legsByDay) {
    for (const leg of legs) {
      const sourceSegment = segments
        .filter(
          (segment) =>
            baseItemId(segment.item.id) === baseItemId(leg.fromId) && !segment.continuesAfter,
        )
        .sort((left, right) => absoluteEnd(right) - absoluteEnd(left))[0];
      const sourceStay = (staysByDay.get(routeDayId) ?? []).find(
        (stay) => `${stay.item.id}:start` === leg.fromId,
      );
      const source = sourceStay
        ? { dayId: sourceStay.dayId, endMinute: sourceStay.endMinute, lane: 0, laneCount: 1 }
        : sourceSegment;
      if (!source) continue;
      const destination = segments
        .filter(
          (segment) =>
            baseItemId(segment.item.id) === baseItemId(leg.toId) && !segment.continuesBefore,
        )
        .sort((left, right) => absoluteStart(left) - absoluteStart(right))[0];
      if (
        sourceStay &&
        destination &&
        absoluteStart(destination) <
          (dayIndex.get(sourceStay.dayId) ?? 0) * calendarDayMinutes + sourceStay.endMinute
      ) {
        sourceStay.conflict = true;
        continue;
      }
      if (leg.durationMinutes === null) continue;
      const durationMinutes = Math.max(calendarMinimumMinutes, leg.durationMinutes);
      const sourceIndex = dayIndex.get(source.dayId) ?? 0;
      let cursor = sourceIndex * calendarDayMinutes + source.endMinute;
      let remaining = durationMinutes;
      const conflict = Boolean(
        destination && cursor + durationMinutes > absoluteStart(destination),
      );
      let part = 0;
      while (remaining > 0) {
        const index = Math.floor(cursor / calendarDayMinutes);
        const day = days[index];
        if (!day) break;
        const startMinute = cursor % calendarDayMinutes;
        const used = Math.min(remaining, calendarDayMinutes - startMinute);
        gaps.get(day.id)?.push({
          key: `${leg.fromId}:${leg.toId}:${part}`,
          dayId: day.id,
          startMinute,
          durationMinutes: used,
          state: leg.state,
          mode: leg.mode,
          totalDurationMinutes: leg.durationMinutes,
          conflict,
          lane: source.lane,
          laneCount: source.laneCount,
        });
        cursor += used;
        remaining -= used;
        part += 1;
      }
    }
  }
  return gaps;
}

function baseItemId(value: string): string {
  return value.replace(/(?::(?:start|end|from|to))+$/, "");
}
