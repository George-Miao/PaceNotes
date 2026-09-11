import { Icon } from "@iconify/react";
import xIcon from "@iconify-icons/lucide/x";
import { useEffect, useRef } from "react";
import { useTripText } from "~/features/trip/language";
import styles from "./MapPlaceDetails.module.css";
import { PlaceDetails } from "./PlaceDetails";

export function MapPlaceDetails({
  placeId,
  autoFocus,
  placement,
  onAddToTrip,
  onRemoveFromDay,
  onClose,
}: {
  placeId: string;
  placement: { itemId: string; dayNumber: number } | null;
  autoFocus: boolean;
  onAddToTrip: (placeId: string) => void;
  onRemoveFromDay: (itemId: string) => void;
  onClose: () => void;
}) {
  const text = useTripText();
  const closeRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    const previous = document.activeElement;
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [autoFocus]);

  useEffect(() => {
    if (placeId && contentRef.current) contentRef.current.scrollTop = 0;
  }, [placeId]);

  return (
    <section
      className={styles.panel}
      role="dialog"
      aria-label={text("placeDetails")}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className={styles.header}>
        <h2>{text("placeDetails")}</h2>
        <div className={styles.actions}>
          {placement ? (
            <button
              type="button"
              className={`danger-button ${styles.add}`}
              onClick={() => onRemoveFromDay(placement.itemId)}
            >
              {text("removeFromDay", { day: placement.dayNumber })}
            </button>
          ) : (
            <button
              type="button"
              className={`primary-button ${styles.add}`}
              onClick={() => onAddToTrip(placeId)}
            >
              {text("addToTrip")}
            </button>
          )}
          <button
            ref={closeRef}
            type="button"
            className="icon-button"
            aria-label={text("closePlaceDetails")}
            onClick={onClose}
          >
            <Icon icon={xIcon} />
          </button>
        </div>
      </header>
      <div ref={contentRef} className={styles.content}>
        <PlaceDetails key={placeId} placeId={placeId} />
      </div>
    </section>
  );
}
