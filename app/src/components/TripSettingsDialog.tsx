import { Temporal } from "@js-temporal/polyfill";
import { useCallback, useEffect, useRef, useState } from "react";
import { travelModeLabel, useTripText, useUiLanguage } from "~/features/trip/language";
import {
  type CalendarStartHour,
  calendarStartHourOptions,
  type DistanceUnit,
  distanceUnits,
  type TravelMode,
  type TripLanguage,
  type TripSettings,
  travelModes,
  tripLanguages,
  tripSettingsSchema,
} from "~/features/trip/model";

const languageLabels: Record<TripLanguage, string> = {
  en: "English",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  ja: "日本語",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  it: "Italiano",
};

export type TripSettingsForm = TripSettings & { uiLanguage: TripLanguage };
function settingsMatch(left: TripSettingsForm, right: TripSettingsForm): boolean {
  return (
    left.startDate === right.startDate &&
    left.endDate === right.endDate &&
    left.uiLanguage === right.uiLanguage &&
    left.tripLanguage === right.tripLanguage &&
    left.distanceUnit === right.distanceUnit &&
    left.defaultTravelMode === right.defaultTravelMode &&
    left.calendarStartHour === right.calendarStartHour
  );
}

export function TripSettingsDialog({
  settings,
  onSave,
  onClose,
}: {
  settings: TripSettingsForm;
  onSave: (settings: TripSettingsForm) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const language = useUiLanguage();
  const text = useTripText();
  const backdropRef = useRef<HTMLDivElement>(null);
  const valid = tripSettingsSchema.safeParse(settingsForDocument(draft)).success;
  const requestClose = useCallback(() => {
    if (!settingsMatch(draft, settings) && !window.confirm(text("discardTripSettings"))) return;
    onClose();
  }, [draft, onClose, settings, text]);

  useEffect(() => {
    const backdrop = backdropRef.current;
    const closeOnBackdrop = (event: MouseEvent) => {
      if (event.target === backdrop) requestClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    };
    backdrop?.addEventListener("click", closeOnBackdrop);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      backdrop?.removeEventListener("click", closeOnBackdrop);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [requestClose]);

  return (
    <div ref={backdropRef} className="dialog-backdrop">
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trip-settings-title"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
        }}
      >
        <h2 id="trip-settings-title">{text("tripSettings")}</h2>
        <fieldset className="trip-date-range">
          <legend className="sr-only">{text("tripDates")}</legend>
          <label className="field">
            <span>{text("start")}</span>
            <input
              type="date"
              required
              value={draft.startDate}
              min={shiftDate(draft.endDate, -29)}
              max={draft.endDate}
              onChange={(event) =>
                setDraft((current) => ({ ...current, startDate: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>{text("end")}</span>
            <input
              type="date"
              required
              value={draft.endDate}
              min={draft.startDate}
              max={shiftDate(draft.startDate, 29)}
              onChange={(event) =>
                setDraft((current) => ({ ...current, endDate: event.target.value }))
              }
            />
          </label>
        </fieldset>
        <div className="settings-language-row">
          <label className="field">
            <span>{text("uiLanguage")}</span>
            <select
              value={draft.uiLanguage}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  uiLanguage: event.target.value as TripLanguage,
                }))
              }
            >
              {tripLanguages.map((language) => (
                <option key={language} value={language}>
                  {languageLabels[language]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{text("tripLanguage")}</span>
            <select
              value={draft.tripLanguage ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  tripLanguage: event.target.value ? (event.target.value as TripLanguage) : null,
                }))
              }
            >
              <option value="">
                {text("followUiLanguage", { language: languageLabels[draft.uiLanguage] })}
              </option>
              {tripLanguages.map((language) => (
                <option key={language} value={language}>
                  {languageLabels[language]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>{text("distanceUnits")}</span>
          <select
            value={draft.distanceUnit}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                distanceUnit: event.target.value as DistanceUnit,
              }))
            }
          >
            {distanceUnits.map((unit) => (
              <option key={unit} value={unit}>
                {text(unit === "metric" ? "metricUnits" : "imperialUnits")}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{text("defaultTransport")}</span>
          <select
            value={draft.defaultTravelMode}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                defaultTravelMode: event.target.value as TravelMode,
              }))
            }
          >
            {travelModes.map((mode) => (
              <option key={mode} value={mode}>
                {travelModeLabel(language, mode)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{text("calendarDayStart")}</span>
          <select
            value={draft.calendarStartHour}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                calendarStartHour: Number(event.target.value) as CalendarStartHour,
              }))
            }
          >
            {calendarStartHourOptions.map((hour) => (
              <option key={hour} value={hour}>
                {String(hour).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </label>
        <div>
          <button type="button" className="ghost-button" onClick={requestClose}>
            {text("cancel")}
          </button>
          <button type="submit" className="primary-button" disabled={!valid}>
            {text("saveSettings")}
          </button>
        </div>
      </form>
    </div>
  );
}

function settingsForDocument(settings: TripSettingsForm): TripSettings {
  const { uiLanguage: _, ...documentSettings } = settings;
  return documentSettings;
}

function shiftDate(date: string, days: number): string | undefined {
  try {
    return Temporal.PlainDate.from(date).add({ days }).toString();
  } catch {
    return undefined;
  }
}
