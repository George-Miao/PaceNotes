import {
  type CalendarSegment,
  calendarDayMinutes,
  calendarMinimumMinutes,
  calendarMinuteForTime,
  timeForCalendarMinute,
} from "~/features/trip/calendar-layout";
import type { CalendarStartHour, TripDay, TripItem } from "~/features/trip/model";
import type { CalendarItemAction } from "./CalendarMenus";
import {
  addDays,
  type CalendarPreview,
  clamp,
  daysBetween,
  itemVersion,
  previewForAbsolute,
} from "./calendar-coordinates";

export type ItemChange = {
  item: TripItem;
  dayId: string;
  startTime: string | null;
  durationMinutes: number;
  orderBeforeId?: string | null;
  extendThrough?: string;
};

type ItemGestureMember = {
  item: TripItem;
  startAbsolute: number;
  endAbsolute: number;
  version: string;
};

export type DragPointer = {
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

export type ItemGesture = {
  type: "item";
  item: TripItem;
  edge: "move" | "start" | "end";
  active: boolean;
  dragBox: Omit<DragPointer, "x" | "y"> | null;
  pointerId: number;
  startX: number;
  startY: number;
  startScrollLeft: number;
  startScrollTop: number;
  startAbsolute: number;
  endAbsolute: number;
  members: readonly ItemGestureMember[];
};

export type AdjustmentAction = Exclude<
  CalendarItemAction,
  "move-up" | "move-down" | "flexible" | "duplicate" | "edit" | "delete"
>;

export function itemGestureMembers(
  selectedItems: readonly TripItem[],
  segment: CalendarSegment,
  dayIndex: ReadonlyMap<string, number>,
  calendarStartHour: CalendarStartHour,
): readonly ItemGestureMember[] {
  return selectedItems.map((item) => {
    const itemDay = dayIndex.get(item.dayId ?? "") ?? 0;
    const startAbsolute =
      itemDay * calendarDayMinutes +
      calendarMinuteForTime(
        item.startTime ??
          (item.id === segment.item.id
            ? timeForCalendarMinute(segment.startMinute, calendarStartHour)
            : "08:00"),
        calendarStartHour,
      );
    return {
      item,
      startAbsolute,
      endAbsolute: startAbsolute + Math.max(calendarMinimumMinutes, item.durationMinutes || 60),
      version: itemVersion(item),
    };
  });
}

export function previewsForItemGesture(
  gesture: ItemGesture,
  { dayDelta, minuteDelta }: { dayDelta: number; minuteDelta: number },
  days: readonly TripDay[],
  calendarStartHour: CalendarStartHour,
): { primary: CalendarPreview | null; group: readonly CalendarPreview[] } {
  if (gesture.edge === "move") {
    const maximum = days.length * calendarDayMinutes;
    const earliest = Math.min(...gesture.members.map((member) => member.startAbsolute));
    const latestEnd = Math.max(...gesture.members.map((member) => member.endAbsolute));
    const delta = clamp(
      dayDelta * calendarDayMinutes + minuteDelta,
      -earliest,
      maximum - latestEnd,
    );
    const group = gesture.members.flatMap((member) => {
      const next = previewForAbsolute(
        member.item.id,
        member.startAbsolute + delta,
        member.endAbsolute + delta,
        days,
        calendarStartHour,
      );
      return next ? [next] : [];
    });
    return {
      primary: group.find((candidate) => candidate.itemId === gesture.item.id) ?? null,
      group,
    };
  }
  const start =
    gesture.edge === "start"
      ? clamp(
          gesture.startAbsolute + dayDelta * calendarDayMinutes + minuteDelta,
          0,
          gesture.endAbsolute - calendarMinimumMinutes,
        )
      : gesture.startAbsolute;
  const end =
    gesture.edge === "end"
      ? Math.max(
          gesture.startAbsolute + calendarMinimumMinutes,
          gesture.endAbsolute + dayDelta * calendarDayMinutes + minuteDelta,
        )
      : gesture.endAbsolute;
  return {
    primary: previewForAbsolute(gesture.item.id, start, end, days, calendarStartHour),
    group: [],
  };
}

export function changesForItemGesture(
  gesture: ItemGesture,
  nextPreviews: readonly CalendarPreview[],
  dayIndex: ReadonlyMap<string, number>,
  days: readonly TripDay[],
  layout: readonly { segments: readonly CalendarSegment[] }[],
  calendarStartHour: CalendarStartHour,
): ItemChange[] {
  const movingIds = new Set(nextPreviews.map((next) => next.itemId));
  return nextPreviews.flatMap((next) => {
    const member = gesture.members.find((candidate) => candidate.item.id === next.itemId);
    if (!member) return [];
    const startIndex =
      dayIndex.get(next.dayId) ?? (days[0] ? daysBetween(days[0].date, next.dayId) : 0);
    const nextStart =
      startIndex * calendarDayMinutes + calendarMinuteForTime(next.startTime, calendarStartHour);
    const finalMinute = nextStart + next.durationMinutes;
    if (nextStart === member.startAbsolute && finalMinute === member.endAbsolute) return [];
    const finalIndex = Math.max(0, Math.ceil(finalMinute / calendarDayMinutes) - 1);
    const lastKnown = days.at(-1)?.date;
    const extendThrough =
      finalIndex >= days.length && lastKnown
        ? addDays(lastKnown, finalIndex - days.length + 1)
        : undefined;
    return [
      {
        item: member.item,
        dayId: next.dayId,
        startTime: gesture.edge === "end" ? member.item.startTime : next.startTime,
        orderBeforeId:
          layout[startIndex]?.segments.find(
            (segment) =>
              segment.item.dayId === next.dayId &&
              !movingIds.has(segment.item.id) &&
              segment.startMinute > calendarMinuteForTime(next.startTime, calendarStartHour),
          )?.item.id ?? null,
        durationMinutes: next.durationMinutes,
        ...(extendThrough ? { extendThrough } : {}),
      },
    ];
  });
}

export function adjustmentForItem(
  segment: CalendarSegment,
  action: AdjustmentAction,
  dayIndex: ReadonlyMap<string, number>,
  days: readonly TripDay[],
  calendarStartHour: CalendarStartHour,
): ItemChange | null {
  const sourceDayIndex = dayIndex.get(segment.item.dayId ?? "") ?? 0;
  const sourceStart =
    sourceDayIndex * calendarDayMinutes +
    calendarMinuteForTime(
      segment.item.startTime ?? timeForCalendarMinute(segment.startMinute, calendarStartHour),
      calendarStartHour,
    );
  const sourceDuration = Math.max(calendarMinimumMinutes, segment.item.durationMinutes || 60);
  let start = sourceStart;
  let duration = sourceDuration;
  const durationOnly = action === "shorter" || action === "longer";
  if (action === "earlier") start -= 15;
  if (action === "later") start += 15;
  if (action === "previous-day") start -= calendarDayMinutes;
  if (action === "next-day") start += calendarDayMinutes;
  if (action === "shorter") duration = Math.max(calendarMinimumMinutes, duration - 15);
  if (action === "longer") duration += 15;
  if (start < 0) return null;
  const next = previewForAbsolute(
    segment.item.id,
    start,
    start + duration,
    days,
    calendarStartHour,
  );
  if (!next) return null;
  const finalIndex = Math.max(0, Math.ceil((start + duration) / calendarDayMinutes) - 1);
  const lastKnown = days.at(-1)?.date;
  const extendThrough =
    finalIndex >= days.length && lastKnown
      ? addDays(lastKnown, finalIndex - days.length + 1)
      : undefined;
  return {
    item: segment.item,
    dayId: next.dayId,
    startTime: durationOnly ? segment.item.startTime : next.startTime,
    durationMinutes: next.durationMinutes,
    ...(extendThrough ? { extendThrough } : {}),
  };
}
