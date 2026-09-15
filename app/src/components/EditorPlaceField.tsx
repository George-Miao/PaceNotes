import { Icon } from "@iconify/react";
import mapPinPenIcon from "@iconify-icons/lucide/map-pin-pen";
import pencilIcon from "@iconify-icons/lucide/pencil";
import xIcon from "@iconify-icons/lucide/x";
import { useRef, useState } from "react";
import type { GooglePlaceView } from "~/features/google/google";
import { useTripText } from "~/features/trip/language";
import type { PlaceReference } from "~/features/trip/model";
import { GooglePlacePicker } from "./GooglePlacePicker";
import styles from "./ItemEditor.module.css";

export function EditorPlaceField({
  label,
  value,
  places,
  optional = false,
  compact = false,
  includedPrimaryTypes,
  onChange,
}: {
  label: string;
  value: PlaceReference | null;
  places: ReadonlyMap<string, GooglePlaceView>;
  optional?: boolean;
  compact?: boolean;
  includedPrimaryTypes?: readonly string[] | undefined;
  onChange: (value: PlaceReference | null) => void;
}) {
  const text = useTripText();
  const [changing, setChanging] = useState(false);
  const compactButton = useRef<HTMLButtonElement>(null);
  const name = value ? places.get(value.placeId)?.displayName || text("selectedPlace") : "";
  const finishCompactChange = () => {
    setChanging(false);
    requestAnimationFrame(() => compactButton.current?.focus());
  };
  if (compact && value) {
    return (
      <div className={`${styles.placeField} ${styles.compactPlace}`}>
        <button
          ref={compactButton}
          type="button"
          className={`${styles.headerAction} icon-button`}
          aria-label={text("changeField", { field: label })}
          aria-expanded={changing}
          onClick={() => setChanging((current) => !current)}
        >
          <Icon icon={mapPinPenIcon} />
        </button>
        {changing ? (
          <div className={styles.compactPlacePanel}>
            <GooglePlacePicker
              label={label}
              includedPrimaryTypes={includedPrimaryTypes}
              onSelect={(place) => {
                onChange(place.reference);
                finishCompactChange();
              }}
            />
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className={`${styles.placeField} field field-wide`}>
      {value && !changing ? (
        <>
          <span>{label}</span>
          <div className="field-line">
            <strong>{name}</strong>
            <div className={styles.placeActions}>
              <button
                type="button"
                className={styles.edit}
                aria-label={text("changeField", { field: label })}
                onClick={() => setChanging(true)}
              >
                <Icon icon={pencilIcon} />
              </button>
              {optional ? (
                <button
                  type="button"
                  className={styles.edit}
                  aria-label={text("removeField", { field: label })}
                  onClick={() => onChange(null)}
                >
                  <Icon icon={xIcon} />
                </button>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <GooglePlacePicker
          label={label}
          includedPrimaryTypes={includedPrimaryTypes}
          onSelect={(place) => {
            onChange(place.reference);
            setChanging(false);
          }}
        />
      )}
      {value && changing ? (
        <button type="button" className="text-button" onClick={() => setChanging(false)}>
          {text("keepField", { field: label })}
        </button>
      ) : null}
    </div>
  );
}
