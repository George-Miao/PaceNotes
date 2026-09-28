import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { conversionFor } from "./exchange.server";
import { type Conversion, currencySchema } from "./model";

const requestSchema = z.object({
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: currencySchema,
  tripCurrency: currencySchema,
  date: z.iso.date().nullable(),
});

const requestConversion = createServerFn({ method: "POST" })
  .validator(requestSchema)
  .handler(
    async ({ data }): Promise<Conversion> =>
      conversionFor(data.amountMinor, data.currency, data.tripCurrency, data.date),
  );

export async function convertExpense(
  amountMinor: number,
  currency: string,
  tripCurrency: string,
  date: string | null,
): Promise<Conversion> {
  return requestConversion({ data: { amountMinor, currency, tripCurrency, date } });
}

const readSettlementTimestamp = createServerFn({ method: "POST" }).handler(
  async (): Promise<string> => new Date().toISOString(),
);

export async function settlementTimestamp(): Promise<string> {
  return readSettlementTimestamp();
}
