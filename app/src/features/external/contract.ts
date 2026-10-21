import { z } from "zod";
import {
  currencySchema,
  expenseCategories,
  expenseSchema,
  financialIdSchema,
  friendSchema,
  settlementSchema,
  splitSchema,
} from "../expense/model";
import {
  distanceUnitSchema,
  placeReferenceSchema,
  transportModes,
  travelModeSchema,
  tripLanguageSchema,
} from "../trip/model";

export const externalVersion = 1;
export const tripIdSchema = z.string().regex(/^[A-Za-z0-9_-]{20,32}$/);
const recordId = z.string().min(1).max(128);
const expected = z.string().regex(/^[a-f0-9]{64}$/);
const createKey = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const date = z.iso.date();
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const calendarHour = z.number().int().min(0).max(23);
const page = {
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().max(512).optional(),
};

export const expenseInputSchema = z.object({
  id: financialIdSchema,
  description: z.string().trim().max(500),
  category: z.enum(expenseCategories),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: currencySchema,
  payerId: financialIdSchema,
  split: splitSchema,
  itemId: recordId.nullable(),
  date: date.nullable(),
  followsItemDate: z.boolean(),
});

export const paymentInputSchema = z.object({
  id: financialIdSchema,
  fromId: financialIdSchema,
  toId: financialIdSchema,
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: currencySchema,
  note: z.string().max(1_000),
  paidAt: z.string().datetime({ offset: true }),
});

const readSelector = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("snapshot") }),
  z.object({
    kind: z.literal("items"),
    dayId: date.nullable().optional(),
    type: z.enum(["place", "note", "reservation", "lodging", "transport"]).optional(),
    ...page,
  }),
  z.object({ kind: z.literal("item"), id: recordId }),
  z.object({ kind: z.literal("tripmates"), ...page }),
  z.object({ kind: z.literal("tripmate"), id: financialIdSchema }),
  z.object({ kind: z.literal("expenses"), date: date.nullable().optional(), ...page }),
  z.object({ kind: z.literal("expense"), id: financialIdSchema }),
  z.object({ kind: z.literal("payments"), ...page }),
  z.object({ kind: z.literal("payment"), id: financialIdSchema }),
  z.object({ kind: z.literal("finance") }),
]);

const tripPatch = z.object({
  title: z.string().trim().max(200).optional(),
  destination: placeReferenceSchema.optional(),
  timeZone: z.string().min(1).max(100).optional(),
  tripLanguage: tripLanguageSchema.nullable().optional(),
  distanceUnit: distanceUnitSchema.optional(),
  defaultTravelMode: travelModeSchema.optional(),
  calendarStartHour: calendarHour.optional(),
});

const itemInput = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(["place", "note", "reservation", "lodging", "transport"]),
  title: z.string().trim().max(300),
  details: z.string().max(10_000),
  dayId: date.nullable(),
  startTime: clock.nullable(),
  durationMinutes: z.number().int().min(0).max(10_080),
  place: placeReferenceSchema.nullable(),
  reservation: z
    .object({ provider: z.string().max(200), confirmation: z.string().max(200) })
    .nullable(),
  lodging: z
    .object({ startDate: date, endDate: date, leaveTimes: z.record(date, clock) })
    .nullable(),
  transport: z
    .object({
      from: placeReferenceSchema.nullable(),
      to: placeReferenceSchema.nullable(),
      mode: z.enum(transportModes),
      customMode: z.string().trim().max(80),
    })
    .nullable(),
  travelMode: travelModeSchema,
});

const itemPatch = z.object({
  title: z.string().trim().max(300).optional(),
  details: z.string().max(10_000).optional(),
  startTime: clock.nullable().optional(),
  durationMinutes: z.number().int().min(0).max(10_080).optional(),
  place: placeReferenceSchema.nullable().optional(),
  reservation: z
    .object({ provider: z.string().max(200), confirmation: z.string().max(200) })
    .nullable()
    .optional(),
  lodging: z
    .object({ startDate: date, endDate: date, leaveTimes: z.record(date, clock) })
    .nullable()
    .optional(),
  transport: z
    .object({
      from: placeReferenceSchema.nullable(),
      to: placeReferenceSchema.nullable(),
      mode: z.enum(transportModes),
      customMode: z.string().trim().max(80),
    })
    .nullable()
    .optional(),
  travelMode: travelModeSchema.optional(),
});

const timeChoice = z.enum(["earlier", "later"]);

export const externalMethods = {
  "trip.create": z.object({
    idempotencyKey: createKey,
    title: z.string().trim().max(200).optional(),
    startDate: date,
    endDate: date,
    destination: placeReferenceSchema,
    timeZone: z.string().min(1).max(100).optional(),
  }),
  "place.search": z.object({
    query: z.string().trim().min(1).max(200),
    language: tripLanguageSchema.optional(),
  }),
  "trip.read": z.object({ select: readSelector }),
  "trip.update": z.object({ expected, patch: tripPatch }),
  "trip.setDates": z.object({ expected, startDate: date, endDate: date }),
  "trip.changeCurrency": z.object({ expected, currency: currencySchema }),
  "item.create": z.object({
    idempotencyKey: createKey,
    item: itemInput,
    timeChoice: timeChoice.optional(),
  }),
  "item.update": z.object({
    id: recordId,
    expected,
    patch: itemPatch,
    timeChoice: timeChoice.optional(),
  }),
  "item.move": z.object({
    id: recordId,
    expected,
    orderExpected: expected,
    dayId: date.nullable(),
    startTime: clock.nullable(),
    beforeId: recordId.nullable(),
    timeChoice: timeChoice.optional(),
  }),
  "item.reorder": z.object({ expected, order: z.array(recordId).max(500) }),
  "item.remove": z.object({ id: recordId, expected }),
  "tripmate.create": z.object({
    idempotencyKey: createKey,
    id: financialIdSchema,
    name: z.string().trim().min(1).max(100),
    color: z.string().regex(/^#[\da-fA-F]{6}$/),
  }),
  "tripmate.update": z.object({
    id: financialIdSchema,
    expected,
    patch: z.object({
      name: z.string().trim().min(1).max(100).optional(),
      color: z
        .string()
        .regex(/^#[\da-fA-F]{6}$/)
        .optional(),
      archived: z.boolean().optional(),
    }),
  }),
  "tripmate.remove": z.object({ id: financialIdSchema, expected }),
  "expense.create": z.object({ idempotencyKey: createKey, expense: expenseInputSchema }),
  "expense.update": z.object({ expected, expense: expenseInputSchema }),
  "expense.remove": z.object({ id: financialIdSchema, expected }),
  "payment.create": z.object({
    idempotencyKey: createKey,
    payment: paymentInputSchema,
    acknowledgeOverpayment: z.boolean().optional(),
  }),
  "payment.update": z.object({
    expected,
    payment: paymentInputSchema,
    acknowledgeOverpayment: z.boolean().optional(),
  }),
  "payment.remove": z.object({ id: financialIdSchema, expected }),
} as const;

const version = z.string().regex(/^[a-f0-9]{64}$/);
const storedItem = itemInput.extend({ timeChoice: timeChoice.nullable().optional() });
const tripRecord = z.object({
  id: tripIdSchema,
  title: z.string(),
  startDate: date,
  endDate: date,
  timeZone: z.string(),
  destination: placeReferenceSchema,
  tripLanguage: tripLanguageSchema.nullable(),
  distanceUnit: distanceUnitSchema,
  defaultTravelMode: travelModeSchema,
  calendarStartHour: calendarHour,
  currency: currencySchema.nullable(),
});
const snapshot = tripRecord.extend({
  days: z.array(z.object({ id: date, date })),
  order: z.array(recordId),
  items: z.record(recordId, storedItem),
  friends: z.record(financialIdSchema, friendSchema),
  expenses: z.record(financialIdSchema, expenseSchema),
  settlements: z.record(financialIdSchema, settlementSchema),
});
const recordVersions = z.object({
  trip: version,
  order: version,
  items: z.record(recordId, version),
  tripmates: z.record(financialIdSchema, version),
  expenses: z.record(financialIdSchema, version),
  payments: z.record(financialIdSchema, version),
});
const paged = <T extends z.ZodType>(value: T) =>
  z.object({
    records: z.array(z.object({ record: value, version })),
    nextCursor: z.string().nullable(),
  });
const readResult = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("snapshot"), snapshot, versions: recordVersions }),
  z.object({ kind: z.literal("items"), ...paged(storedItem).shape }),
  z.object({ kind: z.literal("item"), record: storedItem, version }),
  z.object({ kind: z.literal("tripmates"), ...paged(friendSchema).shape }),
  z.object({ kind: z.literal("tripmate"), record: friendSchema, version }),
  z.object({ kind: z.literal("expenses"), ...paged(expenseSchema).shape }),
  z.object({ kind: z.literal("expense"), record: expenseSchema, version }),
  z.object({ kind: z.literal("payments"), ...paged(settlementSchema).shape }),
  z.object({ kind: z.literal("payment"), record: settlementSchema, version }),
  z.object({
    kind: z.literal("finance"),
    currency: currencySchema,
    balances: z.record(financialIdSchema, z.number().int()),
    suggestions: z.array(
      z.object({
        fromId: financialIdSchema,
        toId: financialIdSchema,
        amountMinor: z.number().int().positive(),
      }),
    ),
  }),
]);
const itemResult = z.object({ record: storedItem, version, orderVersion: version.optional() });
const tripmateResult = z.object({ record: friendSchema, version });
const expenseResult = z.object({ record: expenseSchema, version });
const paymentResult = z.object({ record: settlementSchema, version });
const removed = z.object({ removed: z.literal(true) });

export const externalResults = {
  "trip.create": z.object({ id: tripIdSchema, url: z.string().url() }),
  "place.search": z.object({
    places: z.array(
      z.object({
        placeId: z.string(),
        displayName: z.string(),
        formattedAddress: z.string().nullable(),
      }),
    ),
  }),
  "trip.read": readResult,
  "trip.update": z.object({ record: tripRecord, version }),
  "trip.setDates": z.object({ record: tripRecord, version }),
  "trip.changeCurrency": z.object({ record: tripRecord, version }),
  "item.create": itemResult,
  "item.update": itemResult,
  "item.move": itemResult,
  "item.reorder": z.object({ order: z.array(recordId), version }),
  "item.remove": removed.extend({ orderVersion: version }),
  "tripmate.create": tripmateResult,
  "tripmate.update": tripmateResult,
  "tripmate.remove": removed,
  "expense.create": expenseResult,
  "expense.update": expenseResult,
  "expense.remove": removed,
  "payment.create": paymentResult,
  "payment.update": paymentResult,
  "payment.remove": removed,
} as const satisfies Record<ExternalMethod, z.ZodType>;

export const tripChangeSchema = z.object({
  trip: z.boolean(),
  order: z.boolean(),
  items: z.array(recordId),
  tripmates: z.array(financialIdSchema),
  expenses: z.array(financialIdSchema),
  payments: z.array(financialIdSchema),
});

export type ExternalMethod = keyof typeof externalMethods;
export type ExternalParams<M extends ExternalMethod> = z.input<(typeof externalMethods)[M]>;

export type TripChange = {
  trip: boolean;
  order: boolean;
  items: string[];
  tripmates: string[];
  expenses: string[];
  payments: string[];
};

export class ExternalError extends Error {
  constructor(
    readonly code:
      | "INVALID_PARAMS"
      | "NOT_FOUND"
      | "CONFLICT"
      | "RATE_LIMIT"
      | "PROVIDER_UNAVAILABLE"
      | "FORBIDDEN",
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "ExternalError";
  }
}
