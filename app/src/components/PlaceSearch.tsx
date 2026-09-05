import { useState } from "react";
import type { GooglePlaceSelection } from "~/features/google/google";
import { GooglePlacePicker } from "./GooglePlacePicker";
import { PlaceDetails } from "./PlaceDetails";

export function PlaceSearch({
  bias,
  onAdd,
}: {
  bias?: { latitude: number; longitude: number } | undefined;
  onAdd: (place: GooglePlaceSelection, label: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<GooglePlaceSelection | null>(null);
  const [label, setLabel] = useState("");
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            disabled={!label.trim() || placing}
            onClick={async () => {
              setPlacing(true);
              setError(null);
              try {
                await onAdd(selected, label.trim());
                setSelected(null);
                setLabel("");
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Could not add this place");
              } finally {
                setPlacing(false);
              }
            }}
          >
            {placing ? "Finding best place…" : "Add to day"}
          </button>
          {error ? <p className="field-error">{error}</p> : null}
          <PlaceDetails placeId={selected.reference.placeId} />
        </>
      ) : null}
    </section>
  );
}
