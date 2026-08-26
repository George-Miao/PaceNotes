import { useEffect, useRef, useState } from "react";
import { loadPlacesLibrary } from "~/features/google/google";

export function PlaceDetails({ placeId }: { placeId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let details: HTMLElement | undefined;
    const load = async () => {
      try {
        const { Place } = await loadPlacesLibrary();
        await customElements.whenDefined("gmp-place-details");
        if (disposed || !hostRef.current) return;
        details = document.createElement("gmp-place-details");
        details.className = "google-place-details";
        const request = document.createElement("gmp-place-details-place-request");
        request.place = new Place({ id: placeId });
        const content = document.createElement("gmp-place-content-config");
        const media = document.createElement("gmp-place-media");
        media.setAttribute("lightbox-preferred", "");
        content.append(
          media,
          document.createElement("gmp-place-address"),
          document.createElement("gmp-place-rating"),
          document.createElement("gmp-place-summary"),
          document.createElement("gmp-place-reviews"),
          document.createElement("gmp-place-attribution"),
        );
        details.append(request, content);
        details.addEventListener("gmp-load", () => setError(null), { once: true });
        hostRef.current.replaceChildren(details);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Place details are unavailable");
      }
    };
    void load();
    return () => {
      disposed = true;
      details?.remove();
    };
  }, [placeId]);

  return (
    <div className="place-details-shell">
      <div ref={hostRef} />
      {error ? (
        <div className="inline-error">
          <span>{error}</span>
          <button type="button" onClick={() => location.reload()}>
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}
