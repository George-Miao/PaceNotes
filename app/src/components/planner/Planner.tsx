import { Icon } from "@iconify/react";
import calendarIcon from "@iconify-icons/lucide/calendar";
import calendarDeleteIcon from "@iconify-icons/lucide/calendar-x-2";
import coinsIcon from "@iconify-icons/lucide/coins";
import ellipsisIcon from "@iconify-icons/lucide/ellipsis";
import eyeIcon from "@iconify-icons/lucide/eye";
import listIcon from "@iconify-icons/lucide/list";
import mapIcon from "@iconify-icons/lucide/map";
import mapPinIcon from "@iconify-icons/lucide/map-pin";
import plusIcon from "@iconify-icons/lucide/plus";
import redoIcon from "@iconify-icons/lucide/redo-2";
import routeIcon from "@iconify-icons/lucide/route";
import searchIcon from "@iconify-icons/lucide/search";
import settingsIcon from "@iconify-icons/lucide/settings-2";
import shareIcon from "@iconify-icons/lucide/share-2";
import trashIcon from "@iconify-icons/lucide/trash-2";
import triangleAlertIcon from "@iconify-icons/lucide/triangle-alert";
import undoIcon from "@iconify-icons/lucide/undo-2";
import userIcon from "@iconify-icons/lucide/user";
import usersIcon from "@iconify-icons/lucide/users";
import { Temporal } from "@js-temporal/polyfill";
import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calendar } from "~/components/calendar/Calendar";
import { ExpenseCostControl } from "~/components/expenses/ExpenseCostControl";
import { PlaceSearch } from "~/components/places/PlaceSearch";
import { TripmateJoinDialog } from "~/components/tripmates/TripmateJoinDialog";
import { Brand } from "~/components/ui/Brand";
import { Modal } from "~/components/ui/Modal";
import modalStyles from "~/components/ui/Modal.module.css";
import {
  addTripDay,
  addTripItem,
  addTripItemWithNextTravelMode,
  applyCalendarItemChange,
  applyCalendarItemChanges,
  createTripmate,
  deleteTripDay,
  moveTripItem,
  readTripDocument,
  removeTripItem,
  scheduleTripItem,
  setTripField,
  setTripOrder,
  setTripSettings,
  updateTripItem,
  validateTripSettings,
} from "~/features/collaboration/document";
import { useTripDocument } from "~/features/collaboration/use-trip-document";
import { rebaseTripCurrency } from "~/features/expense/rebase.functions";
import { financialFingerprint } from "~/features/expense/revision";
import {
  type GooglePlaceSelection,
  type GooglePlaceView,
  googleLibraryLanguage,
  resolveGooglePlace,
} from "~/features/google/google";
import { itemTitle } from "~/features/google/item-title";
import { readGooglePlacementTravelTimes } from "~/features/google/place-placement-routes";
import { buildDayRouteExport, type DayRouteExportReason } from "~/features/google/route-export";
import { useGooglePlaceViews } from "~/features/google/use-place-views";
import { useTripTitle } from "~/features/google/use-trip-title";
import type { MapStop, RouteLeg } from "~/features/routing/route-legs";
import { calendarOrder } from "~/features/trip/calendar-layout";
import { buildDayPlans } from "~/features/trip/day-plan";
import { createTripText, TripLanguageProvider, UiLanguageProvider } from "~/features/trip/language";
import {
  effectiveTripLanguage,
  itemForCreate,
  type Lodging,
  lodgingForDates,
  reorder,
  type TripItem,
  type TripLanguage,
  tripLanguages,
} from "~/features/trip/model";
import {
  defaultTravelModeForPlacement,
  findBestPlaceInsertion,
  nearestPlaceDay,
} from "~/features/trip/place-placement";
import { deleteTrip } from "~/features/trip/trip.functions";
import { DayAddControl, type DayAddItemType } from "./DayAddControl";
import { ItemEditorSkeleton } from "./ItemEditorSkeleton";
import { ItineraryDragArea, type ItineraryDrop, ItineraryList } from "./ItineraryList";
import { PanelResizer, useSheetResize, type ViewMode } from "./PanelResizer";
import { buildRouteStops, placeReferences, usePlannerRoutes } from "./planner-routes";
import { buildScheduleWarnings, timeForPosition } from "./planner-schedule";
import { TitleField } from "./TitleField";
import { TripSettingsDialog } from "./TripSettingsDialog";
import { usePlannerNavigation } from "./usePlannerNavigation";
import { useTripCurrency } from "./useTripCurrency";

const noWarnings = new Map<string, string[]>();
const emptyItems: TripItem[] = [];
const emptyLegs: RouteLeg[] = [];
const emptyStops: MapStop[] = [];
// Editing UI loads only after selecting an item.
const ItemEditor = lazy(async () => {
  const module = await import("./ItemEditor");
  return { default: module.ItemEditor };
});
// Expenses load only when the workspace opens, outside the initial planner bundle.
const ExpensesWorkspace = lazy(async () => {
  const module = await import("~/components/expenses/ExpensesWorkspace");
  return { default: module.ExpensesWorkspace };
});
// Tripmate details stay outside the initial planner bundle.
const TripmatesDialog = lazy(async () => {
  const module = await import("~/components/expenses/TripmatesDialog");
  return { default: module.TripmatesDialog };
});
// The map is a deliberate lazy boundary so list planning does not load its renderer.
const TripMap = lazy(async () => {
  const module = await import("~/components/places/TripMap");
  return { default: module.TripMap };
});
type CalendarChange = {
  item: TripItem;
  dayId: string;
  startTime: string | null;
  durationMinutes: number;
  orderBeforeId?: string | null;
  extendThrough?: string;
};

const emphasizedTitleToken = "\uE000";
const uiLanguageStorageKey = "pacenotes-ui-language";
const guestIdentity = "guest";

export function Planner({ tripId }: { tripId: string }) {
  const navigate = useNavigate();
  const {
    document,
    snapshot,
    syncState,
    hasSynced,
    collaborators,
    setPresenceIdentity,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useTripDocument(tripId);
  const [uiLanguage, setUiLanguage] = useState<TripLanguage>("en");
  const tripLanguage = effectiveTripLanguage(uiLanguage, snapshot.tripLanguage);
  const [view, setView] = useState<ViewMode>("split");
  const { sheetHeight, resizeSheet } = useSheetResize(setView);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [identityChoice, setIdentityChoice] = useState<string | null | undefined>(undefined);
  const [focusedExpenseId, setFocusedExpenseId] = useState<string | null>(null);
  const [editorDay, setEditorDay] = useState<string | null>(null);
  const [editorBoundary, setEditorBoundary] = useState<"start" | "end" | null>(null);
  const [mapPlaceId, setMapPlaceId] = useState<string | null>(null);
  const [mapDayFocus, setMapDayFocus] = useState<{ dayId: string; serial: number } | null>(null);
  const [creation, setCreation] = useState<{
    dayId: string;
    anchor: "day" | "top";
    type: "place" | "reservation" | "lodging";
    token: number;
    startTime: string;
    checkInDate: string;
    checkOutDate: string;
  } | null>(null);
  const [addMenuDay, setAddMenuDay] = useState<string | null>(null);
  const creationEpoch = useRef(0);
  const cancelCreation = useCallback(() => {
    creationEpoch.current += 1;
    setCreation(null);
  }, []);
  const closeEditor = () => {
    setMapPlaceId(null);
    setSelectedId(null);
    setEditorDay(null);
    setEditorBoundary(null);
  };
  const {
    plannerContent,
    activeDay,
    setActiveDay,
    navigationDay,
    setNavigationDay,
    calendarFocusRequest,
    currentDay,
    mapDestinationDay,
    itineraryRef,
    inboxRef,
    dayHeights,
    visibleDays,
    inboxOpen,
    setInboxOpen,
    inboxActive,
    changePlannerContent,
    selectCalendarDay,
    resetDayJump,
    trackVisibleDay,
    cancelDayJump,
    jumpToDay,
    jumpToInbox,
  } = usePlannerNavigation({
    snapshot,
    view,
    setView,
    closeEditor,
    cancelCreation,
  });
  const [itineraryDragging, setItineraryDragging] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [headerMoreOpen, setHeaderMoreOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tripmatesOpen, setTripmatesOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const plannerRef = useRef<HTMLElement>(null);
  const headerMoreRef = useRef<HTMLDivElement>(null);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const titleEdit = useRef({ initial: "", cancelled: false });
  const text = createTripText(uiLanguage);
  const title = useTripTitle(snapshot.title, snapshot.destination.placeId, tripLanguage);
  const onlineTripmates = [...new Set(collaborators.map((person) => person.tripmateId))].flatMap(
    (id) => {
      const friend = snapshot.friends[id];
      return friend && !friend.archived ? [friend] : [];
    },
  );
  const selectedFriendId =
    identityChoice && identityChoice !== guestIdentity ? identityChoice : null;
  const identityLoaded = identityChoice !== undefined;
  const selectedTripmate = selectedFriendId ? snapshot.friends[selectedFriendId] : null;
  const tripmateId = selectedTripmate?.id;
  const tripmateName = selectedTripmate?.name;
  const tripmateColor = selectedTripmate?.color;
  const tripmateArchived = selectedTripmate?.archived;
  const needsIdentity =
    hasSynced &&
    identityLoaded &&
    identityChoice !== guestIdentity &&
    (!selectedTripmate || selectedTripmate.archived);
  const [deleteBodyBeforeTitle, deleteBodyAfterTitle] = text("deleteTripBody", {
    title: emphasizedTitleToken,
  }).split(emphasizedTitleToken);

  useEffect(() => {
    if (needsIdentity) setTripmatesOpen(false);
  }, [needsIdentity]);

  useEffect(() => {
    setUiLanguage(preferredUiLanguage());
  }, []);

  const selectTripmate = useCallback(
    (id: string | null) => {
      const choice = id ?? guestIdentity;
      setIdentityChoice(choice);
      localStorage.setItem(`pacenotes-tripmate:${tripId}`, choice);
    },
    [tripId],
  );

  useEffect(() => {
    setIdentityChoice(localStorage.getItem(`pacenotes-tripmate:${tripId}`));
  }, [tripId]);

  useEffect(() => {
    if (!hasSynced || !identityLoaded) return;
    if (selectedFriendId && (!tripmateId || tripmateArchived)) {
      setPresenceIdentity(null);
      localStorage.removeItem(`pacenotes-tripmate:${tripId}`);
      setIdentityChoice(null);
      return;
    }
    setPresenceIdentity(
      tripmateId && tripmateName && tripmateColor
        ? { tripmateId, name: tripmateName, color: tripmateColor }
        : null,
    );
  }, [
    hasSynced,
    identityLoaded,
    selectedFriendId,
    tripmateId,
    tripmateName,
    tripmateColor,
    tripmateArchived,
    tripId,
    setPresenceIdentity,
  ]);
  useEffect(() => {
    if (!shareOpen && !deleteOpen) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (
        event.target instanceof Element &&
        event.target.closest('[role="combobox"][aria-expanded="true"]')
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (deleteOpen) {
        setDeleteOpen(false);
        setDeleteText("");
      } else if (shareOpen) {
        setShareOpen(false);
      }
    };
    window.document.addEventListener("keydown", dismiss, true);
    return () => window.document.removeEventListener("keydown", dismiss, true);
  }, [deleteOpen, shareOpen]);
  useEffect(() => {
    if (!headerMoreOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !headerMoreRef.current?.contains(event.target)) {
        setHeaderMoreOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHeaderMoreOpen(false);
        headerMoreRef.current
          ?.querySelector<HTMLButtonElement>(".planner-header-more-trigger")
          ?.focus();
      }
    };
    window.document.addEventListener("pointerdown", closeOutside);
    window.document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.document.removeEventListener("pointerdown", closeOutside);
      window.document.removeEventListener("keydown", closeOnEscape);
    };
  }, [headerMoreOpen]);

  useEffect(() => {
    window.document.title = `${title} - PaceNotes`;
  }, [title]);

  useEffect(() => {
    const loadedLanguage = googleLibraryLanguage();
    if (loadedLanguage && loadedLanguage !== tripLanguage && syncState === "synced") {
      location.reload();
    }
  }, [syncState, tripLanguage]);

  useEffect(() => {
    if (!snapshot.id) return;
    const recent = readRecentTrips().filter((trip) => trip.id !== snapshot.id);
    recent.unshift({
      id: snapshot.id,
      title: snapshot.title,
      destinationPlaceId: snapshot.destination.placeId,
      href: location.href,
      openedAt: new Date().toISOString(),
    });
    localStorage.setItem("pacenotes-recent-trips", JSON.stringify(recent.slice(0, 12)));
  }, [snapshot.id, snapshot.title, snapshot.destination.placeId]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (
        (!event.ctrlKey && !event.metaKey) ||
        event.altKey ||
        event.isComposing ||
        event.defaultPrevented
      )
        return;
      if (
        event
          .composedPath()
          .some(
            (target) =>
              target instanceof HTMLElement &&
              (target.isContentEditable ||
                target.matches(
                  "input, textarea, select, [role=textbox], [role=combobox], gmp-place-autocomplete",
                )),
          )
      )
        return;
      const key = event.key.toLowerCase();
      const isUndo = key === "z" && !event.shiftKey;
      const isRedo = key === "y" || (key === "z" && event.shiftKey);
      if (!isUndo && !isRedo) return;
      event.preventDefault();
      if (isUndo && canUndo) undo();
      if (isRedo && canRedo) redo();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [undo, redo, canUndo, canRedo]);

  useEffect(() => {
    if (!creation) return;
    const dismissOutside = (event: PointerEvent) => {
      const keepsSearchOpen = event
        .composedPath()
        .some(
          (target) =>
            target instanceof Element &&
            (target.matches("gmp-place-autocomplete") ||
              target.closest(".place-search, [data-place-trigger], .pac-container")),
        );
      if (!keepsSearchOpen) cancelCreation();
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (
        event.target instanceof Element &&
        event.target.closest('[role="combobox"][aria-expanded="true"]')
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      cancelCreation();
    };
    window.addEventListener("pointerdown", dismissOutside);
    window.addEventListener("keydown", dismissOnEscape, true);
    return () => {
      window.removeEventListener("pointerdown", dismissOutside);
      window.removeEventListener("keydown", dismissOnEscape, true);
    };
  }, [creation, cancelCreation]);

  const orderedItems = useMemo(
    () =>
      snapshot.order
        .map((id) => snapshot.items[id])
        .filter((item): item is TripItem => Boolean(item)),
    [snapshot.items, snapshot.order],
  );
  const selected = selectedId ? (snapshot.items[selectedId] ?? null) : null;
  const editorLodgingDate =
    selected?.type === "lodging" && editorDay && editorBoundary
      ? editorBoundary === "start"
        ? editorDay
        : (snapshot.days[snapshot.days.findIndex((day) => day.id === editorDay) + 1]?.date ?? null)
      : null;
  const activeRouteDay = (selectedId ? editorDay : null) ?? activeDay;
  const mapPlacement = useMemo(() => {
    if (!mapPlaceId) return null;
    const item = orderedItems.find(
      (candidate) =>
        candidate.type === "place" &&
        candidate.dayId !== null &&
        candidate.place?.placeId === mapPlaceId,
    );
    if (!item?.dayId) return null;
    const dayIndex = snapshot.days.findIndex((day) => day.id === item.dayId);
    return dayIndex < 0 ? null : { itemId: item.id, dayNumber: dayIndex + 1 };
  }, [mapPlaceId, orderedItems, snapshot.days]);
  const dayPlans = useMemo(
    () => buildDayPlans(orderedItems, snapshot.days),
    [orderedItems, snapshot.days],
  );
  const activePlan = dayPlans.find((plan) => plan.day.id === activeRouteDay);
  const dayItems = activePlan?.items ?? emptyItems;
  const inboxItems = useMemo(
    () => orderedItems.filter((item) => item.dayId === null),
    [orderedItems],
  );
  const editingPlaceId = selected?.place?.placeId;
  const placeIds = useMemo(
    () => [
      snapshot.destination.placeId,
      ...orderedItems.flatMap(placeReferences),
      ...(selected ? placeReferences(selected) : []),
    ],
    [orderedItems, selected, snapshot.destination.placeId],
  );
  const { places: placeViews, error: placeViewError } = useGooglePlaceViews(placeIds, tripLanguage);
  useTripCurrency(document, snapshot, placeViews);
  const { stops, routeData, routeLegs, transports } = usePlannerRoutes(
    dayPlans,
    inboxItems,
    orderedItems,
    placeViews,
    snapshot,
    tripLanguage,
  );
  const legs = routeLegs.get(activeRouteDay ?? "") ?? emptyLegs;
  const itemWarnings = useMemo(
    () =>
      buildScheduleWarnings(
        dayItems,
        legs,
        activeRouteDay ?? snapshot.startDate,
        snapshot.timeZone,
        uiLanguage,
      ),
    [activeRouteDay, dayItems, legs, snapshot.startDate, snapshot.timeZone, uiLanguage],
  );
  const editingPlace = editingPlaceId ? placeViews.get(editingPlaceId) : undefined;
  const focusDayRoute = (dayId: string) => {
    setMapPlaceId(null);
    setView((current) => (current === "list" ? "split" : current));
    setMapDayFocus((request) => ({
      dayId,
      serial: (request?.serial ?? 0) + 1,
    }));
  };

  if (!snapshot.id) {
    return (
      <UiLanguageProvider language={uiLanguage}>
        <TripLanguageProvider language={tripLanguage}>
          <main className="planner-loading">
            <span className="spinner" aria-hidden="true" />
            <strong>{text("loadingTrip")}</strong>
            <span>
              {syncState === "offline" ? text("syncUnavailable") : text("connectingPlan")}
            </span>
          </main>
        </TripLanguageProvider>
      </UiLanguageProvider>
    );
  }

  const selectItem = (id: string, dayId?: string, boundary: "start" | "end" | null = null) => {
    const targetDay = dayId ?? snapshot.items[id]?.dayId ?? null;
    if (selectedId === id && editorDay === targetDay && editorBoundary === boundary) {
      closeEditor();
      return;
    }
    if (dayId) {
      setNavigationDay(null);
      setActiveDay(dayId);
      mapDestinationDay.current = dayId;
    }
    setSelectedId(id);
    setEditorDay(targetDay);
    setEditorBoundary(boundary);
    const placeId = snapshot.items[id]?.place?.placeId ?? null;
    setMapPlaceId(placeId);
    if (placeId || snapshot.items[id]?.type === "transport") setView("split");
  };
  const renderEditor = () =>
    selected ? (
      <Suspense fallback={<ItemEditorSkeleton item={selected} />}>
        <ItemEditor
          key={`${selected.id}:${editorLodgingDate ?? ""}`}
          item={selected}
          days={snapshot.days}
          lodgingDate={editorLodgingDate}
          places={placeViews}
          defaultTitle={
            selected.place ? editingPlace?.displayName || text("placeFallback") : selected.title
          }
          costControl={
            <ExpenseCostControl
              document={document}
              snapshot={snapshot}
              places={placeViews}
              itemId={selected.id}
              entryLabel={itemTitle(selected, placeViews)}
              selectedFriendId={selectedFriendId}
            />
          }
          onSave={(patch) => {
            updateTripItem(document, selected.id, patch);
            if (Object.hasOwn(patch, "dayId")) {
              const dayId = patch.dayId ?? null;
              setEditorDay(dayId);
              if (dayId) setActiveDay(dayId);
            }
          }}
          onActivate={() => {
            if (editorDay) setActiveDay(editorDay);
          }}
          onClose={closeEditor}
        />
      </Suspense>
    ) : null;
  const renderEditorAfter = (
    item: TripItem,
    dayId: string | null,
    boundary: "start" | "end" | null = null,
  ) =>
    plannerContent !== "calendar" &&
    selected?.id === item.id &&
    editorDay === dayId &&
    editorBoundary === boundary
      ? renderEditor()
      : null;

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
  const applyDayDrop = ({
    itemId,
    sourceId,
    sourceIndex,
    destinationId,
    destinationIndex,
  }: ItineraryDrop) => {
    const source = dayPlans.find((plan) => `day:${plan.day.id}` === sourceId);
    const destination = dayPlans.find((plan) => `day:${plan.day.id}` === destinationId);
    const sourceItems = source ? source.items : sourceId === "inbox" ? inboxItems : null;
    const destinationItems = destination
      ? destination.items
      : destinationId === "inbox"
        ? inboxItems
        : null;
    if (!sourceItems || !destinationItems) return;
    if (sourceId === destinationId) {
      applyVisibleOrder(sourceIndex, destinationIndex, sourceItems);
      return;
    }
    const moved = sourceItems[sourceIndex];
    if (!moved || moved.id !== itemId) return;
    if (moved.type === "reservation" && !destination) return;
    const withMoved = destinationItems.toSpliced(destinationIndex, 0, moved);
    const next = snapshot.order.filter((id) => id !== moved.id);
    const before = destinationItems[destinationIndex]?.id;
    const after = destinationItems.at(-1)?.id;
    const insertion = before ? next.indexOf(before) : after ? next.indexOf(after) + 1 : next.length;
    next.splice(insertion, 0, moved.id);
    const destinationDay = destination?.day.id ?? null;
    const previousItem =
      withMoved
        .slice(0, destinationIndex)
        .toReversed()
        .find((candidate) => candidate.place) ??
      destination?.start.toReversed().find((candidate) => candidate.place);
    const previousPlace = previousItem?.place
      ? placeViews.get(previousItem.place.placeId)
      : undefined;
    const movedPlace = moved.place ? placeViews.get(moved.place.placeId) : undefined;
    const placedTravelMode =
      moved.type === "place" && sourceId === "inbox" && destinationDay && movedPlace
        ? defaultTravelModeForPlacement(previousPlace, movedPlace, snapshot.defaultTravelMode)
        : undefined;
    moveTripItem(
      document,
      moved.id,
      destinationDay,
      destinationDay && moved.startTime ? timeForPosition(withMoved, destinationIndex) : null,
      next,
      placedTravelMode,
    );
  };
  const changeCalendarItems = (changes: readonly CalendarChange[]) => {
    let working = snapshot;
    const mutations = changes.map((change) => {
      const positionChanged =
        change.dayId !== change.item.dayId || change.startTime !== change.item.startTime;
      const nextItem = {
        ...change.item,
        dayId: change.dayId,
        startTime: change.startTime,
        durationMinutes: change.durationMinutes,
      };
      const items = { ...working.items, [nextItem.id]: nextItem };
      working = {
        ...working,
        items,
        order: positionChanged
          ? calendarOrder({ ...working, items }, nextItem, change.orderBeforeId)
          : working.order,
      };
      return {
        id: change.item.id,
        patch: {
          dayId: change.dayId,
          startTime: change.startTime,
          durationMinutes: change.durationMinutes,
        },
        ...(change.extendThrough ? { extendThrough: change.extendThrough } : {}),
      };
    });
    const result = applyCalendarItemChanges(document, mutations, working.order);
    const first = changes[0];
    if (first) selectCalendarDay(first.dayId);
    return { clamped: result.clamped };
  };
  const changeCalendarItem = (change: CalendarChange) => changeCalendarItems([change]);
  const makeCalendarItemFlexible = (item: TripItem) => {
    applyCalendarItemChange(document, {
      id: item.id,
      patch: { startTime: null, durationMinutes: 0 },
    });
  };
  const duplicateCalendarItem = (item: TripItem) => {
    const latest = readTripDocument(document);
    const source = latest.items[item.id];
    if (!source) return;
    const sourceIndex = latest.order.indexOf(source.id);
    addTripItem(
      document,
      { ...source, id: crypto.randomUUID() },
      sourceIndex < 0 ? undefined : sourceIndex + 1,
    );
  };
  const moveCalendarNote = (noteId: string, dayId: string, afterItemId: string | null) => {
    const note = snapshot.items[noteId];
    if (note?.type !== "note") return;
    const next = snapshot.order.filter((id) => id !== noteId);
    const firstDayIndex = next.findIndex((id) => snapshot.items[id]?.dayId === dayId);
    const insertion = afterItemId
      ? next.indexOf(afterItemId) + 1
      : firstDayIndex >= 0
        ? firstDayIndex
        : next.length;
    next.splice(insertion, 0, noteId);
    applyCalendarItemChange(document, {
      id: noteId,
      patch: { dayId, startTime: null, durationMinutes: 0 },
      order: next,
    });
    selectCalendarDay(dayId);
  };
  const changeCalendarLodging = (item: TripItem, lodging: Lodging) => {
    const result = applyCalendarItemChange(document, {
      id: item.id,
      patch: {
        dayId: lodging.startDate,
        startTime: null,
        lodging,
      },
      extendThrough: lodging.endDate,
    });
    selectCalendarDay(lodging.startDate);
    return result;
  };

  const moveVisible = (id: string, delta: -1 | 1, visible: TripItem[]) => {
    const source = visible.findIndex((item) => item.id === id);
    const destination = source + delta;
    if (destination < 0 || destination >= visible.length) return;
    applyVisibleOrder(source, destination, visible);
  };
  const calendarItemsFor = (item: TripItem) =>
    dayPlans.find((plan) => plan.day.id === item.dayId)?.items ?? [];
  const canMoveCalendarItem = (item: TripItem, delta: -1 | 1) => {
    const items = calendarItemsFor(item);
    const source = items.findIndex((candidate) => candidate.id === item.id);
    const destination = source + delta;
    return source >= 0 && destination >= 0 && destination < items.length;
  };
  const moveCalendarItem = (item: TripItem, delta: -1 | 1) =>
    moveVisible(item.id, delta, calendarItemsFor(item));
  const beginPlace = (
    type: "place" | "reservation" | "lodging",
    dayId: string,
    startTime = "",
    toggle = true,
    anchor: "day" | "top" = "day",
  ) => {
    closeEditor();
    setNavigationDay(null);
    setActiveDay(dayId);
    setAddMenuDay(null);
    const token = creationEpoch.current + 1;
    creationEpoch.current = token;
    setCreation(
      toggle &&
        type === "place" &&
        creation?.dayId === dayId &&
        creation.type === type &&
        creation.anchor === anchor
        ? null
        : {
            dayId,
            type,
            token,
            anchor,
            startTime,
            checkInDate: dayId,
            checkOutDate: Temporal.PlainDate.from(dayId).add({ days: 1 }).toString(),
          },
    );
  };
  const addTypedItem = (type: "note" | "transport", dayId: string, startTime = "") => {
    addTripItem(
      document,
      itemForCreate(type, dayId, {
        travelMode: snapshot.defaultTravelMode,
        ...(startTime ? { startTime } : {}),
      }),
    );
    closeEditor();
    setNavigationDay(null);
    setActiveDay(dayId);
    setAddMenuDay(null);
    cancelCreation();
  };
  const searchPlaces = () => {
    const dayId = currentDay ?? snapshot.days[0]?.id;
    if (!dayId) return;
    beginPlace("place", dayId, "", true, "top");
  };
  const addDayItem = (type: DayAddItemType, dayId: string) => {
    if (type === "note" || type === "transport") {
      addTypedItem(type, dayId);
      return;
    }
    beginPlace(type, dayId);
  };
  const addCalendarItem = (
    type: "place" | "reservation" | "lodging" | "transport",
    dayId: string,
    startTime: string | null,
  ) => {
    if (type === "transport") {
      addTypedItem(type, dayId, startTime ?? "");
      return;
    }
    beginPlace(type, dayId, startTime ?? "", false);
  };
  const addPlace = async (place: GooglePlaceSelection) => {
    if (!creation) return;
    const target = creation;
    const finishCreation = () => {
      if (creationEpoch.current !== target.token) return;
      creationEpoch.current += 1;
      setCreation((current) => (current?.token === target.token ? null : current));
    };
    const creationType = target.type;
    const placementDay = creationType === "lodging" ? target.checkInDate : target.dayId;
    const placementPlan = dayPlans.find((plan) => plan.day.id === placementDay);
    const placementItems = placementPlan?.items ?? emptyItems;
    const item = itemForCreate(creationType, placementDay, {
      place: place.reference,
      travelMode: snapshot.defaultTravelMode,
      ...(creationType === "reservation"
        ? {
            startTime: target.startTime,
            reservation: { provider: "", confirmation: "" },
          }
        : creationType === "place" && target.startTime
          ? { startTime: target.startTime }
          : {}),
      ...(creationType === "lodging"
        ? {
            durationMinutes: 0,
            lodging: lodgingForDates(target.checkInDate, target.checkOutDate),
          }
        : {}),
    });
    if (creationType !== "place") {
      addTripItem(document, item);
      finishCreation();
      return;
    }
    const candidateStop = {
      id: item.id,
      latitude: place.location.latitude,
      longitude: place.location.longitude,
      travelMode: item.travelMode,
    };
    const previousBoundaryEntry = placementPlan?.start
      .toReversed()
      .find((entry) => entry.place && placeViews.has(entry.place.placeId));
    const nextBoundaryEntry = placementPlan?.end.find(
      (entry) => entry.place && placeViews.has(entry.place.placeId),
    );
    const placementMapItems = [
      ...(placementPlan?.start.map((entry) => ({ item: entry, key: `${entry.id}:start` })) ?? []),
      ...placementItems.map((entry) => ({ item: entry, key: entry.id })),
      ...(placementPlan?.end.map((entry) => ({ item: entry, key: `${entry.id}:end` })) ?? []),
    ];
    const placementStops = buildRouteStops(
      placementMapItems,
      placeViews,
      snapshot.days,
      placementDay,
      tripLanguage,
      snapshot.timeZone,
    );
    if (creationEpoch.current !== target.token) return;
    const placementRoutes = await readGooglePlacementTravelTimes(
      placementStops,
      candidateStop,
      tripLanguage,
    );
    if (creationEpoch.current !== target.token) return;
    const latestSnapshot = readTripDocument(document);
    if (!latestSnapshot.days.some((day) => day.id === placementDay)) {
      finishCreation();
      return;
    }
    const currentLegs = routeLegs.get(placementDay) ?? emptyLegs;
    const currentRoutes = currentLegs.flatMap((leg) =>
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
      items: placementItems,
      ...(previousBoundaryEntry
        ? {
            previousBoundary: { ...previousBoundaryEntry, id: `${previousBoundaryEntry.id}:start` },
          }
        : {}),
      ...(nextBoundaryEntry
        ? { nextBoundary: { ...nextBoundaryEntry, id: `${nextBoundaryEntry.id}:end` } }
        : {}),
      item,
      travelTimes: [...currentRoutes, ...placementRoutes],
      date: placementDay,
      timeZone: snapshot.timeZone,
    });
    const previousItem =
      placementItems
        .slice(0, visibleIndex)
        .toReversed()
        .find((candidate) => candidate.place) ?? previousBoundaryEntry;
    const previousPlace = previousItem?.place
      ? placeViews.get(previousItem.place.placeId)
      : undefined;
    const nextItem =
      placementItems.slice(visibleIndex).find((candidate) => candidate.place) ?? nextBoundaryEntry;
    const nextPlace = nextItem?.place ? placeViews.get(nextItem.place.placeId) : undefined;
    const nextTravelMode =
      nextItem && nextPlace
        ? {
            id: nextItem.id,
            travelMode: defaultTravelModeForPlacement(
              place.location,
              nextPlace,
              latestSnapshot.defaultTravelMode,
            ),
          }
        : null;
    const placedItem = {
      ...item,
      travelMode: defaultTravelModeForPlacement(
        previousPlace,
        place.location,
        latestSnapshot.defaultTravelMode,
      ),
    };
    const beforeId = placementItems[visibleIndex]?.id;
    const latestOrder = latestSnapshot.order;
    const beforeIndex = beforeId ? latestOrder.indexOf(beforeId) : -1;
    const dayIds = new Set(placementItems.map((dayItem) => dayItem.id));
    const lastDayIndex = latestOrder.findLastIndex((id) => dayIds.has(id));
    const destinationIndex =
      beforeIndex >= 0 ? beforeIndex : lastDayIndex >= 0 ? lastDayIndex + 1 : latestOrder.length;
    addTripItemWithNextTravelMode(document, placedItem, nextTravelMode, destinationIndex);
    finishCreation();
  };
  const addMapPlace = async (placeId: string) => {
    let targetPlace: GooglePlaceView | null = null;
    try {
      targetPlace = await resolveGooglePlace(placeId, tripLanguage);
    } catch {
      // Adding the place still works when Google cannot resolve its coordinates.
    }
    const latestSnapshot = readTripDocument(document);
    const fallbackDay = latestSnapshot.days.some((day) => day.id === mapDestinationDay.current)
      ? mapDestinationDay.current
      : null;
    const dayIds = new Set(latestSnapshot.days.map((day) => day.id));
    const candidates = targetPlace
      ? latestSnapshot.order.flatMap((id) => {
          const item = latestSnapshot.items[id];
          if (!item?.place || !item.dayId || !dayIds.has(item.dayId)) return [];
          const place = placeViews.get(item.place.placeId);
          return place
            ? [
                {
                  dayId: item.dayId,
                  latitude: place.latitude,
                  longitude: place.longitude,
                },
              ]
            : [];
        })
      : [];
    const destinationDay = targetPlace
      ? (nearestPlaceDay(targetPlace, candidates) ?? fallbackDay)
      : fallbackDay;
    const latestOrderedItems = latestSnapshot.order.flatMap((id) => {
      const orderedItem = latestSnapshot.items[id];
      return orderedItem ? [orderedItem] : [];
    });
    const destinationPlan = destinationDay
      ? buildDayPlans(latestOrderedItems, latestSnapshot.days).find(
          (plan) => plan.day.id === destinationDay,
        )
      : undefined;
    const previousItem =
      destinationPlan?.items.toReversed().find((candidate) => candidate.place) ??
      destinationPlan?.start.toReversed().find((candidate) => candidate.place);
    const previousPlace = previousItem?.place
      ? placeViews.get(previousItem.place.placeId)
      : undefined;
    const nextItem = destinationPlan?.end.find((candidate) => candidate.place);
    const nextPlace = nextItem?.place ? placeViews.get(nextItem.place.placeId) : undefined;
    const nextTravelMode =
      targetPlace && nextItem && nextPlace
        ? {
            id: nextItem.id,
            travelMode: defaultTravelModeForPlacement(
              targetPlace,
              nextPlace,
              latestSnapshot.defaultTravelMode,
            ),
          }
        : null;
    const item = itemForCreate("place", destinationDay, {
      place: { placeId },
      travelMode: targetPlace
        ? defaultTravelModeForPlacement(
            previousPlace,
            targetPlace,
            latestSnapshot.defaultTravelMode,
          )
        : latestSnapshot.defaultTravelMode,
    });
    addTripItemWithNextTravelMode(document, item, nextTravelMode);
    if (destinationDay) jumpToDay(destinationDay);
    else jumpToInbox();
    setSelectedId(item.id);
    setEditorDay(destinationDay);
    setEditorBoundary(null);
    setMapPlaceId(placeId);
    setView("split");
  };
  const removeMapPlaceFromDay = (itemId: string) => {
    moveTripItem(document, itemId, null, null, snapshot.order);
    if (selectedId === itemId) closeEditor();
    else setMapPlaceId(null);
  };
  const removeItem = (item: TripItem) => {
    if (!confirm(text("deleteItem", { title: itemTitle(item, placeViews) }))) return;
    removeTripItem(document, item.id);
    if (selectedId === item.id) closeEditor();
  };
  const renderCreationSearch = () => {
    if (!creation) return null;
    const target = creation;
    return (
      <PlaceSearch
        title={
          target.type === "place"
            ? text("addPlace")
            : target.type === "reservation"
              ? text("addReservation")
              : text("addLodging")
        }
        bias={placeViews.get(snapshot.destination.placeId)}
        onAdd={addPlace}
        {...(target.type === "reservation"
          ? {
              schedule: {
                type: "reservation" as const,
                date: target.dayId,
                startTime: target.startTime,
                onStartTimeChange: (startTime: string) =>
                  setCreation((current) =>
                    current?.token === target.token ? { ...current, startTime } : current,
                  ),
              },
            }
          : target.type === "lodging"
            ? {
                schedule: {
                  type: "lodging" as const,
                  checkInDate: target.checkInDate,
                  checkOutDate: target.checkOutDate,
                  onCheckInDateChange: (checkInDate: string) =>
                    setCreation((current) => {
                      if (current?.token !== target.token) return current;
                      const checkOutDate =
                        checkInDate && current.checkOutDate <= checkInDate
                          ? Temporal.PlainDate.from(checkInDate).add({ days: 1 }).toString()
                          : current.checkOutDate;
                      return { ...current, checkInDate, checkOutDate };
                    }),
                  onCheckOutDateChange: (checkOutDate: string) =>
                    setCreation((current) =>
                      current?.token === target.token ? { ...current, checkOutDate } : current,
                    ),
                },
              }
            : {})}
      />
    );
  };
  const share = async () => {
    const firstShare = localStorage.getItem(`pacenotes-shared-${tripId}`) !== "true";
    if (firstShare) {
      setShareOpen(true);
      return;
    }
    await copyOrShare(title);
  };
  const confirmShare = async () => {
    localStorage.setItem(`pacenotes-shared-${tripId}`, "true");
    setShareOpen(false);
    await copyOrShare(title);
  };
  const removeDay = (dayId: string, count: number) => {
    const dayIndex = snapshot.days.findIndex((day) => day.id === dayId);
    if (
      snapshot.days.length <= 1 ||
      dayIndex < 0 ||
      (dayIndex !== 0 && dayIndex !== snapshot.days.length - 1)
    )
      return;
    if (
      Object.values(snapshot.items).some(
        (item) => item.type === "reservation" && item.dayId === dayId,
      )
    ) {
      alert(text("deleteDayBlocked"));
      return;
    }
    if (!confirm(text("deleteDayConfirm", { count }))) return;
    resetDayJump();
    cancelCreation();
    setAddMenuDay(null);
    deleteTripDay(document, dayId);
    setNavigationDay(null);
    setActiveDay(snapshot.days.find((day) => day.id !== dayId)?.id ?? null);
    closeEditor();
  };
  const addDayAtEdge = (edge: "before" | "after") => {
    const date = addTripDay(document, edge);
    if (!date) return;
    cancelCreation();
    setAddMenuDay(null);
    setNavigationDay(null);
    setActiveDay(date);
    closeEditor();
  };

  return (
    <UiLanguageProvider language={uiLanguage}>
      <TripLanguageProvider language={tripLanguage}>
        <main
          ref={plannerRef}
          className="planner"
          style={{ "--sheet-height": `${sheetHeight}dvh` } as React.CSSProperties}
        >
          <header className="planner-header">
            <div className="planner-header-title">
              <Brand compact />
              <TitleField
                label={text("tripTitle")}
                value={titleDraft ?? title}
                maxLength={200}
                onFocus={() => {
                  titleEdit.current = { initial: title, cancelled: false };
                  setTitleDraft(title);
                }}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => {
                  if (
                    titleDraft !== null &&
                    !titleEdit.current.cancelled &&
                    titleDraft.trim() !== titleEdit.current.initial
                  ) {
                    setTripField(document, "title", titleDraft.trim());
                  }
                  setTitleDraft(null);
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Enter" || event.key === "Escape") {
                    event.preventDefault();
                    titleEdit.current.cancelled = event.key === "Escape";
                    event.currentTarget.blur();
                  }
                }}
              />
            </div>
            <div className="planner-view-tools">
              <fieldset
                className="content-tabs"
                aria-label={`${text("itinerary")} / ${text("calendar")} / ${text("expenses")}`}
              >
                <legend>{text("plannerView")}</legend>
                <button
                  type="button"
                  aria-pressed={view !== "map" && plannerContent === "itinerary"}
                  onClick={() => changePlannerContent("itinerary")}
                >
                  <Icon icon={listIcon} />
                  {text("itinerary")}
                </button>
                <button
                  type="button"
                  aria-pressed={view !== "map" && plannerContent === "calendar"}
                  onClick={() => changePlannerContent("calendar")}
                >
                  <Icon icon={calendarIcon} />
                  {text("calendar")}
                </button>
                <button
                  type="button"
                  aria-pressed={view !== "map" && plannerContent === "expenses"}
                  onClick={() => changePlannerContent("expenses")}
                >
                  <Icon icon={coinsIcon} />
                  {text("expenses")}
                </button>
              </fieldset>
              <span className="planner-view-separator" aria-hidden="true" />
              <fieldset className="view-tabs">
                <legend>{text("plannerView")}</legend>
                <button
                  type="button"
                  aria-label={text("map")}
                  title={text("map")}
                  aria-pressed={view !== "list"}
                  disabled={view === "map"}
                  onClick={() => setView((current) => (current === "split" ? "list" : "split"))}
                >
                  <Icon icon={mapIcon} />
                  <span className="map-view-label">{text("map")}</span>
                </button>
              </fieldset>
            </div>
            <div className="planner-header-actions">
              <span className={`sync-state state-${syncState}`}>
                <i aria-hidden="true" />
                <span className="sync-state-label">
                  {syncState === "synced"
                    ? text("connected")
                    : syncState === "connecting"
                      ? text("connecting")
                      : text("offline")}
                </span>
              </span>
              <div className="presence-stack">
                {identityChoice === guestIdentity ? (
                  <button
                    type="button"
                    className="guest-presence"
                    aria-label={text("tripmateGuest")}
                    title={text("tripmateGuest")}
                    aria-haspopup="dialog"
                    onClick={() => setJoinOpen(true)}
                  >
                    <Icon icon={userIcon} aria-hidden="true" />
                  </button>
                ) : null}
                {onlineTripmates.slice(0, 4).map((person) => (
                  <span
                    key={person.id}
                    style={{ "--person-color": person.color } as React.CSSProperties}
                    title={person.name}
                  >
                    {initials(person.name)}
                  </span>
                ))}
              </div>
              <span className="sr-only" role="status">
                {text("tripmatesOnline", { count: onlineTripmates.length })}
              </span>
              <div ref={headerMoreRef} className="planner-header-more">
                <button
                  type="button"
                  className="icon-button planner-header-more-trigger"
                  aria-label={text("moreActions")}
                  aria-expanded={headerMoreOpen}
                  aria-controls="planner-header-menu"
                  onClick={() => setHeaderMoreOpen((open) => !open)}
                >
                  <Icon icon={ellipsisIcon} />
                </button>
                <div
                  id="planner-header-menu"
                  className={`planner-header-more-menu${headerMoreOpen ? " is-open" : ""}`}
                >
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={text("undo")}
                    aria-keyshortcuts="Control+Z Meta+Z"
                    disabled={!canUndo}
                    onClick={() => {
                      undo();
                      setHeaderMoreOpen(false);
                    }}
                  >
                    <Icon icon={undoIcon} />
                    <span className="planner-header-action-label">{text("undo")}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={text("redo")}
                    aria-keyshortcuts="Control+Y Control+Shift+Z Meta+Shift+Z"
                    disabled={!canRedo}
                    onClick={() => {
                      redo();
                      setHeaderMoreOpen(false);
                    }}
                  >
                    <Icon icon={redoIcon} />
                    <span className="planner-header-action-label">{text("redo")}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={text("tripmates")}
                    disabled={!hasSynced || !identityLoaded || needsIdentity}
                    onClick={() => {
                      setTripmatesOpen(true);
                      setHeaderMoreOpen(false);
                    }}
                  >
                    <Icon icon={usersIcon} aria-hidden="true" />
                    <span className="planner-header-action-label">{text("tripmates")}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={text("tripSettings")}
                    onClick={() => {
                      setSettingsOpen(true);
                      setHeaderMoreOpen(false);
                    }}
                  >
                    <Icon icon={settingsIcon} />
                    <span className="planner-header-action-label">{text("tripSettings")}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-button danger-icon"
                    aria-label={text("deleteTrip")}
                    onClick={() => {
                      setDeleteOpen(true);
                      setHeaderMoreOpen(false);
                    }}
                  >
                    <Icon icon={trashIcon} />
                    <span className="planner-header-action-label">{text("deleteTrip")}</span>
                  </button>
                </div>
              </div>
              <button type="button" className="secondary-button" onClick={share}>
                <Icon icon={shareIcon} />
                {text("share")}
              </button>
            </div>
          </header>

          <div className="planner-tabs">
            <nav className="date-tabs" aria-label={text("tripDates")}>
              {snapshot.days.map((day) => (
                <button
                  key={day.id}
                  type="button"
                  data-day-tab
                  className={!inboxActive && day.id === currentDay ? "active" : ""}
                  aria-current={!inboxActive && day.id === currentDay ? "date" : undefined}
                  onClick={() => jumpToDay(day.id)}
                >
                  <span>{weekday(day.date, uiLanguage)}</span>
                  <strong>{day.date.slice(-2)}</strong>
                </button>
              ))}
              <button
                type="button"
                className={`places-tab${inboxActive ? " active" : ""}`}
                aria-label={text("placesToVisit")}
                aria-controls="places-to-visit"
                title={text("placesToVisit")}
                aria-current={inboxActive ? "true" : undefined}
                onClick={jumpToInbox}
              >
                <Icon icon={mapPinIcon} />
              </button>
            </nav>
          </div>

          <div
            className={`planner-body view-${view}${mapPlaceId ? " has-map-details" : ""}${selected ? " has-item-editor" : ""}`}
          >
            <section
              id="planner-itinerary"
              className="planner-panel"
              aria-label={text("itinerary")}
              aria-busy={navigationDay !== null}
              onWheelCapture={cancelDayJump}
              onTouchMoveCapture={cancelDayJump}
              onKeyDownCapture={(event) => {
                if (
                  ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(
                    event.key,
                  )
                )
                  cancelDayJump();
              }}
            >
              <button
                type="button"
                className="mobile-sheet-handle"
                aria-label={text("hideItinerary")}
                aria-controls="planner-itinerary"
                aria-expanded="true"
                title={text("hideItinerary")}
                onPointerDown={resizeSheet}
                onClick={(event) => {
                  if (event.detail === 0) setView("map");
                }}
              >
                <span />
              </button>
              <div
                ref={itineraryRef}
                className="planner-scroll"
                onScroll={trackVisibleDay}
                onPointerDownCapture={(event) => {
                  if (event.target === event.currentTarget) cancelDayJump();
                }}
              >
                {plannerContent === "expenses" ? (
                  <Suspense
                    fallback={
                      <div className="planner-loading">
                        <span className="spinner" />
                      </div>
                    }
                  >
                    <ExpensesWorkspace
                      document={document}
                      snapshot={snapshot}
                      places={placeViews}
                      selectedFriendId={selectedFriendId}
                      onOpenItem={(id) => {
                        changePlannerContent("itinerary");
                        const dayId = snapshot.items[id]?.dayId;
                        if (dayId) jumpToDay(dayId, true);
                        else jumpToInbox();
                        selectItem(id, dayId ?? undefined);
                      }}
                      focusExpenseId={focusedExpenseId}
                      onFocusExpense={setFocusedExpenseId}
                    />
                  </Suspense>
                ) : null}
                {plannerContent !== "expenses" ? (
                  <>
                    {plannerContent === "calendar" ? (
                      <Calendar
                        days={snapshot.days}
                        orderedItems={orderedItems}
                        legsByDay={routeLegs}
                        places={placeViews}
                        language={uiLanguage}
                        calendarStartHour={snapshot.calendarStartHour}
                        editor={renderEditor()}
                        creationPanel={
                          plannerContent === "calendar" && creation?.anchor === "day"
                            ? renderCreationSearch()
                            : null
                        }
                        focusRequest={calendarFocusRequest}
                        selectedId={selectedId}
                        onSelect={(item, dayId) =>
                          selectItem(
                            item.id,
                            dayId ?? item.dayId ?? undefined,
                            item.type === "lodging" && dayId ? "start" : null,
                          )
                        }
                        onClearSelection={closeEditor}
                        onChangeItems={changeCalendarItems}
                        onChangeItem={changeCalendarItem}
                        onMoveNote={moveCalendarNote}
                        canReorderItem={canMoveCalendarItem}
                        onReorderItem={moveCalendarItem}
                        onDuplicateItem={duplicateCalendarItem}
                        onMakeFlexible={makeCalendarItemFlexible}
                        onDeleteItem={removeItem}
                        onAddItem={addCalendarItem}
                        onChangeLodging={changeCalendarLodging}
                      />
                    ) : null}
                    <div
                      className={plannerContent === "calendar" ? "calendar-mobile-itinerary" : ""}
                    >
                      <ItineraryDragArea
                        onDrop={applyDayDrop}
                        onDragStateChange={setItineraryDragging}
                      >
                        <div className="planner-days">
                          {dayPlans.map((plan, dayIndex) => {
                            const dateLabel = longDate(plan.day.date, uiLanguage);
                            const editing =
                              selected && selected.dayId !== null && editorDay === plan.day.id;
                            const rendered =
                              itineraryDragging ||
                              visibleDays.has(plan.day.id) ||
                              plan.day.id === currentDay ||
                              Boolean(editing);
                            const count = plan.items.length + plan.start.length + plan.end.length;
                            const itemCount =
                              plan.items.length +
                              new Set([...plan.start, ...plan.end].map((item) => item.id)).size;
                            const dayOrder = rendered
                              ? [
                                  ...plan.start.map((item) => `${item.id}:start`),
                                  ...plan.items.map((item) => item.id),
                                  ...plan.end.map((item) => `${item.id}:end`),
                                ]
                              : [];
                            const layout = `${count}:${editing ? selected.id : ""}:${
                              creation?.dayId === plan.day.id ? creation.type : ""
                            }`;
                            const measured = dayHeights.current.get(plan.day.id);
                            const height =
                              measured?.layout === layout
                                ? `${measured.height}px`
                                : `${4.5 + 4 * count + (count ? 0 : 2)}rem`;
                            const dayLegs = routeLegs.get(plan.day.id) ?? emptyLegs;
                            const ownedRouteIds = new Set([
                              ...plan.start.map((item) => `${item.id}:start`),
                              ...plan.items.map((item) => item.id),
                              ...plan.end.map((item) => `${item.id}:end`),
                            ]);
                            const firstItem = plan.items[0];
                            const firstEnd = plan.end[0];
                            const firstVisibleRouteId =
                              firstItem?.id ?? (firstEnd ? `${firstEnd.id}:end` : null);
                            const hasLeadingTransportLeg =
                              firstVisibleRouteId !== null &&
                              dayLegs.some(
                                (leg) =>
                                  leg.toId === firstVisibleRouteId &&
                                  !ownedRouteIds.has(leg.fromId),
                              );
                            const dayRoute = buildDayRouteExport(
                              routeData.exportStops.get(plan.day.id) ?? emptyStops,
                              dayLegs,
                            );
                            const warnings =
                              plan.day.id === activeRouteDay
                                ? itemWarnings
                                : rendered
                                  ? buildScheduleWarnings(
                                      plan.items,
                                      dayLegs,
                                      plan.day.date,
                                      snapshot.timeZone,
                                      uiLanguage,
                                    )
                                  : noWarnings;
                            return (
                              <section
                                key={plan.day.id}
                                id={`day-${plan.day.id}`}
                                data-day-id={plan.day.id}
                                data-rendered={rendered}
                                data-layout={layout}
                                className="day-section"
                                style={{
                                  minHeight: rendered ? undefined : height,
                                }}
                                aria-label={dateLabel}
                              >
                                <header className="day-heading">
                                  <h2>
                                    <span>{dateLabel}</span>
                                    {dayIndex < dayPlans.length - 1 && plan.end.length === 0 ? (
                                      <small className="missing-lodging">
                                        <Icon
                                          className="missing-lodging-icon"
                                          icon={triangleAlertIcon}
                                          aria-hidden="true"
                                        />
                                        {text("noLodging")}
                                      </small>
                                    ) : null}
                                  </h2>
                                  <div className="day-actions">
                                    <b>{itemCount}</b>
                                    <button
                                      type="button"
                                      className="icon-button day-map-focus"
                                      aria-label={text("showDayRouteOnMap", { date: dateLabel })}
                                      title={text("showDayRouteOnMap", { date: dateLabel })}
                                      disabled={
                                        (routeData.exportStops.get(plan.day.id)?.length ?? 0) === 0
                                      }
                                      onClick={() => focusDayRoute(plan.day.id)}
                                    >
                                      <Icon icon={eyeIcon} />
                                    </button>
                                    {dayRoute.url ? (
                                      <a
                                        className="icon-button day-route-export"
                                        href={dayRoute.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        aria-label={text("openDayGoogleMaps")}
                                      >
                                        <Icon icon={routeIcon} />
                                      </a>
                                    ) : (
                                      <button
                                        type="button"
                                        className="icon-button day-route-export"
                                        aria-disabled="true"
                                        aria-label={dayRouteDisabledText(
                                          uiLanguage,
                                          dayRoute.reason ?? "routes-unavailable",
                                        )}
                                      >
                                        <Icon icon={routeIcon} />
                                      </button>
                                    )}
                                    {dayIndex === 0 ? (
                                      <button
                                        type="button"
                                        className="icon-button"
                                        aria-label={text("addDayBefore", { date: dateLabel })}
                                        disabled={snapshot.days.length >= 30}
                                        onClick={() => addDayAtEdge("before")}
                                      >
                                        <Icon icon={plusIcon} />
                                      </button>
                                    ) : null}
                                    {dayIndex === snapshot.days.length - 1 ? (
                                      <button
                                        type="button"
                                        className="icon-button"
                                        aria-label={text("addDayAfter", { date: dateLabel })}
                                        disabled={snapshot.days.length >= 30}
                                        onClick={() => addDayAtEdge("after")}
                                      >
                                        <Icon icon={plusIcon} />
                                      </button>
                                    ) : null}
                                    {dayIndex === 0 || dayIndex === snapshot.days.length - 1 ? (
                                      <button
                                        type="button"
                                        className="icon-button danger-icon"
                                        aria-label={text("deleteDay", { date: dateLabel })}
                                        disabled={snapshot.days.length <= 1}
                                        onClick={() => removeDay(plan.day.id, itemCount)}
                                      >
                                        <Icon icon={calendarDeleteIcon} />
                                      </button>
                                    ) : null}
                                    <DayAddControl
                                      dayId={plan.day.id}
                                      dayLabel={dateLabel}
                                      menuOpen={addMenuDay === plan.day.id}
                                      onMenuOpenChange={(open) => {
                                        setAddMenuDay(open ? plan.day.id : null);
                                        if (open) cancelCreation();
                                      }}
                                      onPlace={() => beginPlace("place", plan.day.id)}
                                      onAdd={(type) => addDayItem(type, plan.day.id)}
                                    />
                                  </div>
                                </header>
                                {plannerContent !== "calendar" &&
                                creation?.anchor === "day" &&
                                creation.dayId === plan.day.id
                                  ? renderCreationSearch()
                                  : null}
                                {rendered ? (
                                  <>
                                    <ItineraryList
                                      droppableId={`day:${plan.day.id}:start`}
                                      boundary="start"
                                      endpointMode={
                                        routeData.predecessorDayIds.has(plan.day.id)
                                          ? hasLeadingTransportLeg
                                            ? "transport"
                                            : "loose"
                                          : null
                                      }
                                      boundaryDate={plan.day.date}
                                      items={plan.start}
                                      order={dayOrder}
                                      places={placeViews}
                                      legs={dayLegs}
                                      distanceUnit={snapshot.distanceUnit}
                                      warnings={noWarnings}
                                      selectedId={selectedId}
                                      onSelect={(id) => selectItem(id, plan.day.id, "start")}
                                      renderAfter={(item) =>
                                        renderEditorAfter(item, plan.day.id, "start")
                                      }
                                      onDelete={removeItem}
                                      onTravelMode={(id, travelMode) =>
                                        updateTripItem(document, id, { travelMode })
                                      }
                                    />
                                    <ItineraryList
                                      droppableId={`day:${plan.day.id}`}
                                      items={plan.items}
                                      order={dayOrder}
                                      places={placeViews}
                                      legs={dayLegs}
                                      warnings={warnings}
                                      distanceUnit={snapshot.distanceUnit}
                                      selectedId={selectedId}
                                      onSelect={(id) => selectItem(id, plan.day.id)}
                                      renderAfter={(item) => renderEditorAfter(item, plan.day.id)}
                                      onDelete={removeItem}
                                      onMove={(id, delta) => moveVisible(id, delta, plan.items)}
                                      empty={
                                        count === 0 ? (
                                          <div
                                            className="day-empty"
                                            role="img"
                                            aria-label={text("noItems")}
                                            title={text("noItems")}
                                          >
                                            <Icon icon={calendarIcon} aria-hidden="true" />
                                          </div>
                                        ) : (
                                          <div
                                            className={`day-drop-target${plan.end.length > 0 ? " day-drop-target-compact" : ""}`}
                                          />
                                        )
                                      }
                                      onTravelMode={(id, travelMode) =>
                                        updateTripItem(document, id, { travelMode })
                                      }
                                    />
                                    <ItineraryList
                                      droppableId={`day:${plan.day.id}:end`}
                                      boundary="end"
                                      items={plan.end}
                                      boundaryDate={plan.day.date}
                                      places={placeViews}
                                      order={dayOrder}
                                      legs={dayLegs}
                                      distanceUnit={snapshot.distanceUnit}
                                      warnings={noWarnings}
                                      selectedId={selectedId}
                                      onSelect={(id) => selectItem(id, plan.day.id, "end")}
                                      renderAfter={(item) =>
                                        renderEditorAfter(item, plan.day.id, "end")
                                      }
                                      onDelete={removeItem}
                                      onTravelMode={(id, travelMode) =>
                                        updateTripItem(document, id, { travelMode })
                                      }
                                    />
                                  </>
                                ) : null}
                              </section>
                            );
                          })}
                        </div>
                        <section id="places-to-visit" ref={inboxRef} className="inbox-section">
                          <button
                            type="button"
                            className="inbox-heading"
                            onClick={() => setInboxOpen((value) => !value)}
                            aria-expanded={inboxOpen}
                          >
                            <span>{text("placesToVisit")}</span>
                            <b>{inboxItems.length}</b>
                          </button>
                          {inboxOpen ? (
                            <ItineraryList
                              droppableId="inbox"
                              items={inboxItems}
                              places={placeViews}
                              legs={[]}
                              distanceUnit={snapshot.distanceUnit}
                              warnings={noWarnings}
                              selectedId={selectedId}
                              onSelect={selectItem}
                              renderAfter={(item) => renderEditorAfter(item, null)}
                              onDelete={removeItem}
                              empty={<div className="day-drop-target" />}
                              onMove={(id, delta) => moveVisible(id, delta, inboxItems)}
                              onTravelMode={(id, travelMode) =>
                                updateTripItem(document, id, { travelMode })
                              }
                            />
                          ) : null}
                        </section>
                      </ItineraryDragArea>
                    </div>
                  </>
                ) : null}
              </div>
            </section>
            <PanelResizer
              plannerRef={plannerRef}
              view={view}
              onToggle={() => setView((current) => (current === "map" ? "split" : "map"))}
            />
            <section className="map-panel" aria-label={text("map")}>
              <div className="map-search-tools">
                <button
                  type="button"
                  className="secondary-button planner-search-button"
                  data-place-trigger
                  aria-label={text("searchGooglePlaces")}
                  title={text("searchGooglePlaces")}
                  aria-expanded={creation?.type === "place" && creation.anchor === "top"}
                  onClick={searchPlaces}
                >
                  <Icon icon={searchIcon} />
                </button>
                {creation?.anchor === "top" ? (
                  <div className="map-global-search">{renderCreationSearch()}</div>
                ) : null}
              </div>
              {placeViewError ? <p className="map-error">{placeViewError}</p> : null}
              <Suspense
                fallback={
                  <div className="map-shell">
                    <span className="spinner" />
                  </div>
                }
              >
                <TripMap
                  tripId={tripId}
                  destination={placeViews.get(snapshot.destination.placeId)}
                  transports={transports}
                  stops={stops}
                  routes={routeLegs}
                  dayRouteStops={routeData.exportStops}
                  dayFocus={mapDayFocus}
                  selectedId={selectedId}
                  editingPlace={editingPlace}
                  selectedPlaceId={mapPlaceId}
                  mapPlacement={mapPlacement}
                  onSelectPlace={(placeId) => {
                    if (plannerContent === "expenses" && placeId) {
                      const item = orderedItems.find(
                        (candidate) =>
                          candidate.place?.placeId === placeId ||
                          candidate.transport?.from?.placeId === placeId ||
                          candidate.transport?.to?.placeId === placeId,
                      );
                      const linked =
                        item &&
                        Object.values(snapshot.expenses).find(
                          (expense) => expense.itemId === item.id,
                        );
                      if (linked) {
                        setFocusedExpenseId(linked.id);
                        if (view === "map") setView("split");
                        return;
                      }
                      if (item) {
                        changePlannerContent("itinerary");
                        selectItem(item.id);
                        return;
                      }
                    }
                    if (placeId && placeId !== mapPlaceId) closeEditor();
                    setMapPlaceId(placeId);
                  }}
                  onAddPlace={addMapPlace}
                  onRemoveFromDay={removeMapPlaceFromDay}
                />
              </Suspense>
            </section>
          </div>

          {settingsOpen ? (
            <TripSettingsDialog
              settings={{
                startDate: snapshot.startDate,
                endDate: snapshot.endDate,
                uiLanguage,
                tripLanguage: snapshot.tripLanguage,
                distanceUnit: snapshot.distanceUnit,
                defaultTravelMode: snapshot.defaultTravelMode,
                calendarStartHour: snapshot.calendarStartHour,
              }}
              currency={snapshot.currency}
              onCurrencyChange={async (currency, settings) => {
                validateTripSettings(document, settings);
                const result = await rebaseTripCurrency({
                  data: {
                    tripId,
                    currency,
                    expected: financialFingerprint(snapshot),
                    settings,
                  },
                });
                return result.changed;
              }}
              onClose={() => setSettingsOpen(false)}
              onSave={(settings, currencyChanged) => {
                const { uiLanguage: nextUiLanguage, ...documentSettings } = settings;
                if (!currencyChanged) {
                  try {
                    setTripSettings(document, documentSettings);
                  } catch {
                    alert(text("tripDatesBlocked"));
                    return;
                  }
                }
                localStorage.setItem(uiLanguageStorageKey, nextUiLanguage);
                setUiLanguage(nextUiLanguage);
                if (
                  !currentDay ||
                  currentDay < settings.startDate ||
                  currentDay > settings.endDate
                ) {
                  setNavigationDay(null);
                  setActiveDay(settings.startDate);
                }
                setSettingsOpen(false);
              }}
            />
          ) : null}
          {tripmatesOpen && hasSynced && identityLoaded && !needsIdentity ? (
            <Suspense fallback={null}>
              <TripmatesDialog
                document={document}
                snapshot={snapshot}
                selectedFriendId={selectedFriendId}
                onSelectFriend={(id) => {
                  selectTripmate(id);
                  if (!id) setTripmatesOpen(false);
                }}
                onClose={() => setTripmatesOpen(false)}
              />
            </Suspense>
          ) : null}
          {needsIdentity || (identityChoice === guestIdentity && joinOpen) ? (
            <TripmateJoinDialog
              friends={snapshot.friends}
              onSelect={(id) => {
                selectTripmate(id);
                setJoinOpen(false);
              }}
              onCreate={(name, color) => {
                const id = crypto.randomUUID();
                createTripmate(document, { id, name, color, archived: false });
                selectTripmate(id);
                setJoinOpen(false);
              }}
              onLater={() => {
                selectTripmate(null);
                setJoinOpen(false);
              }}
            />
          ) : null}
          {shareOpen ? (
            <Modal title={text("shareTitle")} onClose={() => setShareOpen(false)}>
              <p>{text("shareBody")}</p>
              <div className={modalStyles.actions}>
                <button type="button" className="ghost-button" onClick={() => setShareOpen(false)}>
                  {text("cancel")}
                </button>
                <button type="button" className="primary-button" onClick={confirmShare}>
                  {text("copyLink")}
                </button>
              </div>
            </Modal>
          ) : null}
          {deleteOpen ? (
            <Modal
              title={text("deleteTripTitle")}
              onClose={() => {
                setDeleteOpen(false);
                setDeleteText("");
              }}
            >
              <p>
                {deleteBodyBeforeTitle}
                <strong>{title}</strong>
                {deleteBodyAfterTitle}
              </p>
              <input
                value={deleteText}
                onChange={(event) => setDeleteText(event.target.value)}
                aria-label={text("tripTitleConfirmation")}
              />
              <div className={modalStyles.actions}>
                <button type="button" className="ghost-button" onClick={() => setDeleteOpen(false)}>
                  {text("cancel")}
                </button>
                <button
                  type="button"
                  className="danger-button"
                  disabled={deleteText !== title}
                  onClick={async () => {
                    await deleteTrip({ data: { id: tripId } });
                    await navigate({ to: "/" });
                  }}
                >
                  {text("deleteTrip")}
                </button>
              </div>
            </Modal>
          ) : null}
        </main>
      </TripLanguageProvider>
    </UiLanguageProvider>
  );
}

function preferredUiLanguage(): TripLanguage {
  const stored = localStorage.getItem(uiLanguageStorageKey);
  if (stored && tripLanguages.includes(stored as TripLanguage)) return stored as TripLanguage;
  for (const requested of navigator.languages) {
    const normalized = requested.toLowerCase();
    if (normalized === "zh-tw" || normalized === "zh-hk") return "zh-TW";
    if (normalized.startsWith("zh")) return "zh-CN";
    const base = normalized.split("-")[0];
    if (base && tripLanguages.includes(base as TripLanguage)) return base as TripLanguage;
  }
  return "en";
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

function readRecentTrips(): Array<{
  id: string;
  title: string;
  destinationPlaceId?: string;
  href: string;
  openedAt: string;
}> {
  try {
    return JSON.parse(localStorage.getItem("pacenotes-recent-trips") ?? "[]");
  } catch {
    return [];
  }
}

function dayRouteDisabledText(language: TripLanguage, reason: DayRouteExportReason): string {
  const text = createTripText(language);
  if (reason === "not-enough-places") return text("dayRouteFewPlaces");
  if (reason === "open-gap") return text("dayRouteGap");
  if (reason === "mixed-modes") return text("dayRouteMixedModes");
  return text("dayRouteUnavailable");
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

function weekday(date: string, language: TripLanguage): string {
  return new Intl.DateTimeFormat(language, { weekday: "short", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

function longDate(date: string, language: TripLanguage): string {
  return new Intl.DateTimeFormat(language, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}
