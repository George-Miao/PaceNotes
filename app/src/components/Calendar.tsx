import { Icon } from "@iconify/react";
import arrowDownIcon from "@iconify-icons/lucide/arrow-down";
import arrowLeftIcon from "@iconify-icons/lucide/arrow-left";
import arrowRightIcon from "@iconify-icons/lucide/arrow-right";
import arrowUpIcon from "@iconify-icons/lucide/arrow-up";
import ellipsisIcon from "@iconify-icons/lucide/ellipsis-vertical";
import stickyNoteIcon from "@iconify-icons/lucide/sticky-note";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { GooglePlaceView } from "~/features/google/google";
import { itemTitle } from "~/features/google/item-title";
import type { RouteLeg } from "~/features/google/route-legs";
import {
  buildCalendarLayout,
  type CalendarSegment,
  calendarHourEm,
  calendarMinimumMinutes,
  calendarSnapMinutes,
  snapCalendarMinute,
  timeForCalendarMinute,
} from "~/features/trip/calendar-layout";
import type { TripDay, TripItem, TripLanguage } from "~/features/trip/model";
import styles from "./Calendar.module.css";
import { iconForItem } from "./item-icon";

type ItemChange = {
  item: TripItem;
  dayId: string;
  startTime: string;
  durationMinutes: number;
  extendThrough?: string;
};

type ItemGesture = {
  type: "item";
  item: TripItem;
  edge: "move" | "start" | "end";
  pointerId: number;
  startX: number;
  startY: number;
  startAbsolute: number;
  endAbsolute: number;
  version: string;
};

type LodgingGesture = {
  type: "lodging";
  item: TripItem;
  edge: "move" | "start" | "end";
  pointerId: number;
  startX: number;
  version: string;
};

type Gesture = ItemGesture | LodgingGesture;

type Preview = { itemId: string; dayId: string; startTime: string; durationMinutes: number };
type DragPointer = {
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};
const hourLabels = Array.from({ length: 25 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);

export function Calendar({
  days,
  orderedItems,
  legsByDay,
  places,
  language,
  selectedId,
  onSelect,
  onSelectDay,
  onChangeItem,
  onMoveNote,
  onChangeLodging,
}: {
  days: readonly TripDay[];
  orderedItems: readonly TripItem[];
  legsByDay: ReadonlyMap<string, readonly RouteLeg[]>;
  places: ReadonlyMap<string, GooglePlaceView>;
  language: TripLanguage;
  selectedId: string | null;
  onSelect: (item: TripItem) => void;
  onSelectDay: (dayId: string) => void;
  onChangeItem: (change: ItemChange) => { clamped: boolean };
  onMoveNote: (noteId: string, dayId: string, afterItemId: string | null) => void;
  onChangeLodging: (item: TripItem, startDate: string, endDate: string) => { clamped: boolean };
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [limitMessage, setLimitMessage] = useState("");
  const [dragPointer, setDragPointer] = useState<DragPointer | null>(null);
  const dayIndex = useMemo(() => new Map(days.map((day, index) => [day.id, index])), [days]);
  const effectiveItems = useMemo(
    () =>
      preview
        ? orderedItems.map((item) =>
            item.id === preview.itemId
              ? {
                  ...item,
                  dayId: preview.dayId,
                  startTime: preview.startTime,
                  durationMinutes: preview.durationMinutes,
                }
              : item,
          )
        : orderedItems,
    [orderedItems, preview],
  );
  const layout = useMemo(
    () => buildCalendarLayout(days, orderedItems, legsByDay),
    [days, legsByDay, orderedItems],
  );
  const previewSegmentsByDay = useMemo(
    () =>
      new Map(
        (preview ? buildCalendarLayout(days, effectiveItems, legsByDay) : []).map((column) => [
          column.day.id,
          column.segments.filter((segment) => segment.item.id === preview?.itemId),
        ]),
      ),
    [days, effectiveItems, legsByDay, preview],
  );
  const itemVersions = useMemo(
    () => new Map(orderedItems.map((item) => [item.id, itemVersion(item)])),
    [orderedItems],
  );

  useEffect(() => {
    if (!gesture) return;
    if (itemVersions.get(gesture.item.id) !== gesture.version) {
      setGesture(null);
      setPreview(null);
      setDragPointer(null);
      setLimitMessage("This item changed in another editor. Your local gesture was canceled.");
    }
  }, [gesture, itemVersions]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      if (gesture.type === "lodging") return;
      if (gesture.edge === "move") {
        setDragPointer((current) =>
          current ? { ...current, x: event.clientX, y: event.clientY } : current,
        );
      }
      const { dayDelta, minuteDelta } = pointerDelta(scroller.current, event, gesture);
      const maximum = days.length * 24 * 60;
      let start = gesture.startAbsolute;
      let end = gesture.endAbsolute;
      if (gesture.edge === "move") {
        start = clamp(gesture.startAbsolute + dayDelta * 1440 + minuteDelta, 0, maximum - 15);
        end = start + (gesture.endAbsolute - gesture.startAbsolute);
      } else if (gesture.edge === "start") {
        start = clamp(
          gesture.startAbsolute + dayDelta * 1440 + minuteDelta,
          0,
          gesture.endAbsolute - calendarMinimumMinutes,
        );
      } else {
        end = Math.max(
          gesture.startAbsolute + calendarMinimumMinutes,
          gesture.endAbsolute + dayDelta * 1440 + minuteDelta,
        );
      }
      setPreview(previewForAbsolute(gesture.item.id, start, end, days));
    };
    const finish = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      if (gesture.type === "item") {
        const next = preview;
        setGesture(null);
        setPreview(null);
        setDragPointer(null);
        if (!next) return;
        const startIndex = dayIndex.get(next.dayId) ?? 0;
        const finalMinute =
          startIndex * 1440 + minutesForTime(next.startTime) + next.durationMinutes;
        const finalIndex = Math.max(0, Math.ceil(finalMinute / 1440) - 1);
        const lastKnown = days.at(-1)?.date;
        const extendThrough =
          finalIndex >= days.length && lastKnown
            ? addDays(lastKnown, finalIndex - days.length + 1)
            : undefined;
        const result = onChangeItem({
          item: gesture.item,
          dayId: next.dayId,
          startTime: next.startTime,
          durationMinutes: next.durationMinutes,
          ...(extendThrough ? { extendThrough } : {}),
        });
        if (result.clamped) {
          setLimitMessage("The item ends at the 30-day trip limit.");
        }
        return;
      }
      const result = finishLodgingGesture(gesture, event, days, onChangeLodging);
      setGesture(null);
      if (result.clamped) {
        setLimitMessage("The stay ends at the 30-day trip limit.");
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [dayIndex, days, gesture, onChangeItem, onChangeLodging, preview]);

  const beginItemGesture = (
    event: ReactPointerEvent,
    segment: CalendarSegment,
    edge: ItemGesture["edge"],
  ) => {
    if (
      event.button !== 0 ||
      (edge === "start" && segment.continuesBefore) ||
      (edge === "end" && segment.continuesAfter)
    )
      return;
    event.preventDefault();
    const itemDay = dayIndex.get(segment.item.dayId ?? "") ?? 0;
    const start =
      itemDay * 1440 +
      minutesForTime(segment.item.startTime ?? timeForCalendarMinute(segment.startMinute));
    setLimitMessage("");
    const bounds = event.currentTarget
      .closest<HTMLElement>("[data-calendar-item-id]")
      ?.getBoundingClientRect();
    setDragPointer(
      edge === "move" && bounds
        ? {
            x: event.clientX,
            y: event.clientY,
            offsetX: event.clientX - bounds.left,
            offsetY: event.clientY - bounds.top,
            width: bounds.width,
            height: bounds.height,
          }
        : null,
    );
    setGesture({
      type: "item",
      item: segment.item,
      edge,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startAbsolute: start,
      endAbsolute: start + Math.max(calendarMinimumMinutes, segment.item.durationMinutes || 60),
      version: itemVersion(segment.item),
    });
  };

  const startLodging = (event: ReactPointerEvent, item: TripItem, edge: LodgingGesture["edge"]) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setGesture({
      type: "lodging",
      item,
      edge,
      pointerId: event.pointerId,
      startX: event.clientX,
      version: itemVersion(item),
    });
  };

  const adjustItem = (
    segment: CalendarSegment,
    action: "earlier" | "later" | "previous-day" | "next-day" | "shorter" | "longer",
  ) => {
    const sourceDayIndex = dayIndex.get(segment.item.dayId ?? "") ?? 0;
    const sourceStart =
      sourceDayIndex * 1440 +
      minutesForTime(segment.item.startTime ?? timeForCalendarMinute(segment.startMinute));
    const sourceDuration = Math.max(calendarMinimumMinutes, segment.item.durationMinutes || 60);
    let start = sourceStart;
    let duration = sourceDuration;
    if (action === "earlier") start -= 15;
    if (action === "later") start += 15;
    if (action === "previous-day") start -= 1440;
    if (action === "next-day") start += 1440;
    if (action === "shorter") duration = Math.max(calendarMinimumMinutes, duration - 15);
    if (action === "longer") duration += 15;
    if (start < 0) return;
    const next = previewForAbsolute(segment.item.id, start, start + duration, days);
    if (!next) return;
    const finalIndex = Math.max(0, Math.ceil((start + duration) / 1440) - 1);
    const lastKnown = days.at(-1)?.date;
    const extendThrough =
      finalIndex >= days.length && lastKnown
        ? addDays(lastKnown, finalIndex - days.length + 1)
        : undefined;
    const result = onChangeItem({
      item: segment.item,
      dayId: next.dayId,
      startTime: next.startTime,
      durationMinutes: next.durationMinutes,
      ...(extendThrough ? { extendThrough } : {}),
    });
    setLimitMessage(result.clamped ? "The item ends at the 30-day trip limit." : "");
  };

  const handleItemKey = (event: React.KeyboardEvent<HTMLElement>, segment: CalendarSegment) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      event.preventDefault();
      onSelect(segment.item);
      return;
    }
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

  return (
    <section className={styles.root} aria-label="Trip calendar">
      <div className={styles.scroller} ref={scroller}>
        <div
          className={styles.calendar}
          style={{ "--calendar-day-count": days.length } as React.CSSProperties}
        >
          <div className={styles.corner} aria-hidden="true" />
          {days.map((day) => {
            const leading =
              layout
                .find((column) => column.day.id === day.id)
                ?.noteGroups.find((group) => group.anchorItemId === null)?.notes ?? [];
            return (
              <header
                className={styles.dayHeader}
                key={`header:${day.id}`}
                data-calendar-day={day.id}
              >
                <button
                  className={styles.daySelect}
                  type="button"
                  onClick={() => onSelectDay(day.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => dropNote(event, day.id, null, onMoveNote)}
                >
                  <time dateTime={day.date}>{formatDay(day.date, language)}</time>
                </button>
                <NoteStack notes={leading} onSelect={onSelect} />
              </header>
            );
          })}
          <div className={styles.allDayLabel}>All day</div>
          {days.map((day) => (
            <div className={styles.allDayCell} key={`all-day:${day.id}`}>
              {orderedItems
                .filter(
                  (item) =>
                    item.type === "lodging" &&
                    item.lodging &&
                    item.lodging.startDate <= day.date &&
                    day.date <= item.lodging.endDate,
                )
                .map((item) => {
                  const lodging = item.lodging;
                  if (!lodging) return null;
                  const starts = lodging.startDate === day.date;
                  const ends = lodging.endDate === day.date;
                  return (
                    <div
                      className={`${styles.lodging}${starts ? ` ${styles.checkIn}` : ""}${ends ? ` ${styles.checkOut}` : ""}`}
                      key={item.id}
                    >
                      {starts ? (
                        <button
                          type="button"
                          className={styles.dateHandle}
                          aria-label={`Change check-in for ${itemTitle(item, places)}`}
                          onPointerDown={(event) => startLodging(event, item, "start")}
                        />
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onSelect(item)}
                        onPointerDown={(event) => startLodging(event, item, "move")}
                      >
                        <Icon icon={iconForItem(item)} />
                        <span className={styles.lodgingTitle}>{itemTitle(item, places)}</span>
                      </button>
                      {ends ? (
                        <button
                          type="button"
                          className={styles.dateHandle}
                          aria-label={`Change check-out for ${itemTitle(item, places)}`}
                          onPointerDown={(event) => startLodging(event, item, "end")}
                        />
                      ) : null}
                    </div>
                  );
                })}
            </div>
          ))}
          <div className={styles.timeGutter} aria-hidden="true">
            {hourLabels.map((label) => (
              <time key={label} style={{ top: `${(Number(label.slice(0, 2)) / 24) * 100}%` }}>
                {label}
              </time>
            ))}
          </div>
          {layout.map((column) => (
            <div
              className={styles.dayTrack}
              data-calendar-day={column.day.id}
              key={`track:${column.day.id}`}
            >
              <div className={styles.hourLines} aria-hidden="true" />
              {(previewSegmentsByDay.get(column.day.id) ?? []).map((segment) => (
                <div
                  className={styles.dropPreview}
                  data-calendar-drop-preview
                  key={`preview:${segment.key}`}
                  style={{
                    top: minuteEm(segment.startMinute),
                    height: minuteEm(
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
                    {timeForCalendarMinute(segment.startMinute)} -{" "}
                    {timeForCalendarMinute(segment.endMinute)}
                  </time>
                </div>
              ))}
              {column.routeGaps.map((gap) => (
                <div
                  className={`${styles.routeGap}${gap.conflict ? ` ${styles.routeConflict}` : ""}`}
                  key={gap.key}
                  style={{ top: minuteEm(gap.startMinute), height: minuteEm(gap.durationMinutes) }}
                >
                  <i />
                  <span>{gap.conflict ? `${gap.label} - conflict` : gap.label}</span>
                </div>
              ))}
              {column.segments.map((segment) => {
                const notes =
                  column.noteGroups.find((group) => group.anchorItemId === segment.item.id)
                    ?.notes ?? [];
                return (
                  <article
                    className={`${styles.block}${segment.provisional ? ` ${styles.provisional}` : ""}${selectedId === segment.item.id ? ` ${styles.selected}` : ""}${gesture?.type === "item" && gesture.item.id === segment.item.id ? ` ${styles.dragOrigin}` : ""}`}
                    data-calendar-item-id={segment.item.id}
                    key={segment.key}
                    style={{
                      top: minuteEm(segment.startMinute),
                      height: minuteEm(
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
                      beginItemGesture(event, segment, "move");
                    }}
                  >
                    {!segment.continuesBefore ? (
                      <button
                        type="button"
                        className={styles.resizeStart}
                        aria-label={`Change start of ${itemTitle(segment.item, places)}`}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          beginItemGesture(event, segment, "start");
                        }}
                      />
                    ) : null}
                    <button
                      type="button"
                      className={styles.blockSelect}
                      aria-label={itemTitle(segment.item, places)}
                      onClick={() => {
                        onSelectDay(column.day.id);
                        onSelect(segment.item);
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
                          {segment.continuesBefore ? "Continued" : itemTitle(segment.item, places)}
                        </span>
                      </strong>
                      <time>
                        {segment.provisional
                          ? "Untimed"
                          : `${timeForCalendarMinute(segment.startMinute)} - ${timeForCalendarMinute(segment.endMinute)}`}
                      </time>
                    </button>
                    {!segment.continuesAfter ? (
                      <button
                        type="button"
                        className={styles.resizeEnd}
                        aria-label={`Change end of ${itemTitle(segment.item, places)}`}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          beginItemGesture(event, segment, "end");
                        }}
                      />
                    ) : null}
                    <ItemActions
                      title={itemTitle(segment.item, places)}
                      onAction={(action) => adjustItem(segment, action)}
                    />
                    <NoteStack notes={notes} onSelect={onSelect} />
                  </article>
                );
              })}
              {column.overflow.length ? (
                <div className={styles.overflow}>
                  {column.overflow.map((item) => (
                    <button type="button" key={item.id} onClick={() => onSelect(item)}>
                      {itemTitle(item, places)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      {gesture?.type === "item" && gesture.edge === "move" && dragPointer ? (
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
            {preview?.startTime ?? gesture.item.startTime ?? "08:00"} -{" "}
            {timeForCalendarMinute(
              minutesForTime(preview?.startTime ?? gesture.item.startTime ?? "08:00") +
                ((preview?.durationMinutes ?? gesture.item.durationMinutes) || 60),
            )}
          </time>
        </div>
      ) : null}
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

function ItemActions({
  title,
  onAction,
}: {
  title: string;
  onAction: (
    action: "earlier" | "later" | "previous-day" | "next-day" | "shorter" | "longer",
  ) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, right: 0 });
  const actions = [
    ["previous-day", arrowLeftIcon, "Previous day"],
    ["next-day", arrowRightIcon, "Next day"],
    ["earlier", arrowUpIcon, "15 minutes earlier"],
    ["later", arrowDownIcon, "15 minutes later"],
    ["shorter", arrowUpIcon, "15 minutes shorter"],
    ["longer", arrowDownIcon, "15 minutes longer"],
  ] as const;
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target) &&
        !menu.current?.contains(event.target)
      )
        setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const closeOnViewportChange = () => setOpen(false);
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnViewportChange);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnViewportChange);
    };
  }, [open]);
  return (
    <>
      <div ref={root} className={styles.actions}>
        <button
          type="button"
          aria-label={`Calendar actions for ${title}`}
          aria-expanded={open}
          onClick={(event) => {
            if (open) {
              setOpen(false);
              return;
            }
            const bounds = event.currentTarget.getBoundingClientRect();
            setPosition({
              top: Math.max(4, Math.min(bounds.bottom + 4, window.innerHeight - 190)),
              right: Math.max(4, window.innerWidth - bounds.right),
            });
            setOpen(true);
          }}
        >
          <Icon icon={ellipsisIcon} />
        </button>
      </div>
      {open
        ? createPortal(
            <div ref={menu} className={styles.actionMenu} style={position}>
              {actions.map(([action, icon, label]) => (
                <button
                  key={action}
                  type="button"
                  onClick={() => {
                    onAction(action);
                    setOpen(false);
                  }}
                >
                  <Icon icon={icon} />
                  {label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
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

function pointerDelta(scroller: HTMLDivElement | null, event: PointerEvent, gesture: ItemGesture) {
  const first = scroller?.querySelector<HTMLElement>("[data-calendar-day]");
  const columnWidth = first?.getBoundingClientRect().width || 288;
  const pixelsPerHour =
    calendarHourEm *
    Number.parseFloat(getComputedStyle(scroller ?? document.documentElement).fontSize);
  return {
    dayDelta: Math.round((event.clientX - gesture.startX) / columnWidth),
    minuteDelta:
      Math.round(((event.clientY - gesture.startY) / pixelsPerHour / calendarSnapMinutes) * 60) *
      calendarSnapMinutes,
  };
}

function previewForAbsolute(
  itemId: string,
  start: number,
  end: number,
  days: readonly TripDay[],
): Preview | null {
  const dayIndex = Math.floor(start / 1440);
  if (dayIndex < 0) return null;
  const firstDay = days[0];
  const dayId = days[dayIndex]?.id ?? (firstDay ? addDays(firstDay.date, dayIndex) : null);
  if (!dayId) return null;
  return {
    itemId,
    dayId,
    startTime: timeForCalendarMinute(start),
    durationMinutes: Math.max(calendarMinimumMinutes, snapCalendarMinute(end - start)),
  };
}

function finishLodgingGesture(
  gesture: LodgingGesture,
  event: PointerEvent,
  days: readonly TripDay[],
  onChange: (item: TripItem, startDate: string, endDate: string) => { clamped: boolean },
): { clamped: boolean } {
  const lodging = gesture.item.lodging;
  if (!lodging) return { clamped: false };
  const width =
    document.querySelector<HTMLElement>("[data-calendar-day]")?.getBoundingClientRect().width ||
    288;
  const delta = Math.round((event.clientX - gesture.startX) / width);
  if (delta === 0) return { clamped: false };
  let startDate = lodging.startDate;
  let endDate = lodging.endDate;
  if (gesture.edge === "move") {
    startDate = addDays(startDate, delta);
    endDate = addDays(endDate, delta);
  } else if (gesture.edge === "start") {
    startDate = addDays(startDate, delta);
    if (startDate >= endDate) startDate = addDays(endDate, -1);
  } else {
    endDate = addDays(endDate, delta);
    if (endDate <= startDate) endDate = addDays(startDate, 1);
  }
  const first = days[0]?.date;
  if (first && startDate < first) {
    const nights = daysBetween(startDate, endDate);
    startDate = first;
    endDate = addDays(first, nights);
  }
  return onChange(gesture.item, startDate, endDate);
}

function itemVersion(item: TripItem): string {
  return `${item.dayId}:${item.startTime}:${item.durationMinutes}:${item.lodging?.startDate}:${item.lodging?.endDate}`;
}

function minuteEm(minutes: number): string {
  return `${(minutes / 60) * calendarHourEm}em`;
}

function minutesForTime(value: string): number {
  const [hour = "0", minute = "0"] = value.split(":");
  return Number(hour) * 60 + Number(minute);
}

function formatDay(date: string, language: TripLanguage): string {
  return new Intl.DateTimeFormat(language, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  return Math.max(
    1,
    Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000),
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
