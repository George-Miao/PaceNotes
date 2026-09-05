import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { readPublicConfig } from "../config/public-config";

let configured = false;
let placeLibraryPromise: Promise<google.maps.PlacesLibrary> | undefined;
let mapsLibraryPromise: Promise<google.maps.MapsLibrary> | undefined;
let markerLibraryPromise: Promise<google.maps.MarkerLibrary> | undefined;
let routesLibraryPromise: Promise<google.maps.RoutesLibrary> | undefined;

function configureGoogle(): void {
  if (configured) return;
  const key = readPublicConfig().googleMapsApiKey;
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY is required");
  setOptions({ key, v: "weekly" });
  configured = true;
}

export function loadPlacesLibrary(): Promise<google.maps.PlacesLibrary> {
  configureGoogle();
  placeLibraryPromise ??= importLibrary("places");
  return placeLibraryPromise;
}

export function loadMapsLibrary(): Promise<google.maps.MapsLibrary> {
  configureGoogle();
  mapsLibraryPromise ??= importLibrary("maps");
  return mapsLibraryPromise;
}

export function loadMarkerLibrary(): Promise<google.maps.MarkerLibrary> {
  configureGoogle();
  markerLibraryPromise ??= importLibrary("marker");
  return markerLibraryPromise;
}

export function loadRoutesLibrary(): Promise<google.maps.RoutesLibrary> {
  configureGoogle();
  routesLibraryPromise ??= importLibrary("routes");
  return routesLibraryPromise;
}

export type GooglePlaceSelection = {
  reference: { placeId: string };
  location: { latitude: number; longitude: number };
};

export type GooglePlaceView = {
  placeId: string;
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

export async function resolveGooglePlace(placeId: string): Promise<GooglePlaceView> {
  const { Place } = await loadPlacesLibrary();
  const place = new Place({ id: placeId });
  await place.fetchFields({ fields: ["id", "location"] });
  if (!place.location) throw new Error("Google did not return a place location");
  return {
    placeId,
    latitude: place.location.lat(),
    longitude: place.location.lng(),
  };
}

export type PlaceSelectionEvent = Event & {
  placePrediction: {
    toPlace(): google.maps.places.Place;
  };
};
