import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

export const itemTypes = ["place", "note", "reservation", "lodging", "transport"] as const;
export const travelModes = ["DRIVING", "TRANSIT", "WALKING"] as const;
export const transportModes = ["plane", "train", "bus", "ferry", "custom"] as const;
export const tripLanguages = ["en", "de", "es", "fr", "it", "ja", "zh-CN", "zh-TW"] as const;
export const distanceUnits = ["metric", "imperial"] as const;
export const travelModeLabels = {
  DRIVING: "Car",
  TRANSIT: "Public Transport",
  WALKING: "Walk",
} as const satisfies Record<TravelMode, string>;
export type TransportMode = (typeof transportModes)[number];
export type Transport = {
  from: PlaceReference | null;
  to: PlaceReference | null;
  mode: TransportMode;
  customMode: string;
};

export type ItemType = (typeof itemTypes)[number];
export type TravelMode = (typeof travelModes)[number];
export type TripLanguage = (typeof tripLanguages)[number];
export type DistanceUnit = (typeof distanceUnits)[number];
export type TripSettings = {
  language: TripLanguage;
  distanceUnit: DistanceUnit;
  defaultTravelMode: TravelMode;
};

export type PlaceReference = {
  placeId: string;
};

export type Reservation = {
  provider: string;
  confirmation: string;
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
  transport: Transport | null;
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
  language: TripLanguage;
  distanceUnit: DistanceUnit;
  defaultTravelMode: TravelMode;
  days: TripDay[];
  order: string[];
  items: Record<string, TripItem>;
};

export type NewTripInput = {
  title?: string;
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
export const tripLanguageSchema = z.enum(tripLanguages);
export const distanceUnitSchema = z.enum(distanceUnits);
export const travelModeSchema = z.enum(travelModes);
export const tripSettingsSchema = z.object({
  language: tripLanguageSchema,
  distanceUnit: distanceUnitSchema,
  defaultTravelMode: travelModeSchema,
});

export const placeReferenceSchema = z.object({
  placeId: z.string().min(1).max(255),
});

export const newTripSchema = z
  .object({
    title: z.string().trim().max(200).default(""),
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

export const tripItemSchema = z
  .object({
    id: z.string().min(1).max(64),
    type: z.enum(itemTypes),
    title: z.string().trim().max(300),
    details: z.string().max(10_000),
    dayId: z.string().max(32).nullable(),
    startTime: localTime,
    durationMinutes: z.number().int().min(0).max(10_080),
    place: placeReferenceSchema.nullable(),
    reservation: z
      .object({
        provider: z.string().max(200),
        confirmation: z.string().max(200),
      })
      .nullable(),
    lodging: z.object({ startDate: isoDate, endDate: isoDate }).nullable(),
    transport: z
      .object({
        from: placeReferenceSchema.nullable(),
        to: placeReferenceSchema.nullable(),
        mode: z.enum(transportModes),
        customMode: z.string().trim().max(80),
      })
      .nullable()
      .default(null),
    travelMode: travelModeSchema,
  })
  .refine((item) => item.type === "place" || Boolean(item.place) || item.title.length > 0, {
    path: ["title"],
    message: "Enter an item title",
  })
  .refine((item) => item.transport?.mode !== "custom" || item.transport.customMode.length > 0, {
    path: ["transport", "customMode"],
    message: "Enter a travel method",
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
    language: "en",
    distanceUnit: "metric",
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
  if ((type === "reservation" || type === "lodging") && !partial.place) {
    throw new Error("Choose a place for this item");
  }
  if (type === "reservation" && (!dayId || !partial.startTime)) {
    throw new Error("Choose a date and time for this reservation");
  }
  return tripItemSchema.parse({
    id: partial.id ?? crypto.randomUUID(),
    type,
    title: partial.title ?? (type === "place" || partial.place ? "" : defaultItemTitle(type)),
    details: partial.details ?? "",
    dayId,
    startTime: partial.startTime ?? null,
    durationMinutes: partial.durationMinutes ?? 60,
    place: partial.place ?? null,
    reservation: partial.reservation ?? null,
    lodging: partial.lodging ?? null,
    transport:
      partial.transport ??
      (type === "transport" ? { from: null, to: null, mode: "train", customMode: "" } : null),
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

export function arrivalTimeFor(startTime: string | null, durationMinutes: number): string {
  const departureMinutes = timeInMinutes(startTime);
  if (departureMinutes === null) return "";
  const arrivalMinutes = (departureMinutes + durationMinutes) % (24 * 60);
  const hours = String(Math.floor(arrivalMinutes / 60)).padStart(2, "0");
  const minutes = String(arrivalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function durationBetween(departureTime: string, arrivalTime: string): number {
  const departureMinutes = timeInMinutes(departureTime);
  const arrivalMinutes = timeInMinutes(arrivalTime);
  if (departureMinutes === null || arrivalMinutes === null) return 0;
  return (arrivalMinutes - departureMinutes + 24 * 60) % (24 * 60);
}

function timeInMinutes(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
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
