import { useEffect, useRef, useState } from "react";
import { loadPlacesLibrary } from "~/features/google/google";
import { languageTag, useTripLanguage, useTripText } from "~/features/trip/language";

export function PlaceDetails({ placeId }: { placeId: string }) {
  const [attempt, setAttempt] = useState(0);
  return (
    <PlaceDetailsContent
      key={`${placeId}:${attempt}`}
      placeId={placeId}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}

function PlaceDetailsContent({ placeId, onRetry }: { placeId: string; onRetry: () => void }) {
  const language = useTripLanguage();
  const text = useTripText();
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    let details: HTMLElement | undefined;
    const load = async () => {
      try {
        const { Place, PlaceDetailsElement } = await loadPlacesLibrary(language);
        if (disposed || !hostRef.current) return;
        details = new PlaceDetailsElement();
        details.className = "google-place-details";
        const request = document.createElement("gmp-place-details-place-request");
        request.place = new Place({ id: placeId, requestedLanguage: languageTag(language) });
        const content = document.createElement("gmp-place-content-config");
        const media = document.createElement("gmp-place-media");
        media.setAttribute("lightbox-preferred", "");
        content.append(
          media,
          document.createElement("gmp-place-address"),
          document.createElement("gmp-place-type"),
          document.createElement("gmp-place-open-now-status"),
          document.createElement("gmp-place-opening-hours"),
          document.createElement("gmp-place-website"),
          document.createElement("gmp-place-phone-number"),
          document.createElement("gmp-place-rating"),
          document.createElement("gmp-place-summary"),
          document.createElement("gmp-place-reviews"),
          document.createElement("gmp-place-attribution"),
        );
        details.append(request, content);
        details.addEventListener("gmp-load", () => {
          if (disposed) return;
          setLoading(false);
          setError(null);
        });
        details.addEventListener("gmp-error", () => {
          if (disposed) return;
          setLoading(false);
          setError(text("placeDetailsUnavailable"));
        });
        hostRef.current.replaceChildren(details);
      } catch {
        if (disposed) return;
        setLoading(false);
        setError(text("placeDetailsUnavailable"));
      }
    };
    void load();
    return () => {
      disposed = true;
      details?.remove();
    };
  }, [placeId, language, text]);

  return (
    <div className="place-details-shell">
      {loading ? (
        <p className="place-details-status" role="status">
          {text("loadingPlaceDetails")}
        </p>
      ) : null}
      <div ref={hostRef} hidden={error !== null} />
      {error ? (
        <div className="inline-error">
          <span>{error}</span>
          <button type="button" onClick={onRetry}>
            {text("retry")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
