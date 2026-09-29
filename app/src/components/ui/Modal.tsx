import { Icon } from "@iconify/react";
import xIcon from "@iconify-icons/lucide/x";
import { type ReactNode, type RefObject, useEffect, useId, useRef } from "react";
import { useTripText } from "~/features/trip/language";
import styles from "./Modal.module.css";

export function Modal({
  title,
  onClose,
  children,
  wide = false,
  stacked = false,
  initialFocus,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  stacked?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
}) {
  const text = useTripText();
  const headingId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (!element.open) element.showModal();
    initialFocus?.current?.focus();
    return () => {
      if (element.open) element.close();
    };
  }, [initialFocus]);
  return (
    <dialog
      ref={ref}
      className={`${styles.modal} ${wide ? styles.wideModal : ""} ${stacked ? styles.stackedModal : ""}`}
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          onClose();
        }
      }}
    >
      <div className={styles.header}>
        <h2 id={headingId}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label={text("closeDialog")}
          onClick={onClose}
        >
          <Icon icon={xIcon} aria-hidden="true" />
        </button>
      </div>
      <div className={styles.body}>{children}</div>
    </dialog>
  );
}
