import { Icon } from "@iconify/react";
import stickyNoteIcon from "@iconify-icons/lucide/sticky-note";
import type { DragEvent } from "react";
import type { TripItem } from "~/features/trip/model";
import styles from "./Calendar.module.css";

export function NoteStack({
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

export function dropNote(
  event: DragEvent,
  dayId: string,
  afterItemId: string | null,
  onMove: (noteId: string, dayId: string, afterItemId: string | null) => void,
) {
  event.preventDefault();
  const noteId = event.dataTransfer.getData("application/x-pacenotes-note");
  if (noteId) onMove(noteId, dayId, afterItemId);
}
