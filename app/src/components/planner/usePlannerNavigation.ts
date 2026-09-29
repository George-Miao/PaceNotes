import {
  type Dispatch,
  type SetStateAction,
  startTransition,
  useEffect,
  useRef,
  useState,
} from "react";
import type { TripSnapshot } from "~/features/trip/model";
import type { ViewMode } from "./PanelResizer";

type NavigationOptions = {
  snapshot: Pick<TripSnapshot, "id" | "days">;
  view: ViewMode;
  setView: Dispatch<SetStateAction<ViewMode>>;
  closeEditor: () => void;
  cancelCreation: () => void;
};

export function usePlannerNavigation({
  snapshot,
  view,
  setView,
  closeEditor,
  cancelCreation,
}: NavigationOptions) {
  const [plannerContent, setPlannerContent] = useState<"itinerary" | "calendar" | "expenses">(
    "itinerary",
  );
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [navigationDay, setNavigationDay] = useState<string | null>(null);
  const [calendarFocusRequest, setCalendarFocusRequest] = useState<{
    dayId: string;
    serial: number;
  } | null>(null);
  const currentDay = navigationDay ?? activeDay;
  const mapDestinationDay = useRef<string | null>(null);
  const itineraryRef = useRef<HTMLDivElement>(null);
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
      setPlannerContent(value === "calendar" || value === "expenses" ? value : "itinerary");
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
    if (plannerContent !== "itinerary") return;
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
  }, [dayKey, plannerContent, snapshot.id]);

  const changePlannerContent = (content: "itinerary" | "calendar" | "expenses") => {
    if (view !== "map" && content === plannerContent) {
      setView("map");
      return;
    }
    const selectedDay = pendingJump.current ?? currentDay;
    if (content !== plannerContent) {
      clearJumpAnimation();
      clearJumpTimeout();
      if (pendingJump.current) setActiveDay(pendingJump.current);
      pendingJump.current = null;
      setNavigationDay(null);
    }
    const url = new URL(window.location.href);
    url.searchParams.set("view", content);
    window.history.replaceState(window.history.state, "", url);
    if (content === "calendar" && selectedDay) {
      setCalendarFocusRequest((request) => ({
        dayId: selectedDay,
        serial: (request?.serial ?? 0) + 1,
      }));
    }
    if (view === "map" || (content === "expenses" && plannerContent !== "expenses"))
      setView("split");
    setPlannerContent(content);
    if (plannerContent === "expenses" && content === "itinerary" && selectedDay) {
      pendingJump.current = selectedDay;
      setNavigationDay(selectedDay);
      jumpAnimation.current = window.requestAnimationFrame(() => {
        jumpAnimation.current = null;
        finishDayJump(selectedDay);
      });
    }
  };

  const selectCalendarDay = (id: string) => {
    setNavigationDay(null);
    setActiveDay(id);
    mapDestinationDay.current = id;
    const url = new URL(window.location.href);
    url.hash = id;
    window.history.replaceState(window.history.state, "", url);
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
  const resetDayJump = () => {
    clearJumpAnimation();
    clearJumpTimeout();
    pendingJump.current = null;
  };
  const trackVisibleDay = () => {
    if (plannerContent === "expenses") return;
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
  const jumpToDay = (id: string, openItinerary = false) => {
    closeEditor();
    setInboxActive(false);
    pendingInboxJump.current = false;
    mapDestinationDay.current = id;
    cancelCreation();
    if (plannerContent === "expenses") {
      selectCalendarDay(id);
      if (!openItinerary) return;
    }
    if (plannerContent === "calendar") {
      selectCalendarDay(id);
      setCalendarFocusRequest((request) => ({
        dayId: id,
        serial: (request?.serial ?? 0) + 1,
      }));
      return;
    }
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

  return {
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
  };
}
