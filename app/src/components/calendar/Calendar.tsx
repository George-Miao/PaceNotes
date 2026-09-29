import { Icon } from "@iconify/react";
import bedDoubleIcon from "@iconify-icons/lucide/bed-double";
import triangleAlertIcon from "@iconify-icons/lucide/triangle-alert";
import {
  Fragment,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { iconForItem, iconForTravelMode } from "~/components/planner/item-icon";
import type { GooglePlaceView } from "~/features/google/google";
import { itemTitle } from "~/features/google/item-title";
import type { RouteLeg } from "~/features/routing/route-legs";
import {
  buildCalendarLayout,
  buildCalendarLodgingLayout,
  type CalendarSegment,
  calendarDayMinutes,
  calendarMinimumMinutes,
  calendarMinuteForTime,
  calendarSnapMinutes,
  rollingTimeForCalendarMinute,
  snapCalendarMinute,
  timeForCalendarMinute,
} from "~/features/trip/calendar-layout";
import { createTripText, formatTravelDuration, travelModeLabel } from "~/features/trip/language";
import type {
  CalendarStartHour,
  Lodging,
  TripDay,
  TripItem,
  TripLanguage,
} from "~/features/trip/model";
import styles from "./Calendar.module.css";
import { CalendarHourLines } from "./CalendarHourLines";
import {
  type CalendarAddType,
  type CalendarMenuState,
  CalendarMenus,
  type CalendarMenuPosition as MenuPosition,
} from "./CalendarMenus";
import { dropNote, NoteStack } from "./CalendarNotes";
import {
  clamp,
  clippedLodgingGuide,
  daysBetween,
  formatDay,
  minutePercent,
} from "./calendar-coordinates";
import type { ItemChange } from "./calendar-item-gestures";
import { useCalendarGestures } from "./useCalendarGestures";

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
  const [calendarMenu, setCalendarMenu] = useState<CalendarMenuState | null>(null);
  const [creationPosition, setCreationPosition] = useState<MenuPosition | null>(null);
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
  const layout = useMemo(
    () => buildCalendarLayout(days, orderedItems, legsByDay, calendarStartHour),
    [calendarStartHour, days, legsByDay, orderedItems],
  );
  const {
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
  } = useCalendarGestures({
    focusRequest,
    days,
    orderedItems,
    layout,
    calendarStartHour,
    selectedId,
    onClearSelection,
    onChangeItem,
    onChangeItems,
    onChangeLodging,
    onCloseMenu: () => setCalendarMenu(null),
    onLongPressItem: (segment, x, y) => openItemActions(segment, x, y),
  });
  const activePreviews = useMemo(
    () => (groupPreviews.length > 0 ? groupPreviews : preview ? [preview] : []),
    [groupPreviews, preview],
  );
  const previewById = useMemo(
    () => new Map(activePreviews.map((candidate) => [candidate.itemId, candidate])),
    [activePreviews],
  );
  const resizeDuration =
    gesture?.type === "item" && gesture.edge !== "move" && preview
      ? formatTravelDuration(preview.durationMinutes, language)
      : null;
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

  useEffect(() => {
    if (!creationPanel) setCreationPosition(null);
  }, [creationPanel]);

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
    dismissForMenu();
    setCreationPosition(null);
    setCalendarMenu({ type: "item", segment, position: menuPosition(x, y), focusFirst });
  };
  const openLodgingActions = (item: TripItem, event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dismissForMenu();
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
                    if (consumeSuppressedClick()) return;
                    selectItem(bar.item.id);
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
                          selectItem(stay.item.id);
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
                    {resizeDuration && segment.item.id === preview?.itemId
                      ? ` (${resizeDuration})`
                      : null}
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
                        if (consumeSuppressedClick()) return;
                        if (
                          calendarMenu?.type === "item" &&
                          calendarMenu.segment.item.id === segment.item.id
                        )
                          return;
                        if (event.ctrlKey || event.metaKey) {
                          toggleItem(segment.item.id);
                          return;
                        }
                        selectItem(segment.item.id);
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
                        selectItem(item.id);
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
