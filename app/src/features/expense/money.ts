import type { TripSnapshot } from "../trip/model";
import { countryCurrencies, currencyDigitOverrides, supportedCurrencies } from "./currency-data";
import type { Expense, ExpenseCategory } from "./model";

export { supportedCurrencies } from "./currency-data";

const supportedCurrencySet: ReadonlySet<string> = new Set(supportedCurrencies);
const maximumSafe = BigInt(Number.MAX_SAFE_INTEGER);

function safeAmount(amount: bigint): number {
  if (amount > maximumSafe || amount < -maximumSafe) {
    throw new RangeError("Money total exceeds the safe integer range");
  }
  return Number(amount);
}

export function currencyForCountry(countryCode: string): string | null {
  return countryCurrencies[countryCode.trim().toUpperCase()] ?? null;
}

export function browserCurrency(): string | null {
  if (typeof navigator === "undefined") return null;
  for (const locale of navigator.languages.length ? navigator.languages : [navigator.language]) {
    try {
      const parsed = new Intl.Locale(locale);
      const country = parsed.region ?? parsed.maximize().region;
      if (country) {
        const currency = currencyForCountry(country);
        if (currency) return currency;
      }
    } catch {
      // Continue with the next browser locale when this locale is not well formed.
    }
  }
  return null;
}

export function currencyDigits(currency: string): number {
  if (!supportedCurrencySet.has(currency)) throw new RangeError("Unsupported currency");
  return currencyDigitOverrides[currency] ?? 2;
}

// Allow partial amounts while editing; toMinor checks complete values on save.
export function isMoneyInput(value: string, currency: string): boolean {
  const digits = currencyDigits(currency);
  if (!/^\d*(?:\.\d*)?$/.test(value)) return false;
  const point = value.indexOf(".");
  return point === -1 || (digits > 0 && value.length - point - 1 <= digits);
}

export function toMinor(value: string | number, currency: string): number {
  const digits = currencyDigits(currency);
  const text = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new RangeError("Enter a decimal monetary amount");
  const [, sign, whole, rawFraction = ""] = match;
  const fraction = rawFraction.replace(/0+$/, "");
  if (fraction.length > digits) throw new RangeError("Too many digits for this currency");
  const scale = 10n ** BigInt(digits);
  const amount = BigInt(whole ?? "0") * scale + BigInt(fraction.padEnd(digits, "0") || "0");
  return safeAmount(sign === "-" ? -amount : amount);
}

// Rates are decimal rationals, not binary floating-point multiplication inputs.
export function revalueAtRate(
  amountMinor: number,
  fromCurrency: string,
  toCurrency: string,
  rate: number,
): number {
  if (
    !Number.isSafeInteger(amountMinor) ||
    amountMinor <= 0 ||
    !Number.isFinite(rate) ||
    rate <= 0
  ) {
    throw new RangeError("A positive, finite amount and rate are required");
  }
  const fromScale = 10n ** BigInt(currencyDigits(fromCurrency));
  const toScale = 10n ** BigInt(currencyDigits(toCurrency));
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(rate));
  if (!match) throw new RangeError("Invalid decimal exchange rate");
  const [, whole = "0", fraction = "", rawExponent = "0"] = match;
  const exponent = Number(rawExponent) - fraction.length;
  const coefficient = BigInt(whole + fraction);
  const numerator =
    BigInt(amountMinor) * coefficient * toScale * (exponent > 0 ? 10n ** BigInt(exponent) : 1n);
  const denominator = fromScale * (exponent < 0 ? 10n ** BigInt(-exponent) : 1n);
  const result = safeAmount((numerator + denominator / 2n) / denominator);
  if (result <= 0) throw new RangeError("Converted amount is below one minor unit");
  return result;
}

type MoneyFormatter = {
  integer: Intl.NumberFormat;
  fraction: Intl.NumberFormat | null;
  positive: Intl.NumberFormatPart[];
  negative: Intl.NumberFormatPart[];
};
const displayLocale = new Intl.NumberFormat().resolvedOptions().locale;
const moneyFormatters = new Map<string, MoneyFormatter>();
const currencySymbols = new Map<string, string>();

export function currencySymbol(currency: string): string {
  currencyDigits(currency);
  let symbol = currencySymbols.get(currency);
  if (!symbol) {
    symbol =
      new Intl.NumberFormat(displayLocale, {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
      })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value ?? currency;
    currencySymbols.set(currency, symbol);
  }
  return symbol;
}

export function formatMoney(amountMinor: number, currency: string): string {
  const digits = currencyDigits(currency);
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError("Invalid minor-unit amount");
  const key = `${displayLocale}:${currency}`;
  let formatter = moneyFormatters.get(key);
  if (!formatter) {
    const currencyFormatter = new Intl.NumberFormat(displayLocale, {
      style: "currency",
      currency,
      currencyDisplay: "code",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    formatter = {
      integer: new Intl.NumberFormat(displayLocale, { maximumFractionDigits: 0 }),
      fraction: digits
        ? new Intl.NumberFormat(displayLocale, {
            useGrouping: false,
            minimumIntegerDigits: digits,
            maximumFractionDigits: 0,
          })
        : null,
      positive: currencyFormatter.formatToParts(1),
      negative: currencyFormatter.formatToParts(-1),
    };
    moneyFormatters.set(key, formatter);
  }
  const absolute = BigInt(amountMinor < 0 ? -amountMinor : amountMinor);
  const scale = 10n ** BigInt(digits);
  const integer = formatter.integer.format(absolute / scale);
  const fraction = formatter.fraction?.format(Number(absolute % scale)) ?? "";
  let result = "";
  for (const part of amountMinor < 0 ? formatter.negative : formatter.positive) {
    result += part.type === "integer" ? integer : part.type === "fraction" ? fraction : part.value;
  }
  return result;
}

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function allocateShares(amountMinor: number, weights: [string, bigint][]): Record<string, number> {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !weights.length) {
    throw new RangeError("A positive amount and at least one tripmate are required");
  }
  const totalWeight = weights.reduce((total, [, weight]) => total + weight, 0n);
  if (totalWeight <= 0n || weights.some(([, weight]) => weight <= 0n)) {
    throw new RangeError("Each split weight must be positive");
  }
  const amount = BigInt(amountMinor);
  const shares = weights.map(([id, weight]) => ({
    id,
    amount: (amount * weight) / totalWeight,
    remainder: (amount * weight) % totalWeight,
  }));
  let leftover = amount - shares.reduce((total, share) => total + share.amount, 0n);
  shares.sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return compareId(a.id, b.id);
  });
  for (const share of shares) {
    if (leftover === 0n) break;
    share.amount += 1n;
    leftover -= 1n;
  }
  const result: Record<string, number> = Object.create(null);
  for (const share of shares) result[share.id] = safeAmount(share.amount);
  return result;
}

// Resolve shares in the expense currency before converting them as one rounded total.
function originalShares(expense: Expense): Record<string, number> {
  const { split, amountMinor } = expense;
  if (split.kind === "payer") return { [expense.payerId]: amountMinor };
  if (split.kind === "exact") {
    const entries = Object.entries(split.shares);
    if (
      !entries.length ||
      entries.some(([, amount]) => !Number.isSafeInteger(amount) || amount <= 0) ||
      entries.reduce((sum, [, amount]) => sum + BigInt(amount), 0n) !== BigInt(amountMinor)
    ) {
      throw new RangeError("Exact shares do not total the expense");
    }
    return split.shares;
  }
  const selected = new Set(split.friendIds);
  if (!selected.size || selected.size !== split.friendIds.length) {
    throw new RangeError("A shared split needs distinct tripmates");
  }
  const specified = split.kind === "mixed" ? Object.entries(split.shares) : [];
  if (
    split.kind === "mixed" &&
    (!specified.length ||
      specified.length >= selected.size ||
      specified.some(
        ([id, amount]) => !selected.has(id) || !Number.isSafeInteger(amount) || amount <= 0,
      ))
  ) {
    throw new RangeError("A mixed split needs positive shares for some selected tripmates");
  }
  const remaining =
    BigInt(amountMinor) - specified.reduce((sum, [, amount]) => sum + BigInt(amount), 0n);
  const unspecified = split.friendIds
    .filter((id) => split.kind !== "mixed" || !(id in split.shares))
    .sort(compareId);
  if (remaining < BigInt(unspecified.length)) {
    throw new RangeError("Every selected tripmate needs a positive share");
  }
  const base = remaining / BigInt(unspecified.length);
  const extra = remaining % BigInt(unspecified.length);
  const shares: Record<string, number> = Object.fromEntries(specified);
  for (const [index, id] of unspecified.entries()) {
    shares[id] = safeAmount(base + (BigInt(index) < extra ? 1n : 0n));
  }
  return shares;
}

function convertedShares(
  expense: Expense,
  original: Record<string, number>,
): Record<string, number> {
  return allocateShares(
    expense.conversion.amountMinor,
    Object.entries(original).map(([id, amount]) => [id, BigInt(amount)]),
  );
}

// Returned shares are in the trip currency; fixed and residual weights are in the original currency.
export function expenseShares(_snapshot: TripSnapshot, expense: Expense): Record<string, number> {
  if (expense.split.kind === "payer") {
    return { [expense.payerId]: expense.conversion.amountMinor };
  }
  return convertedShares(expense, originalShares(expense));
}

export function balances(snapshot: TripSnapshot): Record<string, number> {
  const ledger = new Map<string, bigint>(Object.keys(snapshot.friends).map((id) => [id, 0n]));
  const add = (id: string, value: bigint): void => {
    const previous = ledger.get(id);
    if (previous === undefined) throw new RangeError("Unknown tripmate in financial record");
    ledger.set(id, previous + value);
  };
  if (
    !snapshot.currency &&
    (Object.keys(snapshot.expenses).length || Object.keys(snapshot.settlements).length)
  ) {
    throw new RangeError("Financial records require a trip currency");
  }
  for (const expense of Object.values(snapshot.expenses)) {
    add(expense.payerId, BigInt(expense.conversion.amountMinor));
    for (const [id, amount] of Object.entries(expenseShares(snapshot, expense))) {
      add(id, -BigInt(amount));
    }
  }
  for (const settlement of Object.values(snapshot.settlements)) {
    const amount = BigInt(settlement.conversion.amountMinor);
    add(settlement.fromId, amount);
    add(settlement.toId, -amount);
  }
  return Object.fromEntries([...ledger].map(([id, amount]) => [id, safeAmount(amount)]));
}

export type SettlementSuggestion = { fromId: string; toId: string; amountMinor: number };

function compareSuggestion(a: SettlementSuggestion, b: SettlementSuggestion): number {
  return (
    compareId(a.fromId, b.fromId) || compareId(a.toId, b.toId) || a.amountMinor - b.amountMinor
  );
}

export function suggestSettlements(snapshot: TripSnapshot): SettlementSuggestion[] {
  const entries = Object.entries(balances(snapshot))
    .filter(([, amount]) => amount !== 0)
    .sort(([a], [b]) => compareId(a, b));
  const ids = entries.map(([id]) => id);
  const values = entries.map(([, amount]) => BigInt(amount));
  if (values.reduce((total, value) => total + value, 0n) !== 0n) {
    throw new RangeError("Trip balances must sum to zero");
  }
  const memo = new Map<string, SettlementSuggestion[]>();
  const settle = (): SettlementSuggestion[] => {
    const first = values.findIndex((amount) => amount !== 0n);
    if (first < 0) return [];
    const key = values.join(",");
    const known = memo.get(key);
    if (known) return known;
    const original = values[first];
    const firstId = ids[first];
    if (original === undefined || firstId === undefined) {
      throw new RangeError("Trip balances are incomplete");
    }
    let best: SettlementSuggestion[] | null = null;
    const tried = new Set<bigint>();
    for (let next = first + 1; next < values.length; next++) {
      const opposite = values[next];
      const nextId = ids[next];
      if (opposite === undefined || nextId === undefined) {
        throw new RangeError("Trip balances are incomplete");
      }
      if (opposite === 0n || original < 0n === opposite < 0n || tried.has(opposite)) {
        continue;
      }
      tried.add(opposite);
      const amount =
        (original < 0n ? -original : original) < (opposite < 0n ? -opposite : opposite)
          ? original < 0n
            ? -original
            : original
          : opposite < 0n
            ? -opposite
            : opposite;
      values[first] = original + (original < 0n ? amount : -amount);
      values[next] = opposite + (opposite < 0n ? amount : -amount);
      const payment: SettlementSuggestion =
        original < 0n
          ? { fromId: firstId, toId: nextId, amountMinor: safeAmount(amount) }
          : { fromId: nextId, toId: firstId, amountMinor: safeAmount(amount) };
      const candidate = [payment, ...settle()];
      values[first] = original;
      values[next] = opposite;
      candidate.sort(compareSuggestion);
      if (
        !best ||
        candidate.length < best.length ||
        (candidate.length === best.length && compareSuggestionLists(candidate, best) < 0)
      ) {
        best = candidate;
      }
      if (original + opposite === 0n) break;
    }
    if (!best) throw new RangeError("Trip balances cannot be settled");
    memo.set(key, best);
    return best;
  };
  return settle();
}

function compareSuggestionLists(a: SettlementSuggestion[], b: SettlementSuggestion[]): number {
  for (let index = 0; index < a.length; index++) {
    const left = a[index];
    const right = b[index];
    if (!left || !right) return left ? 1 : right ? -1 : 0;
    const difference = compareSuggestion(left, right);
    if (difference) return difference;
  }
  return 0;
}

export function categoryTotals(snapshot: TripSnapshot): Record<ExpenseCategory, number> {
  const totals: Record<ExpenseCategory, bigint> = {
    food: 0n,
    transport: 0n,
    lodging: 0n,
    activities: 0n,
    shopping: 0n,
    fees: 0n,
    other: 0n,
  };
  for (const expense of Object.values(snapshot.expenses)) {
    totals[expense.category] += BigInt(expense.conversion.amountMinor);
  }
  return {
    food: safeAmount(totals.food),
    transport: safeAmount(totals.transport),
    lodging: safeAmount(totals.lodging),
    activities: safeAmount(totals.activities),
    shopping: safeAmount(totals.shopping),
    fees: safeAmount(totals.fees),
    other: safeAmount(totals.other),
  };
}

const csvColumns = [
  "record_type",
  "expense_id",
  "settlement_id",
  "date",
  "description",
  "category",
  "item_id",
  "item_title",
  "role",
  "tripmate_name",
  "payer_name",
  "from_name",
  "to_name",
  "split_kind",
  "amount_minor",
  "currency",
  "trip_amount_minor",
  "trip_currency",
  "expense_total_minor",
  "share_weight",
  "share_weight_total",
  "fx_rate",
  "fx_requested_date",
  "fx_observed_date",
  "fx_source",
  "fx_stale",
  "note",
  "paid_at",
  "share_specified",
] as const;
type CsvColumn = (typeof csvColumns)[number];
type CsvRow = Partial<Record<CsvColumn, string | number | boolean>>;

function csvCell(value: string | number | boolean | undefined): string {
  if (value === undefined) return "";
  const text = String(value);
  // Avoid spreadsheet formula execution from names, descriptions, notes and record IDs.
  const safe = /^\s*(?:[=+\-@]|\t|\r|\n)/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function exportExpensesCsv(snapshot: TripSnapshot): string {
  const rows: CsvRow[] = [];
  const friendName = (id: string): string => snapshot.friends[id]?.name ?? "";
  const sortedExpenses = Object.values(snapshot.expenses).sort(
    (a, b) => compareId(a.date ?? "\uffff", b.date ?? "\uffff") || compareId(a.id, b.id),
  );
  for (const expense of sortedExpenses) {
    const common: CsvRow = {
      record_type: "expense",
      expense_id: expense.id,
      date: expense.date ?? "",
      description: expense.description,
      category: expense.category,
      item_id: expense.itemId ?? "",
      item_title: expense.itemId ? (snapshot.items[expense.itemId]?.title ?? "") : "",
      payer_name: friendName(expense.payerId),
      split_kind: expense.split.kind,
      currency: expense.currency,
      trip_currency: snapshot.currency ?? "",
      expense_total_minor: expense.amountMinor,
      fx_rate: expense.conversion.rate,
      fx_requested_date: expense.conversion.requestedDate ?? "",
      fx_observed_date: expense.conversion.observedDate,
      fx_source: expense.conversion.source,
      fx_stale: expense.conversion.stale,
    };
    if (expense.split.kind === "payer") {
      rows.push({
        ...common,
        role: "payer",
        tripmate_name: friendName(expense.payerId),
        amount_minor: expense.amountMinor,
        trip_amount_minor: expense.conversion.amountMinor,
      });
      continue;
    }
    const original = originalShares(expense);
    for (const [id, share] of Object.entries(convertedShares(expense, original)).sort(([a], [b]) =>
      compareId(a, b),
    )) {
      const originalShare = original[id];
      if (originalShare === undefined) throw new RangeError("Missing original share");
      rows.push({
        ...common,
        role: "share",
        tripmate_name: friendName(id),
        amount_minor: originalShare,
        trip_amount_minor: share,
        share_weight: originalShare,
        share_weight_total: expense.amountMinor,
        share_specified:
          expense.split.kind === "exact" ||
          (expense.split.kind === "mixed" && id in expense.split.shares),
      });
    }
  }
  const sortedSettlements = Object.values(snapshot.settlements).sort(
    (a, b) => compareId(a.paidAt, b.paidAt) || compareId(a.id, b.id),
  );
  for (const settlement of sortedSettlements) {
    rows.push({
      record_type: "settlement",
      settlement_id: settlement.id,
      date: settlement.paidAt.slice(0, 10),
      role: "payment",
      from_name: friendName(settlement.fromId),
      to_name: friendName(settlement.toId),
      amount_minor: settlement.amountMinor,
      currency: settlement.currency,
      trip_amount_minor: settlement.conversion.amountMinor,
      trip_currency: snapshot.currency ?? "",
      fx_rate: settlement.conversion.rate,
      fx_requested_date: settlement.conversion.requestedDate ?? "",
      fx_observed_date: settlement.conversion.observedDate,
      fx_source: settlement.conversion.source,
      fx_stale: settlement.conversion.stale,
      note: settlement.note,
      paid_at: settlement.paidAt,
    });
  }
  return `${[
    csvColumns.map(csvCell).join(","),
    ...rows.map((row) => csvColumns.map((key) => csvCell(row[key])).join(",")),
  ].join("\r\n")}\r\n`;
}
