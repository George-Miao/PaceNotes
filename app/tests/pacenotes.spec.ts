import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import * as Y from "yjs";
import { db, sql } from "../src/db/client";
import { documents, trips } from "../src/db/schema";
import {
  addTripItem,
  initializeTripDocument,
  readTripDocument,
} from "../src/features/collaboration/document";
import { createInitialSnapshot, itemForCreate, type TripItem } from "../src/features/trip/model";

let tripId = "";

const destination = {
  placeId: "tokyo-e2e",
};

async function createEmptyTrip(items: TripItem[] = [], endDate = "2027-04-12"): Promise<string> {
  const id = crypto.randomUUID().replaceAll("-", "");
  const snapshot = createInitialSnapshot(id, {
    startDate: "2027-04-10",
    endDate,
    destination,
    timeZone: "Asia/Tokyo",
  });
  const document = new Y.Doc();
  initializeTripDocument(document, snapshot);
  for (const item of items) addTripItem(document, item);
  await db.insert(trips).values({
    id,
    title: snapshot.title,
    startDate: snapshot.startDate,
    endDate: snapshot.endDate,
    destinationPlaceId: destination.placeId,
    timeZone: snapshot.timeZone,
  });
  await db
    .insert(documents)
    .values({ name: id, data: Buffer.from(Y.encodeStateAsUpdate(document)) });
  document.destroy();
  return id;
}
async function mockGoogle(page: Page) {
  await page.addInitScript(() => {
    class MockPlaceAutocompleteElement extends HTMLElement {
      locationBias: unknown;
      private language = "";
      get requestedLanguage() {
        return this.language;
      }
      set requestedLanguage(value: string) {
        this.language = value;
        const scope = globalThis as typeof globalThis & {
          __pacenotesAutocompleteLanguages?: string[];
        };
        scope.__pacenotesAutocompleteLanguages?.push(value);
      }
    }
    if (!customElements.get("gmp-place-autocomplete")) {
      customElements.define("gmp-place-autocomplete", MockPlaceAutocompleteElement);
    }
    class MockPlace {
      id: string;
      displayName: string;
      location: { lat: () => number; lng: () => number };
      private language: string;
      get requestedLanguage() {
        return this.language;
      }
      constructor({ id, requestedLanguage }: { id: string; requestedLanguage?: string }) {
        this.language = requestedLanguage ?? "";
        this.id = id;
        const scope = globalThis as typeof globalThis & {
          __pacenotesPlaceLanguages?: string[];
        };
        scope.__pacenotesPlaceLanguages?.push(requestedLanguage ?? "");
        this.displayName =
          requestedLanguage === "zh-CN"
            ? `简体-${id}`
            : requestedLanguage === "zh-TW"
              ? `繁體-${id}`
              : "Test destination";
        const latitude = { "placement-portland": 1, "placement-ellsworth": 2 }[id] ?? 35.6762;
        this.location = { lat: () => latitude, lng: () => 0 };
      }
      async fetchFields(): Promise<void> {}
    }
    class MockPlaceDetailsElement extends HTMLElement {
      connectedCallback() {
        const request = this.querySelector<
          HTMLElement & { place: { id: string; requestedLanguage: string } }
        >("gmp-place-details-place-request");
        const heading = document.createElement("h3");
        heading.textContent =
          request?.place.requestedLanguage === "zh-CN"
            ? `简体-${request.place.id}`
            : request?.place.id === "museum"
              ? "City Museum"
              : "Corner Cafe";
        this.append(heading);
        queueMicrotask(() => this.dispatchEvent(new Event("gmp-load")));
      }
    }
    if (!customElements.get("gmp-place-details")) {
      customElements.define("gmp-place-details", MockPlaceDetailsElement);
    }
    class MockMap {
      listeners = new Map<string, (event: { placeId: string; stop: () => void }) => void>();
      constructor(host: HTMLElement) {
        const scope = globalThis as typeof globalThis & {
          __pacenotesMapConstructions?: number;
        };
        scope.__pacenotesMapConstructions = (scope.__pacenotesMapConstructions ?? 0) + 1;
        const canvas = document.createElement("div");
        for (const name of ["Museum", "Cafe"]) {
          const button = document.createElement("button");
          button.textContent = `Map location: ${name}`;
          button.addEventListener("click", () => {
            this.listeners.get("click")?.({ placeId: name.toLowerCase(), stop() {} });
          });
          canvas.append(button);
        }
        host.replaceChildren(canvas);
      }
      addListener(name: string, listener: (event: { placeId: string; stop: () => void }) => void) {
        this.listeners.set(name, listener);
        return { remove: () => this.listeners.delete(name) };
      }
      fitBounds(): void {}
      panTo(): void {}
      setCenter(): void {}
      getMapCapabilities() {
        return { isAdvancedMarkersAvailable: true };
      }
      getProjection() {
        return null;
      }
    }
    class MockPolyline {
      active = true;
      kind: "route" | "transport";
      constructor(options: { strokeOpacity?: number }) {
        this.kind = options.strokeOpacity === 0 ? "transport" : "route";
        const scope = globalThis as typeof globalThis & {
          __pacenotesRoutePolylines?: number;
          __pacenotesRoutePolylineConstructions?: number;
          __pacenotesTransportPolylines?: number;
        };
        const key =
          this.kind === "route" ? "__pacenotesRoutePolylines" : "__pacenotesTransportPolylines";
        scope[key] = (scope[key] ?? 0) + 1;
        if (this.kind === "route") {
          scope.__pacenotesRoutePolylineConstructions =
            (scope.__pacenotesRoutePolylineConstructions ?? 0) + 1;
        }
      }
      setMap(map: unknown): void {
        if (map !== null || !this.active) return;
        this.active = false;
        const scope = globalThis as typeof globalThis & {
          __pacenotesRoutePolylines?: number;
          __pacenotesTransportPolylines?: number;
        };
        const key =
          this.kind === "route" ? "__pacenotesRoutePolylines" : "__pacenotesTransportPolylines";
        scope[key] = Math.max(0, (scope[key] ?? 0) - 1);
      }
    }
    class MockLatLngBounds {
      extend(): void {}
    }
    class MockAdvancedMarkerElement {
      content: HTMLElement;
      mapValue: unknown;
      position: { lat: number; lng: number };
      constructor({
        map,
        position,
        content,
      }: {
        map: unknown;
        position: { lat: number; lng: number };
        content: HTMLElement;
      }) {
        const scope = globalThis as typeof globalThis & {
          __pacenotesMarkerConstructions?: number;
        };
        scope.__pacenotesMarkerConstructions = (scope.__pacenotesMarkerConstructions ?? 0) + 1;
        this.content = content;
        this.mapValue = null;
        this.position = position;
        this.map = map;
      }
      get map() {
        return this.mapValue;
      }
      set map(value: unknown) {
        this.mapValue = value;
        if (value) document.querySelector(".map-canvas > div")?.append(this.content);
        else this.content.remove();
      }
      addListener() {
        return { remove(): void {} };
      }
    }
    class MockOverlayView {
      map: unknown = null;
      onAdd?: () => void;
      onRemove?: () => void;
      getMap() {
        return this.map;
      }
      getProjection() {
        return null;
      }
      setMap(map: unknown) {
        if (this.map && !map) this.onRemove?.();
        this.map = map;
        if (map) this.onAdd?.();
      }
    }
    const routeDurationMillis = (
      origin: { lat: number; lng: number },
      destination: { lat: number; lng: number },
    ) => {
      const routeMinutes: Record<string, number> = {
        "3:1": 100,
        "1:3": 105,
        "3:2": 60,
        "1:2": 145,
      };
      return (routeMinutes[`${origin.lat}:${destination.lat}`] ?? 10) * 60_000;
    };
    const MockRoute = {
      async computeRoutes({
        origin,
        destination,
        language,
        departureTime,
        travelMode,
        routingPreference,
      }: {
        origin: { lat: number; lng: number };
        destination: { lat: number; lng: number };
        language?: string;
        departureTime?: Date;
        travelMode: string;
        routingPreference?: string;
      }) {
        const routeScope = globalThis as typeof globalThis & {
          __pacenotesRouteComputes?: number;
          __pacenotesRouteDepartureTimes?: Array<string | null>;
        };
        routeScope.__pacenotesRouteComputes = (routeScope.__pacenotesRouteComputes ?? 0) + 1;
        routeScope.__pacenotesRouteDepartureTimes?.push(departureTime?.toISOString() ?? null);
        if (departureTime && travelMode === "DRIVING" && routingPreference !== "TRAFFIC_AWARE") {
          throw new Error("Scheduled driving routes require traffic-aware routing");
        }
        (
          routeScope as typeof routeScope & {
            __pacenotesRouteLanguages?: string[];
          }
        ).__pacenotesRouteLanguages?.push(language ?? "");
        return {
          routes: [
            {
              path: [{ toJSON: () => ({ lat: 35.6762, lng: 139.6503 }) }],
              durationMillis: routeDurationMillis(origin, destination),
              distanceMeters: 1_000,
            },
          ],
        };
      },
    };
    const MockRouteMatrix = {
      async computeRouteMatrix({
        origins,
        destinations,
        language,
      }: {
        origins: Array<{ lat: number; lng: number }>;
        destinations: Array<{ lat: number; lng: number }>;
        language?: string;
      }) {
        (
          globalThis as typeof globalThis & {
            __pacenotesRouteLanguages?: string[];
          }
        ).__pacenotesRouteLanguages?.push(language ?? "");
        return {
          matrix: {
            rows: origins.map((origin) => ({
              items: destinations.map((destination) => ({
                durationMillis: routeDurationMillis(origin, destination),
              })),
            })),
          },
        };
      },
    };
    const scope = globalThis as typeof globalThis & {
      __pacenotesMapConstructions?: number;
      __pacenotesMarkerConstructions?: number;
      __pacenotesRouteComputes?: number;
      __pacenotesRouteDepartureTimes?: Array<string | null>;
      __pacenotesRoutePolylines?: number;
      __pacenotesRoutePolylineConstructions?: number;
      __pacenotesTransportPolylines?: number;
      __pacenotesAutocompleteLanguages?: string[];
      __pacenotesPlaceLanguages?: string[];
      __pacenotesRouteLanguages?: string[];
    };
    scope.__pacenotesMapConstructions = 0;
    scope.__pacenotesRouteComputes = 0;
    scope.__pacenotesRouteDepartureTimes = [];
    scope.__pacenotesRoutePolylines = 0;
    scope.__pacenotesMarkerConstructions = 0;
    scope.__pacenotesTransportPolylines = 0;
    scope.__pacenotesRoutePolylineConstructions = 0;
    scope.__pacenotesAutocompleteLanguages = [];
    scope.__pacenotesPlaceLanguages = [];
    scope.__pacenotesRouteLanguages = [];
    globalThis.google = {
      maps: {
        LatLngBounds: MockLatLngBounds,
        marker: { AdvancedMarkerElement: MockAdvancedMarkerElement },
        OverlayView: MockOverlayView,
        event: {
          clearInstanceListeners(): void {},
          removeListener(): void {},
          trigger(): void {},
        },
        importLibrary: async (name: string) => {
          if (name === "places") {
            return {
              PlaceAutocompleteElement: MockPlaceAutocompleteElement,
              Place: MockPlace,
              PlaceDetailsElement: MockPlaceDetailsElement,
            };
          }
          if (name === "maps") return { Map: MockMap, Polyline: MockPolyline };
          if (name === "marker") return { AdvancedMarkerElement: MockAdvancedMarkerElement };
          if (name === "routes")
            return {
              Route: MockRoute,
              RouteMatrix: MockRouteMatrix,
              RoutingPreference: { TRAFFIC_AWARE: "TRAFFIC_AWARE" },
            };
          return {};
        },
      },
    } as unknown as typeof google;
  });
}
type AddItemName = "place" | "note" | "reservation" | "lodging" | "transport";

async function addDayItem(page: Page, type: AddItemName, dayIndex = 0) {
  const day = page.locator(".day-section").nth(dayIndex);
  if (type === "place") {
    await day.getByRole("button", { name: "Place", exact: true }).click();
    return;
  }
  await day.getByRole("button", { name: /^More item types for / }).click();
  await day.getByRole("button", { name: `Add ${type}`, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await mockGoogle(page);
});

test.beforeAll(async ({ browserName }, worker) => {
  tripId = `e2e-${browserName}-${worker.project.name}-123456789`;
  await db.delete(trips).where(eq(trips.id, tripId));
  const snapshot = createInitialSnapshot(tripId, {
    title: "Shared Tokyo plan",
    startDate: "2027-04-10",
    endDate: "2027-05-09",
    destination,
    timeZone: "Asia/Tokyo",
  });
  const document = new Y.Doc();
  initializeTripDocument(document, snapshot);
  for (let index = 0; index < 500; index += 1) {
    const day = snapshot.days[index % snapshot.days.length];
    addTripItem(
      document,
      itemForCreate("place", day?.id ?? null, {
        id: `place-${String(index).padStart(3, "0")}`,
        title: `Place ${String(index + 1).padStart(3, "0")}`,
        place: {
          placeId: `tokyo-place-${index}`,
        },
      }),
    );
  }
  await db.insert(trips).values({
    id: tripId,
    title: snapshot.title,
    startDate: snapshot.startDate,
    endDate: snapshot.endDate,
    destinationPlaceId: destination.placeId,
    timeZone: "Asia/Tokyo",
  });
  await db
    .insert(documents)
    .values({ name: tripId, data: Buffer.from(Y.encodeStateAsUpdate(document)) });
  document.destroy();
});

test.afterAll(async () => {
  if (tripId) await db.delete(trips).where(eq(trips.id, tripId));
  await sql.end();
});

test("landing page is installable, accessible, and fits the viewport", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Build the day/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Where does the trip go?" })).toBeVisible();
  const initialJavaScriptBytes = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter(
        (entry): entry is PerformanceResourceTiming => entry instanceof PerformanceResourceTiming,
      )
      .filter((entry) => entry.initiatorType === "script")
      .reduce((total, entry) => total + entry.encodedBodySize, 0),
  );
  expect(initialJavaScriptBytes).toBeLessThanOrEqual(150 * 1024);
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).display).toBe("standalone");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("icon buttons show their accessible labels on hover", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("pacenotes-display-name", "Tooltip tester"));
  await page.goto(`/trips/${tripId}`);
  const tooltip = page.getByRole("tooltip");
  await page.getByRole("button", { name: "Trip settings" }).hover();
  await expect(tooltip).toHaveText("Trip settings");
  await expect(tooltip).toHaveCSS("opacity", "1");

  const deleteDay = page.locator('.day-heading .icon-button[aria-label^="Delete day "]').first();
  const deleteDayLabel = await deleteDay.getAttribute("aria-label");
  if (!deleteDayLabel) throw new Error("Delete day label is missing");
  await deleteDay.hover();
  await expect(tooltip).toHaveText(deleteDayLabel);
  await expect(tooltip).toHaveCSS("opacity", "1");

  await page.getByRole("button", { name: "Place 001", exact: true }).first().click();
  const closeEditor = page.getByRole("button", { name: "Close editor" });
  await closeEditor.hover();
  await expect(tooltip).toHaveText("Close editor");
  await expect(tooltip).toHaveCSS("opacity", "1");
  await closeEditor.click();
  await expect(closeEditor).toHaveCount(0);
  await expect(tooltip).toHaveCount(0);

  await page.mouse.move(0, 0);
  await expect(tooltip).toHaveCount(0);
});

test("new trips use a transient title and keep the map between days", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The desktop project covers trip creation");
  await page.addInitScript(() => localStorage.setItem("pacenotes-display-name", "Creating editor"));
  await page.goto("/");
  await expect(page.getByLabel("Trip title", { exact: true })).toHaveCount(0);
  await page.locator("gmp-place-autocomplete").evaluate((element) => {
    element.dispatchEvent(
      Object.assign(new Event("gmp-select"), {
        placePrediction: {
          toPlace: () => ({
            id: "new-trip-destination",
            location: { lat: () => 35.6762, lng: () => 139.6503 },
            fetchFields: async () => {},
          }),
        },
      }),
    );
  });
  await page.getByRole("button", { name: "Create trip", exact: true }).click();
  await expect(page).toHaveURL(/\/trips\//);
  const createdId = new URL(page.url()).pathname.slice("/trips/".length);
  try {
    const title = page.getByLabel("Trip title", { exact: true });
    await expect(title).toHaveValue("Trip to Test destination");
    await title.focus();
    await title.press("Tab");
    await title.focus();
    await title.fill("Discard this title");
    await title.press("Escape");
    await expect(title).toHaveValue("Trip to Test destination");
    await title.focus();
    await title.fill("Paris with friends");
    await title.press("Enter");
    await expect(title).toHaveValue("Paris with friends");
    await title.focus();
    await title.fill("");
    await title.press("Enter");
    await expect(title).toHaveValue("Trip to Test destination");
    await expect(page).toHaveTitle("Trip to Test destination - PaceNotes");
    const [storedTrip] = await db.select().from(trips).where(eq(trips.id, createdId));
    const [storedDocument] = await db.select().from(documents).where(eq(documents.name, createdId));
    expect(JSON.stringify(storedTrip)).not.toContain("Test destination");
    expect(storedDocument?.data.toString()).not.toContain("Test destination");
    expect(await page.evaluate(() => localStorage.getItem("pacenotes-recent-trips"))).not.toContain(
      "Test destination",
    );

    const canvas = page.locator(".map-canvas > div");
    await expect(canvas).toHaveCount(1);
    const map = await canvas.elementHandle();
    await page.locator(".date-tabs [data-day-tab]").nth(1).click();
    await expect(page.locator(".date-tabs [data-day-tab]").nth(1)).toHaveAttribute(
      "aria-current",
      "date",
    );
    await addDayItem(page, "note", 1);
    await expect(page.locator(".item-editor")).toHaveCount(0);
    await page
      .locator(".entry-select")
      .filter({ hasText: /^New note$/ })
      .click();
    await expect(page.locator(".item-editor")).toBeVisible();
    await page.locator(".date-tabs [data-day-tab]").nth(0).click();
    await expect(page.locator(".item-editor")).toHaveCount(0);
    await page.locator(".date-tabs [data-day-tab]").nth(1).click();
    await expect(page.locator(".item-editor")).toHaveCount(0);
    expect(await map?.evaluate((element) => element.isConnected)).toBe(true);
    await expect
      .poll(async () => {
        const [stored] = await db.select().from(documents).where(eq(documents.name, createdId));
        if (!stored) return null;
        const saved = new Y.Doc();
        Y.applyUpdate(saved, stored.data);
        const snapshot = readTripDocument(saved);
        saved.destroy();
        return {
          title: snapshot.title,
          hasNote: Object.values(snapshot.items).some((item) => item.type === "note"),
        };
      })
      .toEqual({ title: "", hasNote: true });

    await page.goto("/");
    await expect(page.locator(".recent-list a strong")).toHaveText("Trip to Test destination");
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, createdId));
  }
});

test("map locations open replaceable details without opening the item editor", async ({ page }) => {
  const id = await createEmptyTrip();
  try {
    await page.addInitScript(() => localStorage.setItem("pacenotes-display-name", "Map editor"));
    await page.goto(`/trips/${id}`);
    const map = await page.locator(".map-canvas > div").elementHandle();
    await page.getByRole("button", { name: "Map location: Museum", exact: true }).click();
    const details = page.getByRole("dialog", { name: "Place details", exact: true });
    await expect(details.getByRole("heading", { name: "City Museum" })).toBeVisible();
    await expect(page.locator(".item-editor")).toHaveCount(0);
    await details.getByRole("button", { name: "Add to trip" }).click();
    await expect(details).toHaveCount(0);
    await expect
      .poll(async () => {
        const [stored] = await db.select().from(documents).where(eq(documents.name, id));
        if (!stored) return null;
        const saved = new Y.Doc();
        Y.applyUpdate(saved, stored.data);
        const added = Object.values(readTripDocument(saved).items).find(
          (item) => item.place?.placeId === "museum",
        );
        saved.destroy();
        return added?.dayId;
      })
      .toBe("2027-04-10");
    const addedEntry = page.locator(".day-section").first().locator(".itinerary-entry");
    const [iconBox, titleBox, timeBox] = await Promise.all([
      addedEntry.locator(".entry-type-icon").boundingBox(),
      addedEntry.locator(".entry-copy").boundingBox(),
      addedEntry.locator("time").boundingBox(),
    ]);
    expect(iconBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(timeBox).not.toBeNull();
    expect(iconBox?.x).toBeLessThan(titleBox?.x ?? 0);
    expect(iconBox?.x).toBeLessThan(timeBox?.x ?? 0);
    expect(timeBox?.x).toBeGreaterThan(titleBox?.x ?? Number.POSITIVE_INFINITY);
    await page.getByRole("button", { name: "Places to visit", exact: true }).click();
    await page.getByRole("button", { name: "Map location: Cafe", exact: true }).click();
    await expect(details.getByRole("heading", { name: "Corner Cafe" })).toBeVisible();
    await details.getByRole("button", { name: "Add to trip" }).click();
    await expect(details).toHaveCount(0);
    await expect
      .poll(async () => {
        const [stored] = await db.select().from(documents).where(eq(documents.name, id));
        if (!stored) return undefined;
        const saved = new Y.Doc();
        Y.applyUpdate(saved, stored.data);
        const added = Object.values(readTripDocument(saved).items).find(
          (item) => item.place?.placeId === "cafe",
        );
        saved.destroy();
        return added?.dayId;
      })
      .toBeNull();
    await expect(
      page.locator(".day-section").first().getByRole("button", { name: "Place", exact: true }),
    ).toBeVisible();
    expect(await map?.evaluate((element) => element.isConnected)).toBe(true);
    await page.getByRole("button", { name: "Map location: Museum", exact: true }).click();
    await expect(details).toBeVisible();
    await page.locator(".date-tabs [data-day-tab]").nth(1).click();
    await expect(details).toHaveCount(0);
    await expect(
      page.locator(".day-section").first().getByRole("button", { name: "Place", exact: true }),
    ).toBeVisible();
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("map keeps locations from every day visible", async ({ page }) => {
  const id = await createEmptyTrip();
  try {
    const [stored] = await db.select().from(documents).where(eq(documents.name, id));
    if (!stored) throw new Error("Missing trip document");
    const document = new Y.Doc();
    Y.applyUpdate(document, stored.data);
    const snapshot = readTripDocument(document);
    addTripItem(
      document,
      itemForCreate("place", snapshot.days[0]?.id ?? null, {
        title: "First day place",
        place: { placeId: "first-day-place" },
      }),
    );
    addTripItem(
      document,
      itemForCreate("place", snapshot.days[1]?.id ?? null, {
        title: "Second day place",
        place: { placeId: "second-day-place" },
      }),
    );
    await db
      .update(documents)
      .set({ data: Buffer.from(Y.encodeStateAsUpdate(document)) })
      .where(eq(documents.name, id));
    document.destroy();

    await page.addInitScript(() => localStorage.setItem("pacenotes-display-name", "Map editor"));
    await page.goto(`/trips/${id}`);
    const firstMarker = page.getByRole("button", { name: "Stop 1: First day place" });
    const secondMarker = page.getByRole("button", { name: "Stop 2: Second day place" });
    await expect(firstMarker).toBeVisible();
    await expect(secondMarker).toBeVisible();

    await page.locator(".date-tabs [data-day-tab]").nth(1).click();
    await expect(page.locator(".date-tabs [data-day-tab]").nth(1)).toHaveAttribute(
      "aria-current",
      "date",
    );
    await expect(firstMarker).toBeVisible();
    await expect(secondMarker).toBeVisible();
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("map and list toggles keep at least one panel visible", async ({ page }) => {
  const id = await createEmptyTrip();
  try {
    await page.addInitScript(() => localStorage.setItem("pacenotes-display-name", "View editor"));
    await page.goto(`/trips/${id}`);
    const controls = page.getByRole("group", { name: "Planner view" });
    const map = controls.getByRole("button", { name: "Map", exact: true });
    const list = controls.getByRole("button", { name: "List", exact: true });
    const itinerary = page.getByRole("region", { name: "Itinerary", exact: true });
    const mapPanel = page.locator(".map-panel");
    await expect(controls.getByRole("button")).toHaveCount(2);
    const buttonsFit = () =>
      controls.evaluate((element) => {
        const frame = element.getBoundingClientRect();
        return Array.from(element.querySelectorAll("button")).every((button) => {
          const bounds = button.getBoundingClientRect();
          return bounds.left >= frame.left && bounds.right <= frame.right;
        });
      });
    await expect.poll(buttonsFit).toBe(true);
    await expect(map).toHaveAttribute("aria-pressed", "true");
    await expect(list).toHaveAttribute("aria-pressed", "true");

    await list.click();
    await expect(mapPanel).toBeVisible();
    await expect(itinerary).toBeHidden();
    await expect(map).toBeDisabled();
    await expect(map).toHaveAttribute("aria-pressed", "true");
    await expect(list).toHaveAttribute("aria-pressed", "false");

    await list.click();
    await expect(map).toBeEnabled();
    await expect(mapPanel).toBeVisible();
    await expect(itinerary).toBeVisible();
    await map.click();
    await expect(mapPanel).toBeHidden();
    await expect(itinerary).toBeVisible();
    await expect(list).toBeDisabled();
    await expect(map).toHaveAttribute("aria-pressed", "false");
    await expect(list).toHaveAttribute("aria-pressed", "true");

    await map.focus();
    await map.press("Enter");
    await expect(mapPanel).toBeVisible();
    await expect(itinerary).toBeVisible();
    await expect(map).toHaveAttribute("aria-pressed", "true");
    await expect(list).toHaveAttribute("aria-pressed", "true");
    await expect(map).toBeEnabled();
    await expect(list).toBeEnabled();
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("calendar view schedules items and stays on the itinerary on mobile", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Calendar interaction coverage runs once");
  const dayId = "2027-04-10";
  const timed = itemForCreate("place", dayId, {
    id: "calendar-museum",
    title: "Morning museum",
    startTime: "09:00",
    durationMinutes: 60,
  });
  const note = itemForCreate("note", dayId, {
    id: "calendar-note",
    title: "Bring tickets",
    details: "Meet by the east entrance.",
  });
  const lodging = itemForCreate("lodging", dayId, {
    id: "calendar-hotel",
    title: "City hotel",
    place: { placeId: "calendar-hotel-place" },
    lodging: { startDate: dayId, endDate: "2027-04-11" },
  });
  const id = await createEmptyTrip([note, timed, lodging], "2027-04-14");
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Calendar editor"),
    );
    await page.goto(`/trips/${id}?view=calendar#${dayId}`);
    const controls = page.getByRole("group", { name: "Planner content" });
    const calendarButton = controls.getByRole("button", { name: "Calendar", exact: true });
    const itineraryButton = controls.getByRole("button", { name: "Itinerary", exact: true });
    const calendar = page.getByRole("region", { name: "Trip calendar" });
    await expect(calendarButton).toHaveAttribute("aria-pressed", "true");
    await expect(calendar).toBeVisible();
    expect(await controls.evaluate((element) => element.closest("section")?.id)).toBe(
      "planner-itinerary",
    );
    await expect(calendar.getByRole("button", { name: "Bring tickets" })).toBeVisible();
    const noteButton = calendar.getByRole("button", { name: "Bring tickets" });
    await noteButton.hover();
    const noteTooltip = calendar.getByRole("tooltip");
    await expect(noteTooltip).toHaveText("Meet by the east entrance.");
    await expect(noteTooltip).toBeVisible();
    expect(
      await noteTooltip.evaluate((element) => {
        const pointerEvents = element.style.pointerEvents;
        element.style.pointerEvents = "auto";
        const bounds = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2,
        );
        element.style.pointerEvents = pointerEvents;
        return hit === element || element.contains(hit);
      }),
    ).toBe(true);
    const lodgingButton = calendar.getByRole("button", { name: "City hotel", exact: true }).first();
    await expect(lodgingButton).toBeVisible();
    const lodgingIconBox = await lodgingButton.locator("svg").boundingBox();
    const lodgingTitleBox = await lodgingButton.locator("span").boundingBox();
    if (!lodgingIconBox || !lodgingTitleBox) {
      throw new Error("Missing lodging label geometry");
    }
    expect(lodgingIconBox.y + lodgingIconBox.height / 2).toBeCloseTo(
      lodgingTitleBox.y + lodgingTitleBox.height / 2,
      0,
    );

    const lodgingSegments = calendar.locator('[data-calendar-lodging-id="calendar-hotel"]');
    await expect(lodgingSegments).toHaveCount(2);
    const lodgingDayBox = await calendar.locator("header").first().boundingBox();
    const originalLodgingBox = await lodgingSegments.first().boundingBox();
    if (!lodgingDayBox || !originalLodgingBox) {
      throw new Error("Missing lodging drag geometry");
    }
    const lodgingStartX = originalLodgingBox.x + originalLodgingBox.width / 2;
    const lodgingStartY = originalLodgingBox.y + originalLodgingBox.height / 2;
    await page.mouse.move(lodgingStartX, lodgingStartY);
    await page.mouse.down();
    await page.mouse.move(lodgingStartX + lodgingDayBox.width * 2, lodgingStartY, {
      steps: 4,
    });
    const lodgingProxy = calendar.locator("[data-calendar-lodging-drag-proxy]");
    const lodgingTarget = calendar.locator("[data-calendar-lodging-preview]");
    await expect(lodgingProxy).toBeVisible();
    await expect(lodgingTarget).toContainText("2 days");
    await expect(lodgingTarget).toHaveAttribute("data-start-date", "2027-04-12");
    const lodgingProxyBox = await lodgingProxy.boundingBox();
    const lodgingTargetBox = await lodgingTarget.boundingBox();
    if (!lodgingProxyBox || !lodgingTargetBox) {
      throw new Error("Missing lodging preview geometry");
    }
    expect(lodgingProxyBox.x).toBeCloseTo(originalLodgingBox.x + lodgingDayBox.width * 2, 0);
    expect(lodgingTargetBox.width).toBeGreaterThan(lodgingDayBox.width * 1.8);
    expect(
      Number(await lodgingTarget.evaluate((element) => getComputedStyle(element).opacity)),
    ).toBeLessThan(1);
    await page.mouse.up();
    const shiftedLodging = calendar.locator(
      '[data-calendar-all-day="2027-04-12"] [data-calendar-lodging-id="calendar-hotel"]',
    );
    await shiftedLodging.scrollIntoViewIfNeeded();
    const shiftedLodgingBox = await shiftedLodging.boundingBox();
    if (!shiftedLodgingBox) throw new Error("Missing shifted lodging geometry");
    const shiftedLodgingButton = shiftedLodging.getByRole("button", {
      name: "City hotel",
      exact: true,
    });
    const shiftedLodgingButtonBox = await shiftedLodgingButton.boundingBox();
    if (!shiftedLodgingButtonBox) throw new Error("Missing shifted lodging button geometry");
    const shiftedStartX = shiftedLodgingButtonBox.x + shiftedLodgingButtonBox.width / 2;
    const shiftedStartY = shiftedLodgingButtonBox.y + shiftedLodgingButtonBox.height / 2;
    await page.mouse.move(shiftedStartX, shiftedStartY);
    await page.mouse.down();
    await page.mouse.move(shiftedStartX - lodgingDayBox.width, shiftedStartY, { steps: 4 });
    await expect(lodgingTarget).toHaveAttribute("data-start-date", "2027-04-11");
    await expect(shiftedLodging).toBeHidden();
    const oneDayLeftProxyBox = await lodgingProxy.boundingBox();
    if (!oneDayLeftProxyBox) throw new Error("Missing one-day-left lodging proxy geometry");
    expect(oneDayLeftProxyBox.x).toBeCloseTo(shiftedLodgingBox.x - lodgingDayBox.width, 0);
    await page.mouse.move(shiftedStartX - lodgingDayBox.width * 2, shiftedStartY, {
      steps: 4,
    });
    await expect(lodgingTarget).toHaveAttribute("data-start-date", "2027-04-10");
    const twoDaysLeftProxyBox = await lodgingProxy.boundingBox();
    if (!twoDaysLeftProxyBox) throw new Error("Missing two-days-left lodging proxy geometry");
    expect(twoDaysLeftProxyBox.x).toBeCloseTo(shiftedLodgingBox.x - lodgingDayBox.width * 2, 0);
    await page.mouse.move(shiftedStartX - lodgingDayBox.width, shiftedStartY, { steps: 4 });
    await page.mouse.up();
    await expect(
      calendar.locator(
        '[data-calendar-all-day="2027-04-10"] [data-calendar-lodging-id="calendar-hotel"]',
      ),
    ).toHaveCount(0);
    await expect(
      calendar.locator(
        '[data-calendar-all-day="2027-04-11"] [data-calendar-lodging-id="calendar-hotel"]',
      ),
    ).toBeVisible();

    const checkInHandle = calendar.getByRole("button", {
      name: "Change check-in for City hotel",
    });
    await checkInHandle.scrollIntoViewIfNeeded();
    const checkInBox = await checkInHandle.boundingBox();
    if (!checkInBox) throw new Error("Missing lodging check-in handle geometry");
    await page.mouse.move(
      checkInBox.x + checkInBox.width / 2,
      checkInBox.y + checkInBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      checkInBox.x + checkInBox.width / 2 - lodgingDayBox.width,
      checkInBox.y + checkInBox.height / 2,
      { steps: 4 },
    );
    const resizeGuide = calendar.locator("[data-calendar-lodging-resize-guide]");
    await expect(resizeGuide).toBeVisible();
    await expect(lodgingTarget).toContainText("3 days");
    await expect(lodgingTarget).toHaveAttribute("data-start-date", "2027-04-10");
    const resizeGuideBox = await resizeGuide.boundingBox();
    if (!resizeGuideBox) throw new Error("Missing lodging resize guide geometry");
    expect(resizeGuideBox.width).toBeGreaterThan(lodgingDayBox.width * 1.8);
    expect(resizeGuideBox.height).toBeLessThan(4);
    await page.mouse.up();
    await expect(
      calendar.locator(
        '[data-calendar-all-day="2027-04-10"] [data-calendar-lodging-id="calendar-hotel"]',
      ),
    ).toBeVisible();

    const checkOutHandle = calendar.getByRole("button", {
      name: "Change check-out for City hotel",
    });
    await checkOutHandle.scrollIntoViewIfNeeded();
    const checkOutBox = await checkOutHandle.boundingBox();
    if (!checkOutBox) throw new Error("Missing lodging check-out handle geometry");
    await page.mouse.move(
      checkOutBox.x + checkOutBox.width / 2,
      checkOutBox.y + checkOutBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      checkOutBox.x + checkOutBox.width / 2 - lodgingDayBox.width,
      checkOutBox.y + checkOutBox.height / 2,
      { steps: 4 },
    );
    await expect(resizeGuide).toBeVisible();
    await expect(lodgingTarget).toContainText("2 days");
    await expect(lodgingTarget).toHaveAttribute("data-end-date", "2027-04-11");
    await page.mouse.up();
    await expect(
      calendar.locator(
        '[data-calendar-all-day="2027-04-12"] [data-calendar-lodging-id="calendar-hotel"]',
      ),
    ).toHaveCount(0);
    const extendedCheckOutHandle = calendar.getByRole("button", {
      name: "Change check-out for City hotel",
    });
    await extendedCheckOutHandle.scrollIntoViewIfNeeded();
    const extendedCheckOutBox = await extendedCheckOutHandle.boundingBox();
    if (!extendedCheckOutBox) throw new Error("Missing extended check-out handle geometry");
    expect(extendedCheckOutBox.width).toBeGreaterThanOrEqual(12);
    await page.mouse.move(
      extendedCheckOutBox.x + extendedCheckOutBox.width / 2,
      extendedCheckOutBox.y + extendedCheckOutBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      extendedCheckOutBox.x + extendedCheckOutBox.width / 2 + lodgingDayBox.width,
      extendedCheckOutBox.y + extendedCheckOutBox.height / 2,
      { steps: 4 },
    );
    await expect(resizeGuide).toBeVisible();
    await expect(lodgingTarget).toContainText("3 days");
    await expect(lodgingTarget).toHaveAttribute("data-end-date", "2027-04-12");
    await page.mouse.up();
    await expect(
      calendar.locator(
        '[data-calendar-all-day="2027-04-12"] [data-calendar-lodging-id="calendar-hotel"]',
      ),
    ).toBeVisible();

    const calendarScroller = calendar.locator(":scope > div").first();
    const firstDayHeader = calendar.locator("header").first();
    const allDayLabel = calendar.getByText("All day", { exact: true });
    const plannerPanel = calendar.locator("xpath=..");
    const calendarToolbar = plannerPanel.locator(".planner-content-toolbar");
    await calendarScroller.evaluate((element) => {
      element.scrollTop = 300;
      element.scrollLeft = 0;
    });
    await plannerPanel.evaluate((element) => {
      element.scrollTop = 300;
    });
    const panelScrollTop = await plannerPanel.evaluate((element) => element.scrollTop);
    const toolbarBox = await calendarToolbar.boundingBox();
    const scrollerBox = await calendarScroller.boundingBox();
    const headerBox = await firstDayHeader.boundingBox();
    const allDayLabelBox = await allDayLabel.boundingBox();
    if (!scrollerBox || !toolbarBox || !headerBox || !allDayLabelBox) {
      throw new Error("Missing sticky calendar header geometry");
    }
    expect(panelScrollTop).toBe(0);
    expect(scrollerBox.y).toBeCloseTo(toolbarBox.y + toolbarBox.height, 0);
    expect(headerBox.y).toBeCloseTo(scrollerBox.y, 0);
    expect(allDayLabelBox.y).toBeCloseTo(headerBox.y + headerBox.height, 0);
    await calendarScroller.evaluate((element) => {
      element.scrollLeft = 180;
    });
    const horizontalScrollLeft = await calendarScroller.evaluate((element) => element.scrollLeft);
    const horizontallyScrolledAllDayLabelBox = await allDayLabel.boundingBox();
    if (!horizontallyScrolledAllDayLabelBox) {
      throw new Error("Missing horizontally scrolled all-day label geometry");
    }
    expect(horizontalScrollLeft).toBeGreaterThan(0);
    expect(horizontallyScrolledAllDayLabelBox.x).toBeCloseTo(
      allDayLabelBox.x - horizontalScrollLeft,
      0,
    );
    expect(horizontallyScrolledAllDayLabelBox.y).toBeCloseTo(allDayLabelBox.y, 0);
    await calendarScroller.evaluate((element) => {
      element.scrollTop = 0;
      element.scrollLeft = 0;
    });
    const centeredDayHeader = calendar.locator('[data-calendar-day-header="2027-04-12"]');
    await expect(centeredDayHeader.getByRole("button")).toHaveCount(0);
    await expect(centeredDayHeader).toHaveCSS("cursor", "default");
    await page.getByRole("button", { name: /Mon\s+12/i }).click();
    await expect
      .poll(async () =>
        calendarScroller.evaluate((element) => {
          const header = element.querySelector<HTMLElement>(
            '[data-calendar-day-header="2027-04-12"]',
          );
          if (!header) return Number.POSITIVE_INFINITY;
          const expected = Math.min(
            element.scrollWidth - element.clientWidth,
            Math.max(0, header.offsetLeft - (element.clientWidth - header.offsetWidth) / 2),
          );
          return Math.abs(element.scrollLeft - expected);
        }),
      )
      .toBeLessThan(1);

    const block = calendar.locator('[data-calendar-item-id="calendar-museum"]').first();
    await expect(block).toContainText("09:00 - 10:00");
    const blockButton = block.getByRole("button", { name: "Morning museum", exact: true });
    await expect(blockButton.locator("svg")).toBeVisible();
    await blockButton.focus();
    await blockButton.press("ArrowDown");
    await expect(block).toContainText("09:15 - 10:15");

    const blockBox = await block.boundingBox();
    if (!blockBox) throw new Error("Missing calendar block geometry");
    const pointerX = blockBox.x + blockBox.width / 2;
    const pointerY = blockBox.y + blockBox.height / 2 + 80;
    await page.mouse.move(pointerX, blockBox.y + blockBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(pointerX, pointerY, { steps: 4 });
    const dragProxy = calendar.locator("[data-calendar-drag-proxy]");
    const dropPreview = calendar.locator("[data-calendar-drop-preview]");
    await expect(dragProxy).toBeVisible();
    await expect(dropPreview).toBeVisible();
    const dragProxyBox = await dragProxy.boundingBox();
    if (!dragProxyBox) throw new Error("Missing calendar drag proxy geometry");
    expect(Math.abs(dragProxyBox.y + dragProxyBox.height / 2 - pointerY)).toBeLessThan(4);
    const dropPreviewBox = await dropPreview.boundingBox();
    if (!dropPreviewBox) throw new Error("Missing calendar drop preview geometry");
    expect(Math.abs(dropPreviewBox.y + dropPreviewBox.height / 2 - pointerY)).toBeLessThan(16);
    expect(
      Number(await dropPreview.evaluate((element) => getComputedStyle(element).opacity)),
    ).toBeLessThan(1);
    await page.mouse.up();
    await expect(dragProxy).toBeHidden();
    await expect(dropPreview).toBeHidden();
    await expect(block).not.toContainText("09:15 - 10:15");

    const movedBlockBox = await block.boundingBox();
    if (!movedBlockBox) throw new Error("Missing moved calendar block geometry");
    const earlierPointerX = movedBlockBox.x + 4;
    const earlierPointerY = movedBlockBox.y + movedBlockBox.height / 2;
    await page.mouse.move(earlierPointerX, earlierPointerY);
    await page.mouse.down();
    await page.mouse.move(earlierPointerX, earlierPointerY - 80, { steps: 4 });
    await expect(dragProxy).toBeVisible();
    await expect(dropPreview).toBeVisible();
    await page.mouse.up();
    await expect(block).toContainText("09:15 - 10:15");
    await blockButton.click();
    const calendarEditor = calendar.locator(".item-editor");
    await expect(calendarEditor).toBeVisible();
    const calendarScrollerWithEditorBox = await calendarScroller.boundingBox();
    const calendarEditorBox = await calendarEditor.boundingBox();
    if (!calendarScrollerWithEditorBox || !calendarEditorBox) {
      throw new Error("Missing calendar editor geometry");
    }
    expect(calendarEditorBox.y).toBeGreaterThanOrEqual(
      calendarScrollerWithEditorBox.y + calendarScrollerWithEditorBox.height - 1,
    );
    await calendarEditor.getByRole("button", { name: "Close editor" }).click();
    await expect(calendarEditor).toBeHidden();

    await expect(block.getByRole("button", { name: /Calendar actions/ })).toHaveCount(0);
    await block.click({ button: "right" });
    const actionMenu = page.getByRole("toolbar", {
      name: "Calendar actions for Morning museum",
    });
    await expect(actionMenu).toBeVisible();
    const actionButtons = actionMenu.getByRole("button");
    await expect(actionButtons).toHaveCount(7);
    expect(
      await actionButtons.evaluateAll((buttons) => buttons.map((button) => button.ariaLabel)),
    ).toEqual([
      "Previous day",
      "Next day",
      "15 minutes earlier",
      "15 minutes later",
      "15 minutes longer",
      "15 minutes shorter",
      "Clone",
    ]);
    expect(await actionButtons.locator("svg").count()).toBe(7);
    const actionButtonTops = await actionButtons.evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().top),
    );
    expect(Math.max(...actionButtonTops) - Math.min(...actionButtonTops)).toBeLessThan(1);
    const nextDayAction = actionMenu.getByRole("button", { name: "Next day", exact: true });
    expect(
      await nextDayAction.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2,
        );
        return hit === element || element.contains(hit);
      }),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(actionMenu).toBeHidden();

    const longTapBox = await block.boundingBox();
    if (!longTapBox) throw new Error("Missing calendar block long tap geometry");
    const longTap = {
      pointerId: 91,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: longTapBox.x + longTapBox.width / 2,
      clientY: longTapBox.y + longTapBox.height / 2,
    };
    await block.dispatchEvent("pointerdown", longTap);
    await expect(actionMenu).toBeVisible({ timeout: 1_000 });
    await block.dispatchEvent("pointerup", { ...longTap, buttons: 0 });
    await page.getByRole("button", { name: /Sun\s+11/i }).click();
    await expect(actionMenu).toBeHidden();
    await expect(page).toHaveURL(/#2027-04-11$/);
    await block.click({ button: "right" });
    await actionMenu.getByRole("button", { name: "Clone", exact: true }).click();
    await expect(actionMenu).toBeHidden();
    const clonedBlocks = calendar.getByRole("button", {
      name: "Morning museum",
      exact: true,
    });
    await expect(clonedBlocks).toHaveCount(2);
    await expect(clonedBlocks.nth(0)).toContainText("09:15 - 10:15");
    await expect(clonedBlocks.nth(1)).toContainText("09:15 - 10:15");

    await itineraryButton.click();
    await expect(calendar).toBeHidden();
    await expect(page).toHaveURL(/[?&]view=itinerary/);

    await page.setViewportSize({ width: 390, height: 800 });
    await calendarButton.click();
    await expect(page).toHaveURL(/[?&]view=calendar/);
    await expect(calendar).toBeHidden();
    await expect(page.locator(".calendar-mobile-itinerary .day-section").first()).toBeVisible();
  } finally {
    if (!page.isClosed()) await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("drawer button resizes without closing and restores the sidebar width", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The drawer button is a desktop control");
  const id = await createEmptyTrip();
  try {
    await page.addInitScript(() => localStorage.setItem("pacenotes-display-name", "Drawer editor"));
    await page.goto(`/trips/${id}`);
    const itinerary = page.getByRole("region", { name: "Itinerary", exact: true });
    const drawer = page.getByRole("button", { name: "Hide itinerary", exact: true });
    await expect(drawer).toBeVisible();
    const width = () => itinerary.evaluate((element) => element.getBoundingClientRect().width);
    const initialWidth = await width();
    const bounds = await drawer.boundingBox();
    if (!bounds) throw new Error("The drawer button is not visible");
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 120, y, { steps: 8 });
    await page.mouse.up();
    await expect(itinerary).toBeVisible();
    await expect.poll(width).toBeGreaterThan(initialWidth + 100);
    const resizedWidth = await width();

    await drawer.focus();
    await drawer.press("ArrowLeft");
    await expect.poll(width).toBeLessThan(resizedWidth - 10);
    await drawer.press("ArrowRight");
    await expect.poll(width).toBeCloseTo(resizedWidth, 0);
    await drawer.click();
    await expect(itinerary).toBeHidden();
    const show = page.getByRole("button", { name: "Show itinerary", exact: true });
    await expect(show).toHaveAttribute("aria-expanded", "false");
    const controls = page.getByRole("group", { name: "Planner view" });
    await expect(controls.getByRole("button", { name: "List", exact: true })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await show.click();
    await expect(itinerary).toBeVisible();
    await expect.poll(width).toBeCloseTo(resizedWidth, 0);
    await drawer.press("Enter");
    await expect(itinerary).toBeHidden();
    await show.press("Space");
    await expect(itinerary).toBeVisible();
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("selected places and item edits save automatically", async ({ page }) => {
  const id = await createEmptyTrip();
  try {
    await page.addInitScript(() => localStorage.setItem("pacenotes-display-name", "Place editor"));
    await page.goto(`/trips/${id}`);
    await addDayItem(page, "place");
    const placeSearch = page.locator(".place-search");
    await expect(placeSearch.getByRole("button", { name: "Save entry" })).toHaveCount(0);
    await page.locator("gmp-place-autocomplete").evaluate((element) => {
      element.dispatchEvent(
        Object.assign(new Event("gmp-select"), {
          placePrediction: {
            toPlace: () => ({
              id: "selected-place",
              location: { lat: () => 35.6762, lng: () => 139.6503 },
              fetchFields: async () => {},
            }),
          },
        }),
      );
    });
    await expect(page.locator(".itinerary-entry")).toHaveCount(1);
    const row = page.locator(".itinerary-entry");
    await expect(row).toHaveCount(1);
    await expect(row.locator(".entry-select")).toHaveText("Test destination");
    await expect(page.locator(".place-search")).toHaveCount(0);
    await expect(page.locator(".item-editor")).toHaveCount(0);
    await expect(row.getByRole("button", { name: /Edit .* label/ })).toHaveCount(0);
    await row.click({ position: { x: 8, y: 8 } });
    const editor = page.locator(".item-editor");
    await expect(editor).toBeVisible();
    const share = page.getByRole("button", { name: "Share", exact: true });
    await share.hover();
    await expect
      .poll(() =>
        share.evaluate((button) => {
          const sample = document.createElement("span");
          sample.style.borderColor = "transparent";
          sample.style.background = "var(--muted-surface)";
          document.body.append(sample);
          const style = getComputedStyle(button);
          const expected = getComputedStyle(sample);
          const matches =
            style.borderTopColor === expected.borderTopColor &&
            style.backgroundColor === expected.backgroundColor;
          sample.remove();
          return matches;
        }),
      )
      .toBe(true);
    await expect(editor.getByRole("img", { name: "Markdown supported" })).toBeVisible();
    await expect(editor.getByRole("img", { name: "Markdown supported" })).toHaveText("");
    await expect(editor.getByText("Place", { exact: true })).toHaveCount(0);
    const changePlace = editor.getByRole("button", { name: "Change Place", exact: true });
    const editTitle = editor.getByRole("button", { name: "Edit Test destination label" });
    await expect(changePlace).toBeVisible();
    const editBox = await editTitle.boundingBox();
    const changeBox = await changePlace.boundingBox();
    expect(editBox && changeBox && editBox.x < changeBox.x).toBe(true);
    expect(editBox?.width).toBeLessThanOrEqual(24);
    expect(editBox?.height).toBeLessThanOrEqual(24);
    expect((changeBox?.x ?? 0) - ((editBox?.x ?? 0) + (editBox?.width ?? 0))).toBeGreaterThan(16);
    expect(
      await row.evaluate(
        (entry) =>
          entry.nextElementSibling?.classList.contains("item-editor") &&
          getComputedStyle(entry.nextElementSibling).position !== "sticky",
      ),
    ).toBe(true);
    await changePlace.click();
    const editPlaceSearch = editor.locator("gmp-place-autocomplete");
    await expect(editPlaceSearch).toBeVisible();
    const placeFieldGeometry = await editor.evaluate((element) => {
      const picker = element.querySelector("gmp-place-autocomplete");
      const panel = picker?.closest(".place-picker")?.parentElement;
      const close = element.querySelector<HTMLButtonElement>('[aria-label="Close editor"]');
      if (!picker || !panel || !close) throw new Error("Missing editor place field");
      return {
        panelPosition: getComputedStyle(panel).position,
        pickerRight: picker.getBoundingClientRect().right,
        editorRight: element.getBoundingClientRect().right,
        closeBottom: close.getBoundingClientRect().bottom,
        pickerTop: picker.getBoundingClientRect().top,
      };
    });
    expect(placeFieldGeometry.panelPosition).not.toBe("absolute");
    expect(placeFieldGeometry.pickerRight).toBeLessThanOrEqual(placeFieldGeometry.editorRight + 1);
    expect(placeFieldGeometry.closeBottom).toBeLessThanOrEqual(placeFieldGeometry.pickerTop);
    await changePlace.click();
    const details = page.getByRole("dialog", { name: "Place details", exact: true });
    await expect(details).toBeVisible();
    await expect(editor.locator("gmp-place-details")).toHaveCount(0);
    await expect(editor.getByRole("heading", { name: "Test destination" })).toBeVisible();
    await editor.getByRole("button", { name: "Edit Test destination label" }).click();
    const label = editor.getByRole("textbox", { name: "Itinerary label" });
    await expect(label).toHaveValue("Test destination");
    const editingTitleBox = await label.boundingBox();
    const editingPlaceBox = await changePlace.boundingBox();
    expect(
      Math.abs(
        (editingTitleBox?.y ?? 0) +
          (editingTitleBox?.height ?? 0) / 2 -
          ((editingPlaceBox?.y ?? 0) + (editingPlaceBox?.height ?? 0) / 2),
      ),
    ).toBeLessThan(2);
    await label.press("Enter");
    await editor.getByRole("button", { name: "Edit Test destination label" }).click();
    const longTitle = "W".repeat(300);
    await label.fill(longTitle);
    await label.press("Enter");
    expect(
      await editor.evaluate(
        (element) =>
          element.scrollWidth <= element.clientWidth + 1 &&
          element.getBoundingClientRect().right <=
            (element.parentElement?.getBoundingClientRect().right ?? Number.POSITIVE_INFINITY) + 1,
      ),
    ).toBe(true);
    await editor.getByRole("button", { name: `Edit ${longTitle} label` }).click();
    await label.fill("Meeting point");
    await label.press("Enter");
    await expect(row.locator(".entry-select")).toHaveText("Meeting point");
    await expect(editor.getByRole("button", { name: "Save item" })).toHaveCount(0);
    await expect(editor.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);

    await editor.locator("textarea").fill("Bring tickets");
    await expect(editor).toBeVisible();
    await editor.getByRole("button", { name: "Close editor" }).click();
    await expect(editor).toHaveCount(0);
    await expect(row).toContainText("Bring tickets");
    await expect(details).toHaveCount(0);
    await page.locator(".date-tabs [data-day-tab]").nth(1).click();
    await expect(page.locator(".item-editor")).toHaveCount(0);
    await page.locator(".date-tabs [data-day-tab]").nth(0).click();
    await expect(page.locator(".item-editor")).toHaveCount(0);
    await expect(row.getByRole("button", { name: /^Reorder / })).toHaveCount(0);
    const detailsPosition = await row
      .getByText("Bring tickets", { exact: true })
      .evaluate((element) => {
        const card = element.closest(".itinerary-entry");
        if (!card) throw new Error("The item details have no entry");
        const bounds = element.getBoundingClientRect();
        const entry = card.getBoundingClientRect();
        return {
          x: bounds.x - entry.x + bounds.width / 2,
          y: bounds.y - entry.y + bounds.height / 2,
        };
      });
    await row.click({ position: detailsPosition });
    await expect(page.locator(".item-editor")).toBeVisible();
    await page.waitForTimeout(550);
    await editor.getByRole("button", { name: "Edit Meeting point label" }).click();
    await label.fill("Updated by autosave");
    await label.press("Escape");
    await expect(row.locator(".entry-select")).toHaveText("Updated by autosave");
    await page.waitForTimeout(550);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(row.locator(".entry-select")).toHaveText("Meeting point");
    await editor.getByRole("button", { name: "Edit Meeting point label" }).click();
    await label.fill("");
    await label.press("Enter");
    await expect(row.locator(".entry-select")).toHaveText("Test destination");
    await expect
      .poll(async () => {
        const [stored] = await db.select().from(documents).where(eq(documents.name, id));
        if (!stored) return null;
        const saved = new Y.Doc();
        Y.applyUpdate(saved, stored.data);
        const item = Object.values(readTripDocument(saved).items).find(
          (item) => item.place?.placeId === "selected-place",
        );
        saved.destroy();
        return item;
      })
      .toMatchObject({
        title: "",
        details: "Bring tickets",
        place: { placeId: "selected-place" },
      });
    await page.reload();
    await expect(row.locator(".entry-select")).toHaveText("Test destination");
    await addDayItem(page, "note");
    await page.getByRole("button", { name: "Move Test destination down", exact: true }).click();
    await expect(row.nth(1).locator(".entry-select")).toHaveText("Test destination");
    await expect(page.locator(".item-editor")).toHaveCount(0);
    await row.nth(1).hover();
    await page.getByRole("button", { name: "Move Test destination up", exact: true }).click();
    await expect(row.nth(0).locator(".entry-select")).toHaveText("Test destination");
    await expect(page.locator(".item-editor")).toHaveCount(0);
    await row.nth(1).click({ position: { x: 8, y: 8 } });
    await expect(editor.getByRole("heading", { name: "New note" })).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete New note", exact: true }).click();
    await expect(row).toHaveCount(1);
    await expect(row.nth(0).locator(".entry-select")).toHaveText("Test destination");
    await expect(page.locator(".item-editor")).toHaveCount(0);
    await row.nth(0).click({ position: { x: 8, y: 8 } });
    await expect(editor.getByRole("combobox", { name: /^(Day|Date)$/ })).toHaveCount(0);
    await page.reload();
    await page
      .getByRole("group", { name: "Planner view" })
      .getByRole("button", { name: "Map", exact: true })
      .click();
    const scheduledPlace = row.nth(0);
    await scheduledPlace.click({ position: { x: 8, y: 8 } });
    await expect(editor.getByRole("heading", { name: "Test destination" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Map", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Map location: Cafe", exact: true }).click();
    await expect(page.locator(".item-editor")).toHaveCount(0);
    await expect(details).toBeVisible();
    await expect(details.getByRole("heading", { name: "Corner Cafe" })).toBeVisible();
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("deleting a day cancels its pending place addition", async ({ page }) => {
  const dayId = "2027-04-10";
  const id = await createEmptyTrip([
    itemForCreate("place", dayId, {
      title: "Existing place",
      place: { placeId: "museum" },
    }),
  ]);
  try {
    await page.addInitScript(() => localStorage.setItem("pacenotes-display-name", "Day editor"));
    await page.goto(`/trips/${id}`);
    const firstDay = page.locator(".day-section").first();
    await expect(firstDay.locator(".entry-select")).toHaveText("Existing place");
    await addDayItem(page, "place");
    await page.locator("gmp-place-autocomplete").evaluate((element) => {
      element.dispatchEvent(
        Object.assign(new Event("gmp-select"), {
          placePrediction: {
            toPlace: () => ({
              id: "late-place",
              location: { lat: () => 35.6762, lng: () => 139.6503 },
              fetchFields: async () => {
                const { promise, resolve } = Promise.withResolvers<void>();
                setTimeout(resolve, 500);
                await promise;
              },
            }),
          },
        }),
      );
    });
    page.once("dialog", (dialog) => dialog.accept());
    await firstDay.getByRole("button", { name: /^Delete day / }).click();
    await expect(page.locator(".day-section")).toHaveCount(2);
    await expect(page.locator(".place-search")).toHaveCount(0);
    await page.waitForTimeout(1_000);
    const [stored] = await db.select().from(documents).where(eq(documents.name, id));
    if (!stored) throw new Error("Missing test document");
    const saved = new Y.Doc();
    Y.applyUpdate(saved, stored.data);
    const candidate = Object.values(readTripDocument(saved).items).find(
      (item) => item.place?.placeId === "late-place",
    );
    saved.destroy();
    expect(candidate).toBeUndefined();
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});
test("schedule warnings stay on one line", async ({ page }) => {
  const dayId = "2027-04-10";
  const id = await createEmptyTrip([
    itemForCreate("place", dayId, {
      title: "First stop",
      place: { placeId: "warning-first" },
      startTime: "09:00",
      durationMinutes: 60,
    }),
    itemForCreate("place", dayId, {
      title: "Second stop",
      place: { placeId: "warning-second" },
      startTime: "09:30",
      durationMinutes: 60,
    }),
  ]);
  try {
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Warning editor"),
    );
    await page.goto(`/trips/${id}`);

    const warning = page.locator(".schedule-warning");
    await expect(warning).toHaveText(
      "Overlaps First stop. Travel from First stop cannot finish before this start time.",
    );
    await expect(warning).toHaveCSS("white-space", "nowrap");
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("auto placement includes the day's lodging destination", async ({ page }) => {
  const dayId = "2027-04-10";
  const id = await createEmptyTrip([
    itemForCreate("place", dayId, {
      id: "portland",
      title: "Portland",
      place: { placeId: "placement-portland" },
      startTime: "13:00",
      durationMinutes: 60,
    }),
    itemForCreate("lodging", dayId, {
      id: "ellsworth",
      title: "Ellsworth",
      place: { placeId: "placement-ellsworth" },
      lodging: { startDate: dayId, endDate: "2027-04-11" },
      durationMinutes: 0,
    }),
  ]);
  try {
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Placement editor"),
    );
    await page.goto(`/trips/${id}`);
    await addDayItem(page, "place");
    await page.locator("gmp-place-autocomplete").evaluate((element) => {
      element.dispatchEvent(
        Object.assign(new Event("gmp-select"), {
          placePrediction: {
            toPlace: () => ({
              id: "placement-camden",
              location: { lat: () => 3, lng: () => 0 },
              fetchFields: async () => {},
            }),
          },
        }),
      );
    });

    await expect(page.locator(".day-section").first().locator(".entry-select")).toHaveText([
      "Portland",
      "Test destination",
      "Ellsworth",
    ]);
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("first trip open asks for an editor name", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "The collaboration project covers editor identity",
  );
  await page.goto(`/trips/${tripId}`);
  const dialog = page.getByRole("dialog", { name: "Please tell us your name" });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (globalThis as typeof globalThis & { __pacenotesMapConstructions?: number })
            .__pacenotesMapConstructions ?? 0,
      ),
    )
    .toBeGreaterThan(0);
  const mapConstructions = await page.evaluate(
    () =>
      (globalThis as typeof globalThis & { __pacenotesMapConstructions?: number })
        .__pacenotesMapConstructions ?? 0,
  );

  await dialog.getByLabel("Your name").fill("Tokyo editor");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("pacenotes-display-name")))
    .toBe("Tokyo editor");
  await page.waitForTimeout(250);
  const settledMapConstructions = await page.evaluate(
    () =>
      (globalThis as typeof globalThis & { __pacenotesMapConstructions?: number })
        .__pacenotesMapConstructions ?? 0,
  );
  expect(settledMapConstructions - mapConstructions).toBeLessThanOrEqual(2);
  await page.waitForTimeout(250);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (globalThis as typeof globalThis & { __pacenotesMapConstructions?: number })
            .__pacenotesMapConstructions ?? 0,
      ),
    )
    .toBe(settledMapConstructions);
});
test("item editors expand inline after their entries", async ({ page }) => {
  const id = await createEmptyTrip();
  try {
    await page.addInitScript(() => localStorage.setItem("pacenotes-display-name", "Inline editor"));
    await page.goto(`/trips/${id}`);
    await addDayItem(page, "note");
    await addDayItem(page, "note");
    const entries = page.locator(".day-section").first().locator(".itinerary-entry");
    await expect(entries).toHaveCount(2);
    const entryGap = () =>
      entries.evaluateAll(([first, second]) => {
        if (!first || !second) throw new Error("Missing itinerary entries");
        return second.getBoundingClientRect().top - first.getBoundingClientRect().bottom;
      });
    const gapBefore = await entryGap();
    await entries.nth(0).click({ position: { x: 8, y: 8 } });
    const editor = page.locator(".item-editor");
    await expect(editor).toBeVisible();
    expect(
      await entries
        .nth(0)
        .evaluate((entry) => entry.nextElementSibling?.classList.contains("item-editor")),
    ).toBe(true);
    const editorHeight = await editor.evaluate((element) => element.getBoundingClientRect().height);
    await expect.poll(entryGap).toBeGreaterThan(gapBefore + editorHeight - 2);
    await editor.getByRole("button", { name: "Close editor" }).click();
    await expect.poll(entryGap).toBeCloseTo(gapBefore, 0);
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("pointer drops rejoin the reordered list without a pause", async ({ page }) => {
  const id = await createEmptyTrip();
  try {
    await page.addInitScript(() => localStorage.setItem("pacenotes-display-name", "Drag editor"));
    await page.goto(`/trips/${id}`);
    await addDayItem(page, "note");
    let entries = page.locator(".day-section").first().locator(".itinerary-entry");
    await entries.nth(0).click({ position: { x: 8, y: 8 } });
    const editor = page.locator(".item-editor");
    await editor.getByRole("button", { name: "Edit New note label" }).click();
    await editor.getByRole("textbox", { name: "Itinerary label" }).fill("First stop");
    await editor.getByRole("textbox", { name: "Itinerary label" }).press("Enter");
    await expect(entries.nth(0).locator(".entry-select")).toHaveText("First stop");
    await addDayItem(page, "note");
    entries = page.locator(".day-section").first().locator(".itinerary-entry");
    await expect(entries).toHaveCount(2);
    await expect(page.locator(".item-editor")).toHaveCount(0);

    const handleBox = await entries.nth(0).boundingBox();
    const targetBox = await entries.nth(1).boundingBox();
    if (!handleBox || !targetBox) throw new Error("Missing drag geometry");
    await page.mouse.move(handleBox.x + 8, handleBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 8, handleBox.y + 16);
    await expect(page.locator(".itinerary-entry.is-dragging")).toHaveCount(1);
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 2, {
      steps: 8,
    });
    const releasedAt = performance.now();
    await page.mouse.up();
    await expect(page.locator(".itinerary-entry.is-dragging")).toHaveCount(0, { timeout: 200 });
    expect(performance.now() - releasedAt).toBeLessThan(200);
    await expect(entries.nth(1).locator(".entry-select")).toHaveText("First stop");
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});
test("entries can be dragged to another day", async ({ page }) => {
  const id = await createEmptyTrip();
  try {
    await page.addInitScript(() => localStorage.setItem("pacenotes-display-name", "Day editor"));
    await page.goto(`/trips/${id}`);
    await addDayItem(page, "note");
    const days = page.locator(".day-section");
    await page.waitForTimeout(600);
    const source = days.nth(0);
    const destination = days.nth(1);
    const handleBox = await source.locator(".itinerary-entry").boundingBox();
    const destinationBox = await destination.locator(".itinerary-list").boundingBox();
    if (!handleBox || !destinationBox) throw new Error("Missing cross-day drag geometry");

    await page.mouse.move(handleBox.x + 8, handleBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 8, handleBox.y + 16);
    await expect(page.locator(".itinerary-entry.is-dragging")).toHaveCount(1);
    await page.mouse.move(
      destinationBox.x + destinationBox.width / 2,
      destinationBox.y + destinationBox.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();

    await expect(source.locator(".itinerary-entry")).toHaveCount(0);
    await expect(destination.locator(".entry-select")).toHaveText("New note");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(source.locator(".entry-select")).toHaveText("New note");
    await page.getByRole("button", { name: "Redo" }).click();
    await expect(destination.locator(".entry-select")).toHaveText("New note");
    await page.reload();
    await expect(days.nth(1).locator(".entry-select")).toHaveText("New note");
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("Places to visit can jump into view and drag an item into a day", async ({ page }) => {
  const id = await createEmptyTrip([
    itemForCreate("note", null, {
      title: "Visit later",
    }),
  ]);
  try {
    await page.addInitScript(() => localStorage.setItem("pacenotes-display-name", "Inbox editor"));
    await page.goto(`/trips/${id}`);
    const panel = page.locator(".planner-panel");
    const inbox = page.locator(".inbox-section");
    const inboxTab = page.getByRole("button", { name: "Places to visit", exact: true });
    await inboxTab.click();
    await expect(inbox).toBeInViewport();
    await expect(inboxTab).toHaveAttribute("aria-current", "true");

    await panel.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const source = inbox.locator(".itinerary-entry");
    const destination = page.locator(".day-section").last();
    const handleBox = await source.boundingBox();
    const destinationBox = await destination.locator(".itinerary-list").boundingBox();
    if (!handleBox || !destinationBox) throw new Error("Missing inbox drag geometry");

    await page.mouse.move(handleBox.x + 8, handleBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 8, handleBox.y + 16);
    await expect(page.locator(".itinerary-entry.is-dragging")).toHaveCount(1);
    await page.mouse.move(
      destinationBox.x + destinationBox.width / 2,
      destinationBox.y + destinationBox.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();

    await expect(source).toHaveCount(0);
    await expect(destination.locator(".entry-select")).toHaveText("Visit later");
    await page.reload();
    await expect(page.locator(".day-section").last().locator(".entry-select")).toHaveText(
      "Visit later",
    );
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("a 500-place trip keeps map overlays stable and changes days promptly", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "The desktop project runs the interaction benchmark",
  );
  await page.addInitScript(() =>
    localStorage.setItem("pacenotes-display-name", "Performance editor"),
  );
  await page.goto(`/trips/${tripId}`);
  const title = page.getByRole("textbox", { name: "Trip title" });
  await expect(title).toHaveValue("Shared Tokyo plan");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              __pacenotesRouteComputes?: number;
            }
          ).__pacenotesRouteComputes ?? 0,
      ),
    )
    .toBeGreaterThanOrEqual(450);
  await page.waitForTimeout(500);
  const readOverlayConstructions = () =>
    page.evaluate(() => {
      const scope = globalThis as typeof globalThis & {
        __pacenotesMarkerConstructions?: number;
        __pacenotesRoutePolylineConstructions?: number;
      };
      return {
        markers: scope.__pacenotesMarkerConstructions ?? 0,
        polylines: scope.__pacenotesRoutePolylineConstructions ?? 0,
      };
    });
  const overlayConstructions = await readOverlayConstructions();

  await title.fill("Performance map edit");
  await title.press("Enter");
  await page.waitForTimeout(500);
  const constructionsAfterEdit = await readOverlayConstructions();
  expect(constructionsAfterEdit).toEqual(overlayConstructions);
  expect(overlayConstructions.markers).toBeLessThanOrEqual(500);
  expect(overlayConstructions.polylines).toBeLessThanOrEqual(30);

  await title.fill("Shared Tokyo plan");
  await title.press("Enter");
  const responseTime = await page.evaluate(async () => {
    const days = document.querySelectorAll<HTMLButtonElement>(".date-tabs [data-day-tab]");
    const lastDay = days.item(days.length - 1);
    const start = performance.now();
    lastDay.click();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    return performance.now() - start;
  });
  expect(responseTime).toBeLessThanOrEqual(100);
  await expect(page.getByRole("heading", { name: "Sunday, May 9", exact: true })).toBeVisible();
});

test("resizing a 500-place split avoids itinerary recommits", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop projects run the resize benchmark");
  await page.addInitScript(() => {
    localStorage.setItem("pacenotes-display-name", "Resize performance editor");
    const scope = globalThis as typeof globalThis & {
      __pacenotesTestItineraryProfiler?: {
        count: number;
        onRender: () => void;
      };
    };
    const profiler = {
      count: 0,
      onRender: () => {
        profiler.count += 1;
      },
    };
    scope.__pacenotesTestItineraryProfiler = profiler;
  });
  await page.goto(`/trips/${tripId}`);
  await expect(page.getByRole("textbox", { name: "Trip title" })).toHaveValue("Shared Tokyo plan");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              __pacenotesRouteComputes?: number;
            }
          ).__pacenotesRouteComputes ?? 0,
      ),
    )
    .toBeGreaterThanOrEqual(499);
  await page.waitForTimeout(500);

  const drawer = page.getByRole("button", { name: "Hide itinerary", exact: true });
  const bounds = await drawer.boundingBox();
  if (!bounds) throw new Error("The drawer button is not visible");
  await page.evaluate(() => {
    const panel = document.querySelector(".planner-panel");
    if (!panel) throw new Error("The itinerary panel is not visible");
    const profiler = (
      globalThis as typeof globalThis & {
        __pacenotesTestItineraryProfiler?: { count: number };
      }
    ).__pacenotesTestItineraryProfiler;
    if (!profiler) throw new Error("The itinerary profiler is not available");
    profiler.count = 0;
    let childMutations = 0;
    const frames: number[] = [];
    const observer = new MutationObserver((records) => {
      childMutations += records.reduce(
        (count, record) => count + record.addedNodes.length + record.removedNodes.length,
        0,
      );
    });
    observer.observe(panel, { childList: true, subtree: true });
    let frame = requestAnimationFrame(function measure(time) {
      frames.push(time);
      frame = requestAnimationFrame(measure);
    });
    (
      globalThis as typeof globalThis & {
        __finishResizeProbe?: () => Promise<{
          childMutations: number;
          itineraryCommits: number;
          maxFrameGap: number;
        }>;
      }
    ).__finishResizeProbe = async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      cancelAnimationFrame(frame);
      observer.disconnect();
      const gaps = frames.slice(1).map((time, index) => time - (frames[index] ?? time));
      return {
        childMutations,
        itineraryCommits:
          (
            globalThis as typeof globalThis & {
              __pacenotesTestItineraryProfiler?: { count: number };
            }
          ).__pacenotesTestItineraryProfiler?.count ?? 0,
        maxFrameGap: Math.max(0, ...gaps),
      };
    };
  });
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 180, y, { steps: 24 });
  await page.mouse.up();
  const result = await page.evaluate(async () => {
    const scope = globalThis as typeof globalThis & {
      __finishResizeProbe?: () => Promise<{
        childMutations: number;
        itineraryCommits: number;
        maxFrameGap: number;
      }>;
    };
    const finish = scope.__finishResizeProbe;
    delete scope.__finishResizeProbe;
    if (!finish) throw new Error("The resize probe is not available");
    const result = await finish();
    delete (
      globalThis as typeof globalThis & {
        __pacenotesTestItineraryProfiler?: unknown;
      }
    ).__pacenotesTestItineraryProfiler;
    return result;
  });
  expect(result.maxFrameGap).toBeLessThan(80);
  expect(result.itineraryCommits).toBe(0);
  expect(result.childMutations).toBe(0);
});

test("two open planners exchange a live item edit", async ({ browser }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "The mobile project covers layout and accessibility",
  );
  const first = await browser.newPage();
  const second = await browser.newPage();
  await Promise.all([mockGoogle(first), mockGoogle(second)]);
  await first.addInitScript(() => localStorage.setItem("pacenotes-display-name", "Editor one"));
  await second.addInitScript(() => localStorage.setItem("pacenotes-display-name", "Editor two"));
  await Promise.all([first.goto(`/trips/${tripId}`), second.goto(`/trips/${tripId}`)]);
  await expect(first.getByRole("textbox", { name: "Trip title" })).toHaveValue("Shared Tokyo plan");
  await expect(second.getByRole("textbox", { name: "Trip title" })).toHaveValue(
    "Shared Tokyo plan",
  );

  await addDayItem(first, "note");
  await expect(first.locator(".item-editor")).toHaveCount(0);
  await first
    .locator(".entry-select")
    .filter({ hasText: /^New note$/ })
    .click();
  await first.getByRole("button", { name: "Edit New note label" }).click();
  await first.getByRole("textbox", { name: "Itinerary label" }).fill("Meet at Tokyo Station");
  await first.getByRole("textbox", { name: "Itinerary label" }).press("Enter");
  await expect(
    first.locator(".entry-select").filter({ hasText: /^Meet at Tokyo Station$/ }),
  ).toBeVisible();
  await first.getByRole("button", { name: "Close editor" }).click();
  await expect(first.locator(".item-editor")).toHaveCount(0);
  await expect(second.locator(".sync-state")).toContainText(/synced/i);
  await expect(second.getByText("Meet at Tokyo Station", { exact: true })).toBeVisible();
  await first.getByRole("button", { name: "Meet at Tokyo Station", exact: true }).click();
  await second.getByRole("button", { name: "Meet at Tokyo Station", exact: true }).click();
  await second.getByRole("button", { name: "Edit Meet at Tokyo Station label" }).click();
  await second.getByRole("textbox", { name: "Itinerary label" }).fill("Station entrance");
  await expect(
    first.locator(".entry-select").filter({ hasText: /^Station entrance$/ }),
  ).toBeVisible();
  await first.locator(".item-editor textarea").fill("Bring the tickets");
  await expect(
    first.locator(".entry-select").filter({ hasText: /^Station entrance$/ }),
  ).toBeVisible();
  await expect(
    second.locator(".itinerary-entry").filter({ hasText: "Station entrance" }),
  ).toContainText("Bring the tickets");
  await first.close();
  await second.close();
});

test("hard deletion removes the shared trip", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "The desktop project covers destructive controls",
  );
  await page.addInitScript(() => localStorage.setItem("pacenotes-display-name", "Deleting editor"));
  await page.goto(`/trips/${tripId}`);
  await page.getByRole("button", { name: "Delete trip" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete this trip?" });
  await dialog.getByLabel("Trip title confirmation").fill("Shared Tokyo plan");
  await dialog.getByRole("button", { name: "Delete trip" }).click();
  await expect(page).toHaveURL("/");
  await expect
    .poll(async () => db.select().from(trips).where(eq(trips.id, tripId)))
    .toHaveLength(0);
  await page.goto(`/trips/${tripId}`);
  await expect(page.getByText("Trip not found", { exact: true })).toBeVisible();
});

test("transport endpoints connect to adjacent itinerary places", async ({ page }) => {
  const dayId = "2027-04-10";
  const before = itemForCreate("place", dayId, {
    title: "Before transport",
    place: { placeId: "before-transport" },
  });
  const transport = itemForCreate("transport", dayId, {
    title: "Train",
    transport: {
      mode: "train",
      customMode: "",
      from: { placeId: "transport-from" },
      to: { placeId: "transport-to" },
    },
  });
  const after = itemForCreate("place", dayId, {
    title: "After transport",
    place: { placeId: "after-transport" },
  });
  const fromOnly = itemForCreate("transport", dayId, {
    title: "Departing train",
    transport: {
      mode: "train",
      customMode: "",
      from: { placeId: "second-transport-from" },
      to: null,
    },
  });
  const middle = itemForCreate("place", dayId, {
    title: "Between transports",
    place: { placeId: "between-transports" },
  });
  const toOnly = itemForCreate("transport", dayId, {
    title: "Arriving train",
    transport: {
      mode: "train",
      customMode: "",
      from: null,
      to: { placeId: "second-transport-to" },
    },
  });
  const end = itemForCreate("place", dayId, {
    title: "After one-sided transport",
    place: { placeId: "after-one-sided-transport" },
  });
  const noEndpoints = itemForCreate("transport", dayId, {
    title: "Unlocated transport",
    transport: {
      mode: "train",
      customMode: "",
      from: null,
      to: null,
    },
  });
  const id = await createEmptyTrip([
    before,
    transport,
    after,
    fromOnly,
    middle,
    toOnly,
    end,
    noEndpoints,
  ]);
  try {
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Transport routing"),
    );
    await page.goto(`/trips/${id}`);
    const units = page.locator(".day-section").first().locator(".itinerary-unit");
    const unit = (title: string) =>
      units.filter({ has: page.getByRole("button", { name: title, exact: true }) });
    await expect(unit("Before transport").locator(".transport-leg")).toHaveCount(0);
    await expect(unit("Train").locator(".transport-leg")).toBeVisible();
    await expect(unit("After transport").locator(".transport-leg")).toBeVisible();
    await expect(unit("Departing train").locator(".transport-leg")).toBeVisible();
    await expect(unit("Between transports").locator(".transport-leg")).toHaveCount(0);
    await expect(unit("Arriving train").locator(".transport-leg")).toHaveCount(0);
    await expect(unit("After one-sided transport").locator(".transport-leg")).toBeVisible();

    const trainEntry = unit("Train").locator(".itinerary-entry");
    const displacedEntry = unit("After transport").locator(".itinerary-entry");
    const trainBox = await trainEntry.boundingBox();
    const displacedBox = await displacedEntry.boundingBox();
    const legOffsets = await page.locator(".transport-leg").evaluateAll((legs) => {
      const origin = legs[0]?.getBoundingClientRect().top ?? 0;
      return legs.map((leg) => leg.getBoundingClientRect().top - origin);
    });
    if (!trainBox || !displacedBox) throw new Error("Missing transport drag geometry");
    await page.mouse.move(trainBox.x + 8, trainBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(trainBox.x + 8, trainBox.y + 16);
    await expect(trainEntry).toHaveClass(/is-dragging/);
    await page.mouse.move(
      displacedBox.x + displacedBox.width / 2,
      displacedBox.y + displacedBox.height - 2,
      { steps: 8 },
    );
    await expect(unit("Train").locator(".entry-drag-space")).toHaveCSS(
      "height",
      `${trainBox.height}px`,
    );
    expect(
      await page.locator(".transport-leg").evaluateAll((legs) => {
        const origin = legs[0]?.getBoundingClientRect().top ?? 0;
        return legs.map((leg) => leg.getBoundingClientRect().top - origin);
      }),
    ).toEqual(legOffsets);
    expect(
      await page
        .locator(".leg-mode")
        .evaluateAll((modes) =>
          modes.every((mode) => getComputedStyle(mode).visibility === "visible"),
        ),
    ).toBe(true);
    await page.mouse.up();
    await expect(page.locator(".itinerary-entry.is-dragging")).toHaveCount(0);
    await expect(page.locator(".map-number-marker")).toHaveCount(8);
    expect(await page.locator(".map-number-marker span").allTextContents()).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
    ]);
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("fresh trip renders routes for a visible inactive day", async ({ page }) => {
  const first = itemForCreate("place", "2027-04-11", {
    title: "First second-day place",
    place: { placeId: "first-second-day-place" },
    startTime: "09:30",
  });
  const second = itemForCreate("place", "2027-04-11", {
    title: "Second second-day place",
    place: { placeId: "second-second-day-place" },
  });
  const id = await createEmptyTrip([first, second]);
  try {
    await page.addInitScript(() => localStorage.setItem("pacenotes-display-name", "Route export"));
    await page.goto(`/trips/${id}`);
    const dates = page.locator(".date-tabs [data-day-tab]");
    const dayTwoRoute = page.locator(".day-section").nth(1).locator(".transport-leg");
    await expect(dates.nth(0)).toHaveAttribute("aria-current", "date");
    await expect(dayTwoRoute).toContainText("10 min - 1.0 km");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                __pacenotesRouteDepartureTimes?: Array<string | null>;
              }
            ).__pacenotesRouteDepartureTimes ?? [],
        ),
      )
      .toContain("2027-04-11T00:30:00.000Z");
    const dayOne = page.locator(".day-section").nth(0);
    const dayTwo = page.locator(".day-section").nth(1);
    await dayTwo.getByRole("button", { name: "First second-day place", exact: true }).click();
    const editor = page.locator(".item-editor");
    await editor.getByLabel("Start time").fill("10:30");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                __pacenotesRouteDepartureTimes?: Array<string | null>;
              }
            ).__pacenotesRouteDepartureTimes ?? [],
        ),
      )
      .toContain("2027-04-11T01:30:00.000Z");
    await editor.getByRole("button", { name: "Close editor" }).click();
    const unavailableDay = dayOne.getByRole("button", {
      name: "Add at least two places to export this day",
    });
    await expect(unavailableDay).toHaveAttribute("aria-disabled", "true");
    await unavailableDay.hover();
    await expect(page.getByRole("tooltip")).toHaveText(
      "Add at least two places to export this day",
    );
    await expect(
      dayTwo.getByRole("link", { name: "Open this route in Google Maps" }),
    ).toHaveAttribute("href", /https:\/\/www\.google\.com\/maps\/dir\/\?api=1/);
    await expect(
      dayTwo.getByRole("link", { name: "Open this day in Google Maps" }),
    ).toHaveAttribute("href", /origin_place_id=first-second-day-place/);

    await page.reload();
    await expect(dates.nth(0)).toHaveAttribute("aria-current", "date");
    await expect(dayTwoRoute).toContainText("10 min - 1.0 km");
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("trip language localizes existing Google places and routes", async ({ page }) => {
  const id = await createEmptyTrip([
    itemForCreate("place", "2027-04-10", {
      title: "",
      place: { placeId: "language-place-one" },
    }),
    itemForCreate("place", "2027-04-10", {
      title: "",
      place: { placeId: "language-place-two" },
    }),
  ]);
  try {
    await page.addInitScript(() => localStorage.setItem("pacenotes-display-name", "Language test"));
    await page.goto(`/trips/${id}`);
    await expect(page.locator(".entry-select").first()).toHaveText("Test destination");

    await page.getByRole("button", { name: "Trip settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Trip settings" });
    const language = dialog.getByLabel("Language");
    await expect(language.locator('option[value="zh-CN"]')).toHaveText("简体中文");
    await expect(language.locator('option[value="zh-TW"]')).toHaveText("繁體中文");
    await language.selectOption("zh-CN");
    await dialog.getByRole("button", { name: "Save settings" }).click();

    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.getByRole("button", { name: "分享" })).toBeVisible();
    await expect(page.locator(".entry-select").first()).toHaveText("简体-language-place-one");
    const placeLanguages = await page.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            __pacenotesPlaceLanguages?: string[];
          }
        ).__pacenotesPlaceLanguages ?? [],
    );
    expect(placeLanguages).toContain("zh-CN");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                __pacenotesRouteLanguages?: string[];
              }
            ).__pacenotesRouteLanguages ?? [],
        ),
      )
      .toContain("zh-CN");
    await page.getByRole("button", { name: "Map location: Museum", exact: true }).click();
    await expect(page.getByRole("heading", { name: "简体-museum" })).toBeVisible();
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("map features stay visible across every trip day", async ({ page }) => {
  const routeTrip = await createEmptyTrip([
    itemForCreate("place", "2027-04-10", {
      title: "First map place",
      place: { placeId: "first-map-place" },
    }),
    itemForCreate("place", "2027-04-11", {
      title: "Second map place",
      place: { placeId: "second-map-place" },
    }),
    itemForCreate("place", "2027-04-12", {
      title: "Third map place",
      place: { placeId: "third-map-place" },
    }),
  ]);
  const transportTrip = await createEmptyTrip([
    itemForCreate("transport", "2027-04-11", {
      title: "Second-day train",
      transport: {
        mode: "train",
        customMode: "",
        from: { placeId: "second-day-train-from" },
        to: { placeId: "second-day-train-to" },
      },
    }),
    itemForCreate("transport", "2027-04-12", {
      title: "Third-day train",
      transport: {
        mode: "train",
        customMode: "",
        from: { placeId: "third-day-train-from" },
        to: { placeId: "third-day-train-to" },
      },
    }),
  ]);
  const routePolylines = () =>
    page.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            __pacenotesRoutePolylines?: number;
          }
        ).__pacenotesRoutePolylines ?? 0,
    );
  const transportPolylines = () =>
    page.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            __pacenotesTransportPolylines?: number;
          }
        ).__pacenotesTransportPolylines ?? 0,
    );
  await page.addInitScript(() => localStorage.setItem("pacenotes-display-name", "Trip-wide map"));
  try {
    await page.goto(`/trips/${routeTrip}`);
    const dates = page.locator(".date-tabs [data-day-tab]");
    await expect(dates.nth(0)).toHaveAttribute("aria-current", "date");
    await expect(page.locator(".map-number-marker")).toHaveCount(3);
    await expect.poll(routePolylines).toBe(2);
    await dates.nth(2).click();
    await expect(page.locator(".map-number-marker")).toHaveCount(3);
    await expect.poll(routePolylines).toBe(2);

    await page.goto(`/trips/${transportTrip}`);
    await expect(dates.nth(0)).toHaveAttribute("aria-current", "date");
    await expect(page.locator(".map-number-marker")).toHaveCount(4);
    expect(await page.locator(".map-number-marker span").allTextContents()).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    await expect.poll(transportPolylines).toBe(2);
    await dates.nth(1).click();
    await expect(page.locator(".map-number-marker")).toHaveCount(4);
    await expect.poll(transportPolylines).toBe(2);
  } finally {
    await db.delete(trips).where(inArray(trips.id, [routeTrip, transportTrip]));
  }
});

test("places across days have transport unless lodging separates them", async ({ page }) => {
  const dayOne = itemForCreate("place", "2027-04-10", {
    title: "Day one place",
    place: { placeId: "museum" },
  });
  const lodging = itemForCreate("lodging", "2027-04-10", {
    title: "Overnight stay",
    place: { placeId: "overnight-stay" },
    lodging: {
      startDate: "2027-04-10",
      endDate: "2027-04-11",
      confirmation: "",
    },
  });
  const dayTwo = itemForCreate("place", "2027-04-11", {
    title: "Day two place",
    place: { placeId: "day-two-place" },
  });
  const dayThree = itemForCreate("place", "2027-04-12", {
    title: "Day three place",
    place: { placeId: "day-three-place" },
  });
  const id = await createEmptyTrip([dayOne, lodging, dayTwo, dayThree]);
  try {
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Cross-day transport"),
    );
    const dates = page.locator(".date-tabs [data-day-tab]");
    await page.goto(`/trips/${id}`);
    const days = page.locator(".day-section");
    await expect(days.nth(0).locator(".missing-lodging")).toHaveCount(0);
    const missingLodging = days.nth(1).locator(".missing-lodging");
    await expect(missingLodging).toHaveText("No lodging");
    await expect(missingLodging).toHaveCSS("color", "rgb(148, 108, 35)");
    await expect(missingLodging).toHaveCSS("font-size", "11px");
    await expect(missingLodging).toHaveCSS("display", "flex");
    await expect(missingLodging).toHaveCSS("border-radius", "999px");
    await expect(missingLodging.locator("svg")).toHaveCount(1);
    const [headingBox, warningBox] = await Promise.all([
      days.nth(1).locator(".day-heading h2").boundingBox(),
      missingLodging.boundingBox(),
    ]);
    expect(headingBox).not.toBeNull();
    expect(warningBox).not.toBeNull();
    expect(warningBox?.y).toBeGreaterThanOrEqual(headingBox?.y ?? 0);
    expect((warningBox?.y ?? 0) + (warningBox?.height ?? 0)).toBeLessThanOrEqual(
      (headingBox?.y ?? 0) + (headingBox?.height ?? 0),
    );
    await expect(days.nth(2).locator(".missing-lodging")).toHaveCount(0);
    const routeComputes = () =>
      page.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              __pacenotesRouteComputes?: number;
            }
          ).__pacenotesRouteComputes ?? 0,
      );
    await expect(days.nth(0).locator(".transport-leg")).toBeVisible();
    await expect.poll(routeComputes).toBeGreaterThan(0);
    await expect(days.nth(0).locator(".route-endpoint-start")).toHaveCount(0);
    await expect(days.nth(0).locator(".route-endpoint-end")).toHaveCount(0);
    await expect(days.nth(1).locator(".route-endpoint-start")).toHaveCount(0);
    await page.getByRole("button", { name: "Map location: Museum", exact: true }).click();
    const placeDetails = page.getByRole("dialog", { name: "Place details" });
    const removeFromDay = placeDetails.getByRole("button", { name: "Remove from day 1" });
    await expect(removeFromDay).toHaveClass(/danger-button/);
    await removeFromDay.click();
    await expect(placeDetails).toHaveCount(0);
    await expect(days.nth(0).getByRole("button", { name: "Day one place" })).toHaveCount(0);
    await expect(
      page.locator(".inbox-section").getByRole("button", { name: "Day one place", exact: true }),
    ).toBeVisible();
    const dayThreeUnit = days
      .nth(2)
      .locator(".itinerary-unit")
      .filter({ has: page.getByRole("button", { name: "Day three place", exact: true }) });

    await dates.nth(1).click();
    await expect(dates.nth(1)).toHaveAttribute("aria-current", "date");
    await expect(days.nth(1).locator(".transport-leg")).toHaveCount(1);
    await expect(days.nth(1).locator(".route-endpoint-start")).toHaveCount(0);
    await expect(days.nth(1).locator(".route-endpoint-end")).toHaveCount(0);
    await dates.nth(2).click();
    await expect(dates.nth(2)).toHaveAttribute("aria-current", "date");
    const leg = days.nth(2).locator(".transport-leg");
    await expect(leg).toBeVisible();
    await expect(leg.locator(".leg-cap")).toHaveCount(0);
    const transportStart = days.nth(2).locator(".route-endpoint-start");
    await expect(transportStart).toHaveClass(/route-endpoint-transport/);
    await expect(transportStart.locator(".route-endpoint-cap")).toHaveCount(1);
    await expect(transportStart.locator(".route-endpoint-rail")).toHaveCSS("display", "none");
    expect((await transportStart.boundingBox())?.height).toBe(0);
    await expect(days.nth(2).locator(".route-endpoint-end")).toHaveCount(0);
    await expect(leg).toHaveCSS("--leg-color", "#23df16");
    expect((await leg.locator(".leg-rail").boundingBox())?.height).toBe(32);
    await expect(leg).toContainText("10 min - 1.0 km");
    await expect(page.locator(".transport-leg").filter({ hasText: "Updating route" })).toHaveCount(
      0,
    );
    const travelMode = leg.getByLabel("Travel mode");
    await expect(travelMode).toHaveValue("DRIVING");
    await expect(leg.locator(".leg-options")).toHaveCount(0);
    const plannerPanel = page.locator(".planner-panel");
    await expect
      .poll(async () => {
        const before = await plannerPanel.evaluate((panel) => panel.scrollTop);
        await page.waitForTimeout(120);
        const after = await plannerPanel.evaluate((panel) => panel.scrollTop);
        return Math.abs(after - before);
      })
      .toBeLessThan(1);

    await expect.poll(routeComputes).toBeGreaterThan(0);
    const beforeModeChange = await routeComputes();
    await travelMode.selectOption("WALKING");
    await expect.poll(routeComputes).toBeGreaterThan(beforeModeChange);
    await expect(travelMode).toHaveValue("WALKING");
    await expect(travelMode.locator("option:checked")).toHaveText("Walk");

    let routeComputesBeforeEditing = await routeComputes();
    await dayThreeUnit
      .getByRole("button", { name: "Day three place", exact: true })
      .click({ position: { x: 8, y: 8 } });
    await page.waitForTimeout(500);
    expect(await routeComputes()).toBe(routeComputesBeforeEditing);
    const editor = page.locator(".item-editor");
    await dayThreeUnit.locator(".itinerary-entry").click({ position: { x: 5, y: 5 } });
    await expect(editor).toHaveCount(0);
    await dayThreeUnit.locator(".itinerary-entry").click({ position: { x: 5, y: 5 } });
    await expect(editor).toBeVisible();
    await dates.nth(1).click();
    await expect(dates.nth(1)).toHaveAttribute("aria-current", "date");
    const dayTwoEntry = days
      .nth(1)
      .locator(".itinerary-unit")
      .filter({ has: page.getByRole("button", { name: "Day two place", exact: true }) })
      .locator(".itinerary-entry");
    await dayTwoEntry.click({ position: { x: 5, y: 5 } });
    await expect(editor.getByRole("heading", { name: "Day two place" })).toBeVisible();
    await expect(editor.getByRole("combobox", { name: /^(Day|Date)$/ })).toHaveCount(0);
    await dayTwoEntry.click({ position: { x: 5, y: 5 } });
    await expect(editor).toHaveCount(0);
    await dates.nth(2).click();
    await expect(dates.nth(2)).toHaveAttribute("aria-current", "date");
    await dayThreeUnit.locator(".itinerary-entry").click({ position: { x: 5, y: 5 } });
    await expect(editor).toBeVisible();
    await page.waitForTimeout(1_000);
    routeComputesBeforeEditing = await routeComputes();
    const actions = [
      editor.getByRole("button", { name: "Edit Day three place label" }),
      editor.getByRole("button", { name: "Change place" }),
      editor.getByRole("button", { name: "Change to reservation" }),
      editor.getByRole("button", { name: "Close editor" }),
    ];
    const actionBoxes = await Promise.all(actions.map((action) => action.boundingBox()));
    const actionCenters = actionBoxes.flatMap((box) => (box ? [box.y + box.height / 2] : []));
    expect(Math.max(...actionCenters) - Math.min(...actionCenters)).toBeLessThan(1);

    await editor.getByRole("button", { name: "Day three place", exact: true }).click();
    await editor.getByLabel("Itinerary label").fill("Day three place revised");
    await editor.getByLabel("Itinerary label").press("Enter");
    await page.waitForTimeout(700);
    await expect(dates.nth(2)).toHaveAttribute("aria-current", "date");
    expect(await routeComputes()).toBe(routeComputesBeforeEditing);

    await actions[1]?.click();
    await page.waitForTimeout(500);
    expect(await routeComputes()).toBe(routeComputesBeforeEditing);
    await page
      .locator('gmp-place-autocomplete[aria-label="Place"]')
      .evaluate((element, placeId) => {
        element.dispatchEvent(
          Object.assign(new Event("gmp-select"), {
            placePrediction: {
              toPlace: () => ({
                id: placeId,
                location: { lat: () => 35.67, lng: () => 139.65 },
                fetchFields: async () => ({}),
              }),
            },
          }),
        );
      }, "changed-day-three-place");
    await expect.poll(routeComputes).toBeGreaterThan(routeComputesBeforeEditing);
    let conversionConfirmation = "";
    page.once("dialog", (dialog) => {
      conversionConfirmation = dialog.message();
      void dialog.accept();
    });
    await actions[2]?.click();
    expect(conversionConfirmation).toBe("Change this place to a reservation?");
    await expect(editor.getByRole("group", { name: "Reservation" })).toBeVisible();
    await editor.getByLabel("Start time").fill("09:00");
    await editor.getByRole("button", { name: "Close editor" }).click();
    await page.reload();
    await page
      .getByRole("button", { name: "Day three place revised", exact: true })
      .click({ position: { x: 8, y: 8 } });
    await expect(
      page.locator(".item-editor").getByRole("group", { name: "Reservation" }),
    ).toBeVisible();
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("a note-only day has no loose route endpoint", async ({ page }) => {
  const place = itemForCreate("place", "2027-04-10", {
    title: "Previous day place",
    place: { placeId: "museum" },
  });
  const note = itemForCreate("note", "2027-04-11", {
    title: "Only a note",
  });
  const id = await createEmptyTrip([place, note], "2027-04-11");
  try {
    await page.goto(`/trips/${id}`);
    const days = page.locator(".day-section");
    await expect(days).toHaveCount(2);
    await expect(days.nth(1).getByText("Only a note", { exact: true })).toBeVisible();
    await expect(days.nth(1).locator(".route-endpoint")).toHaveCount(0);
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("removing the only stop leaves a persistent lodging gap", async ({ page }) => {
  const previousLodging = itemForCreate("lodging", "2027-04-10", {
    title: "Previous overnight stay",
    place: { placeId: "overnight-stay" },
    lodging: {
      startDate: "2027-04-09",
      endDate: "2027-04-10",
      confirmation: "",
    },
  });
  const middle = itemForCreate("place", "2027-04-10", {
    title: "Only day stop",
    place: { placeId: "museum" },
  });
  const nextLodging = itemForCreate("lodging", "2027-04-10", {
    title: "Next overnight stay",
    place: { placeId: "overnight-stay" },
    lodging: {
      startDate: "2027-04-10",
      endDate: "2027-04-11",
      confirmation: "",
    },
  });
  const id = await createEmptyTrip([previousLodging, middle, nextLodging]);
  try {
    await page.addInitScript(() => localStorage.setItem("pacenotes-display-name", "Lodging gap"));
    await page.goto(`/trips/${id}`);
    const day = page.locator(".day-section").first();
    await expect(day.locator(".transport-leg")).toHaveCount(2);

    await page.getByRole("button", { name: "Map location: Museum", exact: true }).click();
    const details = page.getByRole("dialog", { name: "Place details" });
    await details.getByRole("button", { name: "Remove from day 1" }).click();
    await expect(details).toHaveCount(0);
    await expect(day.getByRole("button", { name: "Only day stop", exact: true })).toHaveCount(0);
    await expect(
      page.locator(".inbox-section").getByRole("button", { name: "Only day stop", exact: true }),
    ).toBeVisible();
    await expect(day.locator(".transport-leg")).toHaveCount(0);

    await page.reload();
    await expect(day.getByRole("button", { name: "Only day stop", exact: true })).toHaveCount(0);
    await expect(
      page.locator(".inbox-section").getByRole("button", { name: "Only day stop", exact: true }),
    ).toBeVisible();
    await expect(day.locator(".transport-leg")).toHaveCount(0);
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("routes within one day use one day color", async ({ page }) => {
  const lodging = itemForCreate("lodging", "2027-04-10", {
    title: "Three-day stay",
    place: { placeId: "hotel" },
    lodging: {
      startDate: "2027-04-10",
      endDate: "2027-04-12",
      confirmation: "",
    },
  });
  const place = itemForCreate("place", "2027-04-11", {
    title: "Middle-day place",
    place: { placeId: "middle-day-place" },
  });
  const id = await createEmptyTrip([lodging, place]);
  try {
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Route color check"),
    );
    await page.goto(`/trips/${id}`);
    await page.locator(".date-tabs [data-day-tab]").nth(1).click();
    const legs = page.locator(".day-section").nth(1).locator(".transport-leg");
    await expect(legs).toHaveCount(2);
    await expect
      .poll(async () => {
        const colors = await legs.evaluateAll((items) =>
          items.map((item) => getComputedStyle(item).getPropertyValue("--leg-color").trim()),
        );
        return { colors: new Set(colors).size, populated: colors.every(Boolean) };
      })
      .toEqual({ colors: 1, populated: true });
    const railsAreGray = await legs.locator(".leg-rail").evaluateAll((rails) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--border)";
      document.body.append(probe);
      const gray = getComputedStyle(probe).color;
      probe.remove();
      return rails.every((rail) => getComputedStyle(rail).backgroundImage.includes(gray));
    });
    expect(railsAreGray).toBe(true);
    await expect(legs.locator(".leg-rail").first()).toHaveCSS("width", "1px");
    await expect(page.locator(".route-endpoint")).toHaveCount(0);
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("continuous days support transport, place-bound stays, and history shortcuts", async ({
  page,
}) => {
  const id = await createEmptyTrip();
  try {
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Itinerary editor"),
    );
    await page.goto(`/trips/${id}`);
    const dates = page.locator(".date-tabs [data-day-tab]");
    const days = page.locator(".day-section");
    await expect(days).toHaveCount(3);
    await addDayItem(page, "note");
    await expect(days.nth(0).locator(".itinerary-entry")).toHaveCount(1);
    await page.keyboard.press("Control+z");
    await expect(page.locator(".itinerary-entry")).toHaveCount(0);
    await page.keyboard.press("Control+y");
    await expect(days.nth(0).locator(".itinerary-entry")).toHaveCount(1);
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+Shift+z");
    await expect(days.nth(0).locator(".itinerary-entry")).toHaveCount(1);
    await days
      .nth(0)
      .locator(".entry-select")
      .filter({ hasText: /^New note$/ })
      .click();
    await page.locator(".item-editor textarea").fill("Draft notes");
    await page.locator(".item-editor textarea").press("Control+z");
    await expect(days.nth(0).locator(".itinerary-entry")).toHaveCount(1);
    await page.getByRole("button", { name: "Close editor", exact: true }).click();
    await expect(page.locator(".item-editor")).toHaveCount(0);
    for (let index = 0; index < 12; index += 1) {
      await addDayItem(page, "note");
    }
    await dates.nth(1).click();
    await expect(dates.nth(1)).toHaveAttribute("aria-current", "date");
    await expect(days.nth(0).locator(".itinerary-entry")).toHaveCount(13);
    await expect(days.nth(1).getByRole("button", { name: "Place", exact: true })).toBeInViewport();
    await expect
      .poll(() => page.locator(".planner-panel").evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await addDayItem(page, "transport", 1);
    const transportRow = days.nth(1).locator(".itinerary-entry");
    await transportRow.click({ position: { x: 8, y: 8 } });
    const editor = page.locator(".item-editor");
    await editor.getByRole("combobox", { name: /^Travel method/ }).selectOption("custom");
    await expect(editor.getByLabel("Start time")).toHaveCount(0);
    await expect(editor.getByLabel("Duration in minutes")).toHaveCount(0);
    await editor.getByLabel("Departure time").fill("23:30");
    await expect(editor.getByLabel("Arrival time")).toHaveValue("23:30");
    await editor.getByLabel("Arrival time").fill("01:15");
    await expect(editor.getByRole("button", { name: "Save item" })).toHaveCount(0);
    await expect(editor.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
    await editor.getByLabel("Custom travel method", { exact: true }).fill("Cable car");
    const pick = async (label: string, placeId: string) => {
      await page
        .locator(`gmp-place-autocomplete[aria-label="${label}"]`)
        .evaluate((element, selectedId) => {
          element.dispatchEvent(
            Object.assign(new Event("gmp-select"), {
              placePrediction: {
                toPlace: () => ({
                  id: selectedId,
                  location: { lat: () => 35.67, lng: () => 139.65 },
                  fetchFields: async () => ({}),
                }),
              },
            }),
          );
        }, placeId);
    };
    await pick("From", "airport-from");
    await expect(editor.getByRole("button", { name: "Remove From", exact: true })).toBeVisible();
    await pick("To", "station-to");
    await expect(editor.getByRole("button", { name: "Remove To", exact: true })).toBeVisible();
    for (const name of ["Change From", "Remove From", "Change To", "Remove To"]) {
      const action = editor.getByRole("button", { name, exact: true });
      await expect(action.locator("svg")).toBeVisible();
      await expect(action).toHaveText("");
    }
    await expect(transportRow).toContainText("Cable car");
    await page.reload();
    await dates.nth(1).click();
    await expect(dates.nth(1)).toHaveAttribute("aria-current", "date");
    await transportRow.click({ position: { x: 8, y: 8 } });
    await expect(editor.getByLabel("Custom travel method", { exact: true })).toHaveValue(
      "Cable car",
    );
    await expect(editor.getByLabel("Departure time")).toHaveValue("23:30");
    await expect(editor.getByLabel("Arrival time")).toHaveValue("01:15");
    await expect
      .poll(async () => {
        const [stored] = await db.select().from(documents).where(eq(documents.name, id));
        if (!stored) return null;
        const saved = new Y.Doc();
        Y.applyUpdate(saved, stored.data);
        const transport = Object.values(readTripDocument(saved).items).find(
          (item) => item.type === "transport" && item.transport?.customMode === "Cable car",
        );
        saved.destroy();
        return transport
          ? { startTime: transport.startTime, durationMinutes: transport.durationMinutes }
          : null;
      })
      .toEqual({ startTime: "23:30", durationMinutes: 105 });
    await editor.getByRole("button", { name: "Remove From", exact: true }).click();
    await expect(editor.getByRole("button", { name: "Remove From", exact: true })).toHaveCount(0);
    await expect(editor.getByRole("button", { name: "Remove To", exact: true })).toBeVisible();
    await editor.getByRole("button", { name: "Close editor", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await transportRow.click({ position: { x: 8, y: 8 } });
    await expect(editor.getByRole("button", { name: "Remove From", exact: true })).toHaveCount(0);
    await expect(editor.getByRole("button", { name: "Remove To", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close editor", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await dates.nth(0).click();
    await expect(dates.nth(0)).toHaveAttribute("aria-current", "date");
    await addDayItem(page, "reservation");
    const reservationSearch = days.nth(0).locator(".place-search");
    await expect(reservationSearch.getByLabel("Date")).not.toHaveValue("");
    await pick("Search Google Places", "reservation-without-time");
    await reservationSearch.getByRole("button", { name: "Add reservation" }).click();
    await expect(days.nth(0).locator(".itinerary-entry")).toHaveCount(13);
    await expect(reservationSearch).toContainText("Choose a date and time");
    await reservationSearch.getByLabel("Start time").fill("19:30");
    await pick("Search Google Places", "reserved-place");
    await reservationSearch.getByRole("button", { name: "Add reservation" }).click();
    await expect(days.nth(0).locator(".itinerary-entry")).toHaveCount(14);
    const reservationRow = days.nth(0).locator(".itinerary-entry").last();
    await reservationRow.click({ position: { x: 8, y: 8 } });
    await expect(editor.getByRole("combobox", { name: /^(Day|Date)$/ })).toHaveCount(0);
    await expect(editor.getByLabel("Travel mode after prior stop")).toHaveCount(0);
    await expect(editor.getByLabel("Start time")).toHaveValue("19:30");
    await editor.getByRole("button", { name: "Close editor", exact: true }).click();
    await addDayItem(page, "lodging");
    const lodgingSearch = days.nth(0).locator(".place-search");
    await expect(lodgingSearch.getByLabel("Check-in date")).toHaveValue("2027-04-10");
    await expect(lodgingSearch.getByLabel("Check-out date")).toHaveValue("2027-04-11");
    await lodgingSearch.getByLabel("Check-out date").fill("2027-04-12");
    await pick("Search Google Places", "hotel-place");
    await lodgingSearch.getByRole("button", { name: "Add lodging" }).click();
    await expect(days.nth(0).locator(".lodging-boundary")).toHaveCount(1);
    await expect(days.nth(0).locator(".itinerary-entry").last()).toHaveClass(/lodging-boundary/);
    await days.nth(0).locator(".lodging-boundary .entry-select").click();
    await expect(editor.getByLabel("Planning")).toHaveCount(0);
    await expect(editor.getByLabel("Travel mode after prior stop")).toHaveCount(0);
    await expect(editor.locator("fieldset").filter({ hasText: "Stay" })).toHaveCount(0);
    const checkInBox = await editor.getByLabel("Check-in date").boundingBox();
    await expect(editor.getByLabel("Check-in date")).toHaveValue("2027-04-10");
    await expect(editor.getByLabel("Check-out date")).toHaveValue("2027-04-12");
    await editor.getByLabel("Check-out date").fill("2027-04-11");
    const notesBox = await editor.getByText("Notes", { exact: true }).boundingBox();
    expect(checkInBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(notesBox?.y ?? 0);
    const duplicateStay = days.nth(1).locator(".lodging-boundary");
    await expect(duplicateStay).toHaveCount(1);
    await expect(duplicateStay).toHaveCSS("border-left-width", "1px");
    await expect(duplicateStay).toHaveCSS("box-shadow", "none");
    await editor.getByRole("button", { name: "Close editor", exact: true }).click();
    await dates.nth(1).click();
    await expect(dates.nth(1)).toHaveAttribute("aria-current", "date");
    await expect(days.nth(1).locator(".lodging-boundary")).toHaveCount(1);
    await expect(days.nth(1).locator(".itinerary-entry").first()).toHaveClass(/lodging-boundary/);
    await expect(
      days.nth(0).locator(".lodging-boundary button[aria-label^='Reorder']"),
    ).toHaveCount(0);
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("trip settings control language, units, default travel, and persist", async ({ page }) => {
  const id = await createEmptyTrip([
    itemForCreate("place", "2027-04-10", {
      title: "Museum",
      place: { placeId: "museum" },
    }),
    itemForCreate("place", "2027-04-10", {
      title: "Cafe",
      place: { placeId: "cafe" },
    }),
  ]);
  try {
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Settings editor"),
    );
    await page.goto(`/trips/${id}`);

    await expect(page.locator(".transport-leg").first()).toContainText("10 min - 1.0 km");
    const headerActions = await page
      .locator(".planner-header button")
      .evaluateAll((buttons) =>
        buttons.map(
          (button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "",
        ),
      );
    expect(headerActions).toEqual(["Undo", "Redo", "Trip settings", "Delete trip", "Share"]);

    await page.getByRole("button", { name: "Trip settings" }).click();
    const settings = page.getByRole("dialog", { name: "Trip settings" });
    await expect(settings.getByLabel("Language")).toHaveValue("en");
    await expect(settings.getByLabel("Distance units")).toHaveValue("metric");
    await expect(settings.getByLabel("Default transportation")).toHaveValue("DRIVING");
    await expect(settings.getByLabel("Calendar hours")).toHaveValue("24");
    await settings.getByLabel("Language").selectOption("fr");
    await settings.getByLabel("Distance units").selectOption("imperial");
    await settings.getByLabel("Default transportation").selectOption("WALKING");
    await settings.getByLabel("Calendar hours").selectOption("30");
    await settings.getByRole("button", { name: "Save settings" }).click();

    await expect(page.locator(".day-heading h2").first()).toContainText("samedi 10 avril");
    await page.getByRole("button", { name: "Calendar", exact: true }).click();
    const calendarHours = page.locator("[data-calendar-time-gutter] time");
    await expect(calendarHours.first()).toHaveText("06:00");
    await expect(calendarHours.last()).toHaveText("30:00");
    await page.getByRole("button", { name: "Itinerary", exact: true }).click();
    await expect(page.locator(".transport-leg").first()).toContainText(/10\s*min - 0,6\s*mi/);
    await page.locator(".day-section").first().getByRole("button", { name: "Lieu" }).click();
    await page.locator("gmp-place-autocomplete").evaluate((element) => {
      element.dispatchEvent(
        Object.assign(new Event("gmp-select"), {
          placePrediction: {
            toPlace: () => ({
              id: "settings-place",
              location: { lat: () => 35.6762, lng: () => 139.6503 },
              fetchFields: async () => {},
            }),
          },
        }),
      );
    });
    const addedUnit = page
      .locator(".itinerary-unit")
      .filter({ has: page.locator(".entry-select").filter({ hasText: /^Test destination$/ }) });
    await expect(addedUnit.getByLabel("Mode de déplacement")).toHaveValue("WALKING");

    await expect
      .poll(async () => {
        const [stored] = await db.select().from(documents).where(eq(documents.name, id));
        if (!stored) return null;
        const document = new Y.Doc();
        Y.applyUpdate(document, new Uint8Array(stored.data));
        const snapshot = readTripDocument(document);
        document.destroy();
        return {
          language: snapshot.language,
          distanceUnit: snapshot.distanceUnit,
          defaultTravelMode: snapshot.defaultTravelMode,
          calendarHours: snapshot.calendarHours,
        };
      })
      .toEqual({
        language: "fr",
        distanceUnit: "imperial",
        defaultTravelMode: "WALKING",
        calendarHours: 30,
      });
    await page.reload();
    await page.getByRole("button", { name: "Paramètres du voyage" }).click();
    await expect(
      page.getByRole("dialog", { name: "Paramètres du voyage" }).getByLabel("Langue"),
    ).toHaveValue("fr");
    await expect(
      page.getByRole("dialog", { name: "Paramètres du voyage" }).getByLabel("Unités de distance"),
    ).toHaveValue("imperial");
    await expect(
      page.getByRole("dialog", { name: "Paramètres du voyage" }).getByLabel("Transport par défaut"),
    ).toHaveValue("WALKING");
    await expect(
      page.getByRole("dialog", { name: "Paramètres du voyage" }).getByLabel("Heures du calendrier"),
    ).toHaveValue("30");
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("route mode is selected from an inline dropdown", async ({ page }) => {
  const id = await createEmptyTrip([
    itemForCreate("place", "2027-04-10", {
      title: "Museum",
      place: { placeId: "route-mode-museum" },
    }),
    itemForCreate("place", "2027-04-10", {
      title: "Cafe",
      place: { placeId: "route-mode-cafe" },
    }),
  ]);
  try {
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Route layout editor"),
    );
    await page.goto(`/trips/${id}`);
    const leg = page.locator(".transport-leg").first();
    await expect(leg).toBeVisible();
    const routeMode = leg.getByLabel("Travel mode");
    await expect(routeMode).toHaveValue("DRIVING");
    await expect(routeMode.locator("option")).toHaveText(["Car", "Public transport", "Walk"]);
    const initialHeight = await leg.evaluate((element) => element.getBoundingClientRect().height);
    await routeMode.selectOption("TRANSIT");
    await expect(routeMode).toHaveValue("TRANSIT");
    await expect(routeMode.locator("option:checked")).toHaveText("Public transport");
    await expect(leg.locator(".leg-options")).toHaveCount(0);
    const selectedHeight = await leg.evaluate((element) => element.getBoundingClientRect().height);
    expect(Math.abs(initialHeight - selectedHeight)).toBeLessThan(1);
    await expect
      .poll(() =>
        leg.evaluate((element) => {
          const rail = element.querySelector(".leg-rail");
          if (!rail) return false;
          const legBox = element.getBoundingClientRect();
          const railBox = rail.getBoundingClientRect();
          return (
            Math.abs(railBox.top - legBox.top) <= 1 && Math.abs(railBox.bottom - legBox.bottom) <= 1
          );
        }),
      )
      .toBe(true);
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("per-day add controls target their day and date navigation follows the viewport", async ({
  page,
}) => {
  const id = await createEmptyTrip();
  try {
    const [stored] = await db.select().from(documents).where(eq(documents.name, id));
    if (!stored) throw new Error("Missing test document");
    const doc = new Y.Doc();
    Y.applyUpdate(doc, stored.data);
    for (const day of ["2027-04-10", "2027-04-11"]) {
      for (let index = 0; index < 18; index += 1) addTripItem(doc, itemForCreate("note", day));
    }
    await db
      .update(documents)
      .set({ data: Buffer.from(Y.encodeStateAsUpdate(doc)) })
      .where(eq(documents.name, id));
    doc.destroy();
    await page.addInitScript(() => localStorage.setItem("pacenotes-display-name", "Scroll editor"));
    await page.goto(`/trips/${id}`);
    const panel = page.locator(".planner-panel");
    const days = page.locator(".day-section");
    const dates = page.locator(".date-tabs [data-day-tab]");
    await expect(page.locator(".planner-toolbar")).toHaveCount(0);
    await expect(
      page.locator(".day-heading").getByRole("button", { name: /^Delete day / }),
    ).toHaveCount(3);
    await expect(days.getByRole("button", { name: "Place", exact: true })).toHaveCount(3);
    await addDayItem(page, "note", 1);
    await expect(days.nth(0).locator(".itinerary-entry")).toHaveCount(18);
    await expect(days.nth(1).locator(".itinerary-entry")).toHaveCount(19);
    await addDayItem(page, "place", 1);
    await expect(days.nth(1).locator(".place-search")).toBeVisible({ timeout: 2000 });
    await expect(days.nth(0).locator(".place-search")).toHaveCount(0);
    await addDayItem(page, "place", 0);
    await expect(days.nth(1).locator(".place-search")).toHaveCount(0);
    await expect(days.nth(0).locator(".place-search")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".place-search")).toHaveCount(0);
    await addDayItem(page, "place", 1);
    await days.nth(1).locator(".day-heading h2").click();
    await expect(page.locator(".place-search")).toHaveCount(0);
    await page.locator(".day-section").first().locator(".entry-select").first().click();
    await page.locator(".item-editor textarea").fill("Keep this draft");
    await panel.evaluate((element) => {
      const next = element.querySelectorAll(".day-section")[1];
      if (!next) throw new Error("Missing day");
      element.scrollTop +=
        next.getBoundingClientRect().top - element.getBoundingClientRect().top - 8;
    });
    await expect(dates.nth(1)).toHaveAttribute("aria-current", "date");
    await expect(page.locator(".item-editor textarea")).toHaveValue("Keep this draft");
    await page.getByRole("button", { name: "Close editor", exact: true }).click();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await panel.evaluate((element) => {
      const samples: number[] = [];
      const times: number[] = [];
      element.addEventListener("scroll", () => {
        samples.push(element.scrollTop);
        times.push(performance.now());
        element.setAttribute("data-scroll-times", JSON.stringify(times));
        element.setAttribute("data-scroll-samples", JSON.stringify(samples));
      });
      element.addEventListener("scrollend", () => {
        element.setAttribute("data-scroll-ended", String(performance.now()));
      });
    });
    const start = await panel.evaluate((element) => element.scrollTop);
    await dates.nth(2).click();
    await expect(panel).toHaveAttribute("data-scroll-ended", /\d/);
    await expect(panel).toHaveAttribute("aria-busy", "false");
    await expect(dates.nth(2)).toHaveAttribute("aria-current", "date");
    const end = await panel.evaluate((element) => element.scrollTop);
    const samples: number[] = JSON.parse((await panel.getAttribute("data-scroll-samples")) ?? "[]");
    const times: number[] = JSON.parse((await panel.getAttribute("data-scroll-times")) ?? "[]");
    expect((times.at(-1) ?? 0) - (times[0] ?? 0)).toBeLessThan(300);
    expect(
      new Set(
        samples.filter(
          (value) => value > Math.min(start, end) + 2 && value < Math.max(start, end) - 2,
        ),
      ).size,
    ).toBeGreaterThanOrEqual(3);
    const trajectory = [start, ...samples, end];
    const steps = trajectory
      .slice(1)
      .map((value, index) => Math.abs(value - (trajectory[index] ?? value)))
      .filter((value) => value >= 1);
    expect(Math.max(...steps) / Math.min(...steps)).toBeGreaterThan(1.5);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const priorSamples = JSON.parse(
      (await panel.getAttribute("data-scroll-samples")) ?? "[]",
    ).length;
    await dates.nth(0).click();
    await expect(panel).toHaveAttribute("aria-busy", "false");
    await expect(dates.nth(0)).toHaveAttribute("aria-current", "date");
    const reducedSamples: number[] = JSON.parse(
      (await panel.getAttribute("data-scroll-samples")) ?? "[]",
    );
    expect(new Set(reducedSamples.slice(priorSamples)).size).toBeLessThanOrEqual(1);
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});
