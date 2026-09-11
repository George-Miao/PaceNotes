import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { readPublicConfig } from "../config/public-config";
import { languageTag } from "../trip/language";
import type { TripLanguage } from "../trip/model";

let configured = false;
let configuredLanguage: TripLanguage | undefined;
let placeLibraryPromise: Promise<google.maps.PlacesLibrary> | undefined;
let mapsLibraryPromise: Promise<google.maps.MapsLibrary> | undefined;
let markerLibraryPromise: Promise<google.maps.MarkerLibrary> | undefined;
let routesLibraryPromise: Promise<google.maps.RoutesLibrary> | undefined;

function configureGoogle(language: TripLanguage): void {
  if (configured) return;
  const key = readPublicConfig().googleMapsApiKey;
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY is required");
  setOptions({ key, v: "weekly", language: languageTag(language) });
  configuredLanguage = language;
  configured = true;
}

export function loadPlacesLibrary(language: TripLanguage): Promise<google.maps.PlacesLibrary> {
  configureGoogle(language);
  placeLibraryPromise ??= importLibrary("places");
  return placeLibraryPromise;
}

export function loadMapsLibrary(language: TripLanguage): Promise<google.maps.MapsLibrary> {
  configureGoogle(language);
  mapsLibraryPromise ??= importLibrary("maps");
  return mapsLibraryPromise;
}

export function loadMarkerLibrary(language: TripLanguage): Promise<google.maps.MarkerLibrary> {
  configureGoogle(language);
  markerLibraryPromise ??= importLibrary("marker");
  return markerLibraryPromise;
}

export function loadRoutesLibrary(language: TripLanguage): Promise<google.maps.RoutesLibrary> {
  configureGoogle(language);
  routesLibraryPromise ??= importLibrary("routes");
  return routesLibraryPromise;
}

export function googleLibraryLanguage(): TripLanguage | undefined {
  return configuredLanguage;
}

export type GooglePlaceSelection = {
  reference: { placeId: string };
  location: { latitude: number; longitude: number };
};

export type GooglePlaceView = {
  placeId: string;
  displayName: string | null;
  latitude: number;
  longitude: number;
};

export async function readGooglePlaceSelection(
  place: google.maps.places.Place,
): Promise<GooglePlaceSelection> {
  await place.fetchFields({ fields: ["id", "location"] });
  if (!place.id) throw new Error("Google did not return a place ID");
  if (!place.location) throw new Error("Google did not return a place location");
  return {
    reference: { placeId: place.id },
    location: { latitude: place.location.lat(), longitude: place.location.lng() },
  };
}

export async function resolveGooglePlace(
  placeId: string,
  language: TripLanguage,
): Promise<GooglePlaceView> {
  const { Place } = await loadPlacesLibrary(language);
  const place = new Place({ id: placeId, requestedLanguage: languageTag(language) });
  await place.fetchFields({ fields: ["id", "location", "displayName"] });
  if (!place.location) throw new Error("Google did not return a place location");
  return {
    placeId,
    displayName: place.displayName ?? null,
    latitude: place.location.lat(),
    longitude: place.location.lng(),
  };
}

export type PlaceSelectionEvent = Event & {
  placePrediction: {
    toPlace(): google.maps.places.Place;
  };
};
