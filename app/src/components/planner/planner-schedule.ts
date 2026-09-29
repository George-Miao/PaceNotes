import type { RouteLeg } from "~/features/routing/route-legs";
import { createTripText } from "~/features/trip/language";
import { resolveLocalTime, type TripItem, type TripLanguage } from "~/features/trip/model";

export function buildScheduleWarnings(
  items: TripItem[],
  legs: RouteLeg[],
  date: string,
  defaultTimeZone: string,
  language: TripLanguage,
): Map<string, string[]> {
  const warnings = new Map<string, string[]>();
  const text = createTripText(language);
  const add = (id: string, message: string) =>
    warnings.set(id, [...(warnings.get(id) ?? []), message]);
  const epochMinute = (item: TripItem): number => {
    const value = resolveLocalTime(date, item.startTime ?? "00:00", defaultTimeZone);
    return Date.parse(value.replace(/\[[^\]]+\]$/, "")) / 60_000;
  };
  let previous: TripItem | null = null;
  for (const item of items) {
    if (!item.startTime) continue;
    let itemMinute: number;
    try {
      itemMinute = epochMinute(item);
    } catch {
      add(item.id, text("invalidLocalTime"));
      continue;
    }
    if (previous?.startTime) {
      try {
        const previousEnd = epochMinute(previous) + (previous.durationMinutes ?? 0);
        if (previousEnd > itemMinute) add(item.id, text("overlapsItem", { title: previous.title }));
      } catch {
        // The prior item reports its own invalid local time.
      }
    }
    previous = item;
  }
  for (const leg of legs) {
    if (leg.durationMinutes === null) continue;
    const from = items.find((item) => item.id === leg.fromId);
    const to = items.find((item) => item.id === leg.toId);
    if (!from?.startTime || !to?.startTime) continue;
    try {
      const arrival = epochMinute(from) + (from.durationMinutes ?? 0) + leg.durationMinutes;
      if (arrival > epochMinute(to)) {
        add(to.id, text("travelCannotFinish", { title: from.title }));
      }
    } catch {
      // Invalid local times are reported by the item pass above.
    }
  }
  return warnings;
}

export function timeForPosition(items: TripItem[], position: number): string {
  const moved = items[position];
  if (!moved?.startTime) return "12:00";

  const previous = items
    .slice(0, position)
    .toReversed()
    .find((item) => item.startTime);
  const next = items.slice(position + 1).find((item) => item.startTime);
  const previousMinute = previous?.startTime ? parseTime(previous.startTime) : null;
  const nextMinute = next?.startTime ? parseTime(next.startTime) : null;
  if (previousMinute !== null && nextMinute !== null) {
    return formatTime(previousMinute + Math.max(1, Math.floor((nextMinute - previousMinute) / 2)));
  }
  if (previousMinute !== null) {
    return formatTime(previousMinute + Math.max(1, previous?.durationMinutes ?? 1));
  }
  if (nextMinute !== null) {
    return formatTime(nextMinute - Math.max(1, moved.durationMinutes ?? 1));
  }
  return moved.startTime;
}

function parseTime(time: string): number {
  const [hour = "0", minute = "0"] = time.split(":");
  return Number(hour) * 60 + Number(minute);
}

function formatTime(minutes: number): string {
  const bounded = Math.max(0, Math.min(23 * 60 + 59, minutes));
  return `${String(Math.floor(bounded / 60)).padStart(2, "0")}:${String(bounded % 60).padStart(2, "0")}`;
}
