import type { ComputedRoute, MapStop } from "~/features/routing/model";
import { languageTag } from "~/features/trip/language";
import type { TripLanguage } from "~/features/trip/model";
import { loadPlacesLibrary, loadRoutesLibrary } from "./google";

export type GoogleRouteAdapter = {
  compute: (from: MapStop, to: MapStop, departureTime: Date | undefined) => Promise<ComputedRoute>;
};

export async function createGoogleRouteAdapter(
  language: TripLanguage,
): Promise<GoogleRouteAdapter> {
  const [routesLibrary, placesLibrary] = await Promise.all([
    loadRoutesLibrary(language),
    loadPlacesLibrary(language),
  ]);

  return {
    compute: async (from, to, departureTime) => {
      const response = await routesLibrary.Route.computeRoutes({
        origin: routeLocation(placesLibrary, from, language),
        destination: routeLocation(placesLibrary, to, language),
        travelMode: to.travelMode,
        ...(departureTime ? { departureTime } : {}),
        ...(departureTime && to.travelMode === "DRIVING"
          ? { routingPreference: routesLibrary.RoutingPreference.TRAFFIC_AWARE }
          : {}),
        language: languageTag(language),
        fields: ["path", "legs", "durationMillis", "distanceMeters"],
      });
      const route = response.routes?.[0];
      if (route) {
        const path = route.path?.map((point) => point.toJSON()) ?? [];
        return {
          durationMillis: route.durationMillis ?? 0,
          distanceMeters: route.distanceMeters ?? null,
          geometryQuality: path.length > 0 ? "detailed" : "approximate",
          path,
        };
      }
      if (to.travelMode !== "TRANSIT") throw new Error("No route returned");

      const directions = await new routesLibrary.DirectionsService().route({
        origin: directionsLocation(from),
        destination: directionsLocation(to),
        travelMode: routesLibrary.TravelMode.TRANSIT,
        ...(departureTime ? { transitOptions: { departureTime } } : {}),
      });
      const fallbackRoute = directions.routes[0];
      const fallbackLeg = fallbackRoute?.legs[0];
      if (!fallbackRoute || !fallbackLeg) throw new Error("No transit route returned");
      const path = fallbackRoute.overview_path.map((point) => ({
        lat: point.lat(),
        lng: point.lng(),
        altitude: 0,
      }));
      return {
        durationMillis: (fallbackLeg.duration?.value ?? 0) * 1_000,
        distanceMeters: fallbackLeg.distance?.value ?? null,
        geometryQuality: path.length > 0 ? "detailed" : "approximate",
        path,
      };
    },
  };
}

function routeLocation(
  library: google.maps.PlacesLibrary,
  stop: MapStop,
  language: TripLanguage,
): google.maps.routes.ComputeRoutesRequest["origin"] {
  return stop.placeId
    ? new library.Place({ id: stop.placeId, requestedLanguage: languageTag(language) })
    : { lat: stop.latitude, lng: stop.longitude };
}

function directionsLocation(stop: MapStop): google.maps.Place | google.maps.LatLngLiteral {
  return stop.placeId ? { placeId: stop.placeId } : { lat: stop.latitude, lng: stop.longitude };
}
