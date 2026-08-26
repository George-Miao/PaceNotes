import { useEffect } from "react";

export type VariantId = "A" | "B" | "C" | "D";

export const prototypeVariants = [
  { id: "A", name: "Quiet blue", urlKey: "variant=A" },
  { id: "B", name: "Muted teal", urlKey: "variant=B" },
  { id: "C", name: "Soft green", urlKey: "variant=C" },
  { id: "D", name: "Warm coral", urlKey: "variant=D" },
] as const satisfies ReadonlyArray<{
  id: VariantId;
  name: string;
  urlKey: `variant=${VariantId}`;
}>;

type PrototypeSwitcherProps = {
  selected: VariantId;
  onSelect: (variant: VariantId) => void;
};

export function PrototypeSwitcher({ selected, onSelect }: PrototypeSwitcherProps) {
  const currentIndex = prototypeVariants.findIndex((variant) => variant.id === selected);
  const current = prototypeVariants[currentIndex];

  function cycle(offset: number) {
    const nextIndex = (currentIndex + offset + prototypeVariants.length) % prototypeVariants.length;
    onSelect(prototypeVariants[nextIndex].id);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const isTextInput =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.matches("input, textarea, select") ||
          target.closest(
            '[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]',
          ) !== null);

      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isTextInput ||
        (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
      ) {
        return;
      }

      event.preventDefault();
      cycle(event.key === "ArrowRight" ? 1 : -1);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentIndex, onSelect]);

  return (
    <nav className="prototype-switcher" aria-label="Prototype accent colors">
      <button
        className="prototype-switcher__arrow"
        type="button"
        aria-label="Previous accent color"
        onClick={() => cycle(-1)}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <path d="m12.5 4-6 6 6 6" />
        </svg>
      </button>
      <div className="prototype-switcher__label" aria-live="polite">
        <span className="prototype-switcher__eyebrow">Compare accents</span>
        <strong>
          {current.id}. {current.name}
        </strong>
      </div>
      <button
        className="prototype-switcher__arrow"
        type="button"
        aria-label="Next accent color"
        onClick={() => cycle(1)}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <path d="m7.5 4 6 6-6 6" />
        </svg>
      </button>
    </nav>
  );
}
