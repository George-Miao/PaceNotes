import { useEffect, useRef, useState } from "react";
import { createTripText } from "~/features/trip/language";
import type { TripLanguage } from "~/features/trip/model";
import { type GooglePlaceView, resolveGooglePlace } from "./google";

export function useGooglePlaceViews(
  placeIds: string[],
  language: TripLanguage,
): {
  places: ReadonlyMap<string, GooglePlaceView>;
  error: string | null;
} {
  const [places, setPlaces] = useState<ReadonlyMap<string, GooglePlaceView>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const requests = useRef(new Map<string, Promise<GooglePlaceView>>());
  const placeIdKey = [...new Set(placeIds.filter(Boolean))].join("\u0000");

  useEffect(() => {
    setPlaces(new Map());
    let disposed = false;
    const uniqueIds = placeIdKey ? placeIdKey.split("\u0000") : [];
    if (uniqueIds.length === 0) {
      setPlaces(new Map());
      setError(null);
      return;
    }
    const load = async () => {
      const settled = await Promise.allSettled(
        uniqueIds.map((id) => {
          const key = `${language}\u0000${id}`;
          let request = requests.current.get(key);
          if (!request) {
            request = resolveGooglePlace(id, language).catch((cause) => {
              requests.current.delete(key);
              throw cause;
            });
            requests.current.set(key, request);
          }
          return request;
        }),
      );
      if (disposed) return;
      setPlaces((current) => {
        const next = new Map(current);
        for (const result of settled) {
          if (result.status === "fulfilled") next.set(result.value.placeId, result.value);
        }
        return next;
      });
      setError(
        settled.some((result) => result.status === "rejected")
          ? createTripText(language)("somePlacesUnavailable")
          : null,
      );
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [placeIdKey, language]);

  return { places, error };
}
