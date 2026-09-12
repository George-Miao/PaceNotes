import bedDoubleIcon from "@iconify-icons/lucide/bed-double";
import busIcon from "@iconify-icons/lucide/bus";
import calendarCheckIcon from "@iconify-icons/lucide/calendar-check-2";
import clockIcon from "@iconify-icons/lucide/clock-3";
import mapPinIcon from "@iconify-icons/lucide/map-pin";
import planeIcon from "@iconify-icons/lucide/plane";
import routeIcon from "@iconify-icons/lucide/route";
import shipIcon from "@iconify-icons/lucide/ship";
import stickyNoteIcon from "@iconify-icons/lucide/sticky-note";
import trainFrontIcon from "@iconify-icons/lucide/train-front";
import type { TripItem } from "~/features/trip/model";

export function iconForItem(item: TripItem) {
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
