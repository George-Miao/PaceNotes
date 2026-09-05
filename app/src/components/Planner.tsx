import { Icon } from "@iconify/react";
import calendarDeleteIcon from "@iconify-icons/lucide/calendar-x-2";
import clipboardIcon from "@iconify-icons/lucide/clipboard";
import hotelIcon from "@iconify-icons/lucide/hotel";
import mapPinPlusIcon from "@iconify-icons/lucide/map-pin-plus";
import noteIcon from "@iconify-icons/lucide/notebook-pen";
import redoIcon from "@iconify-icons/lucide/redo-2";
import shareIcon from "@iconify-icons/lucide/share-2";
import trainIcon from "@iconify-icons/lucide/train-front";
import trashIcon from "@iconify-icons/lucide/trash-2";
import undoIcon from "@iconify-icons/lucide/undo-2";
import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  addTripItem,
  deleteTripDay,
  readTripDocument,
  removeTripItem,
  scheduleTripItem,
  setTripField,
  setTripOrder,
  updateTripItem,
} from "~/features/collaboration/document";
import { useTripDocument } from "~/features/collaboration/use-trip-document";
import type { GooglePlaceSelection } from "~/features/google/google";
import { readGooglePlacementTravelTimes } from "~/features/google/place-placement-routes";
import { type MapStop, type RouteLeg, useRouteLegs } from "~/features/google/route-legs";
import { useGooglePlaceViews } from "~/features/google/use-place-views";
import {
  type ItemType,
  itemForCreate,
  reorder,
  resolveLocalTime,
  type TripItem,
} from "~/features/trip/model";
import { findBestPlaceInsertion } from "~/features/trip/place-placement";
import { deleteTrip } from "~/features/trip/trip.functions";
import { ItineraryList } from "./ItineraryList";
import { PlaceSearch } from "./PlaceSearch";

const dayColors = ["#3e6796", "#397257", "#946c23", "#8b5578", "#536f8a", "#715f43"];
const noWarnings = new Map<string, string[]>();
const ItemEditor = lazy(async () => {
  const module = await import("./ItemEditor");
  return { default: module.ItemEditor };
});
// The map is a deliberate lazy boundary so list planning does not load its renderer.
const TripMap = lazy(async () => {
  const module = await import("./TripMap");
  return { default: module.TripMap };
});
type ViewMode = "map" | "list" | "split";

export function Planner({ tripId }: { tripId: string }) {
  const navigate = useNavigate();
  const {
    document,
    snapshot,
    syncState,
    collaborators,
    undo,
    redo,
    canUndo,
    canRedo,
    displayNamePrompt,
    setDisplayNamePrompt,
    saveDisplayName,
  } = useTripDocument(tripId);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("split");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [panelWidth, setPanelWidth] = useState(44);
  const [sheetHeight, setSheetHeight] = useState(48);

  useEffect(() => {
    if (!activeDay && snapshot.days[0]) setActiveDay(snapshot.days[0].id);
  }, [activeDay, snapshot.days]);

  useEffect(() => {
    if (snapshot.title) window.document.title = `${snapshot.title} - PaceNotes`;
  }, [snapshot.title]);

  useEffect(() => {
    if (!snapshot.id) return;
    const recent = readRecentTrips().filter((trip) => trip.id !== snapshot.id);
    recent.unshift({
      id: snapshot.id,
      title: snapshot.title,
      href: location.href,
      openedAt: new Date().toISOString(),
    });
    localStorage.setItem("pacenotes-recent-trips", JSON.stringify(recent.slice(0, 12)));
  }, [snapshot.id, snapshot.title]);

  const orderedItems = useMemo(
    () =>
      snapshot.order
        .map((id) => snapshot.items[id])
        .filter((item): item is TripItem => Boolean(item)),
    [snapshot.items, snapshot.order],
  );
  const dayItems = useMemo(
    () =>
      orderDayItems(
        orderedItems.filter((item) => item.dayId === activeDay),
        activeDay ?? snapshot.startDate,
        snapshot.timeZone,
      ),
    [activeDay, orderedItems, snapshot.startDate, snapshot.timeZone],
  );
  const inboxItems = useMemo(
    () => orderedItems.filter((item) => item.dayId === null),
    [orderedItems],
  );
  const selected = selectedId ? (snapshot.items[selectedId] ?? null) : null;
  const placeIds = useMemo(
    () => [
      snapshot.destination.placeId,
      ...dayItems.flatMap((item) => (item.place ? [item.place.placeId] : [])),
    ],
    [dayItems, snapshot.destination.placeId],
  );
  const { places: placeViews, error: placeViewError } = useGooglePlaceViews(placeIds);
  const stops = useMemo<MapStop[]>(() => {
    let stopIndex = 0;
    return dayItems.flatMap((item) => {
      if (!item.place) return [];
      const place = placeViews.get(item.place.placeId);
      if (!place) return [];
      stopIndex += 1;
      const dayIndex = Math.max(
        0,
        snapshot.days.findIndex((day) => day.id === item.dayId),
      );
      return [
        {
          id: item.id,
          label: item.title,
          index: stopIndex,
          latitude: place.latitude,
          longitude: place.longitude,
          color: dayColors[dayIndex % dayColors.length] ?? "#3e6796",
          travelMode: item.travelMode,
        },
      ];
    });
  }, [dayItems, placeViews, snapshot.days]);
  const legs = useRouteLegs(stops);
  const itemWarnings = useMemo(
    () => buildScheduleWarnings(dayItems, legs, activeDay ?? snapshot.startDate, snapshot.timeZone),
    [activeDay, dayItems, legs, snapshot.startDate, snapshot.timeZone],
  );
  const selectItem = useCallback((id: string) => setSelectedId(id), []);

  if (!snapshot.id) {
    return (
      <main className="planner-loading">
        <span className="spinner" aria-hidden="true" />
        <strong>Loading trip</strong>
        <span>
          {syncState === "offline" ? "Sync server is unavailable" : "Connecting to the shared plan"}
        </span>
      </main>
    );
  }

  const applyVisibleOrder = (source: number, destination: number, visible: TripItem[]) => {
    const changedItems = reorder(visible, source, destination);
    const changed = changedItems.map((item) => item.id);
    const visibleIds = new Set(visible.map((item) => item.id));
    let cursor = 0;
    const next = snapshot.order.map((id) => (visibleIds.has(id) ? (changed[cursor++] ?? id) : id));
    const moved = changedItems[destination];
    if (moved?.startTime)
      scheduleTripItem(document, moved.id, timeForPosition(changedItems, destination), next);
    else setTripOrder(document, next);
  };
  const moveVisible = (id: string, delta: -1 | 1, visible: TripItem[]) => {
    const source = visible.findIndex((item) => item.id === id);
    const destination = source + delta;
    if (destination < 0 || destination >= visible.length) return;
    applyVisibleOrder(source, destination, visible);
  };
  const addTypedItem = (type: ItemType) => {
    const partial: Partial<TripItem> = {};
    if (type === "reservation")
      partial.reservation = { provider: "", confirmation: "", bookingDate: null };
    if (type === "lodging")
      partial.lodging = {
        startDate: activeDay ?? snapshot.startDate,
        endDate: activeDay ?? snapshot.endDate,
      };
    const item = itemForCreate(type, activeDay, partial);
    addTripItem(document, item);
    setSelectedId(item.id);
  };
  const addPlace = async (place: GooglePlaceSelection, label: string) => {
    const placementDay = activeDay ?? snapshot.days[0]?.id ?? snapshot.startDate;
    const item = itemForCreate("place", placementDay, {
      title: label,
      place: place.reference,
      travelMode: snapshot.defaultTravelMode,
    });
    const candidateStop = {
      id: item.id,
      latitude: place.location.latitude,
      longitude: place.location.longitude,
      travelMode: item.travelMode,
    };
    const placementRoutes = await readGooglePlacementTravelTimes(stops, candidateStop);
    const currentRoutes = legs.flatMap((leg) =>
      leg.durationMinutes === null
        ? []
        : [
            {
              fromId: leg.fromId,
              toId: leg.toId,
              mode: leg.mode,
              minutes: leg.durationMinutes,
            },
          ],
    );
    const visibleIndex = findBestPlaceInsertion({
      items: dayItems,
      item,
      travelTimes: [...currentRoutes, ...placementRoutes],
      date: placementDay,
      timeZone: snapshot.timeZone,
    });
    const beforeId = dayItems[visibleIndex]?.id;
    const latestOrder = readTripDocument(document).order;
    const beforeIndex = beforeId ? latestOrder.indexOf(beforeId) : -1;
    const dayIds = new Set(dayItems.map((dayItem) => dayItem.id));
    const lastDayIndex = latestOrder.findLastIndex((id) => dayIds.has(id));
    const destinationIndex =
      beforeIndex >= 0 ? beforeIndex : lastDayIndex >= 0 ? lastDayIndex + 1 : latestOrder.length;
    addTripItem(document, item, destinationIndex);
    setSelectedId(item.id);
    setSearchOpen(false);
  };
  const removeItem = (item: TripItem) => {
    if (!confirm(`Delete ${item.title}?`)) return;
    removeTripItem(document, item.id);
    if (selectedId === item.id) setSelectedId(null);
  };
  const share = async () => {
    const firstShare = localStorage.getItem(`pacenotes-shared-${tripId}`) !== "true";
    if (firstShare) {
      setShareOpen(true);
      return;
    }
    await copyOrShare(snapshot.title);
  };
  const confirmShare = async () => {
    localStorage.setItem(`pacenotes-shared-${tripId}`, "true");
    setShareOpen(false);
    await copyOrShare(snapshot.title);
  };
  const removeDay = () => {
    if (!activeDay || snapshot.days.length <= 1) return;
    const count = dayItems.length;
    if (
      !confirm(
        `Delete this day? ${count} item${count === 1 ? "" : "s"} will move to Places to visit.`,
      )
    )
      return;
    deleteTripDay(document, activeDay);
    setActiveDay(snapshot.days.find((day) => day.id !== activeDay)?.id ?? null);
  };
  const resizePanel = (event: React.PointerEvent) => {
    const startX = event.clientX;
    const startWidth = panelWidth;
    const move = (pointer: PointerEvent) =>
      setPanelWidth(
        Math.min(68, Math.max(30, startWidth + ((pointer.clientX - startX) / innerWidth) * 100)),
      );
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  const resizeSheet = (event: React.PointerEvent) => {
    const startY = event.clientY;
    const startHeight = sheetHeight;
    const move = (pointer: PointerEvent) =>
      setSheetHeight(
        Math.min(82, Math.max(22, startHeight + ((startY - pointer.clientY) / innerHeight) * 100)),
      );
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  return (
    <main
      className="planner"
      style={
        {
          "--panel-width": `${panelWidth}%`,
          "--sheet-height": `${sheetHeight}dvh`,
        } as React.CSSProperties
      }
    >
      <header className="planner-header">
        <a className="brand" href="/">
          PaceNotes
        </a>
        <label className="title-field">
          <span className="sr-only">Trip title</span>
          <input
            value={snapshot.title}
            maxLength={200}
            onChange={(event) => setTripField(document, "title", event.target.value)}
          />
        </label>
        <span className={`sync-state state-${syncState}`}>
          <i aria-hidden="true" />
          {syncState === "synced"
            ? "All changes synced"
            : syncState === "unsynced"
              ? "Saving changes"
              : syncState === "connecting"
                ? "Connecting"
                : "Offline"}
        </span>
        <div
          className="presence-stack"
          role="status"
          aria-label={`${collaborators.length} editors online`}
        >
          {collaborators.slice(0, 4).map((person) => (
            <span
              key={person.clientId}
              style={{ "--person-color": person.color } as React.CSSProperties}
              title={person.name}
            >
              {initials(person.name)}
            </span>
          ))}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Undo"
          disabled={!canUndo}
          onClick={undo}
        >
          <Icon icon={undoIcon} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Redo"
          disabled={!canRedo}
          onClick={redo}
        >
          <Icon icon={redoIcon} />
        </button>
        <button type="button" className="secondary-button" onClick={share}>
          <Icon icon={shareIcon} />
          Share
        </button>
        <button
          type="button"
          className="icon-button danger-icon"
          aria-label="Delete trip"
          onClick={() => setDeleteOpen(true)}
        >
          <Icon icon={trashIcon} />
        </button>
      </header>

      <div className="planner-tabs">
        <nav className="date-tabs" aria-label="Trip dates">
          {snapshot.days.map((day) => (
            <button
              type="button"
              key={day.id}
              className={day.id === activeDay ? "active" : ""}
              aria-current={day.id === activeDay ? "date" : undefined}
              onClick={() => setActiveDay(day.id)}
            >
              <span>{weekday(day.date)}</span>
              <strong>{day.date.slice(-2)}</strong>
            </button>
          ))}
        </nav>
        <fieldset className="view-tabs">
          <legend>Planner view</legend>
          {(["map", "list", "split"] as const).map((mode) => (
            <button
              type="button"
              key={mode}
              aria-pressed={view === mode}
              onClick={() => setView(mode)}
            >
              {mode[0]?.toUpperCase()}
              {mode.slice(1)}
            </button>
          ))}
        </fieldset>
      </div>

      <div className={`planner-body view-${view}`}>
        <section className="planner-panel" aria-label="Itinerary">
          <div className="mobile-sheet-handle" onPointerDown={resizeSheet}>
            <span />
          </div>
          <div className="planner-toolbar">
            <div>
              <strong>{activeDay ? longDate(activeDay) : "Places to visit"}</strong>
              <span>{dayItems.length} items</span>
            </div>
            <div className="toolbar-actions">
              <button
                type="button"
                className="primary-button"
                onClick={() => setSearchOpen((value) => !value)}
              >
                <Icon icon={mapPinPlusIcon} />
                Place
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Add note"
                onClick={() => addTypedItem("note")}
              >
                <Icon icon={noteIcon} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Add reservation"
                onClick={() => addTypedItem("reservation")}
              >
                <Icon icon={clipboardIcon} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Add lodging"
                onClick={() => addTypedItem("lodging")}
              >
                <Icon icon={hotelIcon} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Add transport"
                onClick={() => addTypedItem("transport")}
              >
                <Icon icon={trainIcon} />
              </button>
              <button
                type="button"
                className="icon-button danger-icon"
                aria-label="Delete day"
                disabled={snapshot.days.length <= 1}
                onClick={removeDay}
              >
                <Icon icon={calendarDeleteIcon} />
              </button>
            </div>
          </div>
          {searchOpen ? (
            <PlaceSearch bias={placeViews.get(snapshot.destination.placeId)} onAdd={addPlace} />
          ) : null}
          <ItineraryList
            items={dayItems}
            legs={legs}
            warnings={itemWarnings}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onDelete={removeItem}
            onMove={(id, delta) => moveVisible(id, delta, dayItems)}
            onReorder={(source, destination) => applyVisibleOrder(source, destination, dayItems)}
            onTravelMode={(id, travelMode) => updateTripItem(document, id, { travelMode })}
          />
          {dayItems.length === 0 ? (
            <div className="empty-state">
              <strong>No plans for this day</strong>
              <span>Add a place or create a free-form item.</span>
            </div>
          ) : null}
          <section className="inbox-section">
            <button
              type="button"
              className="inbox-heading"
              onClick={() => setInboxOpen((value) => !value)}
              aria-expanded={inboxOpen}
            >
              <span>Places to visit</span>
              <b>{inboxItems.length}</b>
            </button>
            {inboxOpen ? (
              <ItineraryList
                items={inboxItems}
                legs={[]}
                warnings={noWarnings}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onDelete={removeItem}
                onMove={(id, delta) => moveVisible(id, delta, inboxItems)}
                onReorder={(source, destination) =>
                  applyVisibleOrder(source, destination, inboxItems)
                }
                onTravelMode={(id, travelMode) => updateTripItem(document, id, { travelMode })}
              />
            ) : null}
          </section>
          {selected ? (
            <Suspense fallback={<div className="editor-loading">Loading editor</div>}>
              <ItemEditor
                key={selected.id}
                item={selected}
                days={snapshot.days}
                onSave={(patch) => updateTripItem(document, selected.id, patch)}
                onClose={() => setSelectedId(null)}
              />
            </Suspense>
          ) : null}
        </section>
        <hr
          className="panel-resizer"
          aria-label="Resize itinerary"
          aria-orientation="vertical"
          aria-valuemin={30}
          aria-valuemax={70}
          aria-valuenow={Math.round(panelWidth)}
          tabIndex={0}
          onPointerDown={resizePanel}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            setPanelWidth((value) =>
              Math.max(30, Math.min(70, value + (event.key === "ArrowLeft" ? -2 : 2))),
            );
          }}
        />
        <section className="map-panel" aria-label="Map">
          {placeViewError ? <p className="map-error">{placeViewError}</p> : null}
          <Suspense
            fallback={
              <div className="map-shell">
                <span className="spinner" />
              </div>
            }
          >
            <TripMap stops={stops} legs={legs} selectedId={selectedId} onSelect={selectItem} />
          </Suspense>
        </section>
      </div>

      {displayNamePrompt !== null ? (
        <div className="dialog-backdrop">
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="display-name-title"
            onSubmit={(event) => {
              event.preventDefault();
              saveDisplayName();
            }}
          >
            <h2 id="display-name-title">Please tell us your name</h2>
            <p>Other people in this trip can see your name and presence color.</p>
            <label className="field">
              <span>Your name</span>
              <input
                required
                maxLength={80}
                placeholder="Your name"
                value={displayNamePrompt}
                onChange={(event) => setDisplayNamePrompt(event.target.value)}
              />
            </label>
            <div>
              <button type="submit" className="primary-button" disabled={!displayNamePrompt.trim()}>
                Continue
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {shareOpen ? (
        <div className="dialog-backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="share-title">
            <h2 id="share-title">Anyone with this link can edit</h2>
            <p>
              The trip has no account or access control. Share the full URL only with people who may
              change or delete the trip.
            </p>
            <div>
              <button type="button" className="ghost-button" onClick={() => setShareOpen(false)}>
                Cancel
              </button>
              <button type="button" className="primary-button" onClick={confirmShare}>
                Copy link
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {deleteOpen ? (
        <div className="dialog-backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
            <h2 id="delete-title">Delete this trip?</h2>
            <p>
              This disconnects every editor and permanently deletes server data. Type{" "}
              <strong>{snapshot.title}</strong> to continue.
            </p>
            <input
              value={deleteText}
              onChange={(event) => setDeleteText(event.target.value)}
              aria-label="Trip title confirmation"
            />
            <div>
              <button type="button" className="ghost-button" onClick={() => setDeleteOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={deleteText !== snapshot.title}
                onClick={async () => {
                  await deleteTrip({ data: { id: tripId } });
                  await navigate({ to: "/" });
                }}
              >
                Delete trip
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

async function copyOrShare(title: string): Promise<void> {
  if (navigator.share) {
    try {
      await navigator.share({ title, url: location.href });
      return;
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return;
    }
  }
  await navigator.clipboard.writeText(location.href);
}

function readRecentTrips(): Array<{ id: string; title: string; href: string; openedAt: string }> {
  try {
    return JSON.parse(localStorage.getItem("pacenotes-recent-trips") ?? "[]");
  } catch {
    return [];
  }
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

function weekday(date: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

function longDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function orderDayItems(items: TripItem[], date: string, defaultTimeZone: string): TripItem[] {
  const timed = items
    .filter((item) => item.startTime)
    .toSorted((left, right) =>
      timeSortKey(left, date, defaultTimeZone).localeCompare(
        timeSortKey(right, date, defaultTimeZone),
      ),
    );
  let cursor = 0;
  return items.map((item) => (item.startTime ? (timed[cursor++] ?? item) : item));
}

function timeSortKey(item: TripItem, date: string, defaultTimeZone: string): string {
  try {
    return resolveLocalTime(date, item.startTime ?? "00:00", defaultTimeZone);
  } catch {
    return `${date}T${item.startTime ?? "00:00"}`;
  }
}

function buildScheduleWarnings(
  items: TripItem[],
  legs: RouteLeg[],
  date: string,
  defaultTimeZone: string,
): Map<string, string[]> {
  const warnings = new Map<string, string[]>();
  const add = (id: string, message: string) =>
    warnings.set(id, [...(warnings.get(id) ?? []), message]);
  const epochMinute = (item: TripItem): number => {
    const value = resolveLocalTime(date, item.startTime ?? "00:00", defaultTimeZone);
    return Date.parse(value.replace(/\[[^\]]+\]$/, "")) / 60_000;
  };
  let previous: TripItem | null = null;
  for (const item of items) {
    if (!item.startTime) continue;
    let itemMinute: number;
    try {
      itemMinute = epochMinute(item);
    } catch {
      add(item.id, "This local time is missing or ambiguous because of a clock change.");
      continue;
    }
    if (previous?.startTime) {
      try {
        const previousEnd = epochMinute(previous) + (previous.durationMinutes ?? 0);
        if (previousEnd > itemMinute) add(item.id, `Overlaps ${previous.title}.`);
      } catch {
        // The prior item reports its own invalid local time.
      }
    }
    previous = item;
  }
  for (const leg of legs) {
    if (leg.durationMinutes === null) continue;
    const from = items.find((item) => item.id === leg.fromId);
    const to = items.find((item) => item.id === leg.toId);
    if (!from?.startTime || !to?.startTime) continue;
    try {
      const arrival = epochMinute(from) + (from.durationMinutes ?? 0) + leg.durationMinutes;
      if (arrival > epochMinute(to))
        add(to.id, `Travel from ${from.title} cannot finish before this start time.`);
    } catch {
      // Invalid local times are reported by the item pass above.
    }
  }
  return warnings;
}

function timeForPosition(items: TripItem[], position: number): string {
  const moved = items[position];
  if (!moved?.startTime) return "12:00";
  const previous = items
    .slice(0, position)
    .toReversed()
    .find((item) => item.startTime);
  const next = items.slice(position + 1).find((item) => item.startTime);
  const previousMinute = previous?.startTime ? parseTime(previous.startTime) : null;
  const nextMinute = next?.startTime ? parseTime(next.startTime) : null;
  if (previousMinute !== null && nextMinute !== null) {
    return formatTime(previousMinute + Math.max(1, Math.floor((nextMinute - previousMinute) / 2)));
  }
  if (previousMinute !== null) {
    return formatTime(previousMinute + Math.max(1, previous?.durationMinutes ?? 1));
  }
  if (nextMinute !== null) {
    return formatTime(nextMinute - Math.max(1, moved.durationMinutes ?? 1));
  }
  return moved.startTime;
}

function parseTime(time: string): number {
  const [hour = "0", minute = "0"] = time.split(":");
  return Number(hour) * 60 + Number(minute);
}

function formatTime(minutes: number): string {
  const bounded = Math.max(0, Math.min(23 * 60 + 59, minutes));
  return `${String(Math.floor(bounded / 60)).padStart(2, "0")}:${String(bounded % 60).padStart(2, "0")}`;
}
