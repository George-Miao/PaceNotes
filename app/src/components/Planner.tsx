import { Icon } from "@iconify/react";
import calendarIcon from "@iconify-icons/lucide/calendar";
import calendarDeleteIcon from "@iconify-icons/lucide/calendar-x-2";
import listIcon from "@iconify-icons/lucide/list";
import mapIcon from "@iconify-icons/lucide/map";
import mapPinIcon from "@iconify-icons/lucide/map-pin";
import panelLeftCloseIcon from "@iconify-icons/lucide/panel-left-close";
import panelLeftOpenIcon from "@iconify-icons/lucide/panel-left-open";
import redoIcon from "@iconify-icons/lucide/redo-2";
import routeIcon from "@iconify-icons/lucide/route";
import settingsIcon from "@iconify-icons/lucide/settings-2";
import shareIcon from "@iconify-icons/lucide/share-2";
import trashIcon from "@iconify-icons/lucide/trash-2";
import triangleAlertIcon from "@iconify-icons/lucide/triangle-alert";
import undoIcon from "@iconify-icons/lucide/undo-2";
import { Temporal } from "@js-temporal/polyfill";
import { useNavigate } from "@tanstack/react-router";
import {
  lazy,
  Suspense,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  addTripItem,
  applyCalendarItemChange,
  deleteTripDay,
  moveTripItem,
  readTripDocument,
  removeTripItem,
  scheduleTripItem,
  setTripField,
  setTripOrder,
  setTripSettings,
  updateTripItem,
} from "~/features/collaboration/document";
import { useTripDocument } from "~/features/collaboration/use-trip-document";
import {
  type GooglePlaceSelection,
  type GooglePlaceView,
  googleLibraryLanguage,
} from "~/features/google/google";
import { itemTitle } from "~/features/google/item-title";
import { readGooglePlacementTravelTimes } from "~/features/google/place-placement-routes";
import { buildDayRouteExport, type DayRouteExportReason } from "~/features/google/route-export";
import {
  type MapStop,
  type MapTransport,
  type RouteLeg,
  useRouteLegs,
} from "~/features/google/route-legs";
import { useGooglePlaceViews } from "~/features/google/use-place-views";
import { useTripTitle } from "~/features/google/use-trip-title";
import { dayColor } from "~/features/trip/day-colors";
import { buildDayPlans } from "~/features/trip/day-plan";
import { createTripText, TripLanguageProvider, useTripText } from "~/features/trip/language";
import {
  itemForCreate,
  reorder,
  resolveLocalTime,
  type TripDay,
  type TripItem,
  type TripLanguage,
  type TripSnapshot,
} from "~/features/trip/model";
import { findBestPlaceInsertion } from "~/features/trip/place-placement";
import { deleteTrip } from "~/features/trip/trip.functions";
import { Brand } from "./Brand";
import { Calendar } from "./Calendar";
import { DayAddControl, type DayAddItemType } from "./DayAddControl";
import { ItemEditorSkeleton } from "./ItemEditorSkeleton";
import { ItineraryDragArea, type ItineraryDrop, ItineraryList } from "./ItineraryList";
import { PlaceSearch } from "./PlaceSearch";
import { TripSettingsDialog } from "./TripSettingsDialog";

const noWarnings = new Map<string, string[]>();
const emptyItems: TripItem[] = [];
const emptyLegs: RouteLeg[] = [];
const emptyStops: MapStop[] = [];
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
  const [plannerContent, setPlannerContent] = useState<"itinerary" | "calendar">("itinerary");
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [navigationDay, setNavigationDay] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("split");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorDay, setEditorDay] = useState<string | null>(null);
  const [editorBoundary, setEditorBoundary] = useState<"start" | "end" | null>(null);
  const [mapPlaceId, setMapPlaceId] = useState<string | null>(null);
  const currentDay = navigationDay ?? activeDay;
  const mapDestinationDay = useRef<string | null>(null);
  const [creation, setCreation] = useState<{
    dayId: string;
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
  const itineraryRef = useRef<HTMLElement>(null);
  const inboxRef = useRef<HTMLElement>(null);
  const dayHeights = useRef(new Map<string, { layout: string; height: number }>());
  const [visibleDays, setVisibleDays] = useState<ReadonlySet<string>>(() => new Set());
  const pendingInboxJump = useRef(false);
  const pendingJump = useRef<string | null>(null);
  const jumpAnimation = useRef<number | null>(null);
  const jumpTimeout = useRef<number | null>(null);
  const dayKey = snapshot.days.map((day) => day.id).join(",");
  const [inboxOpen, setInboxOpen] = useState(true);
  const [inboxActive, setInboxActive] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const plannerRef = useRef<HTMLElement>(null);
  const [sheetHeight, setSheetHeight] = useState(48);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const titleEdit = useRef({ initial: "", cancelled: false });
  const text = createTripText(snapshot.language);
  const title = useTripTitle(snapshot.title, snapshot.destination.placeId, snapshot.language);

  useEffect(
    () => () => {
      if (jumpAnimation.current !== null) window.cancelAnimationFrame(jumpAnimation.current);
      if (jumpTimeout.current !== null) window.clearTimeout(jumpTimeout.current);
    },
    [],
  );

  useEffect(() => {
    const readView = () => {
      const value = new URLSearchParams(window.location.search).get("view");
      setPlannerContent(value === "calendar" ? "calendar" : "itinerary");
    };
    readView();
    window.addEventListener("popstate", readView);
    return () => window.removeEventListener("popstate", readView);
  }, []);

  useEffect(() => {
    const firstDay = snapshot.days[0]?.id;
    if (!activeDay && firstDay) {
      const fragment =
        typeof window === "undefined" ? "" : decodeURIComponent(window.location.hash.slice(1));
      const initial = snapshot.days.some((day) => day.id === fragment) ? fragment : firstDay;
      mapDestinationDay.current = initial;
      setActiveDay(initial);
    }
  }, [activeDay, snapshot.days]);

  useEffect(() => {
    window.document.title = `${title} - PaceNotes`;
  }, [title]);

  useEffect(() => {
    const loadedLanguage = googleLibraryLanguage();
    if (loadedLanguage && loadedLanguage !== snapshot.language && syncState === "synced") {
      location.reload();
    }
  }, [snapshot.language, syncState]);

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
    const root = itineraryRef.current;
    if (!root || !snapshot.id || !dayKey) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setVisibleDays((current) => {
          const next = new Set(current);
          let changed = false;
          for (const entry of entries) {
            const id = (entry.target as HTMLElement).dataset.dayId;
            if (!id) continue;
            if (entry.isIntersecting && !next.has(id)) {
              next.add(id);
              changed = true;
            } else if (!entry.isIntersecting && next.delete(id)) changed = true;
          }
          return changed ? next : current;
        });
      },
      { root, rootMargin: "120px" },
    );
    for (const section of root.querySelectorAll("[data-day-id]")) observer.observe(section);
    const measure = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (!(entry.target instanceof HTMLElement) || entry.target.dataset.rendered !== "true")
          continue;
        const id = entry.target.dataset.dayId;
        const height =
          entry.borderBoxSize[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
        if (id && height > 0)
          dayHeights.current.set(id, { layout: entry.target.dataset.layout ?? "", height });
      }
    });
    for (const section of root.querySelectorAll("[data-day-id]")) measure.observe(section);
    return () => {
      observer.disconnect();
      measure.disconnect();
    };
  }, [dayKey, snapshot.id]);

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
      if (event.key === "Escape") cancelCreation();
    };
    window.addEventListener("pointerdown", dismissOutside);
    window.addEventListener("keydown", dismissOnEscape);
    return () => {
      window.removeEventListener("pointerdown", dismissOutside);
      window.removeEventListener("keydown", dismissOnEscape);
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
  const { places: placeViews, error: placeViewError } = useGooglePlaceViews(
    placeIds,
    snapshot.language,
  );
  const markerItems = useMemo(
    () => orderedItems.map((item) => ({ item, key: item.id })),
    [orderedItems],
  );
  const nextStops = useMemo(
    () =>
      buildMapStops(
        markerItems,
        placeViews,
        snapshot.days.map((day) => day.id),
        snapshot.language,
      ),
    [markerItems, placeViews, snapshot.days, snapshot.language],
  );
  const stops = useStableArray(nextStops, sameMapStop);
  const routeData = useMemo(() => {
    const exportStops = new Map<string, MapStop[]>();
    const predecessorDayIds = new Set<string>();
    const plans = dayPlans.map((plan, dayIndex) => {
      const ownedEntries = [
        ...plan.start.map((item) => ({ item, key: `${item.id}:start` })),
        ...plan.items.map((item) => ({ item, key: item.id })),
        ...plan.end.map((item) => ({ item, key: `${item.id}:end` })),
      ];
      const ownedStops = buildRouteStops(
        ownedEntries,
        placeViews,
        snapshot.days,
        plan.day.id,
        snapshot.language,
        snapshot.timeZone,
      );
      exportStops.set(plan.day.id, ownedStops);
      const previous = dayPlans[dayIndex - 1];
      let predecessor: { item: TripItem; key: string } | null = null;
      if (previous && plan.start.length === 0 && previous.end.length === 0) {
        const entries = [
          ...previous.start.map((item) => ({ item, key: `${item.id}:start` })),
          ...previous.items.map((item) => ({ item, key: item.id })),
        ];
        for (let index = entries.length - 1; index >= 0; index -= 1) {
          const entry = entries[index];
          if (!entry) continue;
          if (entry.item.type === "transport") break;
          if (entry.item.place) {
            predecessor = entry;
            break;
          }
        }
      }
      if (ownedStops.length === 0) predecessor = null;
      if (predecessor) predecessorDayIds.add(plan.day.id);
      return {
        id: plan.day.id,
        stops: predecessor
          ? buildRouteStops(
              [predecessor, ...ownedEntries],
              placeViews,
              snapshot.days,
              plan.day.id,
              snapshot.language,
              snapshot.timeZone,
            )
          : ownedStops,
      };
    });
    return { plans, exportStops, predecessorDayIds };
  }, [dayPlans, placeViews, snapshot.days, snapshot.language, snapshot.timeZone]);
  const routeLegs = useRouteLegs(routeData.plans, snapshot.language);
  const legs = routeLegs.get(activeRouteDay ?? "") ?? emptyLegs;
  const itemWarnings = useMemo(
    () =>
      buildScheduleWarnings(
        dayItems,
        legs,
        activeRouteDay ?? snapshot.startDate,
        snapshot.timeZone,
        snapshot.language,
      ),
    [activeRouteDay, dayItems, legs, snapshot.language, snapshot.startDate, snapshot.timeZone],
  );
  const editingPlace = editingPlaceId ? placeViews.get(editingPlaceId) : undefined;
  const nextTransports = useMemo<MapTransport[]>(() => {
    const items = orderedItems.filter((item) => item.type === "transport");
    return items.map((item) => ({
      id: item.id,
      label: item.title,
      color: dayColor(
        Math.max(
          0,
          snapshot.days.findIndex((day) => day.id === item.dayId),
        ),
      ).background,
      from: item.transport?.from ? (placeViews.get(item.transport.from.placeId) ?? null) : null,
      to: item.transport?.to ? (placeViews.get(item.transport.to.placeId) ?? null) : null,
    }));
  }, [orderedItems, placeViews, snapshot.days]);
  const changePlannerContent = (content: "itinerary" | "calendar") => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", content);
    window.history.replaceState(window.history.state, "", url);
    setPlannerContent(content);
  };
  const selectCalendarDay = (id: string) => {
    setNavigationDay(null);
    setActiveDay(id);
    mapDestinationDay.current = id;
    const url = new URL(window.location.href);
    url.hash = id;
    window.history.replaceState(window.history.state, "", url);
  };
  const transports = useStableArray(nextTransports, sameMapTransport);

  if (!snapshot.id) {
    return (
      <TripLanguageProvider language={snapshot.language}>
        <main className="planner-loading">
          <span className="spinner" aria-hidden="true" />
          <strong>{text("loadingTrip")}</strong>
          <span>{syncState === "offline" ? text("syncUnavailable") : text("connectingPlan")}</span>
        </main>
      </TripLanguageProvider>
    );
  }

  const closeEditor = () => {
    setMapPlaceId(null);
    setSelectedId(null);
    setEditorDay(null);
    setEditorBoundary(null);
  };
  const selectItem = (id: string, dayId?: string, boundary: "start" | "end" | null = null) => {
    if (selectedId === id && editorBoundary === boundary) {
      closeEditor();
      return;
    }
    if (dayId) {
      setNavigationDay(null);
      setActiveDay(dayId);
      mapDestinationDay.current = dayId;
    }
    setSelectedId(id);
    setEditorDay(dayId ?? snapshot.items[id]?.dayId ?? null);
    setEditorBoundary(boundary);
    const placeId = snapshot.items[id]?.place?.placeId ?? null;
    setMapPlaceId(placeId);
    if (placeId || snapshot.items[id]?.type === "transport") setView("split");
  };
  const clearJumpTimeout = () => {
    if (jumpTimeout.current === null) return;
    window.clearTimeout(jumpTimeout.current);
    jumpTimeout.current = null;
  };
  const clearJumpAnimation = () => {
    if (jumpAnimation.current === null) return;
    window.cancelAnimationFrame(jumpAnimation.current);
    jumpAnimation.current = null;
  };
  const trackVisibleDay = () => {
    const panel = itineraryRef.current;
    if (!panel || panel.clientHeight === 0) return;
    const top = panel.getBoundingClientRect().top + 16;
    const inbox = inboxRef.current;
    if (inbox && inbox.getBoundingClientRect().top <= top) {
      pendingInboxJump.current = false;
      setInboxActive(true);
      mapDestinationDay.current = null;
      return;
    }
    if (pendingInboxJump.current) return;
    setInboxActive(false);
    let visible = snapshot.days[0]?.id;
    for (const section of panel.querySelectorAll<HTMLElement>("[data-day-id]")) {
      if (section.getBoundingClientRect().top > top) break;
      visible = section.dataset.dayId;
    }
    if (visible) {
      mapDestinationDay.current = visible;
      setActiveDay(visible);
    }
  };
  const dayScrollTop = (id: string) => {
    const panel = itineraryRef.current;
    const section = window.document.getElementById(`day-${id}`);
    if (!panel || !section || !panel.contains(section)) return null;
    const margin = Number.parseFloat(getComputedStyle(section).scrollMarginTop) || 0;
    return Math.max(
      0,
      Math.min(
        panel.scrollHeight - panel.clientHeight,
        panel.scrollTop +
          section.getBoundingClientRect().top -
          panel.getBoundingClientRect().top -
          panel.clientTop -
          margin,
      ),
    );
  };
  const finishDayJump = (id: string) => {
    if (pendingJump.current !== id) return;
    clearJumpAnimation();
    clearJumpTimeout();
    const top = dayScrollTop(id);
    const panel = itineraryRef.current;
    if (!panel || top === null) {
      pendingJump.current = null;
      setNavigationDay((current) => (current === id ? null : current));
      trackVisibleDay();
      return;
    }
    if (Math.abs(panel.scrollTop - top) > 1) {
      panel.scrollTo({ top, behavior: "instant" });
    }
    setActiveDay(id);
    mapDestinationDay.current = id;
    jumpTimeout.current = window.setTimeout(() => {
      if (pendingJump.current === id) {
        pendingJump.current = null;
        setActiveDay(id);
      }
      setNavigationDay((current) => (current === id ? null : current));
      jumpTimeout.current = null;
    }, 100);
  };
  const cancelDayJump = () => {
    const id = pendingJump.current;
    if (!id) return;
    clearJumpAnimation();
    clearJumpTimeout();
    pendingJump.current = null;
    setActiveDay(id);
    mapDestinationDay.current = id;
    setNavigationDay(null);
    const panel = itineraryRef.current;
    panel?.scrollTo({ top: panel.scrollTop, behavior: "instant" });
  };
  const jumpToDay = (id: string) => {
    closeEditor();
    setInboxActive(false);
    pendingInboxJump.current = false;
    mapDestinationDay.current = id;
    cancelCreation();
    if (view === "map") setView("split");
    startTransition(() => setNavigationDay(id));
    clearJumpAnimation();
    clearJumpTimeout();
    pendingJump.current = id;
    const startAnimation = (startedAt: number) => {
      if (pendingJump.current !== id) return;
      const top = dayScrollTop(id);
      const panel = itineraryRef.current;
      if (!panel || top === null) {
        jumpAnimation.current = null;
        pendingJump.current = null;
        setNavigationDay((current) => (current === id ? null : current));
        trackVisibleDay();
        return;
      }
      if (
        Math.abs(panel.scrollTop - top) <= 1 ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        panel.scrollTo({ top, behavior: "instant" });
        jumpAnimation.current = null;
        finishDayJump(id);
        return;
      }
      const start = panel.scrollTop;
      const distance = top - start;
      const duration = 120;
      const animate = (now: number) => {
        if (pendingJump.current !== id) return;
        const progress = Math.min((now - startedAt) / duration, 1);
        const eased = 1 - (1 - progress) ** 3;
        panel.scrollTop = start + distance * eased;
        if (progress < 1) {
          jumpAnimation.current = window.requestAnimationFrame(animate);
          return;
        }
        jumpAnimation.current = null;
        finishDayJump(id);
      };
      animate(startedAt);
    };
    jumpAnimation.current = window.requestAnimationFrame(startAnimation);
  };
  const jumpToInbox = () => {
    closeEditor();
    cancelCreation();
    cancelDayJump();
    setNavigationDay(null);
    setInboxOpen(true);
    pendingInboxJump.current = true;
    setInboxActive(true);
    mapDestinationDay.current = null;
    if (view === "map") setView("split");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const panel = itineraryRef.current;
        const inbox = inboxRef.current;
        if (!panel || !inbox) return;
        const top = Math.max(
          0,
          panel.scrollTop +
            inbox.getBoundingClientRect().top -
            panel.getBoundingClientRect().top -
            panel.clientTop -
            8,
        );
        panel.scrollTo({ top, behavior: "instant" });
      });
    });
  };
  const renderEditor = () =>
    selected ? (
      <Suspense fallback={<ItemEditorSkeleton item={selected} />}>
        <ItemEditor
          key={selected.id}
          item={selected}
          days={snapshot.days}
          places={placeViews}
          defaultTitle={
            selected.place ? editingPlace?.displayName || text("placeFallback") : selected.title
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
    selected?.id === item.id && editorDay === dayId && editorBoundary === boundary
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
    moveTripItem(
      document,
      moved.id,
      destinationDay,
      destinationDay && moved.startTime ? timeForPosition(withMoved, destinationIndex) : null,
      next,
    );
  };
  const changeCalendarItem = (change: {
    item: TripItem;
    dayId: string;
    startTime: string;
    durationMinutes: number;
    extendThrough?: string;
  }) => {
    const nextItem = {
      ...change.item,
      dayId: change.dayId,
      startTime: change.startTime,
      durationMinutes: change.durationMinutes,
    };
    const result = applyCalendarItemChange(document, {
      id: change.item.id,
      patch: {
        dayId: change.dayId,
        startTime: change.startTime,
        durationMinutes: change.durationMinutes,
      },
      order: calendarOrder(snapshot, nextItem),
      ...(change.extendThrough ? { extendThrough: change.extendThrough } : {}),
    });
    selectCalendarDay(change.dayId);
    return { clamped: result.clamped };
  };
  const cloneCalendarItem = (item: TripItem) => {
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
  const changeCalendarLodging = (item: TripItem, startDate: string, endDate: string) => {
    const result = applyCalendarItemChange(document, {
      id: item.id,
      patch: {
        dayId: startDate,
        startTime: null,
        lodging: { startDate, endDate },
      },
      extendThrough: endDate,
    });
    selectCalendarDay(startDate);
    return result;
  };

  const moveVisible = (id: string, delta: -1 | 1, visible: TripItem[]) => {
    const source = visible.findIndex((item) => item.id === id);
    const destination = source + delta;
    if (destination < 0 || destination >= visible.length) return;
    applyVisibleOrder(source, destination, visible);
  };
  const beginPlace = (type: "place" | "reservation" | "lodging", dayId: string) => {
    closeEditor();
    setNavigationDay(null);
    setActiveDay(dayId);
    setAddMenuDay(null);
    const token = creationEpoch.current + 1;
    creationEpoch.current = token;
    setCreation(
      type === "place" && creation?.dayId === dayId && creation.type === type
        ? null
        : {
            dayId,
            type,
            token,
            startTime: "",
            checkInDate: dayId,
            checkOutDate: Temporal.PlainDate.from(dayId).add({ days: 1 }).toString(),
          },
    );
  };
  const addTypedItem = (type: "note" | "transport", dayId: string) => {
    addTripItem(document, itemForCreate(type, dayId, { travelMode: snapshot.defaultTravelMode }));
    closeEditor();
    setNavigationDay(null);
    setActiveDay(dayId);
    setAddMenuDay(null);
    cancelCreation();
  };
  const addDayItem = (type: DayAddItemType, dayId: string) => {
    if (type === "note" || type === "transport") {
      addTypedItem(type, dayId);
      return;
    }
    beginPlace(type, dayId);
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
        : {}),
      ...(creationType === "lodging"
        ? {
            durationMinutes: 0,
            lodging: {
              startDate: target.checkInDate,
              endDate: target.checkOutDate,
            },
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
      snapshot.language,
      snapshot.timeZone,
    );
    if (creationEpoch.current !== target.token) return;
    const placementRoutes = await readGooglePlacementTravelTimes(
      placementStops,
      candidateStop,
      snapshot.language,
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
    const beforeId = placementItems[visibleIndex]?.id;
    const latestOrder = latestSnapshot.order;
    const beforeIndex = beforeId ? latestOrder.indexOf(beforeId) : -1;
    const dayIds = new Set(placementItems.map((dayItem) => dayItem.id));
    const lastDayIndex = latestOrder.findLastIndex((id) => dayIds.has(id));
    const destinationIndex =
      beforeIndex >= 0 ? beforeIndex : lastDayIndex >= 0 ? lastDayIndex + 1 : latestOrder.length;
    addTripItem(document, item, destinationIndex);
    finishCreation();
  };
  const addMapPlace = (placeId: string) => {
    const latestSnapshot = readTripDocument(document);
    const destinationDay = latestSnapshot.days.some((day) => day.id === mapDestinationDay.current)
      ? mapDestinationDay.current
      : null;
    addTripItem(
      document,
      itemForCreate("place", destinationDay, {
        place: { placeId },
        travelMode: latestSnapshot.defaultTravelMode,
      }),
    );
    if (destinationDay) setActiveDay(destinationDay);
    else setInboxOpen(true);
    setMapPlaceId(null);
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
    if (snapshot.days.length <= 1) return;
    if (
      Object.values(snapshot.items).some(
        (item) => item.type === "reservation" && item.dayId === dayId,
      )
    ) {
      alert(text("deleteDayBlocked"));
      return;
    }
    if (!confirm(text("deleteDayConfirm", { count }))) return;
    clearJumpAnimation();
    clearJumpTimeout();
    pendingJump.current = null;
    cancelCreation();
    setAddMenuDay(null);
    deleteTripDay(document, dayId);
    setNavigationDay(null);
    setActiveDay(snapshot.days.find((day) => day.id !== dayId)?.id ?? null);
    closeEditor();
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
    <TripLanguageProvider language={snapshot.language}>
      <main
        ref={plannerRef}
        className="planner"
        style={{ "--sheet-height": `${sheetHeight}dvh` } as React.CSSProperties}
      >
        <header className="planner-header">
          <Brand compact />
          <label className="title-field">
            <span className="sr-only">{text("tripTitle")}</span>
            <input
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
          </label>
          <span className={`sync-state state-${syncState}`}>
            <i aria-hidden="true" />
            {syncState === "synced"
              ? text("allSynced")
              : syncState === "unsynced"
                ? text("saving")
                : syncState === "connecting"
                  ? text("connecting")
                  : text("offline")}
          </span>
          <div
            className="presence-stack"
            role="status"
            aria-label={text("editorsOnline", { count: collaborators.length })}
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
            aria-label={text("undo")}
            aria-keyshortcuts="Control+Z Meta+Z"
            disabled={!canUndo}
            onClick={undo}
          >
            <Icon icon={undoIcon} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={text("redo")}
            aria-keyshortcuts="Control+Y Control+Shift+Z Meta+Shift+Z"
            disabled={!canRedo}
            onClick={redo}
          >
            <Icon icon={redoIcon} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={text("tripSettings")}
            onClick={() => setSettingsOpen(true)}
          >
            <Icon icon={settingsIcon} />
          </button>
          <button
            type="button"
            className="icon-button danger-icon"
            aria-label={text("deleteTrip")}
            onClick={() => setDeleteOpen(true)}
          >
            <Icon icon={trashIcon} />
          </button>
          <button type="button" className="secondary-button" onClick={share}>
            <Icon icon={shareIcon} />
            {text("share")}
          </button>
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
                <span>{weekday(day.date, snapshot.language)}</span>
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
          <fieldset className="view-tabs">
            <legend>{text("plannerView")}</legend>
            <button
              type="button"
              aria-label={text("list")}
              title={text("list")}
              aria-pressed={view !== "map"}
              disabled={view === "list"}
              onClick={() => setView((current) => (current === "split" ? "map" : "split"))}
            >
              <Icon icon={listIcon} />
            </button>
            <button
              type="button"
              aria-label={text("map")}
              title={text("map")}
              aria-pressed={view !== "list"}
              disabled={view === "map"}
              onClick={() => setView((current) => (current === "split" ? "list" : "split"))}
            >
              <Icon icon={mapIcon} />
            </button>
          </fieldset>
        </div>

        <div
          className={`planner-body view-${view}${mapPlaceId ? " has-map-details" : ""}${selected ? " has-item-editor" : ""}`}
        >
          <section
            ref={itineraryRef}
            id="planner-itinerary"
            className="planner-panel"
            aria-label={text("itinerary")}
            aria-busy={navigationDay !== null}
            onScroll={trackVisibleDay}
            onWheelCapture={cancelDayJump}
            onPointerDownCapture={(event) => {
              if (event.target === event.currentTarget) cancelDayJump();
            }}
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
            <div className="mobile-sheet-handle" onPointerDown={resizeSheet}>
              <span />
            </div>
            <div className="planner-content-toolbar">
              <fieldset className="content-tabs">
                <legend>Planner content</legend>
                <button
                  type="button"
                  aria-pressed={plannerContent === "itinerary"}
                  onClick={() => changePlannerContent("itinerary")}
                >
                  <Icon icon={listIcon} />
                  Itinerary
                </button>
                <button
                  type="button"
                  aria-pressed={plannerContent === "calendar"}
                  onClick={() => changePlannerContent("calendar")}
                >
                  <Icon icon={calendarIcon} />
                  Calendar
                </button>
              </fieldset>
            </div>
            {plannerContent === "calendar" ? (
              <Calendar
                days={snapshot.days}
                orderedItems={orderedItems}
                legsByDay={routeLegs}
                places={placeViews}
                language={snapshot.language}
                calendarHours={snapshot.calendarHours}
                selectedId={selectedId}
                onSelect={(item) => selectItem(item.id, item.dayId ?? undefined)}
                onSelectDay={selectCalendarDay}
                onChangeItem={changeCalendarItem}
                onMoveNote={moveCalendarNote}
                onCloneItem={cloneCalendarItem}
                onChangeLodging={changeCalendarLodging}
              />
            ) : null}
            <div className={plannerContent === "calendar" ? "calendar-mobile-itinerary" : ""}>
              <ItineraryDragArea onDrop={applyDayDrop}>
                <div className="planner-days">
                  {dayPlans.map((plan, dayIndex) => {
                    const dateLabel = longDate(plan.day.date, snapshot.language);
                    const editing =
                      selected && selected.dayId !== null && editorDay === plan.day.id;
                    const rendered =
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
                        (leg) => leg.toId === firstVisibleRouteId && !ownedRouteIds.has(leg.fromId),
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
                              snapshot.language,
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
                                  snapshot.language,
                                  dayRoute.reason ?? "routes-unavailable",
                                )}
                              >
                                <Icon icon={routeIcon} />
                              </button>
                            )}
                            <button
                              type="button"
                              className="icon-button danger-icon"
                              aria-label={text("deleteDay", { date: dateLabel })}
                              disabled={snapshot.days.length <= 1}
                              onClick={() => removeDay(plan.day.id, itemCount)}
                            >
                              <Icon icon={calendarDeleteIcon} />
                            </button>
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
                        {creation?.dayId === plan.day.id ? (
                          <PlaceSearch
                            title={
                              creation.type === "place"
                                ? text("addPlace")
                                : creation.type === "reservation"
                                  ? text("addReservation")
                                  : text("addLodging")
                            }
                            bias={placeViews.get(snapshot.destination.placeId)}
                            onAdd={addPlace}
                            {...(creation.type === "reservation"
                              ? {
                                  schedule: {
                                    type: "reservation" as const,
                                    date: plan.day.date,
                                    startTime: creation.startTime,
                                    onStartTimeChange: (startTime: string) =>
                                      setCreation((current) =>
                                        current?.token === creation.token
                                          ? { ...current, startTime }
                                          : current,
                                      ),
                                  },
                                }
                              : creation.type === "lodging"
                                ? {
                                    schedule: {
                                      type: "lodging" as const,
                                      checkInDate: creation.checkInDate,
                                      checkOutDate: creation.checkOutDate,
                                      onCheckInDateChange: (checkInDate: string) =>
                                        setCreation((current) => {
                                          if (current?.token !== creation.token) return current;
                                          const checkOutDate =
                                            checkInDate && current.checkOutDate <= checkInDate
                                              ? Temporal.PlainDate.from(checkInDate)
                                                  .add({ days: 1 })
                                                  .toString()
                                              : current.checkOutDate;
                                          return { ...current, checkInDate, checkOutDate };
                                        }),
                                      onCheckOutDateChange: (checkOutDate: string) =>
                                        setCreation((current) =>
                                          current?.token === creation.token
                                            ? { ...current, checkOutDate }
                                            : current,
                                        ),
                                    },
                                  }
                                : {})}
                          />
                        ) : null}
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
                              items={plan.start}
                              order={dayOrder}
                              places={placeViews}
                              legs={dayLegs}
                              distanceUnit={snapshot.distanceUnit}
                              warnings={noWarnings}
                              selectedId={selectedId}
                              onSelect={(id) => selectItem(id, plan.day.id, "start")}
                              renderAfter={(item) => renderEditorAfter(item, plan.day.id, "start")}
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
                                  <div className="day-drop-target" />
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
                              places={placeViews}
                              order={dayOrder}
                              legs={dayLegs}
                              distanceUnit={snapshot.distanceUnit}
                              warnings={noWarnings}
                              selectedId={selectedId}
                              onSelect={(id) => selectItem(id, plan.day.id, "end")}
                              renderAfter={(item) => renderEditorAfter(item, plan.day.id, "end")}
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
          </section>
          <PanelResizer
            plannerRef={plannerRef}
            view={view}
            onToggle={() => setView((current) => (current === "map" ? "split" : "map"))}
          />
          <section className="map-panel" aria-label={text("map")}>
            {placeViewError ? <p className="map-error">{placeViewError}</p> : null}
            <Suspense
              fallback={
                <div className="map-shell">
                  <span className="spinner" />
                </div>
              }
            >
              <TripMap
                destination={placeViews.get(snapshot.destination.placeId)}
                transports={transports}
                stops={stops}
                routes={routeLegs}
                selectedId={selectedId}
                editingPlace={editingPlace}
                selectedPlaceId={mapPlaceId}
                mapPlacement={mapPlacement}
                onSelectPlace={(placeId) => {
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
              language: snapshot.language,
              distanceUnit: snapshot.distanceUnit,
              defaultTravelMode: snapshot.defaultTravelMode,
              calendarHours: snapshot.calendarHours,
            }}
            onClose={() => setSettingsOpen(false)}
            onSave={(settings) => {
              setTripSettings(document, settings);
              setSettingsOpen(false);
            }}
          />
        ) : null}
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
              <h2 id="display-name-title">{text("displayNameTitle")}</h2>
              <p>{text("displayNameBody")}</p>
              <label className="field">
                <span>{text("yourName")}</span>
                <input
                  required
                  maxLength={80}
                  placeholder={text("yourName")}
                  value={displayNamePrompt}
                  onChange={(event) => setDisplayNamePrompt(event.target.value)}
                />
              </label>
              <div>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={!displayNamePrompt.trim()}
                >
                  {text("continue")}
                </button>
              </div>
            </form>
          </div>
        ) : null}
        {shareOpen ? (
          <div className="dialog-backdrop">
            <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="share-title">
              <h2 id="share-title">{text("shareTitle")}</h2>
              <p>{text("shareBody")}</p>
              <div>
                <button type="button" className="ghost-button" onClick={() => setShareOpen(false)}>
                  {text("cancel")}
                </button>
                <button type="button" className="primary-button" onClick={confirmShare}>
                  {text("copyLink")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {deleteOpen ? (
          <div className="dialog-backdrop">
            <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
              <h2 id="delete-title">{text("deleteTripTitle")}</h2>
              <p>{text("deleteTripBody", { title })}</p>
              <input
                value={deleteText}
                onChange={(event) => setDeleteText(event.target.value)}
                aria-label={text("tripTitleConfirmation")}
              />
              <div>
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
            </div>
          </div>
        ) : null}
      </main>
    </TripLanguageProvider>
  );
}

function PanelResizer({
  plannerRef,
  view,
  onToggle,
}: {
  plannerRef: React.RefObject<HTMLElement | null>;
  view: ViewMode;
  onToggle: () => void;
}) {
  const text = useTripText();
  const [panelWidth, setPanelWidth] = useState(44);
  const panelWidthLive = useRef(panelWidth);
  const resizeFrame = useRef<number | null>(null);
  const clickSuppressed = useRef(false);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    pendingWidth: number | null;
    moved: boolean;
  } | null>(null);

  const applyWidth = (value: number) => {
    panelWidthLive.current = value;
    plannerRef.current?.style.setProperty("--panel-width", `${value}%`);
  };
  const flush = () => {
    if (resizeFrame.current !== null) {
      window.cancelAnimationFrame(resizeFrame.current);
      resizeFrame.current = null;
    }
    const activeDrag = drag.current;
    if (activeDrag?.pendingWidth === null || activeDrag?.pendingWidth === undefined) return;
    const width = activeDrag.pendingWidth;
    activeDrag.pendingWidth = null;
    applyWidth(width);
  };
  const commit = () => {
    flush();
    setPanelWidth(panelWidthLive.current);
  };
  const schedule = (width: number) => {
    const activeDrag = drag.current;
    if (!activeDrag) return;
    activeDrag.pendingWidth = width;
    if (resizeFrame.current !== null) return;
    resizeFrame.current = window.requestAnimationFrame(() => {
      resizeFrame.current = null;
      const latestDrag = drag.current;
      if (latestDrag?.pendingWidth === null || latestDrag?.pendingWidth === undefined) return;
      const pendingWidth = latestDrag.pendingWidth;
      latestDrag.pendingWidth = null;
      applyWidth(pendingWidth);
    });
  };

  useEffect(() => {
    plannerRef.current?.style.setProperty("--panel-width", `${panelWidth}%`);
  }, [panelWidth, plannerRef]);

  useEffect(
    () => () => {
      if (resizeFrame.current !== null) window.cancelAnimationFrame(resizeFrame.current);
    },
    [],
  );

  return (
    <button
      type="button"
      className="panel-resizer"
      aria-label={view === "map" ? text("showItinerary") : text("hideItinerary")}
      aria-expanded={view !== "map"}
      aria-controls="planner-itinerary"
      title={view === "map" ? text("showItinerary") : text("hideItineraryResize")}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        clickSuppressed.current = false;
        drag.current = null;
        if (view !== "split") return;
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: panelWidthLive.current,
          pendingWidth: null,
          moved: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const activeDrag = drag.current;
        if (!activeDrag || activeDrag.pointerId !== event.pointerId || event.buttons === 0) return;
        const delta = event.clientX - activeDrag.startX;
        if (!activeDrag.moved && Math.abs(delta) < 4) return;
        activeDrag.moved = true;
        schedule(Math.min(68, Math.max(30, activeDrag.startWidth + (delta / innerWidth) * 100)));
      }}
      onPointerUp={(event) => {
        const activeDrag = drag.current;
        if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        commit();
        clickSuppressed.current = activeDrag.moved;
        drag.current = null;
      }}
      onPointerCancel={(event) => {
        commit();
        drag.current = null;
        clickSuppressed.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onClick={() => {
        if (clickSuppressed.current) {
          clickSuppressed.current = false;
          return;
        }
        onToggle();
      }}
      onKeyDown={(event) => {
        if (view !== "split" || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
        event.preventDefault();
        const nextWidth = Math.max(
          30,
          Math.min(68, panelWidthLive.current + (event.key === "ArrowLeft" ? -2 : 2)),
        );
        panelWidthLive.current = nextWidth;
        setPanelWidth(nextWidth);
      }}
    >
      <Icon icon={view === "map" ? panelLeftOpenIcon : panelLeftCloseIcon} />
    </button>
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
function useStableArray<T>(next: T[], equal: (left: T, right: T) => boolean): T[] {
  const current = useRef(next);
  if (
    current.current.length !== next.length ||
    current.current.some((value, index) => {
      const candidate = next[index];
      return candidate === undefined || !equal(value, candidate);
    })
  ) {
    current.current = next;
  }
  return current.current;
}

function sameMapStop(left: MapStop, right: MapStop): boolean {
  return (
    left.id === right.id &&
    left.placeId === right.placeId &&
    left.label === right.label &&
    left.index === right.index &&
    left.latitude === right.latitude &&
    left.longitude === right.longitude &&
    left.color === right.color &&
    left.textColor === right.textColor &&
    left.travelMode === right.travelMode &&
    left.departureTime === right.departureTime &&
    left.breakBefore === right.breakBefore
  );
}

function sameMapTransport(left: MapTransport, right: MapTransport): boolean {
  return (
    left.id === right.id &&
    left.label === right.label &&
    left.color === right.color &&
    sameTransportPlace(left.from, right.from) &&
    sameTransportPlace(left.to, right.to)
  );
}

function sameTransportPlace(left: GooglePlaceView | null, right: GooglePlaceView | null): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.placeId === right.placeId &&
    left.displayName === right.displayName &&
    left.latitude === right.latitude &&
    left.longitude === right.longitude
  );
}

function buildMapStops(
  entries: Array<{ item: TripItem; key: string }>,
  places: ReadonlyMap<string, GooglePlaceView>,
  dayIds: string[],
  language: TripLanguage,
): MapStop[] {
  let stopIndex = 0;
  const text = createTripText(language);
  const stops: MapStop[] = [];
  const add = (item: TripItem, id: string, place: GooglePlaceView, label: string) => {
    stopIndex += 1;
    const palette = dayColor(Math.max(0, dayIds.indexOf(item.dayId ?? "")));
    stops.push({
      id,
      placeId: place.placeId,
      label,
      index: stopIndex,
      latitude: place.latitude,
      longitude: place.longitude,
      color: palette.background,
      textColor: palette.text,
      travelMode: item.travelMode,
    });
  };
  for (const { item, key } of entries) {
    if (item.type === "transport") {
      const from = item.transport?.from ? places.get(item.transport.from.placeId) : undefined;
      const to = item.transport?.to ? places.get(item.transport.to.placeId) : undefined;
      if (from) {
        add(item, `${key}:from`, from, from.displayName || item.title || text("transportOrigin"));
      }
      if (to) {
        add(item, `${key}:to`, to, to.displayName || item.title || text("transportDestination"));
      }
      continue;
    }
    if (!item.place) continue;
    const place = places.get(item.place.placeId);
    if (place) add(item, key, place, itemTitle(item, places));
  }
  return stops;
}

function buildRouteStops(
  entries: Array<{ item: TripItem; key: string }>,
  places: ReadonlyMap<string, GooglePlaceView>,
  days: TripDay[],
  routeDayId: string,
  language: TripLanguage,
  timeZone: string,
): MapStop[] {
  const palette = dayColor(
    Math.max(
      0,
      days.findIndex((day) => day.id === routeDayId),
    ),
  );
  const text = createTripText(language);
  const dateByDayId = new Map(days.map((day) => [day.id, day.date]));
  const routeDate = dateByDayId.get(routeDayId);
  const departureTime = (item: TripItem) => {
    if (!item.startTime) return null;
    const date = (item.dayId ? dateByDayId.get(item.dayId) : undefined) ?? routeDate;
    if (!date) return null;
    try {
      return resolveLocalTime(date, item.startTime, timeZone);
    } catch {
      return null;
    }
  };
  let stopIndex = 0;
  let breakBeforeNext = false;
  return entries.flatMap(({ item, key }) => {
    const itemDepartureTime = departureTime(item);
    const schedule = itemDepartureTime ? { departureTime: itemDepartureTime } : {};
    if (item.type === "transport") {
      const from = item.transport?.from ? places.get(item.transport.from.placeId) : undefined;
      const to = item.transport?.to ? places.get(item.transport.to.placeId) : undefined;
      const endpoints: MapStop[] = [];
      if (from) {
        stopIndex += 1;
        endpoints.push({
          id: key,
          placeId: from.placeId,
          label: from.displayName || item.title || text("transportOrigin"),
          index: stopIndex,
          latitude: from.latitude,
          longitude: from.longitude,
          color: palette.background,
          textColor: palette.text,
          travelMode: item.travelMode,
          breakBefore: breakBeforeNext,
          ...schedule,
        });
      }
      if (to) {
        stopIndex += 1;
        endpoints.push({
          id: `${key}:to`,
          placeId: to.placeId,
          label: to.displayName || item.title || text("transportDestination"),
          index: stopIndex,
          latitude: to.latitude,
          longitude: to.longitude,
          color: palette.background,
          textColor: palette.text,
          travelMode: item.travelMode,
          breakBefore: true,
          ...schedule,
        });
      }
      breakBeforeNext = !to;
      return endpoints;
    }
    if (!item.place) return [];
    const place = places.get(item.place.placeId);
    if (!place) return [];
    stopIndex += 1;
    const breakBefore = breakBeforeNext;
    breakBeforeNext = false;
    return [
      {
        id: key,
        breakBefore,
        placeId: item.place.placeId,
        label: itemTitle(item, places),
        index: stopIndex,
        latitude: place.latitude,
        longitude: place.longitude,
        color: palette.background,
        textColor: palette.text,
        travelMode: item.travelMode,
        ...schedule,
      },
    ];
  });
}

function buildScheduleWarnings(
  items: TripItem[],
  legs: RouteLeg[],
  date: string,
  defaultTimeZone: string,
  language: TripLanguage,
): Map<string, string[]> {
  const warnings = new Map<string, string[]>();
  const text = createTripText(language);
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
      add(item.id, text("invalidLocalTime"));
      continue;
    }
    if (previous?.startTime) {
      try {
        const previousEnd = epochMinute(previous) + (previous.durationMinutes ?? 0);
        if (previousEnd > itemMinute) add(item.id, text("overlapsItem", { title: previous.title }));
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
      if (arrival > epochMinute(to)) {
        add(to.id, text("travelCannotFinish", { title: from.title }));
      }
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
function calendarOrder(snapshot: TripSnapshot, changed: TripItem): string[] {
  const next = snapshot.order.filter((id) => id !== changed.id);
  const sameDay = next.filter((id) => snapshot.items[id]?.dayId === changed.dayId);
  const changedMinute = changed.startTime
    ? Number(changed.startTime.slice(0, 2)) * 60 + Number(changed.startTime.slice(3))
    : Number.POSITIVE_INFINITY;
  const before = sameDay.find((id) => {
    const item = snapshot.items[id];
    if (!item?.startTime) return false;
    const minute = Number(item.startTime.slice(0, 2)) * 60 + Number(item.startTime.slice(3));
    return minute > changedMinute;
  });
  const last = sameDay.at(-1);
  const insertion = before
    ? next.indexOf(before)
    : last
      ? next.indexOf(last) + 1
      : next.findIndex((id) => {
          const item = snapshot.items[id];
          if (!item?.dayId || !changed.dayId) return false;
          return item.dayId > changed.dayId;
        });
  next.splice(insertion < 0 ? next.length : insertion, 0, changed.id);
  return next;
}

function parseTime(time: string): number {
  const [hour = "0", minute = "0"] = time.split(":");
  return Number(hour) * 60 + Number(minute);
}

function formatTime(minutes: number): string {
  const bounded = Math.max(0, Math.min(23 * 60 + 59, minutes));
  return `${String(Math.floor(bounded / 60)).padStart(2, "0")}:${String(bounded % 60).padStart(2, "0")}`;
}

function placeReferences(item: TripItem): string[] {
  const ids: string[] = [];
  if (item.place) ids.push(item.place.placeId);
  if (item.transport?.from) ids.push(item.transport.from.placeId);
  if (item.transport?.to) ids.push(item.transport.to.placeId);
  return ids;
}
