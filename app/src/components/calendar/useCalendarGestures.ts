import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type CalendarSegment,
  type CalendarStay,
  calendarDayMinutes,
  snapCalendarMinute,
  timeForCalendarMinute,
} from "~/features/trip/calendar-layout";
import {
  type CalendarStartHour,
  type Lodging,
  lodgingForDates,
  type TripDay,
  type TripItem,
} from "~/features/trip/model";
import {
  clamp,
  isCalendarDropPoint,
  itemVersion,
  lodgingRangeForPointer,
  type CalendarPreview as Preview,
  pointerDelta,
  rectangleForPoints,
  rectanglesIntersect,
  type CalendarSelectionBox as SelectionBox,
} from "./calendar-coordinates";
import {
  type AdjustmentAction,
  adjustmentForItem,
  changesForItemGesture,
  type DragPointer,
  type ItemChange,
  type ItemGesture,
  itemGestureMembers,
  previewsForItemGesture,
} from "./calendar-item-gestures";

type PointerPosition = Pick<PointerEvent, "pointerId" | "clientX" | "clientY">;

type LodgingGesture = {
  type: "lodging";
  item: TripItem;
  edge: "move" | "start" | "end";
  active: boolean;
  pointer: LodgingPointer;
  pointerId: number;
  startX: number;
  startY: number;
  version: string;
  startScrollLeft: number;
};

type StayGesture = {
  type: "stay";
  item: TripItem;
  dayId: string;
  pointerId: number;
  startY: number;
  startMinute: number;
  version: string;
};

type SelectionGesture = {
  type: "selection";
  pointerId: number;
  startX: number;
  startY: number;
  baseIds: readonly string[];
};
type Gesture = ItemGesture | LodgingGesture | StayGesture | SelectionGesture;

type LodgingPreview = {
  item: TripItem;
  startDate: string;
  endDate: string;
};
type StayPreview = { key: string; endMinute: number };
type LodgingPointer = {
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  anchorX: number;
  guideY: number;
  clipLeft: number;
  clipRight: number;
};

type LongPress = {
  pointerId: number;
  startX: number;
  startY: number;
  timer: number;
};

type TimeGuide = {
  dayId: string;
  minute: number;
};

type CalendarGesturesInput = {
  days: readonly TripDay[];
  focusRequest: { dayId: string; serial: number } | null;
  orderedItems: readonly TripItem[];
  layout: readonly { segments: readonly CalendarSegment[] }[];
  calendarStartHour: CalendarStartHour;
  selectedId: string | null;
  onClearSelection: () => void;
  onChangeItem: (change: ItemChange) => { clamped: boolean };
  onChangeItems: (changes: readonly ItemChange[]) => { clamped: boolean };
  onChangeLodging: (item: TripItem, lodging: Lodging) => { clamped: boolean };
  onCloseMenu: () => void;
  onLongPressItem: (segment: CalendarSegment, x: number, y: number) => void;
};

export function useCalendarGestures({
  days,
  focusRequest,
  orderedItems,
  layout,
  calendarStartHour,
  selectedId,
  onClearSelection,
  onChangeItem,
  onChangeItems,
  onChangeLodging,
  onCloseMenu,
  onLongPressItem,
}: CalendarGesturesInput) {
  const scroller = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [groupPreviews, setGroupPreviews] = useState<readonly Preview[]>([]);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(selectedId ? [selectedId] : []),
  );
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [limitMessage, setLimitMessage] = useState("");
  const [dragPointer, setDragPointer] = useState<DragPointer | null>(null);
  const longPress = useRef<LongPress | null>(null);
  const suppressItemClick = useRef(false);
  const lastPointer = useRef<PointerPosition | null>(null);
  const [lodgingPreview, setLodgingPreview] = useState<LodgingPreview | null>(null);
  const [lodgingPointer, setLodgingPointer] = useState<LodgingPointer | null>(null);
  const [stayPreview, setStayPreview] = useState<StayPreview | null>(null);
  const [timeGuide, setTimeGuide] = useState<TimeGuide | null>(null);
  const dayIndex = useMemo(() => new Map(days.map((day, index) => [day.id, index])), [days]);
  const itemVersions = useMemo(
    () => new Map(orderedItems.map((item) => [item.id, itemVersion(item)])),
    [orderedItems],
  );
  const itemDragging =
    ((gesture?.type === "item" || gesture?.type === "lodging") &&
      gesture.active &&
      gesture.edge === "move") ??
    false;

  useEffect(
    () => () => {
      if (longPress.current) window.clearTimeout(longPress.current.timer);
    },
    [],
  );
  useEffect(() => {
    if (!itemDragging) return;
    document.documentElement.dataset.calendarDragging = "";
    return () => {
      delete document.documentElement.dataset.calendarDragging;
    };
  }, [itemDragging]);

  useEffect(() => {
    setSelectedIds(selectedId ? new Set([selectedId]) : new Set());
  }, [selectedId]);

  useEffect(() => {
    if (!focusRequest) return;
    const frame = window.requestAnimationFrame(() => {
      const container = scroller.current;
      const header = Array.from(
        container?.querySelectorAll<HTMLElement>("[data-calendar-day-header]") ?? [],
      ).find((element) => element.dataset.calendarDayHeader === focusRequest.dayId);
      if (!container || !header) return;
      const left = clamp(
        header.offsetLeft - (container.clientWidth - header.offsetWidth) / 2,
        0,
        container.scrollWidth - container.clientWidth,
      );
      container.scrollTo({ left, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest]);

  useEffect(() => {
    if (!gesture || gesture.type === "selection") return;
    const changed =
      gesture.type === "item"
        ? gesture.members.some((member) => itemVersions.get(member.item.id) !== member.version)
        : itemVersions.get(gesture.item.id) !== gesture.version;
    if (!changed) return;
    setGesture(null);
    setPreview(null);
    setGroupPreviews([]);
    setDragPointer(null);
    setLimitMessage("This item changed in another editor. Your local gesture was canceled.");
    setLodgingPreview(null);
    setStayPreview(null);
    setLodgingPointer(null);
  }, [gesture, itemVersions]);

  useEffect(() => {
    const update = (event: PointerPosition) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      if (gesture.type === "selection") {
        const box = rectangleForPoints(
          gesture.startX,
          gesture.startY,
          event.clientX,
          event.clientY,
        );
        setSelectionBox(box);
        const selected = new Set(gesture.baseIds);
        for (const element of scroller.current?.querySelectorAll<HTMLElement>(
          "[data-calendar-item-id]",
        ) ?? []) {
          if (rectanglesIntersect(box, element.getBoundingClientRect())) {
            const id = element.dataset.calendarItemId;
            if (id) selected.add(id);
          }
        }
        setSelectedIds(selected);
        return;
      }
      const pending = longPress.current;
      if (
        pending?.pointerId === event.pointerId &&
        Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY) > 8
      ) {
        window.clearTimeout(pending.timer);
        longPress.current = null;
      }
      if (gesture.type === "stay") {
        const track = scroller.current?.querySelector<HTMLElement>("[data-calendar-track]");
        if (!track) return;
        const pixelsPerHour = track.getBoundingClientRect().height / (calendarDayMinutes / 60);
        const minuteDelta = ((event.clientY - gesture.startY) / pixelsPerHour) * 60;
        setStayPreview({
          key: `${gesture.item.id}:${gesture.dayId}`,
          endMinute: clamp(
            snapCalendarMinute(gesture.startMinute + minuteDelta),
            0,
            calendarDayMinutes,
          ),
        });
        return;
      }
      if (gesture.type === "lodging") {
        const moved =
          Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 4;
        if (gesture.edge === "move" && !gesture.active && !moved) return;
        if (gesture.edge === "move" && !gesture.active) {
          suppressItemClick.current = true;
          setGesture({ ...gesture, active: true });
          setLodgingPreview({
            item: gesture.item,
            startDate: gesture.item.lodging?.startDate ?? "",
            endDate: gesture.item.lodging?.endDate ?? "",
          });
        }
        const range = lodgingRangeForPointer(gesture, event.clientX, scroller.current, days);
        if (range) setLodgingPreview({ item: gesture.item, ...range });
        setLodgingPointer({
          ...gesture.pointer,
          x:
            gesture.edge === "move"
              ? event.clientX
              : clamp(event.clientX, gesture.pointer.clipLeft, gesture.pointer.clipRight),
          y: gesture.edge === "move" ? event.clientY : gesture.pointer.y,
        });
        return;
      }
      const moved =
        gesture.type === "item" &&
        Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 4;
      if (gesture.type === "item" && gesture.edge === "move" && !gesture.active && !moved) return;
      if (gesture.type === "item" && gesture.edge === "move" && !gesture.active) {
        setGesture({ ...gesture, active: true });
      }
      if (moved) suppressItemClick.current = true;
      if (gesture.edge === "move") {
        setDragPointer(
          gesture.dragBox ? { ...gesture.dragBox, x: event.clientX, y: event.clientY } : null,
        );
      }
      const next = previewsForItemGesture(
        gesture,
        pointerDelta(scroller.current, event, gesture),
        days,
        calendarStartHour,
      );
      setPreview(next.primary);
      setGroupPreviews(next.group);
    };
    const move = (event: PointerEvent) => {
      lastPointer.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      update(event);
    };
    const finish = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      lastPointer.current = null;
      if (gesture.type === "selection") {
        setGesture(null);
        setSelectionBox(null);
        return;
      }
      const pending = longPress.current;
      if (pending?.pointerId === event.pointerId) {
        window.clearTimeout(pending.timer);
        longPress.current = null;
      }
      if (suppressItemClick.current) {
        window.setTimeout(() => {
          suppressItemClick.current = false;
        }, 0);
      }
      if (gesture.type === "item") {
        const validDrop = gesture.edge !== "move" || isCalendarDropPoint(scroller.current, event);
        const nextPreviews =
          gesture.edge === "move" && groupPreviews.length > 0
            ? groupPreviews
            : preview
              ? [preview]
              : [];
        setGesture(null);
        setPreview(null);
        setGroupPreviews([]);
        setDragPointer(null);
        if (nextPreviews.length === 0) return;
        if (!validDrop) return;
        const changes = changesForItemGesture(
          gesture,
          nextPreviews,
          dayIndex,
          days,
          layout,
          calendarStartHour,
        );
        const result =
          changes.length > 1
            ? onChangeItems(changes)
            : changes[0]
              ? onChangeItem(changes[0])
              : null;
        if (result?.clamped) {
          setLimitMessage("The items end at the 30-day trip limit.");
        }
        return;
      }
      if (gesture.type === "stay") {
        const nextMinute =
          stayPreview?.key === `${gesture.item.id}:${gesture.dayId}`
            ? stayPreview.endMinute
            : gesture.startMinute;
        setGesture(null);
        setStayPreview(null);
        const lodging = gesture.item.lodging;
        if (!lodging || nextMinute === gesture.startMinute) return;
        onChangeLodging(gesture.item, {
          ...lodging,
          leaveTimes: {
            ...lodging.leaveTimes,
            [gesture.dayId]: timeForCalendarMinute(nextMinute, calendarStartHour),
          },
        });
        return;
      }
      const validDrop =
        gesture.edge !== "move" || isCalendarDropPoint(scroller.current, event, true);
      const next = validDrop
        ? lodgingRangeForPointer(gesture, event.clientX, scroller.current, days)
        : null;
      setGesture(null);
      setLodgingPreview(null);
      setLodgingPointer(null);
      if (!next) return;
      const sourceLodging = gesture.item.lodging;
      if (
        sourceLodging &&
        next.startDate === sourceLodging.startDate &&
        next.endDate === sourceLodging.endDate
      )
        return;
      const result = onChangeLodging(
        gesture.item,
        lodgingForDates(next.startDate, next.endDate, sourceLodging?.leaveTimes),
      );
      if (result.clamped) {
        setLimitMessage("The stay ends at the 30-day trip limit.");
      }
    };
    window.addEventListener("pointermove", move);
    const replay = () => {
      if (lastPointer.current) update(lastPointer.current);
    };
    const container = scroller.current;
    container?.addEventListener("scroll", replay, { passive: true });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      container?.removeEventListener("scroll", replay);
      window.removeEventListener("pointercancel", finish);
    };
  }, [
    calendarStartHour,
    dayIndex,
    days,
    gesture,
    layout,
    groupPreviews,
    onChangeItem,
    onChangeItems,
    onChangeLodging,
    preview,
    stayPreview,
  ]);

  const beginItemGesture = (
    event: ReactPointerEvent,
    segment: CalendarSegment,
    edge: ItemGesture["edge"],
  ) => {
    if ((edge === "start" && segment.continuesBefore) || (edge === "end" && segment.continuesAfter))
      return;
    event.preventDefault();
    const selectedItems =
      edge === "move" && selectedIds.has(segment.item.id)
        ? orderedItems.filter(
            (item) =>
              selectedIds.has(item.id) &&
              item.type !== "note" &&
              item.type !== "lodging" &&
              item.dayId &&
              (item.id === segment.item.id || item.startTime),
          )
        : [segment.item];
    const members = itemGestureMembers(selectedItems, segment, dayIndex, calendarStartHour);
    const primary = members.find((member) => member.item.id === segment.item.id);
    if (!primary) return;
    if (edge === "move" && !selectedIds.has(segment.item.id) && !event.ctrlKey && !event.metaKey) {
      setSelectedIds(new Set([segment.item.id]));
    }
    setLimitMessage("");
    onCloseMenu();
    setGroupPreviews([]);
    const bounds = event.currentTarget
      .closest<HTMLElement>("[data-calendar-item-id]")
      ?.getBoundingClientRect();
    setDragPointer(null);
    setGesture({
      type: "item",
      item: segment.item,
      edge,
      active: edge !== "move",
      dragBox:
        edge === "move" && bounds
          ? {
              offsetX: event.clientX - bounds.left,
              offsetY: event.clientY - bounds.top,
              width: bounds.width,
              height: bounds.height,
            }
          : null,
      pointerId: event.pointerId,
      startScrollLeft: scroller.current?.scrollLeft ?? 0,
      startScrollTop: scroller.current?.scrollTop ?? 0,
      startX: event.clientX,
      startY: event.clientY,
      startAbsolute: primary.startAbsolute,
      endAbsolute: primary.endAbsolute,
      members,
    });
  };

  const beginItemInteraction = (event: ReactPointerEvent, segment: CalendarSegment) => {
    suppressItemClick.current = false;
    if (event.pointerType !== "mouse") {
      if (longPress.current) window.clearTimeout(longPress.current.timer);
      const pointerId = event.pointerId;
      const x = event.clientX;
      const y = event.clientY;
      const timer = window.setTimeout(() => {
        if (longPress.current?.pointerId !== pointerId) return;
        longPress.current = null;
        onLongPressItem(segment, x, y);
      }, 500);
      longPress.current = {
        pointerId,
        startX: x,
        startY: y,
        timer,
      };
    }
    beginItemGesture(event, segment, "move");
  };

  const beginSelection = (event: ReactPointerEvent<HTMLFieldSetElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.preventDefault();
    const baseIds = event.ctrlKey || event.metaKey ? [...selectedIds] : [];
    if (baseIds.length === 0) {
      setSelectedIds(new Set());
      onClearSelection();
    }
    onCloseMenu();
    setPreview(null);
    setGroupPreviews([]);
    setSelectionBox({ left: event.clientX, top: event.clientY, width: 0, height: 0 });
    setGesture({
      type: "selection",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseIds,
    });
  };

  const startLodging = (event: ReactPointerEvent, item: TripItem, edge: LodgingGesture["edge"]) => {
    if (edge === "move") suppressItemClick.current = false;
    if (event.button !== 0 || !item.lodging) return;
    event.preventDefault();
    event.stopPropagation();
    const block = event.currentTarget
      .closest<HTMLElement>("[data-calendar-lodging-id]")
      ?.getBoundingClientRect();
    if (!block) return;
    const root = event.currentTarget.closest<HTMLElement>("[data-trip-calendar]");
    const calendarBounds = root?.getBoundingClientRect();
    const segments = Array.from(
      root?.querySelectorAll<HTMLElement>("[data-calendar-lodging-id]") ?? [],
    ).filter((segment) => segment.dataset.calendarLodgingId === item.id);
    onCloseMenu();
    const anchorX =
      edge === "start"
        ? Math.max(...segments.map((segment) => segment.getBoundingClientRect().right))
        : Math.min(...segments.map((segment) => segment.getBoundingClientRect().left));
    setLimitMessage("");
    setPreview(null);
    setDragPointer(null);
    const pointer = {
      x: event.clientX,
      y: event.clientY,
      offsetX: event.clientX - block.left,
      offsetY: event.clientY - block.top,
      width: block.width,
      height: block.height,
      anchorX,
      guideY: block.bottom,
      clipLeft: calendarBounds?.left ?? 0,
      clipRight: calendarBounds?.right ?? window.innerWidth,
    };
    const active = edge !== "move";
    setLodgingPreview(
      active ? { item, startDate: item.lodging.startDate, endDate: item.lodging.endDate } : null,
    );
    setLodgingPointer(active ? pointer : null);
    setGesture({
      type: "lodging",
      item,
      edge,
      startScrollLeft: scroller.current?.scrollLeft ?? 0,
      pointerId: event.pointerId,
      active,
      pointer,
      startX: event.clientX,
      startY: event.clientY,
      version: itemVersion(item),
    });
  };

  const startStay = (event: ReactPointerEvent, stay: CalendarStay) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onCloseMenu();
    setLimitMessage("");
    setSelectedIds(new Set([stay.item.id]));
    setStayPreview({ key: stay.key, endMinute: stay.endMinute });
    setGesture({
      type: "stay",
      item: stay.item,
      dayId: stay.dayId,
      pointerId: event.pointerId,
      startY: event.clientY,
      startMinute: stay.endMinute,
      version: itemVersion(stay.item),
    });
  };

  const adjustItem = (segment: CalendarSegment, action: AdjustmentAction) => {
    const change = adjustmentForItem(segment, action, dayIndex, days, calendarStartHour);
    if (!change) return;
    const result = onChangeItem(change);
    setLimitMessage(result.clamped ? "The item ends at the 30-day trip limit." : "");
  };

  const handleItemKey = (event: ReactKeyboardEvent<HTMLElement>, segment: CalendarSegment) => {
    if (event.target !== event.currentTarget) return;
    const action =
      event.key === "ArrowLeft"
        ? "previous-day"
        : event.key === "ArrowRight"
          ? "next-day"
          : event.key === "ArrowUp" && event.shiftKey
            ? "shorter"
            : event.key === "ArrowDown" && event.shiftKey
              ? "longer"
              : event.key === "ArrowUp"
                ? "earlier"
                : event.key === "ArrowDown"
                  ? "later"
                  : null;
    if (!action) return;
    event.preventDefault();
    adjustItem(segment, action);
  };

  const updateTimeGuide = (event: ReactPointerEvent<HTMLElement>, dayId: string) => {
    if (event.pointerType === "touch" || gesture) {
      setTimeGuide(null);
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const minute = clamp(
      Math.round(((event.clientY - bounds.top) / bounds.height) * calendarDayMinutes),
      0,
      calendarDayMinutes - 1,
    );
    setTimeGuide((current) =>
      current?.dayId === dayId && current.minute === minute ? current : { dayId, minute },
    );
  };
  const clearTimeGuide = (dayId: string) => {
    setTimeGuide((current) => (current?.dayId === dayId ? null : current));
  };

  const dismissForMenu = () => {
    if (longPress.current) {
      window.clearTimeout(longPress.current.timer);
      longPress.current = null;
    }
    setGesture(null);
    setPreview(null);
    setDragPointer(null);
  };
  const consumeSuppressedClick = () => {
    if (!suppressItemClick.current) return false;
    suppressItemClick.current = false;
    return true;
  };
  const selectItem = (itemId: string) => setSelectedIds(new Set([itemId]));
  const toggleItem = (itemId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
    if (selectedId === itemId) onClearSelection();
  };

  return {
    scroller,
    gesture,
    preview,
    groupPreviews,
    selectedIds,
    selectionBox,
    limitMessage,
    dragPointer,
    lodgingPreview,
    lodgingPointer,
    stayPreview,
    timeGuide,
    beginItemGesture,
    beginItemInteraction,
    beginSelection,
    startLodging,
    startStay,
    adjustItem,
    handleItemKey,
    updateTimeGuide,
    clearTimeGuide,
    dismissForMenu,
    consumeSuppressedClick,
    selectItem,
    toggleItem,
  };
}
