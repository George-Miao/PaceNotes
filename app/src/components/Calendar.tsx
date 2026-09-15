import { Icon } from "@iconify/react";
import bedDoubleIcon from "@iconify-icons/lucide/bed-double";
import stickyNoteIcon from "@iconify-icons/lucide/sticky-note";
import triangleAlertIcon from "@iconify-icons/lucide/triangle-alert";
import {
  Fragment,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { GooglePlaceView } from "~/features/google/google";
import { itemTitle } from "~/features/google/item-title";
import type { RouteLeg } from "~/features/routing/route-legs";
import {
  buildCalendarLayout,
  buildCalendarLodgingLayout,
  type CalendarSegment,
  type CalendarStay,
  calendarDayMinutes,
  calendarMinimumMinutes,
  calendarMinuteForTime,
  calendarSnapMinutes,
  rollingTimeForCalendarMinute,
  snapCalendarMinute,
  timeForCalendarMinute,
} from "~/features/trip/calendar-layout";
import { createTripText, formatTravelDuration, travelModeLabel } from "~/features/trip/language";
import {
  type CalendarStartHour,
  type Lodging,
  lodgingForDates,
  type TripDay,
  type TripItem,
  type TripLanguage,
} from "~/features/trip/model";
import styles from "./Calendar.module.css";
import { CalendarHourLines } from "./CalendarHourLines";
import {
  type CalendarAddType,
  type CalendarMenuState,
  CalendarMenus,
  type CalendarItemAction as ItemAction,
  type CalendarMenuPosition as MenuPosition,
} from "./CalendarMenus";
import {
  addDays,
  clamp,
  clippedLodgingGuide,
  daysBetween,
  formatDay,
  isCalendarDropPoint,
  itemVersion,
  lodgingRangeForPointer,
  minutePercent,
  type CalendarPreview as Preview,
  pointerDelta,
  previewForAbsolute,
  rectangleForPoints,
  rectanglesIntersect,
  type CalendarSelectionBox as SelectionBox,
} from "./calendar-coordinates";
import { iconForItem, iconForTravelMode } from "./item-icon";

type ItemChange = {
  item: TripItem;
  dayId: string;
  startTime: string | null;
  durationMinutes: number;
  orderBeforeId?: string | null;
  extendThrough?: string;
};

type ItemGestureMember = {
  item: TripItem;
  startAbsolute: number;
  endAbsolute: number;
  version: string;
};
type PointerPosition = Pick<PointerEvent, "pointerId" | "clientX" | "clientY">;

type ItemGesture = {
  type: "item";
  item: TripItem;
  edge: "move" | "start" | "end";
  active: boolean;
  dragBox: Omit<DragPointer, "x" | "y"> | null;
  pointerId: number;
  startX: number;
  startY: number;
  startScrollLeft: number;
  startScrollTop: number;
  startAbsolute: number;
  endAbsolute: number;
  members: readonly ItemGestureMember[];
};

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

type DragPointer = {
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};
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

type AdjustmentAction = Exclude<
  ItemAction,
  "move-up" | "move-down" | "flexible" | "duplicate" | "edit" | "delete"
>;
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
type CalendarTrackGeometry = {
  height: number;
  origin: number;
  devicePixelRatio: number;
};

function deviceAlignedMinutePosition(
  minute: number,
  geometry: CalendarTrackGeometry | null,
): string {
  if (!geometry) return minutePercent(minute);
  const rawPosition = geometry.origin + (geometry.height * minute) / calendarDayMinutes;
  const alignedPosition =
    Math.round(rawPosition * geometry.devicePixelRatio) / geometry.devicePixelRatio -
    geometry.origin;
  return `${alignedPosition}px`;
}

export function Calendar({
  days,
  orderedItems,
  legsByDay,
  places,
  language,
  selectedId,
  calendarStartHour,
  editor,
  creationPanel,
  focusRequest,
  onSelect,
  onChangeItem,
  onMoveNote,
  onClearSelection,
  onChangeLodging,
  onChangeItems,
  onDuplicateItem,
  canReorderItem,
  onReorderItem,
  onDeleteItem,
  onMakeFlexible,
  onAddItem,
}: {
  days: readonly TripDay[];
  orderedItems: readonly TripItem[];
  legsByDay: ReadonlyMap<string, readonly RouteLeg[]>;
  places: ReadonlyMap<string, GooglePlaceView>;
  language: TripLanguage;
  calendarStartHour: CalendarStartHour;
  editor: ReactNode;
  creationPanel: ReactNode;
  focusRequest: { dayId: string; serial: number } | null;
  selectedId: string | null;
  onSelect: (item: TripItem, dayId?: string) => void;
  onChangeItem: (change: ItemChange) => { clamped: boolean };
  onMoveNote: (noteId: string, dayId: string, afterItemId: string | null) => void;
  onChangeLodging: (item: TripItem, lodging: Lodging) => { clamped: boolean };
  onClearSelection: () => void;
  onChangeItems: (changes: readonly ItemChange[]) => { clamped: boolean };
  canReorderItem: (item: TripItem, delta: -1 | 1) => boolean;
  onReorderItem: (item: TripItem, delta: -1 | 1) => void;
  onDuplicateItem: (item: TripItem) => void;
  onDeleteItem: (item: TripItem) => void;
  onMakeFlexible: (item: TripItem) => void;
  onAddItem: (
    type: CalendarAddType,
    dayId: string,
    startTime: string | null,
    position: MenuPosition,
  ) => void;
}) {
  const text = createTripText(language);
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
  const [calendarMenu, setCalendarMenu] = useState<CalendarMenuState | null>(null);
  const [creationPosition, setCreationPosition] = useState<MenuPosition | null>(null);
  const [lodgingPreview, setLodgingPreview] = useState<LodgingPreview | null>(null);
  const [lodgingPointer, setLodgingPointer] = useState<LodgingPointer | null>(null);
  const [stayPreview, setStayPreview] = useState<StayPreview | null>(null);
  const [timeGuide, setTimeGuide] = useState<TimeGuide | null>(null);
  const [trackGeometry, setTrackGeometry] = useState<CalendarTrackGeometry | null>(null);
  const updateTrackGeometry = useCallback(
    (height: number, origin: number, devicePixelRatio: number) => {
      setTrackGeometry((current) =>
        current?.height === height &&
        current.origin === origin &&
        current.devicePixelRatio === devicePixelRatio
          ? current
          : { height, origin, devicePixelRatio },
      );
    },
    [],
  );
  const hourLabels = useMemo(
    () =>
      Array.from({ length: 25 }, (_, index) =>
        rollingTimeForCalendarMinute(index * 60, calendarStartHour),
      ),
    [calendarStartHour],
  );
  const dayIndex = useMemo(() => new Map(days.map((day, index) => [day.id, index])), [days]);
  const activePreviews = useMemo(
    () => (groupPreviews.length > 0 ? groupPreviews : preview ? [preview] : []),
    [groupPreviews, preview],
  );
  const previewById = useMemo(
    () => new Map(activePreviews.map((candidate) => [candidate.itemId, candidate])),
    [activePreviews],
  );
  const effectiveItems = useMemo(
    () =>
      activePreviews.length > 0
        ? orderedItems.map((item) => {
            const itemPreview = previewById.get(item.id);
            return itemPreview
              ? {
                  ...item,
                  dayId: itemPreview.dayId,
                  startTime: itemPreview.startTime,
                  durationMinutes: itemPreview.durationMinutes,
                }
              : item;
          })
        : orderedItems,
    [activePreviews, orderedItems, previewById],
  );
  const layout = useMemo(
    () => buildCalendarLayout(days, orderedItems, legsByDay, calendarStartHour),
    [calendarStartHour, days, legsByDay, orderedItems],
  );
  const previewSegmentsByDay = useMemo(() => {
    const previewIds = new Set(activePreviews.map((candidate) => candidate.itemId));
    return new Map(
      (activePreviews.length > 0
        ? buildCalendarLayout(days, effectiveItems, legsByDay, calendarStartHour)
        : []
      ).map((column) => [
        column.day.id,
        column.segments.filter((segment) => previewIds.has(segment.item.id)),
      ]),
    );
  }, [activePreviews, calendarStartHour, days, effectiveItems, legsByDay]);
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
    if (!creationPanel) setCreationPosition(null);
  }, [creationPanel]);

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
      const { dayDelta, minuteDelta } = pointerDelta(scroller.current, event, gesture);
      const maximum = days.length * calendarDayMinutes;
      let start = gesture.startAbsolute;
      let end = gesture.endAbsolute;
      if (gesture.edge === "move") {
        const earliest = Math.min(...gesture.members.map((member) => member.startAbsolute));
        const latestEnd = Math.max(...gesture.members.map((member) => member.endAbsolute));
        const delta = clamp(
          dayDelta * calendarDayMinutes + minuteDelta,
          -earliest,
          maximum - latestEnd,
        );
        const previews = gesture.members.flatMap((member) => {
          const next = previewForAbsolute(
            member.item.id,
            member.startAbsolute + delta,
            member.endAbsolute + delta,
            days,
            calendarStartHour,
          );
          return next ? [next] : [];
        });
        setGroupPreviews(previews);
        setPreview(previews.find((candidate) => candidate.itemId === gesture.item.id) ?? null);
        return;
      }
      if (gesture.edge === "start") {
        start = clamp(
          gesture.startAbsolute + dayDelta * calendarDayMinutes + minuteDelta,
          0,
          gesture.endAbsolute - calendarMinimumMinutes,
        );
      } else {
        end = Math.max(
          gesture.startAbsolute + calendarMinimumMinutes,
          gesture.endAbsolute + dayDelta * calendarDayMinutes + minuteDelta,
        );
      }
      setPreview(previewForAbsolute(gesture.item.id, start, end, days, calendarStartHour));
      setGroupPreviews([]);
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
        const movingIds = new Set(nextPreviews.map((next) => next.itemId));
        const changes = nextPreviews.flatMap((next) => {
          const member = gesture.members.find((candidate) => candidate.item.id === next.itemId);
          if (!member) return [];
          const startIndex =
            dayIndex.get(next.dayId) ?? (days[0] ? daysBetween(days[0].date, next.dayId) : 0);
          const nextStart =
            startIndex * calendarDayMinutes +
            calendarMinuteForTime(next.startTime, calendarStartHour);
          const finalMinute = nextStart + next.durationMinutes;
          if (nextStart === member.startAbsolute && finalMinute === member.endAbsolute) return [];
          const finalIndex = Math.max(0, Math.ceil(finalMinute / calendarDayMinutes) - 1);
          const lastKnown = days.at(-1)?.date;
          const extendThrough =
            finalIndex >= days.length && lastKnown
              ? addDays(lastKnown, finalIndex - days.length + 1)
              : undefined;
          return [
            {
              item: member.item,
              dayId: next.dayId,
              startTime: gesture.edge === "end" ? member.item.startTime : next.startTime,
              orderBeforeId:
                layout[startIndex]?.segments.find(
                  (segment) =>
                    segment.item.dayId === next.dayId &&
                    !movingIds.has(segment.item.id) &&
                    segment.startMinute > calendarMinuteForTime(next.startTime, calendarStartHour),
                )?.item.id ?? null,
              durationMinutes: next.durationMinutes,
              ...(extendThrough ? { extendThrough } : {}),
            },
          ];
        });
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

  const menuPosition = (x: number, y: number): MenuPosition => {
    const width = Math.min(272, window.innerWidth - 8);
    return {
      left: clamp(x, 4, window.innerWidth - width - 4),
      top: clamp(y, 4, window.innerHeight - 360),
    };
  };
  const creationPopoverPosition = ({ left, top }: MenuPosition): MenuPosition => {
    const width = Math.min(384, window.innerWidth - 8);
    const height = Math.min(480, window.innerHeight - 8);
    return {
      left: clamp(left, 4, window.innerWidth - width - 4),
      top: clamp(top, 4, window.innerHeight - height - 4),
    };
  };

  const openItemActions = (segment: CalendarSegment, x: number, y: number, focusFirst = false) => {
    if (longPress.current) {
      window.clearTimeout(longPress.current.timer);
      longPress.current = null;
    }
    setGesture(null);
    setPreview(null);
    setDragPointer(null);
    setCreationPosition(null);
    setCalendarMenu({ type: "item", segment, position: menuPosition(x, y), focusFirst });
  };
  const openLodgingActions = (item: TripItem, event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (longPress.current) {
      window.clearTimeout(longPress.current.timer);
      longPress.current = null;
    }
    setGesture(null);
    setPreview(null);
    setDragPointer(null);
    setCreationPosition(null);
    setCalendarMenu({
      type: "lodging",
      item,
      position: menuPosition(event.clientX, event.clientY),
      focusFirst: event.button !== 2,
    });
  };
  const openAddActions = (
    type: "all-day" | "empty",
    dayId: string,
    startTime: string,
    x: number,
    y: number,
    focusFirst = false,
  ) => {
    setCreationPosition(null);
    const position = menuPosition(x, y);
    setCalendarMenu(
      type === "empty"
        ? { type, dayId, startTime, position, focusFirst }
        : { type, dayId, position, focusFirst },
    );
  };

  const addItem = (
    type: CalendarAddType,
    dayId: string,
    startTime: string | null,
    position: MenuPosition,
  ) => {
    setCalendarMenu(null);
    if (type === "transport") setCreationPosition(null);
    else setCreationPosition(creationPopoverPosition(position));
    onAddItem(type, dayId, startTime, position);
  };

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
    const members = selectedItems.map((item) => {
      const itemDay = dayIndex.get(item.dayId ?? "") ?? 0;
      const startAbsolute =
        itemDay * calendarDayMinutes +
        calendarMinuteForTime(
          item.startTime ??
            (item.id === segment.item.id
              ? timeForCalendarMinute(segment.startMinute, calendarStartHour)
              : "08:00"),
          calendarStartHour,
        );
      return {
        item,
        startAbsolute,
        endAbsolute: startAbsolute + Math.max(calendarMinimumMinutes, item.durationMinutes || 60),
        version: itemVersion(item),
      };
    });
    const primary = members.find((member) => member.item.id === segment.item.id);
    if (!primary) return;
    if (edge === "move" && !selectedIds.has(segment.item.id) && !event.ctrlKey && !event.metaKey) {
      setSelectedIds(new Set([segment.item.id]));
    }
    setLimitMessage("");
    setCalendarMenu(null);
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
        openItemActions(segment, x, y);
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
    setCalendarMenu(null);
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
    setCalendarMenu(null);
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
    setCalendarMenu(null);
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
    const sourceDayIndex = dayIndex.get(segment.item.dayId ?? "") ?? 0;
    const sourceStart =
      sourceDayIndex * calendarDayMinutes +
      calendarMinuteForTime(
        segment.item.startTime ?? timeForCalendarMinute(segment.startMinute, calendarStartHour),
        calendarStartHour,
      );
    const sourceDuration = Math.max(calendarMinimumMinutes, segment.item.durationMinutes || 60);
    let start = sourceStart;
    let duration = sourceDuration;
    const durationOnly = action === "shorter" || action === "longer";
    if (action === "earlier") start -= 15;
    if (action === "later") start += 15;
    if (action === "previous-day") start -= calendarDayMinutes;
    if (action === "next-day") start += calendarDayMinutes;
    if (action === "shorter") duration = Math.max(calendarMinimumMinutes, duration - 15);
    if (action === "longer") duration += 15;
    if (start < 0) return;
    const next = previewForAbsolute(
      segment.item.id,
      start,
      start + duration,
      days,
      calendarStartHour,
    );
    if (!next) return;
    const finalIndex = Math.max(0, Math.ceil((start + duration) / calendarDayMinutes) - 1);
    const lastKnown = days.at(-1)?.date;
    const extendThrough =
      finalIndex >= days.length && lastKnown
        ? addDays(lastKnown, finalIndex - days.length + 1)
        : undefined;
    const result = onChangeItem({
      item: segment.item,
      dayId: next.dayId,
      startTime: durationOnly ? segment.item.startTime : next.startTime,
      durationMinutes: next.durationMinutes,
      ...(extendThrough ? { extendThrough } : {}),
    });
    setLimitMessage(result.clamped ? "The item ends at the 30-day trip limit." : "");
  };

  const handleItemKey = (event: React.KeyboardEvent<HTMLElement>, segment: CalendarSegment) => {
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
  const lodgingGuide = lodgingPointer ? clippedLodgingGuide(lodgingPointer) : null;
  const activeLodgingPreview =
    gesture?.type === "lodging" && gesture.active ? lodgingPreview : null;
  const activeLodgingResize =
    gesture?.type === "lodging" && gesture.edge !== "move" ? activeLodgingPreview : null;
  const lodgingLayout = useMemo(
    () =>
      buildCalendarLodgingLayout(
        days,
        orderedItems,
        activeLodgingPreview
          ? {
              itemId: activeLodgingPreview.item.id,
              lodging: activeLodgingPreview,
            }
          : undefined,
      ),
    [activeLodgingPreview, days, orderedItems],
  );
  const lodgingTarget =
    gesture?.type === "lodging" && gesture.active && gesture.edge === "move" && activeLodgingPreview
      ? (lodgingLayout.bars.find((bar) => bar.item.id === activeLodgingPreview.item.id) ?? null)
      : null;
  const itemDragStartTime =
    preview?.startTime ?? (gesture?.type === "item" ? gesture.item.startTime : null) ?? "08:00";
  const itemDragStartMinute = calendarMinuteForTime(itemDragStartTime, calendarStartHour);
  const lodgingTargetDayCount = lodgingTarget
    ? daysBetween(lodgingTarget.lodging.startDate, lodgingTarget.lodging.endDate) + 1
    : 0;

  return (
    <section className={styles.root} data-trip-calendar aria-label={text("tripCalendar")}>
      <div className={styles.scroller} ref={scroller}>
        <div
          className={styles.calendar}
          style={
            {
              "--calendar-day-count": days.length,
              "--calendar-lodging-height": `${0.75 + lodgingLayout.laneCount * 2}em`,
            } as React.CSSProperties
          }
        >
          <div className={styles.corner} aria-hidden="true" />
          {days.map((day, dayIndex) => {
            const leading =
              layout
                .find((column) => column.day.id === day.id)
                ?.noteGroups.find((group) => group.anchorItemId === null)?.notes ?? [];
            return (
              <Fragment key={`header:${day.id}`}>
                {/* biome-ignore lint/a11y/noStaticElementInteractions: This header accepts note drops but has no click action. */}
                <header
                  className={styles.dayHeader}
                  data-calendar-day={day.id}
                  data-calendar-day-header={day.id}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => dropNote(event, day.id, null, onMoveNote)}
                  style={{ gridColumn: dayIndex + 2, gridRow: 1 }}
                >
                  <span className={styles.dayHeading}>
                    <time dateTime={day.date}>{formatDay(day.date, language)}</time>
                    {lodgingLayout.missingDayIds.has(day.id) ? (
                      <small className={styles.missingLodging}>
                        <Icon icon={triangleAlertIcon} aria-hidden="true" />
                        {text("noLodging")}
                      </small>
                    ) : null}
                  </span>
                  <NoteStack notes={leading} onSelect={onSelect} />
                </header>
              </Fragment>
            );
          })}
          <div className={styles.endHeader} aria-hidden="true" />
          <div className={styles.allDayLabel}>{text("allDay")}</div>
          {days.map((day, dayIndex) => (
            <fieldset
              className={styles.allDayCell}
              data-calendar-all-day={day.id}
              key={`all-day:${day.id}`}
              style={{ gridColumn: dayIndex + 2, gridRow: 2 }}
              onContextMenu={(event) => {
                if (event.target !== event.currentTarget) return;
                event.preventDefault();
                openAddActions(
                  "all-day",
                  day.id,
                  "",
                  event.clientX,
                  event.clientY,
                  event.button !== 2,
                );
              }}
            ></fieldset>
          ))}
          {lodgingLayout.bars.map((bar) => {
            const lodging = bar.lodging;
            const firstDay = days[bar.startIndex];
            const lastDay = days[bar.endIndex];
            if (!firstDay || !lastDay) return null;
            const starts = lodging.startDate === firstDay.date;
            const ends = lodging.endDate === lastDay.date;
            const resizing = activeLodgingResize?.item.id === bar.item.id;
            const dayCount = daysBetween(lodging.startDate, lodging.endDate) + 1;
            return (
              <div
                className={`${styles.lodging}${starts ? ` ${styles.checkIn}` : ""}${ends ? ` ${styles.checkOut}` : ""}${resizing ? ` ${styles.lodgingResizing}` : ""}${gesture?.type === "lodging" && gesture.active && gesture.edge === "move" && gesture.item.id === bar.item.id ? ` ${styles.lodgingOrigin}` : ""}`}
                data-calendar-lodging-id={bar.item.id}
                data-calendar-lodging-preview={resizing ? "true" : undefined}
                data-calendar-lodging-lane={bar.lane}
                data-start-date={lodging.startDate}
                data-end-date={lodging.endDate}
                key={bar.key}
                onPointerDown={(event) => startLodging(event, bar.item, "move")}
                style={
                  {
                    "--calendar-lodging-offset": `${bar.lane * 2}em`,
                    gridColumn: `${bar.startIndex + 2} / ${bar.endIndex + 3}`,
                    gridRow: 2,
                  } as React.CSSProperties
                }
              >
                {starts ? (
                  <button
                    type="button"
                    className={`${styles.dateHandle} ${styles.dateHandleStart}`}
                    aria-label={text("changeCheckIn", {
                      title: itemTitle(bar.item, places),
                    })}
                    onContextMenu={(event) => openLodgingActions(bar.item, event)}
                    onPointerDown={(event) => startLodging(event, bar.item, "start")}
                  />
                ) : null}
                <button
                  type="button"
                  onContextMenu={(event) => openLodgingActions(bar.item, event)}
                  onClick={() => {
                    if (suppressItemClick.current) {
                      suppressItemClick.current = false;
                      return;
                    }
                    setSelectedIds(new Set([bar.item.id]));
                    onSelect(bar.item);
                  }}
                >
                  <Icon icon={iconForItem(bar.item)} />
                  <span className={styles.lodgingTitle}>{itemTitle(bar.item, places)}</span>
                  {resizing ? (
                    <small className={styles.lodgingDuration}>
                      {dayCount} {text(dayCount === 1 ? "day" : "days")}
                    </small>
                  ) : null}
                </button>
                {ends ? (
                  <button
                    type="button"
                    className={`${styles.dateHandle} ${styles.dateHandleEnd}`}
                    aria-label={text("changeCheckOut", {
                      title: itemTitle(bar.item, places),
                    })}
                    onContextMenu={(event) => openLodgingActions(bar.item, event)}
                    onPointerDown={(event) => startLodging(event, bar.item, "end")}
                  />
                ) : null}
              </div>
            );
          })}
          {lodgingTarget ? (
            <div
              className={styles.lodgingTarget}
              data-calendar-lodging-preview
              data-calendar-lodging-lane={lodgingTarget.lane}
              data-start-date={lodgingTarget.lodging.startDate}
              data-end-date={lodgingTarget.lodging.endDate}
              style={
                {
                  "--calendar-lodging-offset": `${lodgingTarget.lane * 2}em`,
                  gridColumn: `${lodgingTarget.startIndex + 2} / ${lodgingTarget.endIndex + 3}`,
                  gridRow: 2,
                } as React.CSSProperties
              }
              aria-hidden="true"
            >
              <span className={styles.lodgingTargetContent}>
                <Icon icon={iconForItem(lodgingTarget.item)} />
                <span>{itemTitle(lodgingTarget.item, places)}</span>
                <small>
                  {lodgingTargetDayCount} {text(lodgingTargetDayCount === 1 ? "day" : "days")}
                </small>
              </span>
            </div>
          ) : null}
          <div className={styles.endAllDay} aria-hidden="true" />
          <div className={styles.timeGutter} data-calendar-time-gutter aria-hidden="true">
            {hourLabels.map((label, index) => (
              <time
                className={styles.hourLabel}
                key={label}
                style={{ top: `calc(${index} / 24 * 100%)` }}
              >
                {label}
              </time>
            ))}
            {timeGuide && !gesture ? (
              <time
                className={styles.hoverTime}
                data-calendar-hover-time
                style={{ top: minutePercent(timeGuide.minute) }}
              >
                {rollingTimeForCalendarMinute(timeGuide.minute, calendarStartHour)}
              </time>
            ) : null}
          </div>
          <CalendarHourLines onGeometryChange={updateTrackGeometry} />
          {timeGuide && !gesture ? (
            <div className={styles.timeGuideLayer}>
              <div
                className={styles.timeGuide}
                data-calendar-time-guide
                style={{ top: minutePercent(timeGuide.minute) }}
                aria-hidden="true"
              />
            </div>
          ) : null}
          {layout.map((column, dayIndex) => (
            <fieldset
              className={styles.dayTrack}
              data-calendar-day={column.day.id}
              data-calendar-track={column.day.id}
              key={`track:${column.day.id}`}
              style={{ gridColumn: dayIndex + 2, gridRow: 3 }}
              onPointerDown={beginSelection}
              onPointerMove={(event) => updateTimeGuide(event, column.day.id)}
              onPointerLeave={() => clearTimeGuide(column.day.id)}
              onContextMenu={(event) => {
                const item =
                  event.target instanceof Element
                    ? event.target.closest<HTMLElement>("[data-calendar-item-id]")
                    : null;
                if (item) return;
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                const minute = clamp(
                  snapCalendarMinute(
                    ((event.clientY - bounds.top) / bounds.height) * calendarDayMinutes,
                  ),
                  0,
                  calendarDayMinutes - calendarSnapMinutes,
                );
                openAddActions(
                  "empty",
                  column.day.id,
                  timeForCalendarMinute(minute, calendarStartHour),
                  event.clientX,
                  event.clientY,
                  event.button !== 2,
                );
              }}
            >
              {column.stays.map((stay) => {
                const endMinute =
                  stayPreview?.key === stay.key ? stayPreview.endMinute : stay.endMinute;
                const endPosition = deviceAlignedMinutePosition(endMinute, trackGeometry);
                const title = itemTitle(stay.item, places);
                return (
                  <Fragment key={stay.key}>
                    <div
                      className={`${styles.stayArea}${stay.conflict ? ` ${styles.stayConflict}` : ""}`}
                      data-calendar-stay-id={stay.item.id}
                      data-calendar-stay-date={stay.dayId}
                      data-calendar-stay-conflict={stay.conflict ? "true" : undefined}
                      data-leave-time={timeForCalendarMinute(endMinute, calendarStartHour)}
                      style={{ height: endPosition }}
                    >
                      <button
                        type="button"
                        className={styles.staySelect}
                        onContextMenu={(event) => openLodgingActions(stay.item, event)}
                        onClick={() => {
                          setSelectedIds(new Set([stay.item.id]));
                          onSelect(stay.item, stay.dayId);
                        }}
                      >
                        <Icon icon={bedDoubleIcon} aria-hidden="true" />
                        <span className={styles.stayCopy}>
                          <span>{text("stayAt", { title })}</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className={styles.stayHandle}
                        aria-label={`${text("leaveAt")} ${rollingTimeForCalendarMinute(endMinute, calendarStartHour)}`}
                        onContextMenu={(event) => openLodgingActions(stay.item, event)}
                        onPointerDown={(event) => startStay(event, stay)}
                        onKeyDown={(event) => {
                          const delta =
                            event.key === "ArrowUp" ? -calendarSnapMinutes : calendarSnapMinutes;
                          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                          event.preventDefault();
                          const lodging = stay.item.lodging;
                          if (!lodging) return;
                          const nextMinute = clamp(stay.endMinute + delta, 0, calendarDayMinutes);
                          onChangeLodging(stay.item, {
                            ...lodging,
                            leaveTimes: {
                              ...lodging.leaveTimes,
                              [stay.dayId]: timeForCalendarMinute(nextMinute, calendarStartHour),
                            },
                          });
                        }}
                      />
                    </div>
                    <small
                      className={`${styles.stayLeaveTime}${stay.conflict ? ` ${styles.stayLeaveConflict}` : ""}`}
                      data-calendar-stay-leave-id={stay.item.id}
                      data-calendar-stay-leave-date={stay.dayId}
                      aria-hidden="true"
                      style={{ top: endPosition }}
                    >
                      {text("leaveAt")} {rollingTimeForCalendarMinute(endMinute, calendarStartHour)}
                    </small>
                  </Fragment>
                );
              })}
              {(previewSegmentsByDay.get(column.day.id) ?? []).map((segment) => (
                <div
                  className={styles.dropPreview}
                  data-calendar-drop-preview
                  key={`preview:${segment.key}`}
                  style={{
                    top: minutePercent(segment.startMinute),
                    height: minutePercent(
                      Math.max(calendarMinimumMinutes, segment.endMinute - segment.startMinute),
                    ),
                    left: `calc(${(segment.lane / segment.laneCount) * 100}% + 0.25em)`,
                    width: `calc(${100 / segment.laneCount}% - 0.5em)`,
                  }}
                >
                  <strong className={styles.blockTitle}>
                    <Icon icon={iconForItem(segment.item)} />
                    <span>{itemTitle(segment.item, places)}</span>
                  </strong>
                  <time>
                    {rollingTimeForCalendarMinute(segment.startMinute, calendarStartHour)} -{" "}
                    {rollingTimeForCalendarMinute(segment.endMinute, calendarStartHour)}
                  </time>
                </div>
              ))}
              {column.routeGaps.map((gap) => {
                const duration = formatTravelDuration(gap.totalDurationMinutes, language);
                const label = gap.conflict ? `${duration} - ${text("conflict")}` : duration;
                return (
                  <div
                    data-calendar-route-leg
                    data-travel-mode={gap.mode}
                    role="img"
                    aria-label={`${travelModeLabel(language, gap.mode)} - ${label}`}
                    className={`${styles.routeGap}${gap.conflict ? ` ${styles.routeConflict}` : ""}`}
                    key={gap.key}
                    style={{
                      top: minutePercent(gap.startMinute),
                      height: minutePercent(Math.max(calendarMinimumMinutes, gap.durationMinutes)),
                      left: `calc(${(gap.lane / gap.laneCount) * 100}% + 0.6em)`,
                      width: `calc(${100 / gap.laneCount}% - 1.2em)`,
                    }}
                  >
                    <i aria-hidden="true" />
                    <span className={styles.routeInfo} data-calendar-route-info aria-hidden="true">
                      <Icon
                        className={styles.routeIcon}
                        data-calendar-route-icon
                        icon={iconForTravelMode(gap.mode)}
                        aria-hidden="true"
                      />
                      <span className={styles.routeMode} data-calendar-route-mode>
                        {travelModeLabel(language, gap.mode)}
                      </span>
                      <span className={styles.routeDuration} data-calendar-route-duration>
                        {label}
                      </span>
                    </span>
                  </div>
                );
              })}
              {column.segments.map((segment) => {
                const notes =
                  column.noteGroups.find((group) => group.anchorItemId === segment.item.id)
                    ?.notes ?? [];
                return (
                  <article
                    className={`${styles.block}${segment.provisional ? ` ${styles.provisional}` : ""}${selectedIds.has(segment.item.id) ? ` ${styles.selected}` : ""}${gesture?.type === "item" && gesture.active && gesture.members.some((member) => member.item.id === segment.item.id) ? ` ${styles.dragOrigin}` : ""}`}
                    data-calendar-item-id={segment.item.id}
                    data-calendar-selected={selectedIds.has(segment.item.id) ? "true" : "false"}
                    key={segment.key}
                    style={{
                      top: minutePercent(segment.startMinute),
                      height: minutePercent(
                        Math.max(calendarMinimumMinutes, segment.endMinute - segment.startMinute),
                      ),
                      left: `calc(${(segment.lane / segment.laneCount) * 100}% + 0.25em)`,
                      width: `calc(${100 / segment.laneCount}% - 0.5em)`,
                    }}
                    onPointerDown={(event) => {
                      const control =
                        event.target instanceof Element ? event.target.closest("button") : null;
                      const primary = event.currentTarget.querySelector(`.${styles.blockSelect}`);
                      if (control && control !== primary) return;
                      beginItemInteraction(event, segment);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      const bounds = event.currentTarget.getBoundingClientRect();
                      openItemActions(
                        segment,
                        event.clientX || bounds.left + bounds.width / 2,
                        event.clientY || bounds.top + bounds.height / 2,
                        event.button !== 2,
                      );
                    }}
                  >
                    {!segment.continuesBefore ? (
                      <button
                        type="button"
                        className={styles.resizeStart}
                        aria-label={text("changeStart", {
                          title: itemTitle(segment.item, places),
                        })}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          beginItemGesture(event, segment, "start");
                        }}
                      />
                    ) : null}
                    <button
                      type="button"
                      className={styles.blockSelect}
                      aria-pressed={selectedIds.has(segment.item.id)}
                      aria-label={itemTitle(segment.item, places)}
                      onClick={(event) => {
                        if (suppressItemClick.current) {
                          suppressItemClick.current = false;
                          return;
                        }
                        if (
                          calendarMenu?.type === "item" &&
                          calendarMenu.segment.item.id === segment.item.id
                        )
                          return;
                        if (event.ctrlKey || event.metaKey) {
                          setSelectedIds((current) => {
                            const next = new Set(current);
                            if (next.has(segment.item.id)) next.delete(segment.item.id);
                            else next.add(segment.item.id);
                            return next;
                          });
                          if (selectedId === segment.item.id) onClearSelection();
                          return;
                        }
                        setSelectedIds(new Set([segment.item.id]));
                        onSelect(segment.item, segment.dayId);
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) =>
                        dropNote(event, column.day.id, segment.item.id, onMoveNote)
                      }
                      onKeyDown={(event) => handleItemKey(event, segment)}
                    >
                      <strong className={styles.blockTitle}>
                        <Icon icon={iconForItem(segment.item)} />
                        <span>
                          {segment.continuesBefore
                            ? text("continued")
                            : itemTitle(segment.item, places)}
                        </span>
                      </strong>
                      <time>
                        {segment.provisional ? `${text("flexible")} · ` : ""}
                        {rollingTimeForCalendarMinute(segment.startMinute, calendarStartHour)} -{" "}
                        {rollingTimeForCalendarMinute(segment.endMinute, calendarStartHour)}
                      </time>
                    </button>
                    {!segment.continuesAfter ? (
                      <button
                        type="button"
                        className={styles.resizeEnd}
                        aria-label={text("changeEnd", {
                          title: itemTitle(segment.item, places),
                        })}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          beginItemGesture(event, segment, "end");
                        }}
                      />
                    ) : null}
                    <NoteStack notes={notes} onSelect={onSelect} />
                  </article>
                );
              })}
              {column.overflow.length ? (
                <div className={styles.overflow}>
                  {column.overflow.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => {
                        setSelectedIds(new Set([item.id]));
                        onSelect(item, column.day.id);
                      }}
                    >
                      {itemTitle(item, places)}
                    </button>
                  ))}
                </div>
              ) : null}
            </fieldset>
          ))}
          <div className={styles.endTrack} aria-hidden="true" />
        </div>
      </div>
      {editor ? <div className={styles.editor}>{editor}</div> : null}
      {selectionBox ? (
        <div
          className={styles.selectionBox}
          data-calendar-selection-box
          style={selectionBox}
          aria-hidden="true"
        />
      ) : null}
      {gesture?.type === "item" && gesture.active && gesture.edge === "move" && dragPointer ? (
        <div
          className={styles.dragProxy}
          data-calendar-drag-proxy
          style={{
            left: dragPointer.x - dragPointer.offsetX,
            top: dragPointer.y - dragPointer.offsetY,
            width: dragPointer.width,
            height: dragPointer.height,
          }}
        >
          <strong className={styles.blockTitle}>
            <Icon icon={iconForItem(gesture.item)} />
            <span>{itemTitle(gesture.item, places)}</span>
          </strong>
          <time>
            {rollingTimeForCalendarMinute(itemDragStartMinute, calendarStartHour)} -{" "}
            {rollingTimeForCalendarMinute(
              itemDragStartMinute +
                ((preview?.durationMinutes ??
                  (gesture.type === "item" ? gesture.item.durationMinutes : 60)) ||
                  60),
              calendarStartHour,
            )}
          </time>
        </div>
      ) : null}
      {gesture?.type === "lodging" &&
      gesture.active &&
      gesture.edge === "move" &&
      lodgingPointer ? (
        <div
          className={styles.lodgingDragProxy}
          data-calendar-lodging-drag-proxy
          style={{
            left: lodgingPointer.x - lodgingPointer.offsetX,
            top: lodgingPointer.y - lodgingPointer.offsetY,
            width: lodgingPointer.width,
            height: lodgingPointer.height,
          }}
          aria-hidden="true"
        >
          <Icon icon={iconForItem(gesture.item)} />
          <span>{itemTitle(gesture.item, places)}</span>
        </div>
      ) : null}
      {gesture?.type === "lodging" && gesture.edge !== "move" && lodgingGuide ? (
        <div
          className={styles.lodgingResizeGuide}
          data-calendar-lodging-resize-guide
          style={lodgingGuide}
          aria-hidden="true"
        />
      ) : null}
      <CalendarMenus
        menu={calendarMenu}
        language={language}
        commands={{
          titleForItem: (item) => itemTitle(item, places),
          canReorderItem,
          item: (segment, action) => {
            if (action === "duplicate") onDuplicateItem(segment.item);
            else if (action === "flexible") onMakeFlexible(segment.item);
            else if (action === "edit") onSelect(segment.item);
            else if (action === "delete") onDeleteItem(segment.item);
            else if (action === "move-up") onReorderItem(segment.item, -1);
            else if (action === "move-down") onReorderItem(segment.item, 1);
            else adjustItem(segment, action);
          },
          lodging: (item, action) => {
            if (action === "duplicate") onDuplicateItem(item);
            else if (action === "edit") onSelect(item);
            else onDeleteItem(item);
          },
          add: (type, dayId, startTime, position) => addItem(type, dayId, startTime, position),
          close: () => setCalendarMenu(null),
        }}
      />
      {creationPanel && creationPosition
        ? createPortal(
            <div className={styles.creationPopover} style={creationPosition}>
              {creationPanel}
            </div>,
            document.body,
          )
        : null}
      {limitMessage ? (
        <p className={styles.message} role="status">
          {limitMessage}
        </p>
      ) : null}
    </section>
  );
}

function NoteStack({
  notes,
  onSelect,
}: {
  notes: readonly TripItem[];
  onSelect: (item: TripItem) => void;
}) {
  if (notes.length === 0) return null;
  return (
    <span className={styles.noteStack}>
      {notes.map((note) => {
        const tooltipId = `calendar-note-${note.id}`;
        const tooltip = note.details?.trim() || note.title;
        return (
          <button
            type="button"
            draggable
            key={note.id}
            aria-label={note.title}
            aria-describedby={tooltipId}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(note);
            }}
            onDragStart={(event) =>
              event.dataTransfer.setData("application/x-pacenotes-note", note.id)
            }
          >
            <Icon icon={stickyNoteIcon} />
            <span className={styles.noteTooltip} id={tooltipId} role="tooltip">
              {tooltip}
            </span>
          </button>
        );
      })}
    </span>
  );
}

function dropNote(
  event: React.DragEvent,
  dayId: string,
  afterItemId: string | null,
  onMove: (noteId: string, dayId: string, afterItemId: string | null) => void,
) {
  event.preventDefault();
  const noteId = event.dataTransfer.getData("application/x-pacenotes-note");
  if (noteId) onMove(noteId, dayId, afterItemId);
}
