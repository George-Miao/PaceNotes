import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  type GooglePlaceSelection,
  loadPlacesLibrary,
  type PlaceSelectionEvent,
  readGooglePlaceSelection,
} from "~/features/google/google";
import { languageTag, useTripLanguage, useTripText } from "~/features/trip/language";

export type GooglePlacePickerProps = {
  label: string;
  bias?: { latitude: number; longitude: number } | undefined;
  autoFocus?: boolean;
  includedPrimaryTypes?: readonly string[] | undefined;
  onSelect: (place: GooglePlaceSelection) => void;
};

export function GooglePlacePicker({
  label,
  bias,
  includedPrimaryTypes,
  autoFocus = false,
  onSelect,
}: GooglePlacePickerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const language = useTripLanguage();
  const text = useTripText();
  const [error, setError] = useState<string | null>(null);
  const selectPlace = useEffectEvent(onSelect);

  useEffect(() => {
    let disposed = false;
    let element: google.maps.places.PlaceAutocompleteElement | undefined;
    let focusFrame: number | undefined;

    const setup = async () => {
      try {
        const { PlaceAutocompleteElement } = await loadPlacesLibrary(language);
        if (disposed || !hostRef.current) return;
        element = new PlaceAutocompleteElement();
        element.className = "google-place-picker";
        element.requestedLanguage = languageTag(language);
        element.setAttribute("aria-label", label);
        if (bias) element.locationBias = { lat: bias.latitude, lng: bias.longitude };
        if (includedPrimaryTypes) {
          element.includedPrimaryTypes = [...includedPrimaryTypes];
        }
        const handleSelect = async (event: Event) => {
          try {
            const place = (event as PlaceSelectionEvent).placePrediction.toPlace();
            const selection = await readGooglePlaceSelection(place);
            if (disposed) return;
            selectPlace(selection);
            setError(null);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : text("couldNotLoadGooglePlace"));
          }
        };
        element.addEventListener("gmp-select", handleSelect);
        hostRef.current.replaceChildren(element);
        if (autoFocus) {
          focusFrame = window.requestAnimationFrame(() => element?.focus({ preventScroll: true }));
        }
      } catch (cause) {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : text("googlePlacesUnavailable"));
        }
      }
    };
    void setup();
    return () => {
      disposed = true;
      if (focusFrame !== undefined) window.cancelAnimationFrame(focusFrame);
      element?.remove();
    };
  }, [autoFocus, bias, includedPrimaryTypes, label, language, text]);

  return (
    <section className="place-picker" aria-label={label}>
      <span className="field-label">{label}</span>
      <div ref={hostRef} />
      {error ? <p className="field-error">{error}</p> : null}
    </section>
  );
}
