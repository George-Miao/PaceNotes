import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { addTripItem, initializeTripDocument } from "../features/collaboration/document";
import { createInitialSnapshot, itemForCreate } from "../features/trip/model";
import { sanitizeGooglePlaceDocument } from "./place-id-migration";

function legacyDocument(): Y.Doc {
  const document = new Y.Doc();
  initializeTripDocument(
    document,
    createInitialSnapshot("trip-1", {
      title: "Japan route",
      startDate: "2027-01-01",
      endDate: "2027-01-03",
      destination: { placeId: "destination-1" },
      timeZone: "Asia/Tokyo",
    }),
  );
  document.getMap<unknown>("metadata").set("destination", {
    placeId: "destination-1",
    name: "Cached Google destination",
    address: "Cached address",
  });
  const item = itemForCreate("place", "2027-01-01", {
    title: "Cached Google place",
    details: "Cached address",
    place: { placeId: "place-1" },
  });
  addTripItem(document, item);
  const itemMap = document.getMap<Y.Map<unknown>>("items").get(item.id);
  if (!itemMap) throw new Error("Expected the seeded item");
  itemMap.set("place", {
    placeId: "place-1",
    name: "Cached Google place",
    latitude: 35.6762,
    longitude: 139.6503,
  });
  return document;
}

describe("Google Place ID migration", () => {
  it("removes cached provider fields and provider-derived item text", () => {
    const source = legacyDocument();
    const sanitized = sanitizeGooglePlaceDocument(Y.encodeStateAsUpdate(source));
    expect(sanitized).not.toBeNull();
    if (!sanitized) throw new Error("Expected a sanitized document");

    const clean = new Y.Doc();
    Y.applyUpdate(clean, sanitized);
    expect(clean.getMap("metadata").get("destination")).toEqual({ placeId: "destination-1" });
    const item = [...clean.getMap<Y.Map<unknown>>("items").values()][0];
    expect(item?.get("place")).toEqual({ placeId: "place-1" });
    expect(item?.get("title")).toBe("Place");
    expect(item?.get("details")).toBe("");
    source.destroy();
    clean.destroy();
  });

  it("leaves a Place ID-only document unchanged", () => {
    const source = legacyDocument();
    const first = sanitizeGooglePlaceDocument(Y.encodeStateAsUpdate(source));
    if (!first) throw new Error("Expected a sanitized document");
    expect(sanitizeGooglePlaceDocument(first)).toBeNull();
    source.destroy();
  });
});
