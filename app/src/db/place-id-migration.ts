import * as Y from "yjs";
import { initializeTripDocument, readTripDocument } from "../features/collaboration/document";

export function sanitizeGooglePlaceDocument(data: Uint8Array): Uint8Array | null {
  const source = new Y.Doc();
  Y.applyUpdate(source, data);
  const legacyItemIds = new Set<string>();
  source.getMap<Y.Map<unknown>>("items").forEach((item, id) => {
    if (hasCachedPlaceFields(item.get("place"))) legacyItemIds.add(id);
  });
  const hasLegacyDestination = hasCachedPlaceFields(
    source.getMap<unknown>("metadata").get("destination"),
  );
  if (!hasLegacyDestination && legacyItemIds.size === 0) {
    source.destroy();
    return null;
  }

  const snapshot = readTripDocument(source);
  for (const id of legacyItemIds) {
    const item = snapshot.items[id];
    if (item) snapshot.items[id] = { ...item, title: "Place", details: "" };
  }
  const clean = new Y.Doc();
  initializeTripDocument(clean, snapshot);
  const result = Y.encodeStateAsUpdate(clean);
  clean.destroy();
  source.destroy();
  return result;
}

function hasCachedPlaceFields(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).some((key) => key !== "placeId")
  );
}
