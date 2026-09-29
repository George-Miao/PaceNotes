import { Icon } from "@iconify/react";
import chevronDownIcon from "@iconify-icons/lucide/chevron-down";
import {
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useTripText } from "~/features/trip/language";
import styles from "./Dropdown.module.css";

export type DropdownOption = {
  value: string;
  label: string;
  ariaLabel?: string;
  groupLabel?: string;
  muted?: boolean;
  icon?: ReactNode;
  disabled?: boolean;
  separatorAfter?: boolean;
};

export type DropdownProps = {
  value: string;
  options: readonly DropdownOption[];
  onChange: (value: string) => void;
  label: string;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  compact?: boolean;
  placeholder?: string;
};

export function Dropdown({
  value,
  options,
  onChange,
  label,
  id,
  disabled = false,
  required = false,
  className,
  compact = false,
  placeholder,
}: DropdownProps) {
  const text = useTripText();
  const displayPlaceholder = placeholder ?? text("select");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", time: 0 });
  const listId = useId();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];

  useEffect(() => {
    if (!open || !trigger.current || !list.current) return;
    const button = trigger.current;
    const popup = list.current;
    popup.showPopover();

    function position() {
      const anchor = button.getBoundingClientRect();
      const width = Math.min(Math.max(anchor.width, 12 * 16), window.innerWidth - 16);
      popup.style.width = `${width}px`;
      popup.style.maxHeight = `${Math.min(320, window.innerHeight - 16)}px`;
      const height = popup.getBoundingClientRect().height;
      const above = window.innerHeight - anchor.bottom < height + 8 && anchor.top > height;
      popup.style.top = `${above ? anchor.top - height - 4 : Math.min(anchor.bottom + 4, window.innerHeight - height - 8)}px`;
      popup.style.left = `${Math.min(Math.max(8, anchor.left), window.innerWidth - width - 8)}px`;
    }

    function onPointerDown(event: PointerEvent) {
      if (!button.contains(event.target as Node) && !popup.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    position();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      if (popup.matches(":popover-open")) popup.hidePopover();
    };
  }, [open]);

  useEffect(() => {
    if (open && activeIndex >= 0) {
      list.current
        ?.querySelectorAll('[role="option"]')
        [activeIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, open]);

  function firstEnabled(from: number, step: number): number {
    const count = options.length;
    for (let offset = 0; offset < count; offset++) {
      const index = (((from + step * offset) % count) + count) % count;
      if (!options[index]?.disabled) return index;
    }
    return -1;
  }

  function begin(index = selectedIndex) {
    if (disabled || options.length === 0) return;
    setActiveIndex(index >= 0 && !options[index]?.disabled ? index : firstEnabled(0, 1));
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    trigger.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      if (!open) begin();
      else setActiveIndex(firstEnabled(activeIndex + step + options.length, step));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (!open) begin(event.key === "Home" ? 0 : options.length - 1);
      else
        setActiveIndex(
          firstEnabled(
            event.key === "Home" ? 0 : options.length - 1,
            event.key === "Home" ? 1 : -1,
          ),
        );
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(activeIndex);
      else begin();
      return;
    }
    if (event.key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey) return;
    const now = Date.now();
    search.current.text =
      (now - search.current.time < 700 ? search.current.text : "") + event.key.toLocaleLowerCase();
    search.current.time = now;
    const start = open ? activeIndex + 1 : selectedIndex + 1;
    for (let offset = 0; offset < options.length; offset++) {
      const index = (start + offset + options.length) % options.length;
      const option = options[index];
      if (
        option &&
        !option.disabled &&
        option.label.toLocaleLowerCase().startsWith(search.current.text)
      ) {
        event.preventDefault();
        setActiveIndex(index);
        setOpen(true);
        return;
      }
    }
  }

  return (
    <div
      className={`${styles.root}${compact ? ` ${styles.compact}` : ""}${className ? ` ${className}` : ""}`}
    >
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-label={`${label}: ${selected?.ariaLabel ?? selected?.label ?? displayPlaceholder}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        aria-required={required || undefined}
        disabled={disabled}
        className={styles.trigger}
        onClick={() => (open ? setOpen(false) : begin())}
        onKeyDown={onKeyDown}
      >
        {selected ? (
          <span className={`${styles.value}${selected.muted ? ` ${styles.muted}` : ""}`}>
            {selected.icon ? (
              <span className={styles.icon} aria-hidden="true">
                {selected.icon}
              </span>
            ) : null}
            <span className={styles.text}>{selected.label}</span>
          </span>
        ) : (
          <span className={`${styles.value} ${styles.placeholder}`}>{displayPlaceholder}</span>
        )}
        <Icon icon={chevronDownIcon} aria-hidden="true" className={styles.chevron} />
      </button>
      {open ? (
        <div
          ref={list}
          id={listId}
          className={styles.list}
          role="listbox"
          aria-label={label}
          popover="manual"
        >
          {options.map((option, index) => (
            <Fragment key={option.value}>
              {option.groupLabel ? (
                <div className={styles.groupLabel} aria-hidden="true">
                  {option.groupLabel}
                </div>
              ) : null}
              <button
                type="button"
                tabIndex={-1}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={option.value === value}
                aria-label={option.ariaLabel}
                aria-disabled={option.disabled || undefined}
                className={`${styles.option}${index === activeIndex ? ` ${styles.active}` : ""}${option.disabled ? ` ${styles.disabled}` : ""}${option.muted ? ` ${styles.muted}` : ""}`}
                onPointerDown={(event) => event.preventDefault()}
                onMouseEnter={() => {
                  if (!option.disabled) setActiveIndex(index);
                }}
                onClick={() => choose(index)}
              >
                {option.icon ? (
                  <span className={styles.icon} aria-hidden="true">
                    {option.icon}
                  </span>
                ) : null}
                <span>{option.label}</span>
              </button>
              {option.separatorAfter ? (
                <div className={styles.separator} aria-hidden="true" />
              ) : null}
            </Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}
