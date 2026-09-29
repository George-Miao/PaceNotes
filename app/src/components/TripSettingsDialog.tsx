import { Icon } from "@iconify/react";
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
import { CurrencyDropdown } from "./CurrencyDropdown";
import { Dropdown, type DropdownOption } from "./Dropdown";
import { iconForTravelMode } from "./item-icon";

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
  currency,
  onCurrencyChange,
  onSave,
  onClose,
}: {
  settings: TripSettingsForm;
  currency: string | null;
  onCurrencyChange: (currency: string, settings: TripSettings) => Promise<boolean>;
  onSave: (settings: TripSettingsForm, currencyChanged: boolean) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [nextCurrency, setNextCurrency] = useState(currency ?? "");
  const [currencyBusy, setCurrencyBusy] = useState(false);
  const [currencyError, setCurrencyError] = useState<string | null>(null);
  const language = useUiLanguage();
  const text = useTripText();
  const backdropRef = useRef<HTMLDivElement>(null);
  const valid = tripSettingsSchema.safeParse(settingsForDocument(draft)).success;
  const requestClose = useCallback(() => {
    if (
      (!settingsMatch(draft, settings) || nextCurrency !== (currency ?? "")) &&
      !window.confirm(text("discardTripSettings"))
    )
      return;
    onClose();
  }, [currency, draft, nextCurrency, onClose, settings, text]);

  useEffect(() => {
    const backdrop = backdropRef.current;
    const closeOnBackdrop = (event: MouseEvent) => {
      if (event.target === backdrop) requestClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (
        event.target instanceof Element &&
        event.target.closest('[role="combobox"][aria-expanded="true"]')
      )
        return;
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
          if (!valid || currencyBusy) return;
          const save = async () => {
            const currencyChanged = Boolean(nextCurrency && nextCurrency !== currency);
            if (
              currencyChanged &&
              currency &&
              !window.confirm(text("settingsCurrencyChangeConfirm", { currency: nextCurrency }))
            )
              return;
            setCurrencyBusy(true);
            setCurrencyError(null);
            try {
              if (currencyChanged) {
                if (!(await onCurrencyChange(nextCurrency, settingsForDocument(draft)))) {
                  setCurrencyError(text("settingsCurrencyChanged"));
                  return;
                }
              }
              onSave(draft, currencyChanged);
            } catch {
              setCurrencyError(text("settingsSaveFailed"));
            } finally {
              setCurrencyBusy(false);
            }
          };
          void save();
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
          <div className="field">
            <span>{text("uiLanguage")}</span>
            <Dropdown
              label={text("uiLanguage")}
              value={draft.uiLanguage}
              options={tripLanguages.map(
                (language): DropdownOption => ({
                  value: language,
                  label: languageLabels[language],
                }),
              )}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  uiLanguage: value as TripLanguage,
                }))
              }
            />
          </div>
          <div className="field">
            <span>{text("tripLanguage")}</span>
            <Dropdown
              label={text("tripLanguage")}
              value={draft.tripLanguage ?? ""}
              options={[
                {
                  value: "",
                  label: text("followUiLanguage", {
                    language: languageLabels[draft.uiLanguage],
                  }),
                },
                ...tripLanguages.map((language) => ({
                  value: language,
                  label: languageLabels[language],
                })),
              ]}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  tripLanguage: value ? (value as TripLanguage) : null,
                }))
              }
            />
          </div>
        </div>
        <div className="field">
          <span>{text("distanceUnits")}</span>
          <Dropdown
            label={text("distanceUnits")}
            value={draft.distanceUnit}
            options={distanceUnits.map((unit) => ({
              value: unit,
              label: text(unit === "metric" ? "metricUnits" : "imperialUnits"),
            }))}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                distanceUnit: value as DistanceUnit,
              }))
            }
          />
        </div>
        <div className="field">
          <span>{text("defaultTransport")}</span>
          <Dropdown
            label={text("defaultTransport")}
            value={draft.defaultTravelMode}
            options={travelModes.map((mode) => ({
              value: mode,
              label: travelModeLabel(language, mode),
              icon: <Icon icon={iconForTravelMode(mode)} />,
            }))}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                defaultTravelMode: value as TravelMode,
              }))
            }
          />
        </div>
        <div className="field">
          <span>{text("calendarDayStart")}</span>
          <Dropdown
            label={text("calendarDayStart")}
            value={String(draft.calendarStartHour)}
            options={calendarStartHourOptions.map((hour) => ({
              value: String(hour),
              label: `${String(hour).padStart(2, "0")}:00`,
            }))}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                calendarStartHour: Number(value) as CalendarStartHour,
              }))
            }
          />
        </div>
        <div className="field">
          <label htmlFor="trip-currency">{text("tripCurrency")}</label>
          <CurrencyDropdown
            id="trip-currency"
            label={text("tripCurrency")}
            value={nextCurrency}
            placeholder={text("settingsChooseCurrency")}
            onChange={setNextCurrency}
          />
          {currencyError ? (
            <p className="field-error" role="alert">
              {currencyError}
            </p>
          ) : null}
        </div>
        <div>
          <button type="button" className="ghost-button" onClick={requestClose}>
            {text("cancel")}
          </button>
          <button type="submit" className="primary-button" disabled={!valid || currencyBusy}>
            {currencyBusy ? text("settingsSaving") : text("saveSettings")}
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
