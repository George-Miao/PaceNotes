import { useCallback, useEffect, useState } from "react";
import { AtomGallery } from "./atoms/AtomGallery";
import { PrototypeSwitcher, type VariantId } from "./PrototypeSwitcher";
import {
  NormalizedAtlas,
  type AtlasAccent,
} from "./variants/NormalizedAtlas";

const knownVariants: Record<VariantId, true> = { A: true, B: true, C: true, D: true };
const variantAccents: Record<VariantId, AtlasAccent> = {
  A: "blue",
  B: "teal",
  C: "green",
  D: "coral",
};

function Planner() {
  const [selected, setSelected] = useState<VariantId>(() => {
    const requested = new URLSearchParams(window.location.search).get("variant")?.toUpperCase();
    return requested && Object.hasOwn(knownVariants, requested) ? (requested as VariantId) : "A";
  });

  useEffect(() => {
    function handlePopState() {
      const requested = new URLSearchParams(window.location.search).get("variant")?.toUpperCase();
      setSelected(requested && Object.hasOwn(knownVariants, requested) ? (requested as VariantId) : "A");
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const selectVariant = useCallback((variant: VariantId) => {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", variant);
    window.history.replaceState({}, "", url);
    setSelected(variant);
  }, []);

  const design = <NormalizedAtlas accent={variantAccents[selected]} />;

  return (
    <>
      <span className="prototype-label">PaceNotes prototype</span>
      {design}
      {import.meta.env.DEV ? (
        <PrototypeSwitcher selected={selected} onSelect={selectVariant} />
      ) : null}
    </>
  );
}

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, "");

  return path === "/atoms" ? <AtomGallery /> : <Planner />;
}
