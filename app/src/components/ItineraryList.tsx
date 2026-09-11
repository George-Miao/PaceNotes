import {
  DragDropContext,
  Draggable,
  type DraggingStyle,
  Droppable,
  type DropResult,
} from "@hello-pangea/dnd";
import { Icon } from "@iconify/react";
import bedDoubleIcon from "@iconify-icons/lucide/bed-double";
import busIcon from "@iconify-icons/lucide/bus";
import calendarCheckIcon from "@iconify-icons/lucide/calendar-check-2";
import carFrontIcon from "@iconify-icons/lucide/car-front";
import chevronDownIcon from "@iconify-icons/lucide/chevron-down";
import chevronUpIcon from "@iconify-icons/lucide/chevron-up";
import clockIcon from "@iconify-icons/lucide/clock-3";
import footprintsIcon from "@iconify-icons/lucide/footprints";
import mapPinIcon from "@iconify-icons/lucide/map-pin";
import planeIcon from "@iconify-icons/lucide/plane";
import routeIcon from "@iconify-icons/lucide/route";
import shipIcon from "@iconify-icons/lucide/ship";
import stickyNoteIcon from "@iconify-icons/lucide/sticky-note";
import trainFrontIcon from "@iconify-icons/lucide/train-front";
import trashIcon from "@iconify-icons/lucide/trash-2";
import {
  type CSSProperties,
  Fragment,
  Profiler,
  type ProfilerOnRenderCallback,
  type ReactNode,
} from "react";
import type { GooglePlaceView } from "~/features/google/google";
import { itemTitle } from "~/features/google/item-title";
import { googleMapsRouteUrl } from "~/features/google/route-export";
import type { RouteLeg } from "~/features/google/route-legs";
import { routeContinuations } from "~/features/trip/day-plan";
import {
  createTripText,
  travelModeLabel,
  useTripLanguage,
  useTripText,
} from "~/features/trip/language";
import {
  type DistanceUnit,
  type TravelMode,
  type TripItem,
  type TripLanguage,
  travelModes,
} from "~/features/trip/model";

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
}: {
  children: ReactNode;
  onDrop: (drop: ItineraryDrop) => void;
}) {
  const handleDragEnd = (result: DropResult) => {
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
  const content = <DragDropContext onDragEnd={handleDragEnd}>{children}</DragDropContext>;
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
  connectedEndpoint = false,
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
  connectedEndpoint?: boolean;
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
  const language = useTripLanguage();
  const text = useTripText();
  const endpoint =
    boundary && connectedEndpoint ? (
      <div
        className={`route-endpoint route-endpoint-${boundary} route-endpoint-connected`}
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
                  {leg ? (
                    <TransportLeg
                      leg={leg}
                      distanceUnit={distanceUnit}
                      onTravelMode={(mode) => onTravelMode(item.id, mode)}
                    />
                  ) : continuations.has(key) ? (
                    <div className="transport-leg leg-continuation" aria-hidden="true">
                      <i className="leg-rail" />
                    </div>
                  ) : null}
                  <Draggable
                    draggableId={boundary ? `${item.id}:${boundary}:${droppableId}` : item.id}
                    index={index}
                    isDragDisabled={Boolean(boundary)}
                    disableInteractiveElementBlocking
                  >
                    {(drag, state) => (
                      <Fragment>
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
                              {boundary === "start" ? text("start") : text("end")}
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
                        {state.isDragging ? (
                          <div
                            className="entry-drag-space"
                            style={{
                              height: (drag.draggableProps.style as DraggingStyle).height,
                            }}
                            aria-hidden="true"
                          />
                        ) : null}
                      </Fragment>
                    )}
                  </Draggable>
                  {renderAfter?.(item)}
                </div>
              );
            })}
            {items.length === 0 ? empty : null}
            {drop.placeholder}
          </div>
        )}
      </Droppable>
      {boundary === "end" ? endpoint : null}
    </>
  );
}

function TransportLeg({
  leg,
  onTravelMode,
  distanceUnit,
}: {
  leg: RouteLeg;
  distanceUnit: DistanceUnit;
  onTravelMode: (mode: TravelMode) => void;
}) {
  const language = useTripLanguage();
  const text = useTripText();
  const routeUrl = googleMapsRouteUrl([leg.from, leg.to], leg.mode);
  return (
    <div
      className={`transport-leg state-${leg.state}`}
      style={{ "--leg-color": leg.color } as CSSProperties}
    >
      <i className="leg-rail" aria-hidden="true" />
      <span className="leg-summary">
        <Icon icon={iconForMode(leg.mode)} aria-hidden="true" />
        {leg.state === "updating"
          ? text("updatingRoute")
          : `${leg.state === "stale" ? `${text("stale")} - ` : ""}${[
              leg.duration,
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
      <label className="leg-mode">
        <span className="sr-only">{text("travelMode")}</span>
        <select
          value={leg.mode}
          onChange={(event) => onTravelMode(event.target.value as TravelMode)}
        >
          {travelModes.map((mode) => (
            <option key={mode} value={mode}>
              {travelModeLabel(language, mode)}
            </option>
          ))}
        </select>
        <Icon icon={chevronDownIcon} aria-hidden="true" />
      </label>
    </div>
  );
}

function iconForItem(item: TripItem) {
  if (item.type === "note") return stickyNoteIcon;
  if (item.type === "lodging") return bedDoubleIcon;
  if (item.type === "reservation") return calendarCheckIcon;
  if (item.type === "transport") {
    switch (item.transport?.mode) {
      case "plane":
        return planeIcon;
      case "bus":
        return busIcon;
      case "ferry":
        return shipIcon;
      case "custom":
        return routeIcon;
      default:
        return trainFrontIcon;
    }
  }
  return item.place ? mapPinIcon : clockIcon;
}

function iconForMode(mode: TravelMode) {
  if (mode === "WALKING") return footprintsIcon;
  if (mode === "TRANSIT") return trainFrontIcon;
  return carFrontIcon;
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
