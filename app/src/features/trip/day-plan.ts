import type { TripDay, TripItem } from "./model";

export type DayPlan = {
  day: TripDay;
  items: TripItem[];
  start: TripItem[];
  end: TripItem[];
};

export function buildDayPlans(items: TripItem[], days: TripDay[]): DayPlan[] {
  const stays = items.filter(
    (item) =>
      item.type === "lodging" &&
      item.dayId !== null &&
      item.lodging &&
      item.lodging.endDate > item.lodging.startDate &&
      item.lodging.startDate <= (days.at(-1)?.date ?? "") &&
      item.lodging.endDate >= (days[0]?.date ?? ""),
  );
  const stayIds = new Set(stays.map((item) => item.id));
  const ordinary = new Map<string, TripItem[]>();
  for (const item of items) {
    if (!item.dayId || stayIds.has(item.id)) continue;
    const group = ordinary.get(item.dayId);
    if (group) group.push(item);
    else ordinary.set(item.dayId, [item]);
  }
  return days.map((day) => ({
    day,
    items: orderDayItems(ordinary.get(day.id) ?? []),
    start: stays.filter(
      (item) =>
        item.lodging && item.lodging.startDate < day.date && day.date <= item.lodging.endDate,
    ),
    end: stays.filter(
      (item) =>
        item.lodging && item.lodging.startDate <= day.date && day.date < item.lodging.endDate,
    ),
  }));
}
function orderDayItems(items: TripItem[]): TripItem[] {
  // All entries share a day and trip time zone. Keep invalid local times visible for correction.
  const timed = items
    .filter((item) => item.startTime)
    .toSorted((left, right) => (left.startTime ?? "").localeCompare(right.startTime ?? ""));
  let cursor = 0;
  return items.map((item) => (item.startTime ? (timed[cursor++] ?? item) : item));
}

export function routeContinuations(
  order: readonly string[],
  legs: readonly { fromId: string; toId: string }[],
): ReadonlySet<string> {
  const positions = new Map(order.map((id, index) => [id, index]));
  const continuations = new Set<string>();
  for (const leg of legs) {
    const from = positions.get(leg.fromId);
    const to = positions.get(leg.toId);
    if (from === undefined || to === undefined) continue;
    for (let index = from + 1; index < to; index += 1) {
      const id = order[index];
      if (id) continuations.add(id);
    }
  }
  return continuations;
}
