import { z } from "zod";
import { supportedCurrencies } from "./currency-data";

export const expenseCategories = [
  "food",
  "transport",
  "lodging",
  "activities",
  "shopping",
  "fees",
  "other",
] as const;
export type ExpenseCategory = (typeof expenseCategories)[number];

export const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .refine(
    (value) => supportedCurrencies.includes(value as (typeof supportedCurrencies)[number]),
    "Unsupported currency",
  );
const amountSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const financialIdSchema = z.uuid();
const isoDateSchema = z.iso.date();

// Keep these stored names for existing trips. A Friend record is one tripmate identity.
export const friendSchema = z.object({
  id: financialIdSchema,
  name: z.string().trim().min(1).max(100),
  color: z.string().regex(/^#[\da-fA-F]{6}$/),
  archived: z.boolean(),
});
export type Friend = z.infer<typeof friendSchema>;

export const conversionSchema = z.object({
  amountMinor: amountSchema,
  rate: z.number().finite().positive(),
  requestedDate: isoDateSchema.nullable(),
  observedDate: isoDateSchema,
  source: z.string().min(1).max(128),
  stale: z.boolean(),
});
export type Conversion = z.infer<typeof conversionSchema>;

const participantIdsSchema = z
  .array(financialIdSchema)
  .min(1)
  .refine((ids) => new Set(ids).size === ids.length, "Each tripmate may appear only once");

export const splitSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("payer") }),
  z.object({
    kind: z.literal("equal"),
    friendIds: participantIdsSchema,
  }),
  z.object({
    kind: z.literal("exact"),
    // Exact shares are in the expense's original currency, not the trip currency.
    shares: z
      .record(financialIdSchema, amountSchema)
      .refine((shares) => Object.keys(shares).length > 0, "Select at least one tripmate"),
  }),
  z
    .object({
      kind: z.literal("mixed"),
      friendIds: participantIdsSchema,
      // Only specified shares are stored. Unspecified tripmates split the remainder.
      shares: z.record(financialIdSchema, amountSchema),
    })
    .refine(({ friendIds, shares }) => {
      const specified = Object.keys(shares);
      return (
        specified.length > 0 &&
        specified.length < friendIds.length &&
        specified.every((id) => friendIds.includes(id))
      );
    }),
]);
export type Split = z.infer<typeof splitSchema>;

export const expenseSchema = z
  .object({
    id: financialIdSchema,
    description: z.string().trim().max(500),
    category: z.enum(expenseCategories),
    amountMinor: amountSchema,
    currency: currencySchema,
    payerId: financialIdSchema,
    split: splitSchema,
    itemId: z.string().min(1).max(128).nullable(),
    date: isoDateSchema.nullable(),
    followsItemDate: z.boolean(),
    conversion: conversionSchema,
  })
  .superRefine((expense, context) => {
    const { split, amountMinor } = expense;
    if (split.kind === "payer") return;
    if (split.kind === "equal") {
      if (amountMinor < split.friendIds.length) {
        context.addIssue({
          code: "custom",
          path: ["split", "friendIds"],
          message: "Every tripmate needs at least one original-currency minor unit",
        });
      }
      return;
    }
    const specified = Object.values(split.shares);
    const total = specified.reduce((sum, share) => sum + BigInt(share), 0n);
    if (split.kind === "exact" && total !== BigInt(amountMinor)) {
      context.addIssue({
        code: "custom",
        path: ["split", "shares"],
        message: "Exact shares must total the original expense amount",
      });
    }
    if (split.kind === "mixed") {
      const unspecified = split.friendIds.length - specified.length;
      if (BigInt(amountMinor) - total < BigInt(unspecified)) {
        context.addIssue({
          code: "custom",
          path: ["split", "shares"],
          message: "The remaining amount must give every unspecified tripmate a positive share",
        });
      }
    }
  });
export type Expense = z.infer<typeof expenseSchema>;

export const settlementSchema = z
  .object({
    id: financialIdSchema,
    fromId: financialIdSchema,
    toId: financialIdSchema,
    amountMinor: amountSchema,
    currency: currencySchema,
    conversion: conversionSchema,
    note: z.string().max(1_000),
    paidAt: z.string().datetime({ offset: true }),
  })
  .refine((settlement) => settlement.fromId !== settlement.toId, {
    path: ["toId"],
    message: "A settlement needs two different tripmates",
  });
export type Settlement = z.infer<typeof settlementSchema>;
