import { useState } from "react";
import { travelModeLabel, useTripLanguage, useTripText } from "~/features/trip/language";
import {
  type CalendarHours,
  calendarHourOptions,
  type DistanceUnit,
  distanceUnits,
  type TravelMode,
  type TripLanguage,
  type TripSettings,
  travelModes,
  tripLanguages,
} from "~/features/trip/model";

const languageLabels: Record<TripLanguage, string> = {
  en: "English",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  it: "Italiano",
  ja: "日本語",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
};

export function TripSettingsDialog({
  settings,
  onSave,
  onClose,
}: {
  settings: TripSettings;
  onSave: (settings: TripSettings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const language = useTripLanguage();
  const text = useTripText();

  return (
    <div className="dialog-backdrop">
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
        <label className="field">
          <span>{text("language")}</span>
          <select
            value={draft.language}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                language: event.target.value as TripLanguage,
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
          <span>{text("calendarHours")}</span>
          <select
            value={draft.calendarHours}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                calendarHours: Number(event.target.value) as CalendarHours,
              }))
            }
          >
            {calendarHourOptions.map((hours) => (
              <option key={hours} value={hours}>
                {text(hours === 24 ? "calendar24Hours" : "calendar30Hours")}
              </option>
            ))}
          </select>
        </label>
        <div>
          <button type="button" className="ghost-button" onClick={onClose}>
            {text("cancel")}
          </button>
          <button type="submit" className="primary-button">
            {text("saveSettings")}
          </button>
        </div>
      </form>
    </div>
  );
}
