import { useTripText } from "~/features/trip/language";

export function Brand({ compact = false }: { compact?: boolean }) {
  const text = useTripText();
  return (
    <a className={`brand${compact ? " brand-compact" : ""}`} href="/" aria-label={text("home")}>
      <img
        className={compact ? "brand-mark" : "brand-lockup"}
        src={compact ? "/icon.svg" : "/logo.svg"}
        alt=""
      />
    </a>
  );
}
