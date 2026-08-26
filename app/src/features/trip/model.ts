import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

export const itemTypes = ["place", "note", "reservation", "lodging", "transport"] as const;
export const travelModes = ["DRIVING", "TRANSIT", "WALKING"] as const;

export type ItemType = (typeof itemTypes)[number];
export type TravelMode = (typeof travelModes)[number];

export type PlaceReference = {
  placeId: string;
};

export type Reservation = {
  provider: string;
  confirmation: string;
  bookingDate: string | null;
};

export type Lodging = {
  startDate: string;
  endDate: string;
};

export type TripItem = {
  id: string;
  type: ItemType;
  title: string;
  details: string;
  dayId: string | null;
  startTime: string | null;
  durationMinutes: number;
  place: PlaceReference | null;
  reservation: Reservation | null;
  lodging: Lodging | null;
  travelMode: TravelMode;
};

export type TripDay = {
  id: string;
  date: string;
};

export type TripSnapshot = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  destination: PlaceReference;
  defaultTravelMode: TravelMode;
  days: TripDay[];
  order: string[];
  items: Record<string, TripItem>;
};

export type NewTripInput = {
  title: string;
  startDate: string;
  endDate: string;
  destination: PlaceReference;
  timeZone: string;
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const localTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .nullable();

export const placeReferenceSchema = z.object({
  placeId: z.string().min(1).max(255),
});

export const newTripSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    startDate: isoDate,
    endDate: isoDate,
    destination: placeReferenceSchema,
    timeZone: z.string().min(1).max(100),
  })
  .superRefine((value, context) => {
    const days = tripDates(value.startDate, value.endDate);
    if (days.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "End date must not be before start date",
      });
    }
    if (days.length > 30) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "A trip can contain at most 30 days",
      });
    }
  });

export const tripItemSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(itemTypes),
  title: z.string().trim().min(1).max(300),
  details: z.string().max(10_000),
  dayId: z.string().max(32).nullable(),
  startTime: localTime,
  durationMinutes: z.number().int().min(0).max(10_080),
  place: placeReferenceSchema.nullable(),
  reservation: z
    .object({
      provider: z.string().max(200),
      confirmation: z.string().max(200),
      bookingDate: isoDate.nullable(),
    })
    .nullable(),
  lodging: z.object({ startDate: isoDate, endDate: isoDate }).nullable(),
  travelMode: z.enum(travelModes),
});

export function tripDates(startDate: string, endDate: string): string[] {
  let current: Temporal.PlainDate;
  let end: Temporal.PlainDate;
  try {
    current = Temporal.PlainDate.from(startDate);
    end = Temporal.PlainDate.from(endDate);
  } catch {
    return [];
  }

  if (Temporal.PlainDate.compare(current, end) > 0) return [];
  const dates: string[] = [];
  while (Temporal.PlainDate.compare(current, end) <= 0 && dates.length <= 30) {
    dates.push(current.toString());
    current = current.add({ days: 1 });
  }
  return dates;
}

export function createInitialSnapshot(id: string, input: NewTripInput): TripSnapshot {
  const parsed = newTripSchema.parse(input);
  const days = tripDates(parsed.startDate, parsed.endDate).map((date) => ({ id: date, date }));
  return {
    id,
    title: parsed.title,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    timeZone: parsed.timeZone,
    destination: parsed.destination,
    defaultTravelMode: "DRIVING",
    days,
    order: [],
    items: {},
  };
}

export function itemForCreate(
  type: ItemType,
  dayId: string | null,
  partial: Partial<TripItem> = {},
): TripItem {
  return tripItemSchema.parse({
    id: partial.id ?? crypto.randomUUID(),
    type,
    title: partial.title ?? defaultItemTitle(type),
    details: partial.details ?? "",
    dayId,
    startTime: partial.startTime ?? null,
    durationMinutes: partial.durationMinutes ?? 60,
    place: partial.place ?? null,
    reservation: partial.reservation ?? null,
    lodging: partial.lodging ?? null,
    travelMode: partial.travelMode ?? "DRIVING",
  });
}

export function defaultItemTitle(type: ItemType): string {
  switch (type) {
    case "place":
      return "New place";
    case "note":
      return "New note";
    case "reservation":
      return "New reservation";
    case "lodging":
      return "New lodging";
    case "transport":
      return "New transport";
  }
}

export function reorder<T>(items: readonly T[], source: number, destination: number): T[] {
  if (source === destination) return [...items];
  if (source < 0 || source >= items.length || destination < 0 || destination >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(source, 1);
  if (moved === undefined) return next;
  next.splice(destination, 0, moved);
  return next;
}

export function resolveLocalTime(
  date: string,
  time: string,
  timeZone: string,
  disambiguation: "reject" | "earlier" | "later" = "reject",
): string {
  return Temporal.ZonedDateTime.from(`${date}T${time}[${timeZone}]`, { disambiguation })
    .toInstant()
    .toString();
}
