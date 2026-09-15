import { describe, expect, it } from "vitest";
import { buildDayPlans, routeContinuations } from "./day-plan";
import { itemForCreate, lodgingForDates } from "./model";

const days = ["2027-01-01", "2027-01-02", "2027-01-03", "2027-01-04"].map((date) => ({
  id: date,
  date,
}));

describe("continuous day plans", () => {
  it("uses one stay at night and the following morning, including a hotel change", () => {
    const first = itemForCreate("lodging", days[0]?.id ?? null, {
      id: "first",
      place: { placeId: "hotel-a" },
      lodging: lodgingForDates("2027-01-01", "2027-01-03"),
    });
    const second = itemForCreate("lodging", "2027-01-03", {
      id: "second",
      place: { placeId: "hotel-b" },
      lodging: lodgingForDates("2027-01-03", "2027-01-04"),
    });
    const note = itemForCreate("note", "2027-01-03", { id: "visit" });
    const plans = buildDayPlans([first, second, note], days);
    expect(
      plans.map((plan) => ({
        start: plan.start.map((item) => item.id),
        items: plan.items.map((item) => item.id),
        end: plan.end.map((item) => item.id),
      })),
    ).toEqual([
      { start: [], items: [], end: ["first"] },
      { start: ["first"], items: [], end: ["first"] },
      { start: ["first"], items: ["visit"], end: ["second"] },
      { start: ["second"], items: [], end: [] },
    ]);
    expect(
      buildDayPlans([{ ...first, dayId: null }], days).every(
        (plan) => !plan.start.length && !plan.end.length,
      ),
    ).toBe(true);
  });

  it("keeps untimed positions and invalid clock-gap entries while ordering timed items", () => {
    const date = "2027-03-14";
    const items = [
      itemForCreate("place", date, { id: "late", title: "late", startTime: "03:30" }),
      itemForCreate("place", date, { id: "open", title: "open" }),
      itemForCreate("place", date, { id: "early", title: "early", startTime: "01:30" }),
      itemForCreate("place", date, { id: "gap", title: "gap", startTime: "02:30" }),
    ];
    const plan = buildDayPlans(items, [{ id: date, date }])[0];
    expect(plan?.items.map((item) => item.id)).toEqual(["early", "open", "gap", "late"]);
  });

  it("continues a route through every intervening entry, including stay boundaries", () => {
    const order = [
      "hotel:start",
      "note-before",
      "a",
      "note-one",
      "note-two",
      "b",
      "note-after",
      "hotel:end",
    ];
    expect([
      ...routeContinuations(order, [
        { fromId: "hotel:start", toId: "a" },
        { fromId: "a", toId: "b" },
        { fromId: "b", toId: "hotel:end" },
      ]),
    ]).toEqual(["note-before", "note-one", "note-two", "note-after"]);
  });

  it("does not invent connectors for missing or reversed route endpoints", () => {
    expect([
      ...routeContinuations(
        ["b", "note", "a"],
        [
          { fromId: "a", toId: "b" },
          { fromId: "removed", toId: "a" },
          { fromId: "b", toId: "removed" },
        ],
      ),
    ]).toEqual([]);
  });
});
