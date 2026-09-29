import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type TooltipState = {
  immediate: boolean;
  label: string;
  left: number;
  side: "bottom" | "top";
  top: number;
};

const selector = ".icon-button[aria-label]";

export function IconButtonTooltips() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  useEffect(() => {
    let active: HTMLElement | null = null;

    const buttonFor = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>(selector) : null;

    const show = (event: Event) => {
      const button = buttonFor(event.target);
      const label = button?.getAttribute("aria-label")?.trim();
      if (!button || !label) return;
      active = button;
      setTooltip(positionTooltip(button, label, event.type === "focusin"));
    };

    const hide = (event: Event) => {
      const button = buttonFor(event.target);
      if (
        !button ||
        button !== active ||
        button === buttonFor((event as FocusEvent).relatedTarget)
      ) {
        return;
      }
      if (event.type === "pointerout" && button.matches(":focus-visible")) return;
      active = null;
      setTooltip(null);
    };

    const reposition = () => {
      if (!active?.isConnected) {
        active = null;
        setTooltip(null);
        return;
      }
      const label = active.getAttribute("aria-label")?.trim();
      if (!label) {
        active = null;
        setTooltip(null);
        return;
      }
      setTooltip(positionTooltip(active, label, true));
    };

    const hideDetached = () => {
      if (!active || active.isConnected) return;
      active = null;
      setTooltip(null);
    };
    const observer = new MutationObserver(hideDetached);
    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener("pointerover", show);
    document.addEventListener("pointerout", hide);
    document.addEventListener("focusin", show);
    document.addEventListener("focusout", hide);
    document.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("pointerover", show);
      document.removeEventListener("pointerout", hide);
      document.removeEventListener("focusin", show);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      observer.disconnect();
    };
  }, []);

  if (!tooltip) return null;
  return createPortal(
    <div
      className="icon-tooltip"
      data-immediate={tooltip.immediate || undefined}
      data-side={tooltip.side}
      role="tooltip"
      style={{ left: tooltip.left, top: tooltip.top }}
    >
      {tooltip.label}
    </div>,
    document.body,
  );
}

function positionTooltip(target: HTMLElement, label: string, immediate: boolean): TooltipState {
  const rect = target.getBoundingClientRect();
  const estimatedWidth = Math.min(288, Math.max(32, label.length * 6.25 + 16));
  const halfLimit = Math.min(estimatedWidth / 2, Math.max(0, (window.innerWidth - 16) / 2));
  const left = Math.min(
    window.innerWidth - halfLimit - 8,
    Math.max(halfLimit + 8, rect.left + rect.width / 2),
  );
  const side = rect.bottom + 48 > window.innerHeight && rect.top > 48 ? "top" : "bottom";
  return {
    immediate,
    label,
    left,
    side,
    top: side === "top" ? rect.top - 6 : rect.bottom + 6,
  };
}
