import type { TripItem } from "../trip/model";
import type { ExpenseCategory } from "./model";

const transportTypes = new Set([
  "airport",
  "international_airport",
  "airstrip",
  "bus_station",
  "bus_stop",
  "ferry_service",
  "ferry_terminal",
  "heliport",
  "light_rail_station",
  "subway_station",
  "train_station",
  "train_ticket_office",
  "tram_stop",
  "transit_depot",
  "transit_station",
  "transit_stop",
  "taxi_service",
  "taxi_stand",
  "transportation_service",
  "car_rental",
  "gas_station",
  "parking",
  "parking_garage",
  "parking_lot",
  "park_and_ride",
  "toll_station",
  "bike_sharing_station",
  "ebike_charging_station",
  "electric_vehicle_charging_station",
]);
const lodgingTypes = new Set([
  "lodging",
  "hotel",
  "motel",
  "hostel",
  "inn",
  "guest_house",
  "bed_and_breakfast",
  "resort_hotel",
  "japanese_inn",
  "budget_japanese_inn",
  "campground",
  "camping_cabin",
  "cottage",
  "extended_stay_hotel",
  "farmstay",
  "private_guest_room",
  "rv_park",
  "mobile_home_park",
]);
const foodTypes = new Set([
  "food",
  "restaurant",
  "cafe",
  "coffee_shop",
  "coffee_stand",
  "tea_house",
  "bakery",
  "bar",
  "bar_and_grill",
  "pub",
  "brewery",
  "winery",
  "food_court",
  "meal_takeaway",
  "meal_delivery",
  "deli",
  "diner",
  "snack_bar",
  "ice_cream_shop",
  "dessert_shop",
  "juice_shop",
  "grocery_store",
  "supermarket",
  "convenience_store",
  "food_store",
  "farmers_market",
  "butcher_shop",
  "health_food_store",
]);
const shoppingTypes = new Set(["store", "shopping_mall", "market", "flea_market", "gift_shop"]);
const feeTypes = new Set([
  "atm",
  "bank",
  "city_hall",
  "courthouse",
  "embassy",
  "government_office",
  "post_office",
]);
const activityTypes = new Set([
  "tourist_attraction",
  "museum",
  "art_museum",
  "history_museum",
  "amusement_park",
  "aquarium",
  "zoo",
  "park",
  "national_park",
  "state_park",
  "beach",
  "movie_theater",
  "performing_arts_theater",
  "concert_hall",
  "art_gallery",
  "historical_landmark",
  "monument",
]);

function categoryForType(type: string): ExpenseCategory | null {
  if (transportTypes.has(type)) return "transport";
  if (lodgingTypes.has(type)) return "lodging";
  if (foodTypes.has(type) || type.endsWith("_restaurant") || type.endsWith("_bar")) {
    return "food";
  }
  if (shoppingTypes.has(type) || type.endsWith("_store")) return "shopping";
  if (feeTypes.has(type)) return "fees";
  if (activityTypes.has(type)) return "activities";
  return null;
}

export function defaultExpenseCategory(
  item: TripItem | undefined,
  place: { primaryType: string | null; types: readonly string[] } | undefined,
): ExpenseCategory {
  if (!item || item.type === "note") return "other";
  if (item.type === "transport") return "transport";
  if (item.type === "lodging") return "lodging";

  if (place) {
    const primary = place.primaryType && categoryForType(place.primaryType);
    if (primary) return primary;
    for (const type of place.types) {
      const category = categoryForType(type);
      if (category) return category;
    }
  }
  return "activities";
}
