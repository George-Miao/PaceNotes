import { Icon } from "@iconify/react";
import ellipsisIcon from "@iconify-icons/lucide/ellipsis";
import hotelIcon from "@iconify-icons/lucide/hotel";
import mapPinPlusIcon from "@iconify-icons/lucide/map-pin-plus";
import noteIcon from "@iconify-icons/lucide/notebook-pen";
import ticketIcon from "@iconify-icons/lucide/ticket";
import trainIcon from "@iconify-icons/lucide/train-front";
import { useEffect, useRef } from "react";
import { useTripText } from "~/features/trip/language";
import styles from "./DayAddControl.module.css";

export type DayAddItemType = "note" | "reservation" | "lodging" | "transport";

const itemTypes: Array<{ type: DayAddItemType; icon: typeof noteIcon }> = [
  { type: "note", icon: noteIcon },
  { type: "reservation", icon: ticketIcon },
  { type: "lodging", icon: hotelIcon },
  { type: "transport", icon: trainIcon },
];

export function DayAddControl({
  dayId,
  dayLabel,
  menuOpen,
  onMenuOpenChange,
  onPlace,
  onAdd,
}: {
  dayId: string;
  dayLabel: string;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onPlace: () => void;
  onAdd: (type: DayAddItemType) => void;
}) {
  const text = useTripText();
  const root = useRef<HTMLDivElement>(null);
  const menuId = `day-add-menu-${dayId}`;

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        onMenuOpenChange(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onMenuOpenChange(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen, onMenuOpenChange]);

  return (
    <div ref={root} className={styles.root}>
      <div className={styles.controls}>
        <div className={styles.group}>
          <button
            type="button"
            data-place-trigger
            className={`primary-button ${styles.place}`}
            onClick={onPlace}
          >
            <Icon icon={mapPinPlusIcon} />
            {text("place")}
          </button>
          <button
            type="button"
            className={`primary-button ${styles.more}`}
            aria-label={text("moreItemTypes", { date: dayLabel })}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => onMenuOpenChange(!menuOpen)}
          >
            <Icon icon={ellipsisIcon} />
          </button>
        </div>
        {menuOpen ? (
          <fieldset
            id={menuId}
            className={styles.menu}
            aria-label={text("addItemToDay", { date: dayLabel })}
          >
            {itemTypes.map(({ type, icon }) => {
              const label = text(type);
              return (
                <button
                  key={type}
                  type="button"
                  aria-label={text("addType", { type: label.toLocaleLowerCase() })}
                  onClick={() => onAdd(type)}
                >
                  <Icon icon={icon} />
                  {label}
                </button>
              );
            })}
          </fieldset>
        ) : null}
      </div>
    </div>
  );
}
