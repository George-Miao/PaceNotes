import { useState } from "react";
import type { Lodging, Reservation, TravelMode, TripDay, TripItem } from "~/features/trip/model";
import { MarkdownPreview } from "./MarkdownPreview";
import { PlaceDetails } from "./PlaceDetails";

export function ItemEditor({
  item,
  days,
  onSave,
  onClose,
}: {
  item: TripItem;
  days: TripDay[];
  onSave: (patch: Partial<TripItem>) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(item);
  const [preview, setPreview] = useState(false);

  const save = () => {
    onSave({
      title: draft.title,
      details: draft.details,
      dayId: draft.dayId,
      startTime: draft.startTime,
      durationMinutes: draft.durationMinutes,
      reservation: draft.reservation,
      lodging: draft.lodging,
      travelMode: draft.travelMode,
    });
    onClose();
  };

  return (
    <aside className="item-editor" aria-labelledby="item-editor-title">
      <div className="section-heading">
        <h2 id="item-editor-title">Edit item</h2>
        <button type="button" className="ghost-button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="editor-grid">
        <label className="field field-wide">
          <span>Title</span>
          <input
            value={draft.title}
            maxLength={300}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Day</span>
          <select
            value={draft.dayId ?? ""}
            onChange={(event) => setDraft({ ...draft, dayId: event.target.value || null })}
          >
            <option value="">Places to visit</option>
            {days.map((day) => (
              <option key={day.id} value={day.id}>
                {formatDay(day.date)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Start time</span>
          <input
            type="time"
            value={draft.startTime ?? ""}
            onChange={(event) => setDraft({ ...draft, startTime: event.target.value || null })}
          />
        </label>
        <label className="field">
          <span>Duration in minutes</span>
          <input
            type="number"
            min="0"
            max="10080"
            value={draft.durationMinutes}
            onChange={(event) =>
              setDraft({ ...draft, durationMinutes: Number(event.target.value) })
            }
          />
        </label>
        <label className="field">
          <span>Travel mode after prior stop</span>
          <select
            value={draft.travelMode}
            onChange={(event) =>
              setDraft({ ...draft, travelMode: event.target.value as TravelMode })
            }
          >
            <option value="DRIVING">Driving</option>
            <option value="TRANSIT">Public transport</option>
            <option value="WALKING">Walking</option>
          </select>
        </label>
        <div className="field field-wide">
          <div className="field-line">
            <span>Notes</span>
            {draft.type === "note" ? (
              <button
                type="button"
                className="text-button"
                onClick={() => setPreview((value) => !value)}
              >
                {preview ? "Edit" : "Preview"}
              </button>
            ) : null}
          </div>
          {preview ? (
            <MarkdownPreview source={draft.details} />
          ) : (
            <textarea
              rows={6}
              maxLength={10_000}
              value={draft.details}
              onChange={(event) => setDraft({ ...draft, details: event.target.value })}
            />
          )}
        </div>
        {draft.type === "reservation" ? (
          <ReservationFields
            value={draft.reservation}
            onChange={(reservation) => setDraft({ ...draft, reservation })}
          />
        ) : null}
        {draft.type === "lodging" ? (
          <LodgingFields
            value={draft.lodging}
            days={days}
            onChange={(lodging) => setDraft({ ...draft, lodging })}
          />
        ) : null}
      </div>
      {draft.place ? <PlaceDetails placeId={draft.place.placeId} /> : null}
      <div className="editor-actions">
        <button type="button" className="ghost-button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={!draft.title.trim()}
          onClick={save}
        >
          Save item
        </button>
      </div>
    </aside>
  );
}

function ReservationFields({
  value,
  onChange,
}: {
  value: Reservation | null;
  onChange: (value: Reservation) => void;
}) {
  const reservation = value ?? { provider: "", confirmation: "", bookingDate: null };
  return (
    <fieldset className="field-group field-wide">
      <legend>Reservation</legend>
      <label className="field">
        <span>Provider</span>
        <input
          value={reservation.provider}
          maxLength={200}
          onChange={(event) => onChange({ ...reservation, provider: event.target.value })}
        />
      </label>
      <label className="field">
        <span>Confirmation</span>
        <input
          value={reservation.confirmation}
          maxLength={200}
          onChange={(event) => onChange({ ...reservation, confirmation: event.target.value })}
        />
      </label>
      <label className="field">
        <span>Booking date</span>
        <input
          type="date"
          value={reservation.bookingDate ?? ""}
          onChange={(event) =>
            onChange({ ...reservation, bookingDate: event.target.value || null })
          }
        />
      </label>
    </fieldset>
  );
}

function LodgingFields({
  value,
  days,
  onChange,
}: {
  value: Lodging | null;
  days: TripDay[];
  onChange: (value: Lodging) => void;
}) {
  const lodging = value ?? { startDate: days[0]?.date ?? "", endDate: days.at(-1)?.date ?? "" };
  return (
    <fieldset className="field-group field-wide">
      <legend>Stay</legend>
      <label className="field">
        <span>Check-in date</span>
        <input
          type="date"
          value={lodging.startDate}
          onChange={(event) => onChange({ ...lodging, startDate: event.target.value })}
        />
      </label>
      <label className="field">
        <span>Check-out date</span>
        <input
          type="date"
          value={lodging.endDate}
          onChange={(event) => onChange({ ...lodging, endDate: event.target.value })}
        />
      </label>
    </fieldset>
  );
}

function formatDay(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}
