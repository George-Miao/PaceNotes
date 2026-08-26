import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { useEffect, useRef, useState } from "react";
import { readPublicConfig } from "~/features/config/public-config";
import { loadMapsLibrary, loadMarkerLibrary } from "~/features/google/google";
import type { MapStop, RouteLeg } from "~/features/google/route-legs";

export function TripMap({
  stops,
  legs,
  selectedId,
  onSelect,
}: {
  stops: MapStop[];
  legs: RouteLeg[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let clusterer: MarkerClusterer | undefined;
    const markers: google.maps.marker.AdvancedMarkerElement[] = [];
    const polylines: google.maps.Polyline[] = [];

    const render = async () => {
      if (!hostRef.current) return;
      try {
        const [{ Map: GoogleMap, Polyline }, { AdvancedMarkerElement }] = await Promise.all([
          loadMapsLibrary(),
          loadMarkerLibrary(),
        ]);
        if (disposed || !hostRef.current) return;
        const center = stops[0]
          ? { lat: stops[0].latitude, lng: stops[0].longitude }
          : { lat: 35.6812, lng: 139.7671 };
        const mapId = readPublicConfig().googleMapId;
        if (!mapId) throw new Error("GOOGLE_MAP_ID is required");
        const map = new GoogleMap(hostRef.current, {
          center,
          zoom: 12,
          mapId,
          gestureHandling: "greedy",
          clickableIcons: false,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        });
        const bounds = new google.maps.LatLngBounds();
        for (const stop of stops) {
          const markerContent = document.createElement("button");
          markerContent.type = "button";
          markerContent.className = `map-number-marker${stop.id === selectedId ? " is-selected" : ""}`;
          markerContent.style.setProperty("--marker-color", stop.color);
          const label = document.createElement("span");
          label.textContent = String(stop.index);
          markerContent.append(label);
          markerContent.setAttribute("aria-label", `Stop ${stop.index}: ${stop.label}`);
          const marker = new AdvancedMarkerElement({
            map,
            position: { lat: stop.latitude, lng: stop.longitude },
            title: stop.label,
            content: markerContent,
          });
          marker.addListener("click", () => onSelect(stop.id));
          markers.push(marker);
          bounds.extend({ lat: stop.latitude, lng: stop.longitude });
        }
        if (markers.length > 0) clusterer = new MarkerClusterer({ map, markers });
        if (markers.length > 1) map.fitBounds(bounds, 56);

        for (const leg of legs) {
          if (leg.path.length === 0) continue;
          polylines.push(
            new Polyline({
              map,
              path: leg.path,
              strokeColor: "#3e6796",
              strokeOpacity: 0.82,
              strokeWeight: 4,
            }),
          );
        }
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Map is unavailable");
      }
    };
    void render();

    return () => {
      disposed = true;
      clusterer?.clearMarkers();
      for (const marker of markers) marker.map = null;
      for (const polyline of polylines) polyline.setMap(null);
    };
  }, [legs, onSelect, selectedId, stops]);

  return (
    <div className="map-shell">
      <section ref={hostRef} className="map-canvas" aria-label="Trip map" />
      {error ? (
        <div className="map-error">
          <strong>Map unavailable</strong>
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}
