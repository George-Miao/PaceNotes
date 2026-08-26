import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { Icon } from "@iconify/react";
import bedDoubleIcon from "@iconify-icons/lucide/bed-double";
import calendarCheckIcon from "@iconify-icons/lucide/calendar-check-2";
import carFrontIcon from "@iconify-icons/lucide/car-front";
import chevronDownIcon from "@iconify-icons/lucide/chevron-down";
import chevronUpIcon from "@iconify-icons/lucide/chevron-up";
import clockIcon from "@iconify-icons/lucide/clock-3";
import footprintsIcon from "@iconify-icons/lucide/footprints";
import gripIcon from "@iconify-icons/lucide/grip-vertical";
import mapPinIcon from "@iconify-icons/lucide/map-pin";
import stickyNoteIcon from "@iconify-icons/lucide/sticky-note";
import trainFrontIcon from "@iconify-icons/lucide/train-front";
import trashIcon from "@iconify-icons/lucide/trash-2";
import { useState } from "react";
import type { RouteLeg } from "~/features/google/route-legs";
import type { TravelMode, TripItem } from "~/features/trip/model";

export function ItineraryList({
  items,
  legs,
  warnings,
  selectedId,
  onSelect,
  onDelete,
  onMove,
  onReorder,
  onTravelMode,
}: {
  items: TripItem[];
  legs: RouteLeg[];
  warnings: ReadonlyMap<string, string[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (item: TripItem) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onReorder: (source: number, destination: number) => void;
  onTravelMode: (id: string, mode: TravelMode) => void;
}) {
  const [expandedLeg, setExpandedLeg] = useState<string | null>(null);
  const legByDestination = new Map(legs.map((leg) => [leg.toId, leg]));
  const handleDragEnd = (result: DropResult) => {
    if (!result.destination || result.source.index === result.destination.index) return;
    onReorder(result.source.index, result.destination.index);
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <Droppable droppableId="itinerary">
        {(drop) => (
          <div className="itinerary-list" ref={drop.innerRef} {...drop.droppableProps}>
            {items.map((item, index) => {
              const leg = legByDestination.get(item.id);
              return (
                <div className="itinerary-unit" key={item.id}>
                  {leg ? (
                    <TransportLeg
                      leg={leg}
                      expanded={expandedLeg === item.id}
                      onToggle={() =>
                        setExpandedLeg((current) => (current === item.id ? null : item.id))
                      }
                      onTravelMode={(mode) => onTravelMode(item.id, mode)}
                    />
                  ) : null}
                  <Draggable draggableId={item.id} index={index}>
                    {(drag, state) => (
                      <article
                        ref={drag.innerRef}
                        {...drag.draggableProps}
                        className={`itinerary-entry${selectedId === item.id ? " is-selected" : ""}${state.isDragging ? " is-dragging" : ""}`}
                      >
                        <time>{item.startTime ?? "Open"}</time>
                        <span className="entry-type-icon" aria-hidden="true">
                          <Icon icon={iconForItem(item)} />
                        </span>
                        <div className="entry-copy">
                          <button
                            type="button"
                            className="entry-select"
                            onClick={() => onSelect(item.id)}
                          >
                            {item.title}
                          </button>
                          {item.details ? <small>{firstLine(item.details)}</small> : null}
                          {warnings.get(item.id)?.map((message) => (
                            <small className="schedule-warning" key={message}>
                              {message}
                            </small>
                          ))}
                        </div>
                        {item.reservation?.confirmation ? (
                          <span className="status-pill">
                            <i aria-hidden="true" />
                            Confirmed
                          </span>
                        ) : null}
                        <div className="entry-actions">
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Move ${item.title} up`}
                            disabled={index === 0}
                            onClick={(event) => {
                              event.stopPropagation();
                              onMove(item.id, -1);
                            }}
                          >
                            <Icon icon={chevronUpIcon} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Move ${item.title} down`}
                            disabled={index === items.length - 1}
                            onClick={(event) => {
                              event.stopPropagation();
                              onMove(item.id, 1);
                            }}
                          >
                            <Icon icon={chevronDownIcon} />
                          </button>
                          <button
                            type="button"
                            className="icon-button drag-handle"
                            aria-label={`Reorder ${item.title}`}
                            onClick={(event) => event.stopPropagation()}
                            {...drag.dragHandleProps}
                          >
                            <Icon icon={gripIcon} />
                          </button>
                          <button
                            type="button"
                            className="icon-button danger-icon"
                            aria-label={`Delete ${item.title}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              onDelete(item);
                            }}
                          >
                            <Icon icon={trashIcon} />
                          </button>
                        </div>
                      </article>
                    )}
                  </Draggable>
                </div>
              );
            })}
            {drop.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}

function TransportLeg({
  leg,
  expanded,
  onToggle,
  onTravelMode,
}: {
  leg: RouteLeg;
  expanded: boolean;
  onToggle: () => void;
  onTravelMode: (mode: TravelMode) => void;
}) {
  return (
    <div className={`transport-leg state-${leg.state}`}>
      <i className="leg-rail" aria-hidden="true" />
      <span className="leg-summary">
        <Icon icon={iconForMode(leg.mode)} aria-hidden="true" />
        {leg.state === "updating"
          ? "Updating route"
          : `${leg.state === "stale" ? "Stale - " : ""}${[leg.duration, leg.distance].filter(Boolean).join(" - ")}`}
      </span>
      <button type="button" onClick={onToggle} aria-expanded={expanded}>
        Directions <Icon icon={chevronDownIcon} />
      </button>
      {expanded ? (
        <div className="leg-options">
          <label>
            Travel mode
            <select
              value={leg.mode}
              onChange={(event) => onTravelMode(event.target.value as TravelMode)}
            >
              <option value="DRIVING">Driving</option>
              <option value="TRANSIT">Public transport</option>
              <option value="WALKING">Walking</option>
            </select>
          </label>
          <span>Route changes update the map after edits settle.</span>
        </div>
      ) : null}
    </div>
  );
}

function iconForItem(item: TripItem) {
  if (item.type === "note") return stickyNoteIcon;
  if (item.type === "lodging") return bedDoubleIcon;
  if (item.type === "reservation") return calendarCheckIcon;
  if (item.type === "transport") return trainFrontIcon;
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
