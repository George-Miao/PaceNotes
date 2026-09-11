import { defaultItemTitle, type TripItem } from "../trip/model";
import type { GooglePlaceView } from "./google";

export function itemTitle(item: TripItem, places: ReadonlyMap<string, GooglePlaceView>): string {
  return (
    item.title ||
    (item.place && places.get(item.place.placeId)?.displayName) ||
    defaultItemTitle(item.type)
  );
}
