import { describe, expect, it } from "vitest";
import { createInitialSnapshot } from "../trip/model";
import { expenseSchema, settlementSchema } from "./model";
import {
  balances,
  expenseShares,
  exportExpensesCsv,
  isMoneyInput,
  revalueAtRate,
  suggestSettlements,
  toMinor,
} from "./money";

const ids = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004",
  "00000000-0000-4000-8000-000000000005",
  "00000000-0000-4000-8000-000000000006",
] as const;

function trip() {
  const snapshot = createInitialSnapshot("trip-1", {
    startDate: "2026-09-01",
    endDate: "2026-09-03",
    destination: { placeId: "destination" },
    timeZone: "UTC",
  });
  snapshot.currency = "EUR";
  snapshot.friends = Object.fromEntries(
    ids.map((id, i) => [
      id,
      {
        id,
        name: `Friend ${i}`,
        color: "#336699",
        archived: false,
      },
    ]),
  );
  return snapshot;
}

const identity = (amountMinor: number) => ({
  amountMinor,
  rate: 1,
  requestedDate: null,
  observedDate: "2026-09-01",
  source: "identity",
  stale: false,
});

describe("trip expense arithmetic", () => {
  it("accepts editable amounts only within the currency precision", () => {
    expect(isMoneyInput("", "USD")).toBe(true);
    expect(isMoneyInput("12.", "USD")).toBe(true);
    expect(isMoneyInput("12.34", "USD")).toBe(true);
    expect(isMoneyInput("12.345", "USD")).toBe(false);
    expect(isMoneyInput("12.345", "BHD")).toBe(true);
    expect(isMoneyInput("12", "JPY")).toBe(true);
    expect(isMoneyInput("12.", "JPY")).toBe(false);
    expect(isMoneyInput("12a", "USD")).toBe(false);
    expect(isMoneyInput("12..3", "USD")).toBe(false);
  });

  it("allocates converted exact and equal shares by rational largest remainder", () => {
    const snapshot = trip();
    const expense = expenseSchema.parse({
      id: "10000000-0000-4000-8000-000000000001",
      description: "Dinner",
      category: "food",
      amountMinor: 101,
      currency: "USD",
      payerId: ids[0],
      split: { kind: "exact", shares: { [ids[0]]: 33, [ids[1]]: 34, [ids[2]]: 34 } },
      itemId: null,
      date: null,
      followsItemDate: false,
      conversion: { ...identity(89), rate: 0.8811881188, source: "Frankfurter v2 blended" },
    });
    expect(expenseShares(snapshot, expense)).toEqual({ [ids[0]]: 29, [ids[1]]: 30, [ids[2]]: 30 });
    expect(
      expenseShares(snapshot, {
        ...expense,
        split: { kind: "equal", friendIds: [ids[2], ids[1], ids[0]] },
      }),
    ).toEqual({ [ids[0]]: 30, [ids[1]]: 30, [ids[2]]: 29 });
    expect(
      expenseSchema.safeParse({
        ...expense,
        split: { kind: "exact", shares: { [ids[0]]: 32, [ids[1]]: 34, [ids[2]]: 34 } },
      }).success,
    ).toBe(false);
    expect(toMinor("1.2300", "USD")).toBe(123);
    expect(() => toMinor("1.005", "USD")).toThrow();
    expect(revalueAtRate(1, "USD", "JPY", 150.5)).toBe(2);
  });

  it("splits the original-currency remainder before deterministic conversion and CSV export", () => {
    const snapshot = trip();
    const expense = expenseSchema.parse({
      id: "10000000-0000-4000-8000-000000000001",
      description: "Shared meal",
      category: "food",
      amountMinor: 12,
      currency: "USD",
      payerId: ids[0],
      split: {
        kind: "mixed",
        friendIds: [ids[4], ids[3], ids[2], ids[1], ids[0]],
        shares: { [ids[0]]: 2, [ids[4]]: 3 },
      },
      itemId: null,
      date: null,
      followsItemDate: false,
      conversion: { ...identity(7), rate: 7 / 12, source: "rate" },
    });
    expect(expenseShares(snapshot, expense)).toEqual({
      [ids[0]]: 1,
      [ids[1]]: 2,
      [ids[2]]: 1,
      [ids[3]]: 1,
      [ids[4]]: 2,
    });
    snapshot.expenses[expense.id] = expense;
    const [header, ...rows] = exportExpensesCsv(snapshot).trim().split("\r\n");
    const columns = header?.split(",").map((value) => value.slice(1, -1)) ?? [];
    const column = (name: string) => columns.indexOf(name);
    expect(
      rows.map((row) => {
        const cells = row.split(",").map((value) => value.replace(/^"|"$/g, ""));
        return [
          cells[column("tripmate_name")],
          cells[column("amount_minor")],
          cells[column("trip_amount_minor")],
          cells[column("share_specified")],
        ];
      }),
    ).toEqual([
      ["Friend 0", "2", "1", "true"],
      ["Friend 1", "3", "2", "false"],
      ["Friend 2", "2", "1", "false"],
      ["Friend 3", "2", "1", "false"],
      ["Friend 4", "3", "2", "true"],
    ]);
  });

  it("rejects overspecified or non-positive residual shares and malformed mixed selections", () => {
    const expense = {
      id: "10000000-0000-4000-8000-000000000001",
      description: "Shared meal",
      category: "food",
      amountMinor: 12,
      currency: "EUR",
      payerId: ids[0],
      itemId: null,
      date: null,
      followsItemDate: false,
      conversion: identity(12),
    };
    for (const split of [
      { kind: "mixed", friendIds: [ids[0], ids[1], ids[2]], shares: { [ids[0]]: 11 } },
      { kind: "mixed", friendIds: [ids[0], ids[1]], shares: { [ids[0]]: 12 } },
      { kind: "mixed", friendIds: [ids[0], ids[1]], shares: { [ids[0]]: 13 } },
      { kind: "mixed", friendIds: [ids[0], ids[1]], shares: { [ids[0]]: 0 } },
      { kind: "mixed", friendIds: [ids[0], ids[1]], shares: { [ids[2]]: 3 } },
      { kind: "mixed", friendIds: [ids[0], ids[1]], shares: {} },
      { kind: "mixed", friendIds: [ids[0], ids[1]], shares: { [ids[0]]: 5, [ids[1]]: 7 } },
      { kind: "mixed", friendIds: [ids[0], ids[0], ids[1]], shares: { [ids[0]]: 5 } },
    ]) {
      expect(expenseSchema.safeParse({ ...expense, split }).success).toBe(false);
    }
    expect(
      expenseSchema.safeParse({
        ...expense,
        amountMinor: 1,
        conversion: identity(1),
        split: { kind: "equal", friendIds: [ids[0], ids[1]] },
      }).success,
    ).toBe(false);
  });

  it("finds a minimum transfer plan even when largest-first greedy takes five transfers", () => {
    const snapshot = trip();
    snapshot.currency = "EUR";
    const expenses = [
      { payer: ids[3], shares: { [ids[0]]: 1, [ids[2]]: 1 } },
      { payer: ids[4], shares: { [ids[1]]: 2 } },
      { payer: ids[5], shares: { [ids[2]]: 2 } },
    ];
    for (const [index, entry] of expenses.entries()) {
      const expense = expenseSchema.parse({
        id: `10000000-0000-4000-8000-00000000000${index + 1}`,
        description: "",
        category: "other",
        amountMinor: 2,
        currency: "EUR",
        payerId: entry.payer,
        split: { kind: "exact", shares: entry.shares },
        itemId: null,
        date: null,
        followsItemDate: false,
        conversion: identity(2),
      });
      snapshot.expenses[expense.id] = expense;
    }
    expect(Object.values(balances(snapshot))).toEqual([-1, -2, -3, 2, 2, 2]);
    const suggestions = suggestSettlements(snapshot);
    expect(suggestions).toHaveLength(4);
    for (const [index, suggestion] of suggestions.entries()) {
      const settlement = settlementSchema.parse({
        id: `20000000-0000-4000-8000-00000000000${index + 1}`,
        ...suggestion,
        currency: "EUR",
        conversion: identity(suggestion.amountMinor),
        note: "",
        paidAt: "2026-09-01T00:00:00Z",
      });
      snapshot.settlements[settlement.id] = settlement;
    }
    expect(Object.values(balances(snapshot))).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("exports payer, every share and settlement with names, dates, stale flags and safe CSV", () => {
    const snapshot = trip();
    snapshot.friends[ids[0]] = {
      id: ids[0],
      name: ' =HYPERLINK("bad")',
      color: "#336699",
      archived: false,
    };
    const expense = expenseSchema.parse({
      id: "10000000-0000-4000-8000-000000000001",
      description: "=1+1",
      category: "fees",
      amountMinor: 3,
      currency: "EUR",
      payerId: ids[0],
      split: { kind: "equal", friendIds: [ids[0], ids[1]] },
      itemId: null,
      date: null,
      followsItemDate: false,
      conversion: { ...identity(3), stale: true },
    });
    snapshot.expenses[expense.id] = expense;
    const payerOnly = expenseSchema.parse({
      ...expense,
      id: "10000000-0000-4000-8000-000000000002",
      description: "Solo",
      amountMinor: 2,
      payerId: ids[2],
      split: { kind: "payer" },
      conversion: identity(2),
    });
    snapshot.expenses[payerOnly.id] = payerOnly;
    const settlement = settlementSchema.parse({
      id: "20000000-0000-4000-8000-000000000001",
      fromId: ids[1],
      toId: ids[0],
      amountMinor: 1,
      currency: "EUR",
      conversion: identity(1),
      note: "\t=cmd",
      paidAt: "2026-09-02T12:00:00Z",
    });
    snapshot.settlements[settlement.id] = settlement;
    const csv = exportExpensesCsv(snapshot);
    expect(csv.trim().split("\r\n")).toHaveLength(5);
    expect(csv.split('"payer"')).toHaveLength(3);
    expect(csv.split('"share"')).toHaveLength(3);
    const header = csv.split("\r\n")[0] ?? "";
    expect(header).not.toContain("friend_id");
    expect(header).not.toContain("payer_id");
    expect(header).not.toContain("from_id");
    expect(header).not.toContain("to_id");
    expect(csv).toContain('"\' =HYPERLINK(""bad"")"');
    expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('"\'\t=cmd"');
    expect(csv).toContain('"true"');
    expect(csv).toContain('"settlement"');
  });
});
