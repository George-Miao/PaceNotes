import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { Icon } from "@iconify/react";
import chevronDownIcon from "@iconify-icons/lucide/chevron-down";
import chevronUpIcon from "@iconify-icons/lucide/chevron-up";
import routeIcon from "@iconify-icons/lucide/route";
import trashIcon from "@iconify-icons/lucide/trash-2";
import {
  type CSSProperties,
  Profiler,
  type ProfilerOnRenderCallback,
  type ReactNode,
  useRef,
} from "react";
import type { GooglePlaceView } from "~/features/google/google";
import { itemTitle } from "~/features/google/item-title";
import { googleMapsRouteUrl } from "~/features/google/route-export";
import type { RouteLeg } from "~/features/routing/route-legs";
import { routeContinuations } from "~/features/trip/day-plan";
import {
  createTripText,
  formatTravelDuration,
  travelModeLabel,
  useTripText,
  useUiLanguage,
} from "~/features/trip/language";
import {
  type DistanceUnit,
  lodgingLeaveTime,
  type TravelMode,
  type TripItem,
  type TripLanguage,
  travelModes,
} from "~/features/trip/model";
import { Dropdown } from "./Dropdown";
import { iconForItem, iconForTravelMode } from "./item-icon";

export type ItineraryDrop = {
  itemId: string;
  sourceId: string;
  sourceIndex: number;
  destinationId: string;
  destinationIndex: number;
};

export function ItineraryDragArea({
  children,
  onDrop,
  onDragStateChange,
}: {
  children: ReactNode;
  onDrop: (drop: ItineraryDrop) => void;
  onDragStateChange: (dragging: boolean) => void;
}) {
  const dragHeight = useRef(0);
  const originTop = useRef(0);
  const sourceUnit = useRef<HTMLElement | null>(null);
  const sourceUnitHeight = useRef(0);
  const dragLeg = useRef<{ height: number; offset: number } | null>(null);
  const targetGap = useRef<HTMLElement | null>(null);
  const preview = useRef<HTMLElement | null>(null);
  const findList = (id: string) =>
    [...document.querySelectorAll<HTMLElement>(".itinerary-list")].find(
      (element) => element.dataset.rfdDroppableId === id,
    );
  const clearPreview = () => {
    targetGap.current?.style.removeProperty("margin-top");
    targetGap.current = null;
    preview.current?.removeAttribute("data-drop-preview");
    preview.current?.removeAttribute("data-origin-preview");
    preview.current?.removeAttribute("data-transport-drop-preview");
    sourceUnit.current?.style.removeProperty("min-height");
    preview.current?.style.removeProperty("--drop-preview-top");
    preview.current?.style.removeProperty("--drop-preview-height");
    preview.current?.style.removeProperty("--drop-preview-leg-height");
    preview.current?.style.removeProperty("--drop-preview-leg-offset");
    preview.current?.style.removeProperty("padding-bottom");
    preview.current = null;
  };
  const showPreview = (list: HTMLElement, top: number) => {
    list.style.setProperty("--drop-preview-top", `${top}px`);
    list.style.setProperty("--drop-preview-height", `${dragHeight.current}px`);
    if (dragLeg.current) {
      list.style.setProperty("--drop-preview-leg-height", `${dragLeg.current.height}px`);
      list.style.setProperty("--drop-preview-leg-offset", `${dragLeg.current.offset}px`);
      list.setAttribute("data-transport-drop-preview", "");
    }
    list.setAttribute("data-drop-preview", "");
    preview.current = list;
  };
  const showOrigin = (sourceId: string) => {
    const list = findList(sourceId);
    if (!list || !dragHeight.current) return;
    sourceUnit.current?.style.setProperty("min-height", `${sourceUnitHeight.current}px`);
    list.setAttribute("data-origin-preview", "");
    showPreview(list, originTop.current);
  };
  const handleDragEnd = (result: DropResult) => {
    clearPreview();
    dragHeight.current = 0;
    originTop.current = 0;
    sourceUnit.current = null;
    sourceUnitHeight.current = 0;
    dragLeg.current = null;
    onDragStateChange(false);
    if (!result.destination) return;
    if (
      result.source.droppableId === result.destination.droppableId &&
      result.source.index === result.destination.index
    )
      return;
    onDrop({
      itemId: result.draggableId,
      sourceId: result.source.droppableId,
      sourceIndex: result.source.index,
      destinationId: result.destination.droppableId,
      destinationIndex: result.destination.index,
    });
  };
  const content = (
    <DragDropContext
      onBeforeCapture={({ draggableId }) => {
        const entry = [...document.querySelectorAll<HTMLElement>("[data-rfd-draggable-id]")].find(
          (element) => element.dataset.rfdDraggableId === draggableId,
        );
        const box = entry?.getBoundingClientRect();
        const list = entry?.closest<HTMLElement>(".itinerary-list");
        dragHeight.current = box?.height ?? 0;
        originTop.current = box && list ? box.top - list.getBoundingClientRect().top : 0;
        sourceUnit.current = entry?.closest<HTMLElement>(".itinerary-unit") ?? null;
        sourceUnitHeight.current = sourceUnit.current?.getBoundingClientRect().height ?? 0;
        const leg = sourceUnit.current?.querySelector<HTMLElement>(".transport-leg");
        const legBox = leg?.getBoundingClientRect();
        dragLeg.current =
          box && legBox ? { height: legBox.height, offset: box.top - legBox.top } : null;
        onDragStateChange(true);
      }}
      onDragStart={({ source }) => {
        showOrigin(source.droppableId);
      }}
      onDragUpdate={({ source, destination }) => {
        clearPreview();
        if (!dragHeight.current) return;
        const sameList = destination?.droppableId === source.droppableId;
        if (!destination || (sameList && source.index === destination.index)) {
          showOrigin(source.droppableId);
          return;
        }
        const list = findList(destination.droppableId);
        if (!list) return;
        const units = [...list.children].filter(
          (element): element is HTMLElement =>
            element instanceof HTMLElement && element.classList.contains("itinerary-unit"),
        );
        const target = units[destination.index];
        const listTop = list.getBoundingClientRect().top;
        const top = target
          ? sameList && destination.index < source.index
            ? listTop + target.offsetTop
            : sameList && destination.index > source.index
              ? target.getBoundingClientRect().bottom
              : target.getBoundingClientRect().top
          : (units.at(-1)?.getBoundingClientRect().bottom ?? listTop);
        const legHeight = dragLeg.current?.height ?? 0;
        if (legHeight) {
          const next =
            units[
              sameList && destination.index > source.index
                ? destination.index + 1
                : destination.index
            ];
          if (next) {
            next.style.marginTop = `${legHeight}px`;
            targetGap.current = next;
          } else {
            list.style.paddingBottom = `${legHeight}px`;
          }
        }
        showPreview(list, top - listTop + legHeight);
      }}
      onDragEnd={handleDragEnd}
    >
      {children}
    </DragDropContext>
  );
  const profiler = (
    globalThis as typeof globalThis & {
      __pacenotesTestItineraryProfiler?: {
        onRender: ProfilerOnRenderCallback;
      };
    }
  ).__pacenotesTestItineraryProfiler;
  if (!profiler) return content;
  return (
    <Profiler id="itinerary" onRender={profiler.onRender}>
      {content}
    </Profiler>
  );
}

export function ItineraryList({
  items,
  droppableId,
  boundary,
  boundaryDate,
  endpointMode = null,
  order,
  places,
  legs,
  distanceUnit,
  warnings,
  selectedId,
  onSelect,
  onDelete,
  onMove,
  empty,
  onTravelMode,
  renderAfter,
}: {
  items: TripItem[];
  droppableId: string;
  order?: readonly string[];
  boundary?: "start" | "end";
  boundaryDate?: string;
  endpointMode?: "transport" | "loose" | null;
  places: ReadonlyMap<string, GooglePlaceView>;
  legs: RouteLeg[];
  distanceUnit: DistanceUnit;
  warnings: ReadonlyMap<string, string[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (item: TripItem) => void;
  onMove?: (id: string, delta: -1 | 1) => void;
  onTravelMode: (id: string, mode: TravelMode) => void;
  renderAfter?: (item: TripItem) => ReactNode;
  empty?: ReactNode;
}) {
  const language = useUiLanguage();
  const text = useTripText();
  const endpoint =
    boundary && endpointMode ? (
      <div
        className={`route-endpoint route-endpoint-${boundary} route-endpoint-${endpointMode}`}
        aria-hidden="true"
      >
        <i className="route-endpoint-rail" />
        <i className="route-endpoint-cap" />
      </div>
    ) : null;
  if (items.length === 0 && boundary) return endpoint;
  const keys = order ?? items.map((item) => (boundary ? `${item.id}:${boundary}` : item.id));
  const continuations = routeContinuations(keys, legs);
  const legByDestination = new Map(legs.map((leg) => [leg.toId, leg]));

  return (
    <>
      {boundary === "start" ? endpoint : null}
      <Droppable droppableId={droppableId} isDropDisabled={Boolean(boundary)}>
        {(drop) => (
          <div className="itinerary-list" ref={drop.innerRef} {...drop.droppableProps}>
            {items.map((item, index) => {
              const key = boundary ? `${item.id}:${boundary}` : item.id;
              const leg = legByDestination.get(key);
              const gap = key !== keys[0] && !leg && !continuations.has(key);
              const title = itemTitle(item, places);
              return (
                <div className={`itinerary-unit${gap ? " entry-gap" : ""}`} key={item.id}>
                  <Draggable
                    draggableId={boundary ? `${item.id}:${boundary}:${droppableId}` : item.id}
                    index={index}
                    isDragDisabled={Boolean(boundary)}
                    disableInteractiveElementBlocking
                  >
                    {(drag, state) => (
                      <>
                        {!state.isDragging && leg ? (
                          <TransportLeg
                            leg={leg}
                            distanceUnit={distanceUnit}
                            onTravelMode={(mode) => onTravelMode(item.id, mode)}
                            motionStyle={{
                              transform: drag.draggableProps.style?.transform,
                              transition: drag.draggableProps.style?.transition,
                              ...(state.isDropAnimating
                                ? { transitionDuration: "0.01s" }
                                : undefined),
                            }}
                          />
                        ) : !state.isDragging && continuations.has(key) ? (
                          <div
                            className="transport-leg leg-continuation"
                            aria-hidden="true"
                            style={{
                              transform: drag.draggableProps.style?.transform,
                              transition: drag.draggableProps.style?.transition,
                              ...(state.isDropAnimating
                                ? { transitionDuration: "0.01s" }
                                : undefined),
                            }}
                          >
                            <i className="leg-rail" />
                          </div>
                        ) : null}
                        <article
                          ref={drag.innerRef}
                          {...drag.draggableProps}
                          {...(!boundary ? drag.dragHandleProps : {})}
                          style={{
                            ...drag.draggableProps.style,
                            ...(state.isDropAnimating
                              ? { transitionDuration: "0.01s" }
                              : undefined),
                          }}
                          className={`itinerary-entry${boundary ? " lodging-boundary" : ""}${selectedId === item.id ? " is-selected" : ""}${state.isDragging ? " is-dragging" : ""}`}
                        >
                          <span className="entry-type-icon" aria-hidden="true">
                            <Icon icon={iconForItem(item)} />
                          </span>
                          {boundary ? (
                            <time className="entry-boundary">
                              {boundary === "start" && item.lodging && boundaryDate
                                ? `${text("leaveAt")} ${lodgingLeaveTime(item.lodging, boundaryDate)}`
                                : text(boundary === "start" ? "start" : "end")}
                            </time>
                          ) : null}
                          <div className="entry-copy">
                            <button
                              type="button"
                              className="entry-select"
                              onClick={() => onSelect(item.id)}
                            >
                              {title}
                            </button>
                            {item.details ? <small>{firstLine(item.details)}</small> : null}
                            {item.transport ? (
                              <small>{transportDescription(item, places, language)}</small>
                            ) : null}
                            {warnings.get(item.id)?.length ? (
                              <small className="schedule-warning">
                                {warnings.get(item.id)?.join(" ")}
                              </small>
                            ) : null}
                          </div>
                          {item.reservation?.confirmation ? (
                            <span className="status-pill">
                              <i aria-hidden="true" />
                              {text("confirmed")}
                            </span>
                          ) : null}
                          {!boundary ? <time>{item.startTime ?? ""}</time> : null}
                          <div className="entry-actions">
                            {!boundary ? (
                              <>
                                <button
                                  type="button"
                                  className="icon-button"
                                  aria-label={text("moveUp", { title })}
                                  disabled={index === 0}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onMove?.(item.id, -1);
                                  }}
                                >
                                  <Icon icon={chevronUpIcon} />
                                </button>
                                <button
                                  type="button"
                                  className="icon-button"
                                  aria-label={text("moveDown", { title })}
                                  disabled={index === items.length - 1}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onMove?.(item.id, 1);
                                  }}
                                >
                                  <Icon icon={chevronDownIcon} />
                                </button>
                              </>
                            ) : null}
                            <button
                              type="button"
                              className="icon-button danger-icon"
                              aria-label={text("deleteItem", { title })}
                              onClick={(event) => {
                                event.stopPropagation();
                                onDelete(item);
                              }}
                            >
                              <Icon icon={trashIcon} />
                            </button>
                          </div>
                        </article>
                      </>
                    )}
                  </Draggable>
                  {renderAfter?.(item)}
                </div>
              );
            })}
            {items.length === 0 ? empty : null}
            <TransportLeg placeholder />
            {drop.placeholder}
          </div>
        )}
      </Droppable>
      {boundary === "end" ? endpoint : null}
    </>
  );
}

function TransportLeg(
  props:
    | { placeholder: true }
    | {
        leg: RouteLeg;
        onTravelMode: (mode: TravelMode) => void;
        distanceUnit: DistanceUnit;
        motionStyle?: CSSProperties;
      },
) {
  const language = useUiLanguage();
  const text = useTripText();
  if ("placeholder" in props) {
    return (
      <div className="transport-leg leg-preview" aria-hidden="true">
        <i className="leg-rail" />
        <span className="leg-summary">
          <Icon icon={routeIcon} aria-hidden="true" />
          {text("transport")}
        </span>
        <i className="leg-mode-placeholder" />
      </div>
    );
  }
  const { leg, onTravelMode, distanceUnit, motionStyle } = props;
  const routeUrl = googleMapsRouteUrl([leg.from, leg.to], leg.mode);
  const duration =
    leg.durationMinutes === null
      ? text("routeUnavailable")
      : formatTravelDuration(leg.durationMinutes, language);
  return (
    <div
      className={`transport-leg state-${leg.state}`}
      style={{ "--leg-color": leg.color, ...motionStyle } as CSSProperties}
    >
      <i className="leg-rail" aria-hidden="true" />
      <span className="leg-summary">
        <Icon icon={iconForTravelMode(leg.mode)} aria-hidden="true" />
        {leg.state === "updating"
          ? text("updatingRoute")
          : `${leg.state === "stale" ? `${text("stale")} - ` : ""}${[
              duration,
              formatDistance(leg.distanceMeters, distanceUnit, language),
            ]
              .filter(Boolean)
              .join(" - ")}`}
        {routeUrl ? (
          <a
            className="icon-button leg-export"
            href={routeUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={text("openLegGoogleMaps")}
          >
            <Icon icon={routeIcon} />
          </a>
        ) : null}
      </span>
      <Dropdown
        className="leg-mode"
        compact
        label={text("travelMode")}
        value={leg.mode}
        options={travelModes.map((mode) => ({
          value: mode,
          label: travelModeLabel(language, mode),
          icon: <Icon icon={iconForTravelMode(mode)} />,
        }))}
        onChange={(mode) => onTravelMode(mode as TravelMode)}
      />
    </div>
  );
}

function firstLine(value: string): string {
  return value.split("\n", 1)[0] ?? "";
}

function formatDistance(meters: number | null, unit: DistanceUnit, language: TripLanguage): string {
  if (meters === null) return "";
  const value =
    unit === "imperial"
      ? { amount: meters / 1609.344, unit: "mile" as const }
      : { amount: meters / 1000, unit: "kilometer" as const };
  return new Intl.NumberFormat(language, {
    style: "unit",
    unit: value.unit,
    unitDisplay: "short",
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(value.amount);
}
function transportDescription(
  item: TripItem,
  places: ReadonlyMap<string, GooglePlaceView>,
  language: TripLanguage,
): string {
  const transport = item.transport;
  if (!transport) return "";
  const text = createTripText(language);
  const mode =
    transport.mode === "custom"
      ? transport.customMode
      : text(transport.mode as "plane" | "train" | "bus" | "ferry");
  const from = transport.from
    ? places.get(transport.from.placeId)?.displayName || text("from")
    : "";
  const to = transport.to ? places.get(transport.to.placeId)?.displayName || text("to") : "";
  return [mode, [from, to].filter(Boolean).join(" → ")].filter(Boolean).join(" - ");
}
