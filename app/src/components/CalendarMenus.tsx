import { Icon } from "@iconify/react";
import arrowDownIcon from "@iconify-icons/lucide/arrow-down";
import arrowLeftIcon from "@iconify-icons/lucide/arrow-left";
import arrowRightIcon from "@iconify-icons/lucide/arrow-right";
import arrowUpIcon from "@iconify-icons/lucide/arrow-up";
import bedDoubleIcon from "@iconify-icons/lucide/bed-double";
import calendarCheckIcon from "@iconify-icons/lucide/calendar-check";
import chevronDownIcon from "@iconify-icons/lucide/chevron-down";
import chevronUpIcon from "@iconify-icons/lucide/chevron-up";
import clockIcon from "@iconify-icons/lucide/clock-3";
import copyIcon from "@iconify-icons/lucide/copy";
import mapPinIcon from "@iconify-icons/lucide/map-pin";
import minusIcon from "@iconify-icons/lucide/minus";
import pencilIcon from "@iconify-icons/lucide/pencil";
import plusIcon from "@iconify-icons/lucide/plus";
import routeIcon from "@iconify-icons/lucide/route";
import trashIcon from "@iconify-icons/lucide/trash-2";
import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { CalendarSegment } from "~/features/trip/calendar-layout";
import { createTripText } from "~/features/trip/language";
import type { TripItem, TripLanguage } from "~/features/trip/model";
import styles from "./Calendar.module.css";

export type CalendarItemAction =
  | "earlier"
  | "later"
  | "previous-day"
  | "next-day"
  | "move-up"
  | "move-down"
  | "shorter"
  | "longer"
  | "flexible"
  | "duplicate"
  | "edit"
  | "delete";
export type CalendarLodgingAction = Extract<CalendarItemAction, "duplicate" | "edit" | "delete">;

export type CalendarAddType = "place" | "reservation" | "lodging" | "transport";
export type CalendarMenuPosition = { left: number; top: number };
export type CalendarMenuState =
  | {
      type: "item";
      segment: CalendarSegment;
      position: CalendarMenuPosition;
      focusFirst: boolean;
    }
  | {
      type: "lodging";
      item: TripItem;
      position: CalendarMenuPosition;
      focusFirst: boolean;
    }
  | {
      type: "all-day";
      dayId: string;
      position: CalendarMenuPosition;
      focusFirst: boolean;
    }
  | {
      type: "empty";
      dayId: string;
      startTime: string;
      position: CalendarMenuPosition;
      focusFirst: boolean;
    };

type CalendarMenuCommands = {
  titleForItem: (item: TripItem) => string;
  canReorderItem: (item: TripItem, direction: -1 | 1) => boolean;
  item: (segment: CalendarSegment, action: CalendarItemAction) => void;
  lodging: (item: TripItem, action: CalendarLodgingAction) => void;
  add: (
    type: CalendarAddType,
    dayId: string,
    startTime: string | null,
    position: CalendarMenuPosition,
  ) => void;
  close: () => void;
};

export function CalendarMenus({
  menu,
  language,
  commands,
}: {
  menu: CalendarMenuState | null;
  language: TripLanguage;
  commands: CalendarMenuCommands;
}) {
  if (!menu) return null;
  if (menu.type === "item") {
    return (
      <ItemActions
        title={commands.titleForItem(menu.segment.item)}
        position={menu.position}
        language={language}
        focusFirst={menu.focusFirst}
        canMoveUp={commands.canReorderItem(menu.segment.item, -1)}
        canMoveDown={commands.canReorderItem(menu.segment.item, 1)}
        canMakeFlexible={
          menu.segment.item.startTime !== null && menu.segment.item.type !== "reservation"
        }
        onAction={(action) => commands.item(menu.segment, action)}
        onClose={commands.close}
      />
    );
  }
  if (menu.type === "lodging") {
    return (
      <LodgingActions
        title={commands.titleForItem(menu.item)}
        position={menu.position}
        language={language}
        focusFirst={menu.focusFirst}
        onAction={(action) => commands.lodging(menu.item, action)}
        onClose={commands.close}
      />
    );
  }

  return (
    <AddActions
      type={menu.type}
      position={menu.position}
      language={language}
      focusFirst={menu.focusFirst}
      onAdd={(type) =>
        commands.add(type, menu.dayId, menu.type === "empty" ? menu.startTime : null, menu.position)
      }
      onClose={commands.close}
    />
  );
}

function ContextMenuSurface({
  label,
  position,
  children,
  focusFirst,
  onClose,
}: {
  label: string;
  position: CalendarMenuPosition;
  focusFirst: boolean;
  children: ReactNode;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusFirst) menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const closeOnViewportChange = () => onClose();
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnViewportChange);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnViewportChange);
    };
  }, [focusFirst, onClose]);

  return createPortal(
    <div ref={menu} className={styles.actionMenu} style={position} role="menu" aria-label={label}>
      {children}
    </div>,
    document.body,
  );
}

function ItemActions({
  title,
  canMakeFlexible,
  canMoveUp,
  canMoveDown,
  position,
  focusFirst,
  language,
  onAction,
  onClose,
}: {
  title: string;
  position: CalendarMenuPosition;
  focusFirst: boolean;
  canMakeFlexible: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  language: TripLanguage;
  onAction: (action: CalendarItemAction) => void;
  onClose: () => void;
}) {
  const text = createTripText(language);
  const directions = [
    ["previous-day", arrowLeftIcon, text("previousDay"), false],
    ["next-day", arrowRightIcon, text("nextDay"), false],
    ["earlier", arrowUpIcon, text("earlier15"), false],
    ["later", arrowDownIcon, text("later15"), false],
    ["move-up", chevronUpIcon, text("moveUp", { title }), !canMoveUp],
    ["move-down", chevronDownIcon, text("moveDown", { title }), !canMoveDown],
  ] as const;
  const actions = [
    ["edit", pencilIcon, text("edit")],
    ["duplicate", copyIcon, text("duplicate")],
    ["longer", plusIcon, text("longer15")],
    ["shorter", minusIcon, text("shorter15")],
    ...(canMakeFlexible ? ([["flexible", clockIcon, text("makeFlexible")]] as const) : []),
    ["delete", trashIcon, text("delete")],
  ] as const;
  const run = (action: CalendarItemAction) => {
    onAction(action);
    onClose();
  };

  return (
    <ContextMenuSurface
      label={text("calendarActions", { title })}
      focusFirst={focusFirst}
      position={position}
      onClose={onClose}
    >
      <div className={styles.actionDirections}>
        {directions.map(([action, icon, label, disabled]) => (
          <button
            className={styles.directionAction}
            key={action}
            type="button"
            role="menuitem"
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={() => run(action)}
          >
            <Icon icon={icon} />
          </button>
        ))}
      </div>
      {actions.map(([action, icon, label]) => (
        <button
          className={`${styles.menuAction}${action === "delete" ? ` ${styles.dangerAction}` : ""}`}
          key={action}
          type="button"
          role="menuitem"
          onClick={() => run(action)}
        >
          <Icon icon={icon} />
          <span>{label}</span>
        </button>
      ))}
    </ContextMenuSurface>
  );
}

function LodgingActions({
  title,
  position,
  focusFirst,
  language,
  onAction,
  onClose,
}: {
  title: string;
  position: CalendarMenuPosition;
  focusFirst: boolean;
  language: TripLanguage;
  onAction: (action: CalendarLodgingAction) => void;
  onClose: () => void;
}) {
  const text = createTripText(language);
  const actions = [
    ["edit", pencilIcon, text("edit")],
    ["duplicate", copyIcon, text("duplicate")],
    ["delete", trashIcon, text("delete")],
  ] as const;

  return (
    <ContextMenuSurface
      label={text("calendarActions", { title })}
      focusFirst={focusFirst}
      position={position}
      onClose={onClose}
    >
      {actions.map(([action, icon, label]) => (
        <button
          className={`${styles.menuAction}${action === "delete" ? ` ${styles.dangerAction}` : ""}`}
          key={action}
          type="button"
          role="menuitem"
          onClick={() => {
            onAction(action);
            onClose();
          }}
        >
          <Icon icon={icon} />
          <span>{label}</span>
        </button>
      ))}
    </ContextMenuSurface>
  );
}

function AddActions({
  type,
  position,
  focusFirst,
  language,
  onAdd,
  onClose,
}: {
  type: "all-day" | "empty";
  position: CalendarMenuPosition;
  focusFirst: boolean;
  language: TripLanguage;
  onAdd: (type: CalendarAddType) => void;
  onClose: () => void;
}) {
  const text = createTripText(language);
  const actions =
    type === "all-day"
      ? ([["lodging", bedDoubleIcon, text("addLodging")]] as const)
      : ([
          ["place", mapPinIcon, text("calendarAddPlace")],
          ["reservation", calendarCheckIcon, text("addReservation")],
          ["transport", routeIcon, text("addTransport")],
        ] as const);

  return (
    <ContextMenuSurface
      label={text("calendarAddItem")}
      position={position}
      focusFirst={focusFirst}
      onClose={onClose}
    >
      {actions.map(([action, icon, label]) => (
        <button
          className={styles.menuAction}
          key={action}
          type="button"
          role="menuitem"
          onClick={() => {
            onAdd(action);
            onClose();
          }}
        >
          <Icon icon={icon} />
          <span>{label}</span>
        </button>
      ))}
    </ContextMenuSurface>
  );
}
