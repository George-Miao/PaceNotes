import { useState } from "react";
import type { GooglePlaceSelection } from "~/features/google/google";
import type { PlaceReference } from "~/features/trip/model";
import { GooglePlacePicker } from "./GooglePlacePicker";
import { PlaceDetails } from "./PlaceDetails";

export function PlaceSearch({
  bias,
  onAdd,
}: {
  bias?: { latitude: number; longitude: number } | undefined;
  onAdd: (place: PlaceReference, label: string) => void;
}) {
  const [selected, setSelected] = useState<GooglePlaceSelection | null>(null);
  const [label, setLabel] = useState("");

  return (
    <section className="place-search" aria-labelledby="place-search-title">
      <div className="section-heading">
        <h2 id="place-search-title">Add a place</h2>
        <span>Google Places</span>
      </div>
      <GooglePlacePicker label="Search Google Places" bias={bias} onSelect={setSelected} />
      {selected ? (
        <>
          <label className="field">
            <span>Itinerary label</span>
            <input
              required
              maxLength={200}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Add your own place label"
            />
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={!label.trim()}
            onClick={() => {
              onAdd(selected.reference, label.trim());
              setSelected(null);
              setLabel("");
            }}
          >
            Add to day
          </button>
          <PlaceDetails placeId={selected.reference.placeId} />
        </>
      ) : null}
    </section>
  );
}
