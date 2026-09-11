import type { RouteLeg } from "~/features/google/route-legs";
import type { TripDay, TripItem } from "./model";

export const calendarHourEm = 4;
export const calendarSnapMinutes = 15;
export const calendarMinimumMinutes = 15;
export const calendarDefaultStartMinutes = 8 * 60;

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

export type CalendarNoteGroup = {
  anchorItemId: string | null;
  notes: TripItem[];
};

export type CalendarRouteGap = {
  key: string;
  dayId: string;
  startMinute: number;
  durationMinutes: number;
  state: RouteLeg["state"];
  label: string;
  conflict: boolean;
};

export type CalendarDayLayout = {
  day: TripDay;
  segments: CalendarSegment[];
  noteGroups: CalendarNoteGroup[];
  overflow: TripItem[];
  routeGaps: CalendarRouteGap[];
};

export function buildCalendarLayout(
  days: readonly TripDay[],
  orderedItems: readonly TripItem[],
  legsByDay: ReadonlyMap<string, readonly RouteLeg[]>,
): CalendarDayLayout[] {
  const dayIndex = new Map(days.map((day, index) => [day.id, index]));
  const segmentsByDay = new Map(days.map((day) => [day.id, [] as CalendarSegment[]]));
  const overflowByDay = new Map(days.map((day) => [day.id, [] as TripItem[]]));
  const notesByDay = buildNoteGroups(days, orderedItems);

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
        minutesForTime(item.startTime),
        duration,
        false,
      );
      continue;
    }
    const daySegments = segmentsByDay.get(item.dayId);
    if (!daySegments) continue;
    const start = firstOpenMinute(daySegments, calendarDefaultStartMinutes, duration);
    if (start + duration > 24 * 60) {
      overflowByDay.get(item.dayId)?.push(item);
      continue;
    }
    addSegments(days, segmentsByDay, item, index, start, duration, true);
  }

  const laidOutByDay = new Map(
    days.map((day) => [day.id, assignLanes(segmentsByDay.get(day.id) ?? [])]),
  );
  const routeGapsByDay = buildRouteGaps(days, laidOutByDay, legsByDay);
  const result = days.map((day) => {
    const segments = laidOutByDay.get(day.id) ?? [];
    return {
      day,
      segments,
      noteGroups: notesByDay.get(day.id) ?? [],
      overflow: overflowByDay.get(day.id) ?? [],
      routeGaps: routeGapsByDay.get(day.id) ?? [],
    };
  });
  return result;
}

export function snapCalendarMinute(value: number): number {
  return Math.max(0, Math.round(value / calendarSnapMinutes) * calendarSnapMinutes);
}

export function timeForCalendarMinute(value: number): string {
  const minute = ((Math.floor(value) % (24 * 60)) + 24 * 60) % (24 * 60);
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
    const available = 24 * 60 - minute;
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
  legsByDay: ReadonlyMap<string, readonly RouteLeg[]>,
): Map<string, CalendarRouteGap[]> {
  const gaps = new Map(days.map((day) => [day.id, [] as CalendarRouteGap[]]));
  const dayIndex = new Map(days.map((day, index) => [day.id, index]));
  const segments = [...segmentsByDay.values()].flat();
  const absoluteStart = (segment: CalendarSegment) =>
    (dayIndex.get(segment.dayId) ?? 0) * 1440 + segment.startMinute;
  const absoluteEnd = (segment: CalendarSegment) =>
    (dayIndex.get(segment.dayId) ?? 0) * 1440 + segment.endMinute;
  for (const legs of legsByDay.values()) {
    for (const leg of legs) {
      if (leg.durationMinutes === null) continue;
      const source = segments
        .filter(
          (segment) =>
            baseItemId(segment.item.id) === baseItemId(leg.fromId) && !segment.continuesAfter,
        )
        .sort((left, right) => absoluteEnd(right) - absoluteEnd(left))[0];
      if (!source) continue;
      const destination = segments
        .filter(
          (segment) =>
            baseItemId(segment.item.id) === baseItemId(leg.toId) && !segment.continuesBefore,
        )
        .sort((left, right) => absoluteStart(left) - absoluteStart(right))[0];
      const durationMinutes = Math.max(1, leg.durationMinutes);
      let cursor = absoluteEnd(source);
      let remaining = durationMinutes;
      const conflict = Boolean(
        destination && cursor + durationMinutes > absoluteStart(destination),
      );
      let part = 0;
      while (remaining > 0) {
        const index = Math.floor(cursor / 1440);
        const day = days[index];
        if (!day) break;
        const startMinute = cursor % 1440;
        const used = Math.min(remaining, 1440 - startMinute);
        gaps.get(day.id)?.push({
          key: `${leg.fromId}:${leg.toId}:${part}`,
          dayId: day.id,
          startMinute,
          durationMinutes: used,
          state: leg.state,
          label: leg.duration,
          conflict,
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
  return value.replace(/:(start|end)$/, "");
}
