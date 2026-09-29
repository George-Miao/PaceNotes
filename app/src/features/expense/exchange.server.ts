import { z } from "zod";
import { type Conversion, currencySchema } from "./model";
import { revalueAtRate } from "./money";

const defaultBaseUrl = "https://api.frankfurter.dev";
const freshForMs = 24 * 60 * 60 * 1_000 - 1;
const rateSchema = z.object({
  date: z.iso.date(),
  base: currencySchema,
  quote: currencySchema,
  rate: z.number().finite().positive(),
});

type Quote = z.infer<typeof rateSchema>;
type CachedQuote = { quote: Quote; expiresAt: number };
const cache = new Map<string, CachedQuote>();
const pending = new Map<string, Promise<Quote>>();

function providerBaseUrl(): string {
  const url = new URL(process.env.FRANKFURTER_URL ?? defaultBaseUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Invalid Frankfurter URL configuration");
  }
  return url.href.replace(/\/$/, "");
}

async function rateFor(base: string, quote: string, date: string | null): Promise<Quote> {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  // Today's and future-dated expenses use the latest available reference rate.
  // Only completed historical dates can be cached indefinitely.
  const historicalDate = date && date < today ? date : null;
  const baseUrl = providerBaseUrl();
  const key = `${baseUrl}|${base}|${quote}|${historicalDate ?? "latest"}`;
  const stored = cache.get(key);
  if (stored && stored.expiresAt > now) return stored.quote;
  const active = pending.get(key);
  if (active) return active;
  const request = (async () => {
    const url = new URL(`${baseUrl}/v2/rate/${base}/${quote}`);
    if (historicalDate) url.searchParams.set("date", historicalDate);
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("Exchange rate unavailable");
    const body = await response.text();
    if (body.length > 8_192) throw new Error("Invalid exchange-rate response");
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error("Invalid exchange-rate response");
    }
    const result = rateSchema.parse(parsed);
    if (
      result.base !== base ||
      result.quote !== quote ||
      (historicalDate && result.date > historicalDate) ||
      result.date > today
    ) {
      throw new Error("Exchange-rate response does not match the requested pair or date");
    }
    cache.set(key, {
      quote: result,
      expiresAt: historicalDate ? Number.POSITIVE_INFINITY : now + freshForMs,
    });
    return result;
  })();
  pending.set(key, request);
  try {
    return await request;
  } finally {
    pending.delete(key);
  }
}

// This server-only entry point is shared by the client server-function and currency rebase.
export async function conversionFor(
  amountMinor: number,
  currency: string,
  tripCurrency: string,
  date: string | null,
): Promise<Conversion> {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new RangeError("An amount must be positive minor units");
  }
  currencySchema.parse(currency);
  currencySchema.parse(tripCurrency);
  if (date !== null) z.iso.date().parse(date);
  const today = new Date().toISOString().slice(0, 10);
  if (currency === tripCurrency) {
    return {
      amountMinor,
      rate: 1,
      requestedDate: date,
      observedDate: date ?? today,
      source: "identity",
      stale: false,
    };
  }
  const quote = await rateFor(currency, tripCurrency, date);
  return {
    amountMinor: revalueAtRate(amountMinor, currency, tripCurrency, quote.rate),
    rate: quote.rate,
    requestedDate: date,
    observedDate: quote.date,
    source: "Frankfurter v2 blended",
    stale: false,
  };
}
