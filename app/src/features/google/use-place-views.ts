import { useEffect, useState } from "react";
import { type GooglePlaceView, resolveGooglePlace } from "./google";

export function useGooglePlaceViews(placeIds: string[]): {
  places: ReadonlyMap<string, GooglePlaceView>;
  error: string | null;
} {
  const [places, setPlaces] = useState<ReadonlyMap<string, GooglePlaceView>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const placeIdKey = [...new Set(placeIds.filter(Boolean))].join("\u0000");

  useEffect(() => {
    let disposed = false;
    const uniqueIds = placeIdKey ? placeIdKey.split("\u0000") : [];
    if (uniqueIds.length === 0) {
      setPlaces(new Map());
      setError(null);
      return;
    }
    const load = async () => {
      const settled = await Promise.allSettled(uniqueIds.map(resolveGooglePlace));
      if (disposed) return;
      const next = new Map<string, GooglePlaceView>();
      for (const result of settled) {
        if (result.status === "fulfilled") next.set(result.value.placeId, result.value);
      }
      setPlaces(next);
      setError(
        next.size === uniqueIds.length ? null : "Some Google place locations are unavailable",
      );
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [placeIdKey]);

  return { places, error };
}
