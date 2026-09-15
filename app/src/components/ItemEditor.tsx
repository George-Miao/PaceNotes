import { Icon } from "@iconify/react";
import calendarCheckIcon from "@iconify-icons/lucide/calendar-check-2";
import pencilIcon from "@iconify-icons/lucide/pencil";
import xIcon from "@iconify-icons/lucide/x";
import { type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import type { GooglePlaceView } from "~/features/google/google";
import { useGooglePlaceViews } from "~/features/google/use-place-views";
import { useTripLanguage, useTripText } from "~/features/trip/language";
import {
  arrivalTimeFor,
  durationBetween,
  type Lodging,
  lodgingForDates,
  lodgingLeaveTime,
  type Reservation,
  type Transport,
  type TransportMode,
  type TripDay,
  type TripItem,
  transportModes,
} from "~/features/trip/model";
import { EditorPlaceField } from "./EditorPlaceField";
import styles from "./ItemEditor.module.css";
import { MarkdownPreview } from "./MarkdownPreview";

const markdownIcon = {
  width: 24,
  height: 24,
  body: '<path fill="currentColor" d="M22.27 19.385H1.73A1.73 1.73 0 0 1 0 17.655V6.345a1.73 1.73 0 0 1 1.73-1.73h20.54A1.73 1.73 0 0 1 24 6.345v11.308a1.73 1.73 0 0 1-1.73 1.731zM5.769 15.923v-4.5l2.308 2.885l2.307-2.885v4.5h2.308V8.078h-2.308l-2.307 2.885l-2.308-2.885H3.46v7.847zM21.232 12h-2.309V8.077h-2.307V12h-2.308l3.461 4.039z"/>',
} as const;

const transportPrimaryTypes = {
  plane: ["airport", "airstrip", "heliport", "international_airport"],
  train: ["train_station", "transit_station", "subway_station"],
  bus: ["bus_station", "bus_stop", "transit_station"],
  ferry: ["ferry_terminal"],
  custom: undefined,
} as const satisfies Record<TransportMode, readonly string[] | undefined>;

export function ItemEditor({
  item,
  days,
  lodgingDate,
  defaultTitle,
  places,
  onSave,
  onClose,
  onActivate,
}: {
  item: TripItem;
  days: TripDay[];
  lodgingDate: string | null;
  defaultTitle: string;
  places: ReadonlyMap<string, GooglePlaceView>;
  onSave: (patch: Partial<TripItem>) => void;
  onClose: () => void;
  onActivate: () => void;
}) {
  const language = useTripLanguage();
  const text = useTripText();
  const [draft, setDraftState] = useState(item);
  const [arrivalTime, setArrivalTime] = useState(() =>
    arrivalTimeFor(item.startTime, item.durationMinutes),
  );
  const [preview, setPreview] = useState(false);
  const initialLabel = useRef("");
  const savedDraft = useRef(item);
  const pendingDraft = useRef<TripItem | null>(null);
  const saveTimer = useRef<number | null>(null);
  const onSaveRef = useRef(onSave);
  const flushRef = useRef<() => void>(() => {});
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const titleBlur = useRef<number | null>(null);
  const editor = useRef<HTMLElement>(null);
  const titleButton = useRef<HTMLButtonElement>(null);
  const setDraft = (next: SetStateAction<TripItem>) => {
    if (typeof next !== "function") {
      pendingDraft.current = next;
      setDraftState(next);
      return;
    }
    setDraftState((current) => {
      const value = next(current);
      pendingDraft.current = value;
      return value;
    });
  };
  const editingTitle = titleDraft !== null;
  const draftIds = [draft.place, draft.transport?.from, draft.transport?.to].flatMap((place) =>
    place && !places.has(place.placeId) ? [place.placeId] : [],
  );
  const { places: localPlaces } = useGooglePlaceViews(draftIds, language);
  const editorPlaces = useMemo(() => new Map([...places, ...localPlaces]), [places, localPlaces]);
  const title =
    draft.title ||
    (draft.place && editorPlaces.get(draft.place.placeId)?.displayName) ||
    defaultTitle;
  const editedTitle =
    titleDraft === null || titleDraft.trim() === initialLabel.current
      ? draft.title
      : titleDraft.trim();
  const optionalTitle = draft.type === "place" || Boolean(draft.place);
  const transport: Transport = draft.transport ?? {
    from: null,
    to: null,
    mode: "train",
    customMode: "",
  };
  const invalidStay =
    draft.type === "lodging" &&
    (!draft.lodging || draft.lodging.endDate <= draft.lodging.startDate);
  const outsideTrip =
    draft.type === "lodging" &&
    draft.dayId !== null &&
    draft.lodging !== null &&
    (draft.lodging.endDate < (days[0]?.date ?? "") ||
      draft.lodging.startDate > (days.at(-1)?.date ?? ""));
  const missingPlace = (draft.type === "reservation" || draft.type === "lodging") && !draft.place;
  const invalidTransport =
    draft.type === "transport" && transport.mode === "custom" && !transport.customMode.trim();
  const missingTransportArrival =
    draft.type === "transport" && draft.startTime !== null && arrivalTime === "";
  const missingReservationDay = draft.type === "reservation" && !draft.dayId;
  const missingReservationTime = draft.type === "reservation" && !draft.startTime;
  const invalidDraft =
    (!optionalTitle && !editedTitle) ||
    invalidStay ||
    outsideTrip ||
    missingPlace ||
    missingReservationDay ||
    missingReservationTime ||
    invalidTransport ||
    missingTransportArrival;

  onSaveRef.current = onSave;
  const flushPending = () => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const next = pendingDraft.current;
    if (!next) return;
    pendingDraft.current = null;
    const patch = changedItemFields(savedDraft.current, next);
    if (Object.keys(patch).length === 0) return;
    savedDraft.current = next;
    onSaveRef.current(patch);
  };
  flushRef.current = flushPending;

  useEffect(() => {
    editor.current?.scrollIntoView({ block: "nearest" });
  }, []);

  useEffect(
    () => () => {
      if (titleBlur.current !== null) window.clearTimeout(titleBlur.current);
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      flushRef.current();
    },
    [],
  );
  useEffect(() => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    const next = { ...draft, title: editedTitle };
    if (invalidDraft || Object.keys(changedItemFields(savedDraft.current, next)).length === 0) {
      pendingDraft.current = null;
      saveTimer.current = null;
      return;
    }
    pendingDraft.current = next;
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      flushRef.current();
    }, 300);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [draft, editedTitle, invalidDraft]);

  useEffect(() => {
    if (pendingDraft.current) return;
    savedDraft.current = item;
    setDraftState(item);
    setArrivalTime(arrivalTimeFor(item.startTime, item.durationMinutes));
  }, [item]);
  useEffect(() => {
    if (!editingTitle) return;
    titleInput.current?.focus();
    titleInput.current?.select();
  }, [editingTitle]);

  const startTitleEdit = () => {
    initialLabel.current = title;
    setTitleDraft(title);
  };

  const finishTitle = (restoreFocus: boolean) => {
    if (titleBlur.current !== null) {
      window.clearTimeout(titleBlur.current);
      titleBlur.current = null;
    }
    if (optionalTitle || editedTitle) {
      setDraft((current) => ({ ...current, title: editedTitle }));
    }
    setTitleDraft(null);
    if (restoreFocus) requestAnimationFrame(() => titleButton.current?.focus());
  };

  const close = () => {
    if (titleBlur.current !== null) {
      window.clearTimeout(titleBlur.current);
      titleBlur.current = null;
    }
    onClose();
  };

  return (
    <aside
      ref={editor}
      className="item-editor"
      aria-labelledby="item-editor-title"
      onFocusCapture={onActivate}
    >
      <div className="section-heading">
        <div className={styles.title}>
          {titleDraft === null ? (
            <button type="button" className={styles.titleTrigger} onClick={startTitleEdit}>
              <h2 id="item-editor-title" className={styles.text}>
                {title}
              </h2>
            </button>
          ) : (
            <input
              ref={titleInput}
              id="item-editor-title"
              className={styles.input}
              aria-label={text("itineraryLabel")}
              aria-invalid={!optionalTitle && !titleDraft.trim()}
              maxLength={300}
              value={titleDraft}
              onChange={(event) => {
                setTitleDraft(event.target.value);
              }}
              onBlur={() => {
                titleBlur.current = window.setTimeout(() => {
                  titleBlur.current = null;
                  finishTitle(false);
                }, 0);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (optionalTitle || titleDraft.trim()) finishTitle(true);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  finishTitle(true);
                }
              }}
            />
          )}
          <div className={styles.headerActions}>
            {titleDraft === null ? (
              <button
                ref={titleButton}
                type="button"
                className={`${styles.headerAction} ${styles.titleEditAction} icon-button`}
                aria-label={text("editLabel", { title })}
                onClick={startTitleEdit}
              >
                <Icon icon={pencilIcon} />
              </button>
            ) : null}
            {titleDraft === null ? (
              <span className={styles.actionSpacer} aria-hidden="true" />
            ) : null}
            {draft.place ? (
              <EditorPlaceField
                label={text("place")}
                value={draft.place}
                places={editorPlaces}
                compact
                onChange={(place) => setDraft({ ...draft, place })}
              />
            ) : null}
            {draft.type === "place" && draft.dayId !== null ? (
              <button
                type="button"
                className={`${styles.headerAction} icon-button`}
                aria-label={text("changeToReservation")}
                onClick={() => {
                  if (!confirm(text("changeToReservationConfirm"))) return;
                  setDraft({
                    ...draft,
                    type: "reservation",
                    reservation: { provider: "", confirmation: "" },
                  });
                }}
              >
                <Icon icon={calendarCheckIcon} />
              </button>
            ) : null}
            <button
              type="button"
              className={`${styles.headerAction} icon-button`}
              aria-label={text("closeEditor")}
              onClick={close}
            >
              <Icon icon={xIcon} />
            </button>
          </div>
        </div>
      </div>
      <div className="editor-grid">
        {(draft.type === "place" || draft.type === "reservation" || draft.type === "lodging") &&
        !draft.place ? (
          <EditorPlaceField
            label={text("place")}
            value={draft.place}
            places={editorPlaces}
            onChange={(place) => setDraft({ ...draft, place })}
          />
        ) : null}
        {draft.type === "transport" ? (
          <>
            <label className="field field-wide">
              <span>{text("travelMethod")}</span>
              <select
                value={transport.mode}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    transport: { ...transport, mode: event.target.value as Transport["mode"] },
                  })
                }
              >
                {transportModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {text(mode)}
                  </option>
                ))}
              </select>
            </label>
            {transport.mode === "custom" ? (
              <label className="field field-wide">
                <span>{text("customTravelMethod")}</span>
                <input
                  maxLength={80}
                  value={transport.customMode}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      transport: { ...transport, customMode: event.target.value },
                    })
                  }
                />
              </label>
            ) : null}
            <EditorPlaceField
              label={text("from")}
              value={transport.from}
              places={editorPlaces}
              includedPrimaryTypes={transportPrimaryTypes[transport.mode]}
              optional
              onChange={(from) => setDraft({ ...draft, transport: { ...transport, from } })}
            />
            <EditorPlaceField
              label={text("to")}
              value={transport.to}
              places={editorPlaces}
              includedPrimaryTypes={transportPrimaryTypes[transport.mode]}
              optional
              onChange={(to) => setDraft({ ...draft, transport: { ...transport, to } })}
            />
          </>
        ) : null}
        {draft.type === "transport" ? (
          <>
            <label className="field">
              <span>{text("departureTime")}</span>
              <input
                type="time"
                value={draft.startTime ?? ""}
                onChange={(event) => {
                  const departureTime = event.target.value || null;
                  const nextArrivalTime = departureTime ? arrivalTime || departureTime : "";
                  setArrivalTime(nextArrivalTime);
                  setDraft({
                    ...draft,
                    startTime: departureTime,
                    durationMinutes: departureTime
                      ? durationBetween(departureTime, nextArrivalTime)
                      : draft.durationMinutes,
                  });
                }}
              />
            </label>
            <label className="field">
              <span>{text("arrivalTime")}</span>
              <input
                type="time"
                required={draft.startTime !== null}
                aria-invalid={missingTransportArrival}
                disabled={draft.startTime === null}
                value={arrivalTime}
                onChange={(event) => {
                  const nextArrivalTime = event.target.value;
                  setArrivalTime(nextArrivalTime);
                  if (draft.startTime && nextArrivalTime) {
                    setDraft({
                      ...draft,
                      durationMinutes: durationBetween(draft.startTime, nextArrivalTime),
                    });
                  }
                }}
              />
            </label>
          </>
        ) : draft.type !== "lodging" && draft.type !== "note" ? (
          <>
            <label className="field">
              <span>{text("startTime")}</span>
              <input
                type="time"
                required={draft.type === "reservation"}
                aria-invalid={draft.type === "reservation" && !draft.startTime}
                value={draft.startTime ?? ""}
                onChange={(event) => setDraft({ ...draft, startTime: event.target.value || null })}
              />
            </label>
            <label className="field">
              <span>{text("durationMinutes")}</span>
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
          </>
        ) : null}
        {draft.type === "lodging" ? (
          <LodgingFields
            value={draft.lodging}
            days={days}
            editDate={lodgingDate}
            onChange={(lodging) =>
              setDraft({
                ...draft,
                lodging,
                dayId: draft.dayId === null ? null : lodging.startDate,
              })
            }
          />
        ) : null}
        <div className="field field-wide">
          <div className="field-line">
            <span className={styles.notesLabel}>
              {text("notes")}
              <span
                className={styles.markdownCue}
                role="img"
                aria-label={text("markdownSupported")}
                title={text("markdownSupported")}
              >
                <Icon icon={markdownIcon} aria-hidden="true" />
              </span>
            </span>
            {draft.type === "note" ? (
              <button
                type="button"
                className="text-button"
                onClick={() => setPreview((value) => !value)}
              >
                {preview ? text("edit") : text("preview")}
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
        {invalidStay ? <p className="field-error field-wide">{text("stayAfterCheckin")}</p> : null}
        {outsideTrip ? <p className="field-error field-wide">{text("stayOverlap")}</p> : null}
        {missingPlace ? (
          <p className="field-error field-wide">{text("choosePlaceSaving")}</p>
        ) : null}
        {missingReservationDay ? (
          <p className="field-error field-wide">{text("scheduleReservation")}</p>
        ) : null}
        {missingReservationTime ? (
          <p className="field-error field-wide">{text("chooseStartSaving")}</p>
        ) : null}
        {missingTransportArrival ? (
          <p className="field-error field-wide">{text("chooseArrival")}</p>
        ) : null}
      </div>
    </aside>
  );
}

function changedItemFields(before: TripItem, after: TripItem): Partial<TripItem> {
  return {
    ...(before.type !== after.type ? { type: after.type } : {}),
    ...(before.title !== after.title ? { title: after.title } : {}),
    ...(before.details !== after.details ? { details: after.details } : {}),
    ...(before.dayId !== after.dayId ? { dayId: after.dayId } : {}),
    ...(before.startTime !== after.startTime ? { startTime: after.startTime } : {}),
    ...(before.durationMinutes !== after.durationMinutes
      ? { durationMinutes: after.durationMinutes }
      : {}),
    ...(before.place !== after.place ? { place: after.place } : {}),
    ...(before.reservation !== after.reservation ? { reservation: after.reservation } : {}),
    ...(before.lodging !== after.lodging ? { lodging: after.lodging } : {}),
    ...(before.transport !== after.transport ? { transport: after.transport } : {}),
    ...(before.travelMode !== after.travelMode ? { travelMode: after.travelMode } : {}),
  };
}

function ReservationFields({
  value,
  onChange,
}: {
  value: Reservation | null;
  onChange: (value: Reservation) => void;
}) {
  const text = useTripText();
  const reservation = value ?? { provider: "", confirmation: "" };
  return (
    <fieldset className="field-group field-wide">
      <legend>{text("reservation")}</legend>
      <label className="field">
        <span>{text("provider")}</span>
        <input
          value={reservation.provider}
          maxLength={200}
          onChange={(event) => onChange({ ...reservation, provider: event.target.value })}
        />
      </label>
      <label className="field">
        <span>{text("confirmation")}</span>
        <input
          value={reservation.confirmation}
          maxLength={200}
          onChange={(event) => onChange({ ...reservation, confirmation: event.target.value })}
        />
      </label>
    </fieldset>
  );
}

function LodgingFields({
  value,
  days,
  editDate,
  onChange,
}: {
  value: Lodging | null;
  days: TripDay[];
  editDate: string | null;
  onChange: (value: Lodging) => void;
}) {
  const text = useTripText();
  const lodging = value ?? lodgingForDates(days[0]?.date ?? "", days.at(-1)?.date ?? "");
  return (
    <div className={`${styles.stayFields} field-wide`}>
      {editDate ? (
        <label className="field field-wide">
          <span>{text("leaveAt")}</span>
          <input
            type="time"
            required
            value={lodgingLeaveTime(lodging, editDate)}
            onChange={(event) => {
              if (!event.target.value) return;
              onChange({
                ...lodging,
                leaveTimes: { ...lodging.leaveTimes, [editDate]: event.target.value },
              });
            }}
          />
        </label>
      ) : null}
      <label className="field">
        <span>{text("checkInDate")}</span>
        <input
          type="date"
          value={lodging.startDate}
          onChange={(event) =>
            onChange(lodgingForDates(event.target.value, lodging.endDate, lodging.leaveTimes))
          }
        />
      </label>
      <label className="field">
        <span>{text("checkOutDate")}</span>
        <input
          type="date"
          value={lodging.endDate}
          onChange={(event) =>
            onChange(lodgingForDates(lodging.startDate, event.target.value, lodging.leaveTimes))
          }
        />
      </label>
    </div>
  );
}
