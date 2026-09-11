import { Temporal } from "@js-temporal/polyfill";
import { useRef, useState } from "react";
import type { GooglePlaceSelection } from "~/features/google/google";
import { useTripText } from "~/features/trip/language";
import { GooglePlacePicker } from "./GooglePlacePicker";
import styles from "./PlaceSearch.module.css";

type PlaceSchedule =
  | {
      type: "reservation";
      date: string;
      startTime: string;
      onStartTimeChange: (startTime: string) => void;
    }
  | {
      type: "lodging";
      checkInDate: string;
      checkOutDate: string;
      onCheckInDateChange: (date: string) => void;
      onCheckOutDateChange: (date: string) => void;
    };

export function PlaceSearch({
  bias,
  title,
  schedule,
  onAdd,
}: {
  bias?: { latitude: number; longitude: number } | undefined;
  title: string;
  schedule?: PlaceSchedule;
  onAdd: (place: GooglePlaceSelection) => Promise<void>;
}) {
  const text = useTripText();
  const pending = useRef(false);
  const [selectedPlace, setSelectedPlace] = useState<GooglePlaceSelection | null>(null);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (place: GooglePlaceSelection) => {
    if (pending.current) return;
    setError(null);
    pending.current = true;
    setPlacing(true);
    try {
      await onAdd(place);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("couldNotAddPlace"));
    } finally {
      pending.current = false;
      setPlacing(false);
    }
  };

  const save = async () => {
    if (!selectedPlace) {
      setError(text("choosePlace"));
      return;
    }
    if (schedule?.type === "reservation" && !schedule.startTime) {
      setError(text("chooseDateTime"));
      return;
    }
    if (
      schedule?.type === "lodging" &&
      (!schedule.checkInDate ||
        !schedule.checkOutDate ||
        schedule.checkOutDate <= schedule.checkInDate)
    ) {
      setError(text("checkoutAfterCheckin"));
      return;
    }
    await add(selectedPlace);
  };

  return (
    <section className="place-search" aria-labelledby="place-search-title" aria-busy={placing}>
      <div className="section-heading">
        <h2 id="place-search-title">{title}</h2>
        <span>Google Places</span>
      </div>
      {schedule?.type === "reservation" ? (
        <div className={styles.schedule}>
          <label className="field">
            <span>{text("date")}</span>
            <input type="date" required readOnly value={schedule.date} />
          </label>
          <label className="field">
            <span>{text("startTime")}</span>
            <input
              type="time"
              required
              value={schedule.startTime}
              onChange={(event) => schedule.onStartTimeChange(event.target.value)}
            />
          </label>
        </div>
      ) : schedule?.type === "lodging" ? (
        <div className={styles.schedule}>
          <label className="field">
            <span>{text("checkInDate")}</span>
            <input
              type="date"
              required
              value={schedule.checkInDate}
              onChange={(event) => schedule.onCheckInDateChange(event.target.value)}
            />
          </label>
          <label className="field">
            <span>{text("checkOutDate")}</span>
            <input
              type="date"
              required
              min={nextDate(schedule.checkInDate)}
              value={schedule.checkOutDate}
              onChange={(event) => schedule.onCheckOutDateChange(event.target.value)}
            />
          </label>
        </div>
      ) : null}
      <div inert={placing}>
        <GooglePlacePicker
          label={text("searchGooglePlaces")}
          bias={bias}
          onSelect={(place) => {
            setError(null);
            if (!schedule) {
              setSelectedPlace(null);
              void add(place);
              return;
            }
            setSelectedPlace(place);
          }}
        />
      </div>
      {schedule ? (
        <div className={styles.actions}>
          <button type="button" className="primary-button" disabled={placing} onClick={save}>
            {schedule.type === "reservation" ? text("addReservation") : text("addLodging")}
          </button>
        </div>
      ) : null}
      {placing ? <p role="status">{text("checkingPlacement")}</p> : null}
      {error ? <p className="field-error">{error}</p> : null}
    </section>
  );
}

function nextDate(date: string): string | undefined {
  if (!date) return undefined;
  try {
    return Temporal.PlainDate.from(date).add({ days: 1 }).toString();
  } catch {
    return undefined;
  }
}
