import { describe, expect, it } from "vitest";
import { itemForCreate } from "../trip/model";
import { defaultExpenseCategory } from "./category";

const item = itemForCreate("place", null, { place: { placeId: "place" } });

function placeTypes(primaryType: string | null, types: string[]) {
  return { primaryType, types };
}

describe("default expense category", () => {
  it("uses the primary place type before secondary types", () => {
    expect(
      defaultExpenseCategory(item, placeTypes("train_station", ["train_station", "food"])),
    ).toBe("transport");
    expect(
      defaultExpenseCategory(item, placeTypes("restaurant", ["restaurant", "train_station"])),
    ).toBe("food");
    expect(defaultExpenseCategory(item, placeTypes("museum", ["museum", "restaurant"]))).toBe(
      "activities",
    );
  });

  it("uses specific Google types when there is no known primary type", () => {
    expect(
      defaultExpenseCategory(item, placeTypes(null, ["point_of_interest", "bus_station"])),
    ).toBe("transport");
    expect(defaultExpenseCategory(item, placeTypes("sushi_restaurant", []))).toBe("food");
    expect(defaultExpenseCategory(item, placeTypes("hotel", []))).toBe("lodging");
    expect(defaultExpenseCategory(item, placeTypes("shopping_mall", []))).toBe("shopping");
    expect(defaultExpenseCategory(item, placeTypes("grocery_store", ["store", "food"]))).toBe(
      "food",
    );
  });

  it("keeps explicit item types and falls back without useful place data", () => {
    const restaurant = placeTypes("restaurant", ["restaurant"]);
    expect(defaultExpenseCategory(itemForCreate("transport", null), restaurant)).toBe("transport");
    expect(
      defaultExpenseCategory(
        itemForCreate("lodging", null, { place: { placeId: "place" } }),
        restaurant,
      ),
    ).toBe("lodging");
    expect(defaultExpenseCategory(itemForCreate("note", null), restaurant)).toBe("other");
    expect(defaultExpenseCategory(item, placeTypes(null, ["establishment"]))).toBe("activities");
    expect(defaultExpenseCategory(undefined, restaurant)).toBe("other");
  });
});
