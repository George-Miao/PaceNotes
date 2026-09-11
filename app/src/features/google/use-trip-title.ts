import { useEffect, useState } from "react";
import { createTripText, languageTag } from "~/features/trip/language";
import type { TripLanguage } from "~/features/trip/model";
import { loadPlacesLibrary } from "./google";

export function useTripTitle(
  title: string,
  destinationPlaceId: string,
  language: TripLanguage,
): string {
  const [destination, setDestination] = useState<{ placeId: string; name: string } | null>(null);

  useEffect(() => {
    if (title || !destinationPlaceId) return;
    let disposed = false;
    const load = async () => {
      try {
        const { Place } = await loadPlacesLibrary(language);
        const place = new Place({
          id: destinationPlaceId,
          requestedLanguage: languageTag(language),
        });
        await place.fetchFields({ fields: ["displayName"] });
        if (!disposed) {
          setDestination({ placeId: destinationPlaceId, name: place.displayName ?? "" });
        }
      } catch {
        if (!disposed) setDestination(null);
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [title, destinationPlaceId, language]);

  if (title) return title;
  return destination?.placeId === destinationPlaceId && destination.name
    ? createTripText(language)("tripTo", { place: destination.name })
    : "PaceNotes";
}
