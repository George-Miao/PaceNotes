import { z } from "zod";

import { ExternalError } from "../external/contract";

const api = "https://places.googleapis.com/v1/places";

async function googleRequest(url: string, init: RequestInit, fieldMask: string): Promise<unknown> {
  const key = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!key)
    throw new ExternalError("PROVIDER_UNAVAILABLE", "Google Places server key is not configured");
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": fieldMask,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("Google Places request failed");
    return await response.json();
  } catch {
    // Do not send the provider URL, credential, or response body to clients.
    throw new ExternalError("PROVIDER_UNAVAILABLE", "Google Places is unavailable");
  }
}

const placeSearchResponse = z.object({
  places: z
    .array(
      z.object({
        id: z.string().min(1),
        displayName: z.object({ text: z.string().min(1) }),
        formattedAddress: z.string().optional(),
      }),
    )
    .optional(),
});

export async function searchPlaces(query: string, language?: string) {
  const data = await googleRequest(
    `${api}:searchText`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ textQuery: query, ...(language ? { languageCode: language } : {}) }),
    },
    "places.id,places.displayName,places.formattedAddress",
  );
  const parsed = placeSearchResponse.safeParse(data);
  if (!parsed.success)
    throw new ExternalError("PROVIDER_UNAVAILABLE", "Google Places returned invalid search data");
  return {
    places: (parsed.data.places ?? []).map((place) => ({
      placeId: place.id,
      displayName: place.displayName.text,
      formattedAddress: place.formattedAddress ?? null,
    })),
  };
}

export async function destinationTimeZone(placeId: string): Promise<string> {
  const data = await googleRequest(
    `${api}/${encodeURIComponent(placeId)}`,
    { method: "GET" },
    "timeZone",
  );
  const parsed = z.object({ timeZone: z.object({ id: z.string() }) }).safeParse(data);
  const zone = parsed.success ? parsed.data.timeZone.id : null;
  if (!zone || !validTimeZone(zone)) {
    throw new ExternalError("PROVIDER_UNAVAILABLE", "The destination time zone is unavailable");
  }
  return zone;
}

export function validTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
