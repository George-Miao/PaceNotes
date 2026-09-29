import {
  calendarDayMinutes,
  calendarMinimumMinutes,
  calendarSnapMinutes,
  snapCalendarMinute,
  timeForCalendarMinute,
} from "~/features/trip/calendar-layout";
import type { CalendarStartHour, TripDay, TripItem, TripLanguage } from "~/features/trip/model";

export type CalendarPreview = {
  itemId: string;
  dayId: string;
  startTime: string;
  durationMinutes: number;
};

export type CalendarSelectionBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type PointerPosition = Pick<PointerEvent, "clientX" | "clientY">;
type ItemPointerOrigin = {
  startX: number;
  startY: number;
  startScrollLeft: number;
  startScrollTop: number;
};
type LodgingPointerOrigin = {
  item: TripItem;
  edge: "move" | "start" | "end";
  startX: number;
  startScrollLeft: number;
};
type LodgingGuidePointer = {
  x: number;
  anchorX: number;
  guideY: number;
  clipLeft: number;
  clipRight: number;
};

export function pointerDelta(
  scroller: HTMLDivElement | null,
  event: PointerPosition,
  gesture: ItemPointerOrigin,
) {
  const first = scroller?.querySelector<HTMLElement>("[data-calendar-track]");
  if (!first) return { dayDelta: 0, minuteDelta: 0 };
  const bounds = first.getBoundingClientRect();
  const columnWidth = bounds.width;
  const pixelsPerHour = bounds.height / (calendarDayMinutes / 60);
  const horizontal =
    event.clientX - gesture.startX + (scroller?.scrollLeft ?? 0) - gesture.startScrollLeft;
  const vertical =
    event.clientY - gesture.startY + (scroller?.scrollTop ?? 0) - gesture.startScrollTop;
  return {
    dayDelta: Math.round(horizontal / columnWidth),
    minuteDelta:
      Math.round((vertical / pixelsPerHour / calendarSnapMinutes) * 60) * calendarSnapMinutes,
  };
}

export function isCalendarDropPoint(
  scroller: HTMLDivElement | null,
  event: PointerPosition,
  includeAllDay = false,
): boolean {
  const hit = document.elementFromPoint(event.clientX, event.clientY);
  if (!scroller || !hit || !scroller.contains(hit)) return false;
  const tracks = Array.from(scroller.querySelectorAll<HTMLElement>("[data-calendar-track]"));
  const first = tracks[0]?.getBoundingClientRect();
  const last = tracks.at(-1)?.getBoundingClientRect();
  const viewport = scroller.getBoundingClientRect();
  if (!first || !last) return false;
  const top = includeAllDay ? viewport.top : Math.max(viewport.top, first.top);
  const bottom = includeAllDay ? viewport.bottom : Math.min(viewport.bottom, first.bottom);
  return (
    event.clientX >= Math.max(viewport.left, first.left) &&
    event.clientX <= Math.min(viewport.right, last.right) &&
    event.clientY >= top &&
    event.clientY <= bottom
  );
}

export function previewForAbsolute(
  itemId: string,
  start: number,
  end: number,
  days: readonly TripDay[],
  calendarStartHour: CalendarStartHour,
): CalendarPreview | null {
  const dayIndex = Math.floor(start / calendarDayMinutes);
  if (dayIndex < 0) return null;
  const firstDay = days[0];
  const dayId = days[dayIndex]?.id ?? (firstDay ? addDays(firstDay.date, dayIndex) : null);
  if (!dayId) return null;
  return {
    itemId,
    dayId,
    startTime: timeForCalendarMinute(start, calendarStartHour),
    durationMinutes: Math.max(calendarMinimumMinutes, snapCalendarMinute(end - start)),
  };
}

export function rectangleForPoints(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): CalendarSelectionBox {
  return {
    left: Math.min(startX, endX),
    top: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

export function rectanglesIntersect(first: CalendarSelectionBox, second: DOMRect): boolean {
  return (
    first.left <= second.right &&
    first.left + first.width >= second.left &&
    first.top <= second.bottom &&
    first.top + first.height >= second.top
  );
}

export function lodgingRangeForPointer(
  gesture: LodgingPointerOrigin,
  clientX: number,
  scroller: HTMLDivElement | null,
  days: readonly TripDay[],
): { startDate: string; endDate: string } | null {
  const lodging = gesture.item.lodging;
  if (!lodging) return null;
  const width =
    scroller?.querySelector<HTMLElement>("[data-calendar-day]")?.getBoundingClientRect().width ||
    288;
  const delta = Math.round(
    (clientX - gesture.startX + (scroller?.scrollLeft ?? 0) - gesture.startScrollLeft) / width,
  );
  let startDate = lodging.startDate;
  let endDate = lodging.endDate;
  if (gesture.edge === "move") {
    startDate = addDays(startDate, delta);
    endDate = addDays(endDate, delta);
  } else if (gesture.edge === "start") {
    startDate = addDays(startDate, delta);
    if (startDate >= endDate) startDate = addDays(endDate, -1);
  } else {
    endDate = addDays(endDate, delta);
    if (endDate <= startDate) endDate = addDays(startDate, 1);
  }
  const first = days[0]?.date;
  if (first && startDate < first) {
    const nights = daysBetween(startDate, endDate);
    startDate = first;
    endDate = addDays(first, nights);
  }
  return { startDate, endDate };
}

export function clippedLodgingGuide(pointer: LodgingGuidePointer) {
  const left = Math.max(Math.min(pointer.anchorX, pointer.x), pointer.clipLeft);
  const right = Math.min(Math.max(pointer.anchorX, pointer.x), pointer.clipRight);
  if (right <= left) return null;
  return {
    left,
    top: pointer.guideY,
    width: right - left,
  };
}

export function itemVersion(item: TripItem): string {
  return `${item.dayId}:${item.startTime}:${item.durationMinutes}:${item.lodging?.startDate}:${item.lodging?.endDate}:${JSON.stringify(item.lodging?.leaveTimes)}`;
}

export function minutePercent(minutes: number): string {
  return `calc(${minutes} / ${calendarDayMinutes} * 100%)`;
}

export function formatDay(date: string, language: TripLanguage): string {
  return new Intl.DateTimeFormat(language, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

export function daysBetween(start: string, end: string): number {
  return Math.max(
    1,
    Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000),
  );
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
