import { Icon } from "@iconify/react";
import panelLeftCloseIcon from "@iconify-icons/lucide/panel-left-close";
import panelLeftOpenIcon from "@iconify-icons/lucide/panel-left-open";
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { useTripText } from "~/features/trip/language";

export type ViewMode = "map" | "list" | "split";

export function useSheetResize(setView: Dispatch<SetStateAction<ViewMode>>) {
  const [sheetHeight, setSheetHeight] = useState(48);
  const resizeSheet = (event: React.PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const pointerId = event.pointerId;
    const startY = event.clientY;
    const startHeight = sheetHeight;
    let moved = false;
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      if (Math.abs(pointer.clientY - startY) > 4) moved = true;
      setSheetHeight(
        Math.min(82, Math.max(22, startHeight + ((startY - pointer.clientY) / innerHeight) * 100)),
      );
    };
    const stop = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      if (!moved && pointer.type === "pointerup") setView("map");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };
  return { sheetHeight, resizeSheet };
}

export function PanelResizer({
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
