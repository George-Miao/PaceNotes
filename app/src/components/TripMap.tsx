import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { readPublicConfig } from "~/features/config/public-config";
import { type GooglePlaceView, loadMapsLibrary, loadMarkerLibrary } from "~/features/google/google";
import type { MapStop, MapTransport, RouteLeg } from "~/features/google/route-legs";
import { useTripLanguage, useTripText } from "~/features/trip/language";
import { MapPlaceDetails } from "./MapPlaceDetails";

type MapRuntime = {
  map: google.maps.Map;
  AdvancedMarkerElement: typeof google.maps.marker.AdvancedMarkerElement;
  Polyline: typeof google.maps.Polyline;
};

export function TripMap({
  destination,
  stops,
  transports,
  routes,
  selectedId,
  editingPlace,
  selectedPlaceId,
  mapPlacement,
  onAddPlace,
  onRemoveFromDay,
  onSelectPlace,
}: {
  destination: GooglePlaceView | undefined;
  stops: MapStop[];
  transports: MapTransport[];
  routes: ReadonlyMap<string, RouteLeg[]>;
  selectedId: string | null;
  editingPlace: GooglePlaceView | undefined;
  selectedPlaceId: string | null;
  mapPlacement: { itemId: string; dayNumber: number } | null;
  onAddPlace: (placeId: string) => void;
  onRemoveFromDay: (itemId: string) => void;
  onSelectPlace: (placeId: string | null) => void;
}) {
  const language = useTripLanguage();
  const text = useTripText();
  const hostRef = useRef<HTMLDivElement>(null);
  const hasFocused = useRef(false);
  const markerButtons = useRef(new Map<string, HTMLButtonElement>());
  const routePolylines = useRef(
    new Map<string, { legs: RouteLeg[]; polylines: google.maps.Polyline[] }>(),
  );
  const routeRuntime = useRef<MapRuntime | null>(null);
  const [runtime, setRuntime] = useState<MapRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectPlace = useEffectEvent(onSelectPlace);
  const isStopSelected = useEffectEvent(
    (stop: MapStop) => stop.id === selectedId || stop.placeId === selectedPlaceId,
  );
  const positionsKey = useMemo(
    () => stops.map((stop) => `${stop.latitude},${stop.longitude}`).join(";"),
    [stops],
  );
  const transportPositions = useMemo(
    () =>
      transports
        .flatMap((transport) => [transport.from, transport.to])
        .filter((place): place is GooglePlaceView => place !== null),
    [transports],
  );
  const transportKey = useMemo(
    () => transportPositions.map((place) => `${place.latitude},${place.longitude}`).join(";"),
    [transportPositions],
  );
  const focusStops = useEffectEvent((map: google.maps.Map) => {
    if (selectedId && (editingPlace || transports.some((transport) => transport.id === selectedId)))
      return;
    const positions = [...stops, ...transportPositions];
    const first = positions[0];
    if (!first) return;
    if (positions.length === 1) {
      map.panTo({ lat: first.latitude, lng: first.longitude });
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    for (const stop of positions) bounds.extend({ lat: stop.latitude, lng: stop.longitude });
    map.fitBounds(bounds, 56);
  });

  useEffect(() => {
    let disposed = false;
    let map: google.maps.Map | undefined;
    const host = hostRef.current;
    const initialize = async () => {
      if (!host) return;
      try {
        const [{ Map: GoogleMap, Polyline }, { AdvancedMarkerElement }] = await Promise.all([
          loadMapsLibrary(language),
          loadMarkerLibrary(language),
        ]);
        if (disposed) return;
        const mapId = readPublicConfig().googleMapId;
        if (!mapId) throw new Error("GOOGLE_MAP_ID is required");
        map = new GoogleMap(host, {
          zoom: 12,
          mapId,
          gestureHandling: "greedy",
          clickableIcons: true,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        });
        map.addListener(
          "click",
          (event: google.maps.MapMouseEvent | google.maps.IconMouseEvent) => {
            if ("placeId" in event && event.placeId) {
              event.stop();
              selectPlace(event.placeId);
            } else {
              selectPlace(null);
            }
          },
        );
        hasFocused.current = false;
        setRuntime({ map, AdvancedMarkerElement, Polyline });
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : text("mapUnavailable"));
      }
    };
    void initialize();
    return () => {
      disposed = true;
      if (map) google.maps.event.clearInstanceListeners(map);
      host?.replaceChildren();
    };
  }, [language, text]);

  useEffect(() => {
    if (!runtime) return;
    const { map, AdvancedMarkerElement } = runtime;
    const buttons = markerButtons.current;
    const listeners: google.maps.MapsEventListener[] = [];
    const markers: google.maps.marker.AdvancedMarkerElement[] = [];
    let clusterer: MarkerClusterer | undefined;
    try {
      for (const stop of stops) {
        const markerContent = document.createElement("button");
        markerContent.type = "button";
        markerContent.className = `map-number-marker${isStopSelected(stop) ? " is-selected" : ""}`;
        markerContent.style.setProperty("--marker-color", stop.color);
        markerContent.style.setProperty("--marker-text-color", stop.textColor);
        const label = document.createElement("span");
        label.textContent = String(stop.index);
        markerContent.append(label);
        markerContent.setAttribute(
          "aria-label",
          text("stopLabel", { index: stop.index, label: stop.label }),
        );
        markerContent.addEventListener("click", (event) => {
          event.stopPropagation();
          selectPlace(stop.placeId);
        });
        buttons.set(stop.id, markerContent);
        const marker = new AdvancedMarkerElement({
          map,
          position: { lat: stop.latitude, lng: stop.longitude },
          title: stop.label,
          content: markerContent,
        });
        markers.push(marker);
        listeners.push(marker.addListener("click", () => selectPlace(stop.placeId)));
      }
      if (markers.length > 0) clusterer = new MarkerClusterer({ map, markers });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("mapUnavailable"));
    }
    return () => {
      clusterer?.clearMarkers();
      clusterer?.setMap(null);
      for (const listener of listeners) listener.remove();
      for (const marker of markers) marker.map = null;
      buttons.clear();
    };
  }, [runtime, stops, text]);

  useEffect(() => {
    for (const stop of stops) {
      markerButtons.current
        .get(stop.id)
        ?.classList.toggle(
          "is-selected",
          stop.id === selectedId || stop.placeId === selectedPlaceId,
        );
    }
  }, [stops, selectedId, selectedPlaceId]);

  useEffect(() => {
    if (!runtime || (!positionsKey && !transportKey)) return;
    focusStops(runtime.map);
    hasFocused.current = true;
  }, [runtime, positionsKey, transportKey]);

  useEffect(() => {
    if (!runtime || !destination || hasFocused.current) return;
    runtime.map.setCenter({ lat: destination.latitude, lng: destination.longitude });
    hasFocused.current = true;
  }, [runtime, destination]);

  useEffect(() => {
    if (!runtime || !selectedId) return;
    const transport = transports.find((item) => item.id === selectedId);
    const points = editingPlace
      ? [editingPlace]
      : [transport?.from, transport?.to].filter((place): place is GooglePlaceView =>
          Boolean(place),
        );
    const first = points[0];
    if (!first) return;
    if (points.length === 1) runtime.map.panTo({ lat: first.latitude, lng: first.longitude });
    else {
      const bounds = new google.maps.LatLngBounds();
      for (const point of points) bounds.extend({ lat: point.latitude, lng: point.longitude });
      runtime.map.fitBounds(bounds, 56);
    }
    hasFocused.current = true;
  }, [runtime, selectedId, editingPlace, transports]);

  useEffect(() => {
    const overlays = routePolylines.current;
    if (routeRuntime.current !== runtime) {
      for (const overlay of overlays.values()) {
        for (const polyline of overlay.polylines) polyline.setMap(null);
      }
      overlays.clear();
      routeRuntime.current = runtime;
    }
    if (!runtime) return;
    const { map, Polyline } = runtime;
    const active = new Set<string>();
    for (const [planId, legs] of routes) {
      active.add(planId);
      const existing = overlays.get(planId);
      if (existing?.legs === legs) continue;
      if (existing) {
        for (const polyline of existing.polylines) polyline.setMap(null);
      }
      const polylines = groupRoutePaths(legs).map(
        (route) =>
          new Polyline({
            map,
            path: route.path,
            strokeColor: route.color,
            strokeOpacity: 0.82,
            strokeWeight: 4,
          }),
      );
      overlays.set(planId, { legs, polylines });
    }
    for (const [planId, overlay] of overlays) {
      if (active.has(planId)) continue;
      for (const polyline of overlay.polylines) polyline.setMap(null);
      overlays.delete(planId);
    }
  }, [runtime, routes]);

  useEffect(
    () => () => {
      for (const overlay of routePolylines.current.values()) {
        for (const polyline of overlay.polylines) polyline.setMap(null);
      }
      routePolylines.current.clear();
      routeRuntime.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!runtime) return;
    const lines: google.maps.Polyline[] = [];
    try {
      for (const transport of transports) {
        if (transport.from && transport.to)
          lines.push(
            new runtime.Polyline({
              map: runtime.map,
              path: [transport.from, transport.to].map((place) => ({
                lat: place.latitude,
                lng: place.longitude,
              })),
              geodesic: true,
              strokeOpacity: 0,
              strokeColor: transport.color,
              icons: [
                {
                  icon: {
                    path: "M 0,-1 0,1",
                    strokeOpacity: 1,
                    strokeColor: transport.color,
                    scale: 3,
                  },
                  offset: "0",
                  repeat: "16px",
                },
              ],
            }),
          );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("transportLocationsUnavailable"));
    }
    return () => {
      for (const line of lines) line.setMap(null);
    };
  }, [runtime, transports, text]);

  return (
    <div className="map-shell">
      <section ref={hostRef} className="map-canvas" aria-label={text("tripMap")} />
      {selectedPlaceId ? (
        <MapPlaceDetails
          placeId={selectedPlaceId}
          autoFocus={selectedId === null}
          placement={mapPlacement}
          onAddToTrip={onAddPlace}
          onRemoveFromDay={onRemoveFromDay}
          onClose={() => onSelectPlace(null)}
        />
      ) : null}
      {error ? (
        <div className="map-error">
          <strong>{text("mapUnavailable")}</strong>
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}

type GroupedRoutePath = {
  color: string;
  path: google.maps.LatLngAltitudeLiteral[];
  toId: string;
};

function groupRoutePaths(legs: RouteLeg[]): GroupedRoutePath[] {
  const groups: GroupedRoutePath[] = [];
  for (const leg of legs) {
    if (leg.path.length === 0) continue;
    const previous = groups.at(-1);
    if (previous && previous.color === leg.color && previous.toId === leg.fromId) {
      const last = previous.path.at(-1);
      const first = leg.path[0];
      const start = last && first && samePosition(last, first) ? 1 : 0;
      for (let index = start; index < leg.path.length; index += 1) {
        const point = leg.path[index];
        if (point) previous.path.push(point);
      }
      previous.toId = leg.toId;
      continue;
    }
    groups.push({
      color: leg.color,
      path: [...leg.path],
      toId: leg.toId,
    });
  }
  return groups;
}

function samePosition(
  left: google.maps.LatLngAltitudeLiteral,
  right: google.maps.LatLngAltitudeLiteral,
): boolean {
  return left.lat === right.lat && left.lng === right.lng && left.altitude === right.altitude;
}
