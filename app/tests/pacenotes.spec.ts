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
import {
  createInitialSnapshot,
  itemForCreate,
  lodgingForDates,
  type TripItem,
} from "../src/features/trip/model";

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
    const mockPlaceLocations = new Map([
      ["placement-portland", { latitude: 1, longitude: 0 }],
      ["placement-ellsworth", { latitude: 2, longitude: 0 }],
      ["cafe-anchor", { latitude: 35, longitude: 139 }],
      ["cafe", { latitude: 35.001, longitude: 139 }],
      ["museum-anchor", { latitude: 36, longitude: 140 }],
      ["museum", { latitude: 36.001, longitude: 140 }],
      ["no-detail-start", { latitude: 37, longitude: 141 }],
      ["no-detail-end", { latitude: 37.1, longitude: 141.1 }],
    ]);
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
        const location = mockPlaceLocations.get(id) ?? { latitude: 35.6762, longitude: 0 };
        this.location = { lat: () => location.latitude, lng: () => location.longitude };
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
    type MockMapEvent = { placeId: string; stop: () => void };
    type MockCenter = { lat: number; lng: number };
    class MockMap {
      listeners = new Map<string, (event?: MockMapEvent) => void>();
      center: MockCenter;
      zoom: number;
      constructor(host: HTMLElement, options: { center?: MockCenter; zoom?: number } = {}) {
        const scope = globalThis as typeof globalThis & {
          __pacenotesMap?: MockMap;
          __pacenotesMapConstructions?: number;
        };
        this.center = options.center ?? { lat: 0, lng: 0 };
        this.zoom = options.zoom ?? 12;
        scope.__pacenotesMap = this;
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
      addListener(name: string, listener: (event?: MockMapEvent) => void) {
        this.listeners.set(name, listener);
        return { remove: () => this.listeners.delete(name) };
      }
      fitBounds(bounds: { points: MockCenter[] }): void {
        const scope = globalThis as typeof globalThis & {
          __pacenotesMapFitBoundsCalls?: number;
          __pacenotesMapFitBoundsPoints?: MockCenter[];
        };
        scope.__pacenotesMapFitBoundsCalls = (scope.__pacenotesMapFitBoundsCalls ?? 0) + 1;
        scope.__pacenotesMapFitBoundsPoints = bounds.points.map((point) => ({ ...point }));
      }
      panTo(center: MockCenter): void {
        this.center = center;
        const scope = globalThis as typeof globalThis & {
          __pacenotesMapPanCalls?: number;
        };
        scope.__pacenotesMapPanCalls = (scope.__pacenotesMapPanCalls ?? 0) + 1;
      }
      setCenter(center: MockCenter): void {
        this.center = center;
      }
      getCenter() {
        return { lat: () => this.center.lat, lng: () => this.center.lng };
      }
      getZoom() {
        return this.zoom;
      }
      setZoom(zoom: number): void {
        this.zoom = zoom;
      }
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
      dashed: boolean;
      constructor(options: { strokeOpacity?: number; icons?: unknown[]; path?: unknown[] }) {
        this.kind = options.strokeOpacity === 0 ? "transport" : "route";
        this.dashed = (options.icons?.length ?? 0) > 0;
        const scope = globalThis as typeof globalThis & {
          __pacenotesRoutePolylines?: number;
          __pacenotesRoutePolylineConstructions?: number;
          __pacenotesTransportPolylines?: number;
          __pacenotesDashedTransportPolylines?: number;
          __pacenotesPolylineOptions?: Array<{
            dashPath: unknown;
            path: unknown[];
            strokeOpacity: number | undefined;
          }>;
        };
        const key =
          this.kind === "route" ? "__pacenotesRoutePolylines" : "__pacenotesTransportPolylines";
        scope[key] = (scope[key] ?? 0) + 1;
        if (this.kind === "transport" && this.dashed) {
          scope.__pacenotesDashedTransportPolylines =
            (scope.__pacenotesDashedTransportPolylines ?? 0) + 1;
        }
        const firstIcon = options.icons?.[0] as { icon?: { path?: unknown } } | undefined;
        scope.__pacenotesPolylineOptions?.push({
          dashPath: firstIcon?.icon?.path,
          path: options.path ?? [],
          strokeOpacity: options.strokeOpacity,
        });
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
          __pacenotesDashedTransportPolylines?: number;
        };
        const key =
          this.kind === "route" ? "__pacenotesRoutePolylines" : "__pacenotesTransportPolylines";
        scope[key] = Math.max(0, (scope[key] ?? 0) - 1);
        if (this.kind === "transport" && this.dashed) {
          scope.__pacenotesDashedTransportPolylines = Math.max(
            0,
            (scope.__pacenotesDashedTransportPolylines ?? 0) - 1,
          );
        }
      }
    }
    class MockLatLngBounds {
      points: MockCenter[] = [];
      extend(point: MockCenter): void {
        this.points.push(point);
      }
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
    type MockRouteLocation = {
      id?: string;
      lat?: number;
      lng?: number;
      location?: { lat: () => number; lng: () => number };
    };
    const routeCoordinates = (location: MockRouteLocation) => {
      if (location.location) {
        return { lat: location.location.lat(), lng: location.location.lng() };
      }
      if (location.lat === undefined || location.lng === undefined) {
        throw new Error("Route location has no coordinates");
      }
      return { lat: location.lat, lng: location.lng };
    };
    const routeDurationMillis = (origin: MockRouteLocation, destination: MockRouteLocation) => {
      const originCoordinates = routeCoordinates(origin);
      const destinationCoordinates = routeCoordinates(destination);
      const routeMinutes: Record<string, number> = {
        "3:1": 100,
        "1:3": 105,
        "3:2": 60,
        "1:2": 145,
      };
      return (
        (routeMinutes[`${originCoordinates.lat}:${destinationCoordinates.lat}`] ?? 10) * 60_000
      );
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
        origin: MockRouteLocation;
        destination: MockRouteLocation;
        language?: string;
        departureTime?: Date;
        travelMode: string;
        routingPreference?: string;
      }) {
        const routeScope = globalThis as typeof globalThis & {
          __pacenotesRouteComputes?: number;
          __pacenotesRouteDepartureTimes?: Array<string | null>;
          __pacenotesRouteEndpoints?: Array<{
            originPlaceId: string | null;
            destinationPlaceId: string | null;
            travelMode: string;
          }>;
        };
        routeScope.__pacenotesRouteComputes = (routeScope.__pacenotesRouteComputes ?? 0) + 1;
        routeScope.__pacenotesRouteDepartureTimes?.push(departureTime?.toISOString() ?? null);
        routeScope.__pacenotesRouteEndpoints?.push({
          originPlaceId: origin.id ?? null,
          destinationPlaceId: destination.id ?? null,
          travelMode,
        });
        if (departureTime && travelMode === "DRIVING" && routingPreference !== "TRAFFIC_AWARE") {
          throw new Error("Scheduled driving routes require traffic-aware routing");
        }
        (
          routeScope as typeof routeScope & {
            __pacenotesRouteLanguages?: string[];
          }
        ).__pacenotesRouteLanguages?.push(language ?? "");
        if (travelMode === "TRANSIT") return { routes: [] };
        return {
          routes: [
            {
              path:
                destination.id === "no-detail-end"
                  ? [
                      {
                        toJSON: () => ({ lat: origin.location.lat(), lng: origin.location.lng() }),
                      },
                      { toJSON: () => ({ lat: 37.05, lng: 141.08 }) },
                      {
                        toJSON: () => ({
                          lat: destination.location.lat(),
                          lng: destination.location.lng(),
                        }),
                      },
                    ]
                  : [{ toJSON: () => ({ lat: 35.6762, lng: 139.6503 }) }],
              durationMillis: routeDurationMillis(origin, destination),
              distanceMeters: destination.id === "no-detail-end" ? null : 1_000,
            },
          ],
        };
      },
    };
    class MockDirectionsService {
      async route({
        origin,
        destination,
        travelMode,
        transitOptions,
      }: {
        origin: { placeId?: string; lat?: number; lng?: number };
        destination: { placeId?: string; lat?: number; lng?: number };
        travelMode: string;
        transitOptions?: { departureTime?: Date };
      }) {
        const routeScope = globalThis as typeof globalThis & {
          __pacenotesDirectionsComputes?: number;
        };
        routeScope.__pacenotesDirectionsComputes =
          (routeScope.__pacenotesDirectionsComputes ?? 0) + 1;
        if (travelMode !== "TRANSIT") throw new Error("Directions fallback is transit-only");
        if (origin.placeId !== "route-mode-museum" || destination.placeId !== "route-mode-cafe") {
          throw new Error("Directions fallback requires Place ID endpoints");
        }
        if (transitOptions) throw new Error("Unscheduled transit must omit provider time");
        return {
          routes: [
            {
              overview_path: [
                {
                  lat: () => 35.6762,
                  lng: () => 139.6503,
                },
              ],
              legs: [
                {
                  duration: { value: 25 * 60 },
                  distance: { value: 1_000 },
                },
              ],
            },
          ],
        };
      }
    }
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
      __pacenotesDirectionsComputes?: number;
      __pacenotesRouteDepartureTimes?: Array<string | null>;
      __pacenotesRouteEndpoints?: Array<{
        originPlaceId: string | null;
        destinationPlaceId: string | null;
        travelMode: string;
      }>;
      __pacenotesRoutePolylines?: number;
      __pacenotesRoutePolylineConstructions?: number;
      __pacenotesTransportPolylines?: number;
      __pacenotesDashedTransportPolylines?: number;
      __pacenotesPolylineOptions?: Array<{
        dashPath: unknown;
        path: unknown[];
        strokeOpacity: number | undefined;
      }>;
      __pacenotesAutocompleteLanguages?: string[];
      __pacenotesPlaceLanguages?: string[];
      __pacenotesRouteLanguages?: string[];
    };
    scope.__pacenotesMapConstructions = 0;
    scope.__pacenotesRouteComputes = 0;
    scope.__pacenotesRouteDepartureTimes = [];
    scope.__pacenotesRouteEndpoints = [];
    scope.__pacenotesDirectionsComputes = 0;
    scope.__pacenotesRoutePolylines = 0;
    scope.__pacenotesMarkerConstructions = 0;
    scope.__pacenotesTransportPolylines = 0;
    scope.__pacenotesPolylineOptions = [];
    scope.__pacenotesDashedTransportPolylines = 0;
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
              DirectionsService: MockDirectionsService,
              RouteMatrix: MockRouteMatrix,
              RoutingPreference: { TRAFFIC_AWARE: "TRAFFIC_AWARE" },
              TravelMode: { TRANSIT: "TRANSIT" },
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

  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).display).toBe("standalone");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("landing removes deleted trips from recent trips", async ({ page }) => {
  const validId = await createEmptyTrip();
  const deletedId = "deleted-recent-trip-1234";
  try {
    await page.addInitScript(
      ({ validId, deletedId }) => {
        localStorage.setItem(
          "pacenotes-recent-trips",
          JSON.stringify([
            {
              id: deletedId,
              title: "Deleted trip",
              href: `${location.origin}/trips/${deletedId}`,
              openedAt: "2027-04-12T00:00:00.000Z",
            },
            {
              id: validId,
              title: "Valid trip",
              href: `${location.origin}/trips/${validId}`,
              openedAt: "2027-04-11T00:00:00.000Z",
            },
          ]),
        );
      },
      { validId, deletedId },
    );
    await page.goto("/");

    await expect(page.getByRole("link", { name: /Valid trip/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Deleted trip/ })).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.parse(localStorage.getItem("pacenotes-recent-trips") ?? "[]").map(
            (trip: { href: string }) => ({
              ...trip,
              href: new URL(trip.href, location.origin).pathname,
            }),
          ),
        ),
      )
      .toEqual([
        {
          id: validId,
          title: "Valid trip",
          href: `/trips/${validId}`,
          openedAt: "2027-04-11T00:00:00.000Z",
        },
      ]);
  } finally {
    await db.delete(trips).where(eq(trips.id, validId));
  }
});

test("mobile landing omits the route preview and fills the viewport", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile layout coverage runs once");
  await page.goto("/");
  await expect(
    page.getByRole("img", { name: "Sample route with three planned stops" }),
  ).toHaveCount(0);
  const heroBox = await page.locator(".hero").boundingBox();
  if (!heroBox) throw new Error("Missing mobile hero geometry");
  expect(heroBox.x).toBeCloseTo(0, 0);
  expect(heroBox.width).toBeCloseTo(page.viewportSize()?.width ?? 0, 0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
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

test("map marker numbers restart for each day after an earlier-day addition", async ({ page }) => {
  const id = await createEmptyTrip(
    [
      itemForCreate("place", "2027-04-11", {
        id: "map-number-later",
        title: "Later day place",
        place: { placeId: "museum" },
      }),
      itemForCreate("place", "2027-04-10", {
        id: "map-number-first",
        title: "First day place",
        place: { placeId: "cafe-anchor" },
      }),
    ],
    "2027-04-11",
  );
  try {
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Map number editor"),
    );
    await page.goto(`/trips/${id}`);

    await expect(page.getByRole("button", { name: "Stop 1: First day place" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop 1: Later day place" })).toBeVisible();
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});
test("top header search opens place search without changing content views", async ({ page }) => {
  const id = await createEmptyTrip();
  try {
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Toolbar search editor"),
    );
    await page.goto(`/trips/${id}#2027-04-10`);

    const topHeader = page.locator(".planner-tabs");
    const viewTabs = topHeader.getByRole("group", { name: "Planner view" });
    const search = topHeader.getByRole("button", { name: "Search Google Places" });
    await expect(search).toBeVisible();
    await expect(
      page
        .locator(".planner-content-toolbar")
        .getByRole("button", { name: "Search Google Places" }),
    ).toHaveCount(0);
    await expect(search).toHaveText("");
    await expect(search.locator("svg")).toHaveCSS("width", "24px");
    const tabsBox = await viewTabs.boundingBox();
    const searchBox = await search.boundingBox();
    if (!tabsBox || !searchBox) throw new Error("Missing toolbar geometry");
    expect(searchBox.x).toBeGreaterThanOrEqual(tabsBox.x + tabsBox.width);

    await search.click();
    const stickyTools = page.locator(".planner-sticky-tools");
    await expect(stickyTools).toHaveCSS("position", "sticky");
    await expect(stickyTools.locator(".place-search")).toBeVisible();
    await expect(page.locator("[data-day-id] .place-search")).toHaveCount(0);
    await expect(page.locator("gmp-place-autocomplete")).toHaveAttribute(
      "aria-label",
      "Search Google Places",
    );
    await expect(
      page
        .locator(".planner-content-toolbar")
        .getByRole("button", { name: "Itinerary", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("map place additions choose the nearest day and open the editor", async ({ page }) => {
  const cafeAnchor = itemForCreate("place", "2027-04-10", {
    id: "map-cafe-anchor",
    title: "Cafe anchor",
    place: { placeId: "cafe-anchor" },
  });
  const museumAnchor = itemForCreate("place", "2027-04-11", {
    id: "map-museum-anchor",
    title: "Museum anchor",
    place: { placeId: "museum-anchor" },
  });
  const id = await createEmptyTrip([cafeAnchor, museumAnchor]);
  const readAddedPlace = async (placeId: string) => {
    const [stored] = await db.select().from(documents).where(eq(documents.name, id));
    if (!stored) return null;
    const saved = new Y.Doc();
    Y.applyUpdate(saved, stored.data);
    const added = Object.values(readTripDocument(saved).items).find(
      (item) => item.place?.placeId === placeId,
    );
    saved.destroy();
    return added ? { id: added.id, dayId: added.dayId, travelMode: added.travelMode } : null;
  };
  try {
    await page.addInitScript(() => localStorage.setItem("pacenotes-display-name", "Map editor"));
    await page.goto(`/trips/${id}`);
    const map = await page.locator(".map-canvas > div").elementHandle();
    const details = page.getByRole("dialog", { name: "Place details", exact: true });

    await page.getByRole("button", { name: "Map location: Museum", exact: true }).click();
    await expect(details.getByRole("heading", { name: "City Museum" })).toBeVisible();
    await expect(page.locator(".item-editor")).toHaveCount(0);
    await details.getByRole("button", { name: "Add to trip" }).click();

    await expect
      .poll(async () => {
        const added = await readAddedPlace("museum");
        return added ? { dayId: added.dayId, travelMode: added.travelMode } : null;
      })
      .toEqual({ dayId: "2027-04-11", travelMode: "WALKING" });
    await expect(page.locator(".date-tabs [data-day-tab]").nth(1)).toHaveAttribute(
      "aria-current",
      "date",
    );
    const museumDay = page.locator('[data-day-id="2027-04-11"]');
    const listEditor = museumDay.locator(".item-editor");
    await expect(listEditor).toBeVisible();
    const museumTravelMode = museumDay.locator(".transport-leg").last().getByLabel("Travel mode");
    await expect(museumTravelMode).toHaveValue("WALKING");
    await museumTravelMode.selectOption("DRIVING");
    await expect.poll(async () => (await readAddedPlace("museum"))?.travelMode).toBe("DRIVING");
    const addedEntry = listEditor.locator("xpath=preceding-sibling::*[1]");
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
    await listEditor.getByRole("button", { name: "Close editor" }).click();

    await page.getByRole("button", { name: "Calendar", exact: true }).click();
    const calendar = page.getByRole("region", { name: "Trip calendar" });
    await expect(calendar).toBeVisible();
    await page.getByRole("button", { name: "Map location: Cafe", exact: true }).click();
    await expect(details.getByRole("heading", { name: "Corner Cafe" })).toBeVisible();
    await details.getByRole("button", { name: "Add to trip" }).click();

    let cafeId = "";
    await expect
      .poll(async () => {
        const added = await readAddedPlace("cafe");
        cafeId = added?.id ?? "";
        return added ? { dayId: added.dayId, travelMode: added.travelMode } : null;
      })
      .toEqual({ dayId: "2027-04-10", travelMode: "WALKING" });
    await expect(page.locator(".date-tabs [data-day-tab]").first()).toHaveAttribute(
      "aria-current",
      "date",
    );
    await expect(page).toHaveURL(/#2027-04-10$/);
    await expect(calendar.locator(`[data-calendar-item-id="${cafeId}"]`).first()).toHaveAttribute(
      "data-calendar-selected",
      "true",
    );
    await expect(calendar.locator(".item-editor")).toBeVisible();
    await expect.poll(async () => (await readAddedPlace("museum"))?.travelMode).toBe("DRIVING");
    await expect(
      calendar.locator(".item-editor").getByRole("button", { name: "Close editor" }),
    ).toBeVisible();
    expect(await map?.evaluate((element) => element.isConnected)).toBe(true);
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("route updates do not replay an old day map focus", async ({ page }) => {
  const first = itemForCreate("place", "2027-04-10", {
    id: "focus-first",
    title: "Cafe anchor",
    place: { placeId: "cafe-anchor" },
  });
  const second = itemForCreate("place", "2027-04-11", {
    id: "focus-second",
    title: "Museum anchor",
    place: { placeId: "museum-anchor" },
  });
  const id = await createEmptyTrip([first, second]);
  const fitBoundsCalls = () =>
    page.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            __pacenotesMapFitBoundsCalls?: number;
          }
        ).__pacenotesMapFitBoundsCalls ?? 0,
    );
  try {
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Map focus regression"),
    );
    await page.goto(`/trips/${id}`);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                __pacenotesRoutePolylines?: number;
              }
            ).__pacenotesRoutePolylines ?? 0,
        ),
      )
      .toBeGreaterThan(0);
    await page.locator(".day-map-focus").nth(1).click();
    await expect.poll(fitBoundsCalls).toBeGreaterThan(0);
    await page.waitForTimeout(700);
    const callsAfterFocus = await fitBoundsCalls();

    await page.getByRole("button", { name: "Map location: Cafe", exact: true }).click();
    const details = page.getByRole("dialog", { name: "Place details", exact: true });
    await details.getByRole("button", { name: "Add to trip" }).click();
    await expect(details.getByRole("button", { name: "Remove from day 1" })).toBeVisible();
    await page.waitForTimeout(700);

    expect(await fitBoundsCalls()).toBe(callsAfterFocus);
  } finally {
    if (!page.isClosed()) await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("a new close place changes its outgoing lodging route to walking", async ({ page }) => {
  const lodging = itemForCreate("lodging", "2027-04-10", {
    id: "nearby-lodging",
    title: "Nearby lodging",
    place: { placeId: "museum-anchor" },
    lodging: {
      startDate: "2027-04-10",
      endDate: "2027-04-11",
      confirmation: "",
      leaveTimes: { "2027-04-11": "08:00" },
    },
  });
  const id = await createEmptyTrip([lodging], "2027-04-11");
  const lodgingTravelMode = async () => {
    const [stored] = await db.select().from(documents).where(eq(documents.name, id));
    if (!stored) return null;
    const saved = new Y.Doc();
    Y.applyUpdate(saved, stored.data);
    const travelMode = readTripDocument(saved).items[lodging.id]?.travelMode ?? null;
    saved.destroy();
    return travelMode;
  };
  try {
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Walking route regression"),
    );
    await page.goto(`/trips/${id}`);
    await page.getByRole("button", { name: "Map location: Museum", exact: true }).click();
    const details = page.getByRole("dialog", { name: "Place details", exact: true });
    await details.getByRole("button", { name: "Add to trip" }).click();

    await expect.poll(lodgingTravelMode).toBe("WALKING");
    await expect(
      page
        .locator('[data-day-id="2027-04-10"]')
        .locator(".transport-leg")
        .last()
        .getByLabel("Travel mode"),
    ).toHaveValue("WALKING");
  } finally {
    if (!page.isClosed()) await page.goto("/");
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
    const secondMarker = page.getByRole("button", { name: "Stop 1: Second day place" });
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

test("calendar drop below a flexible item preserves item order", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Calendar drag coverage runs once");
  const dayId = "2027-04-10";
  const moved = itemForCreate("place", dayId, {
    id: "calendar-order-moved",
    title: "Moved stop",
    startTime: null,
    durationMinutes: 60,
  });
  const acadia = itemForCreate("place", dayId, {
    id: "calendar-order-acadia",
    title: "Acadia National Park",
    startTime: null,
    durationMinutes: 60,
  });
  const id = await createEmptyTrip([moved, acadia], "2027-04-11");
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Calendar order editor"),
    );
    await page.goto(`/trips/${id}?view=calendar#${dayId}`);
    const calendar = page.getByRole("region", { name: "Trip calendar" });
    const movedBlock = calendar.locator('[data-calendar-item-id="calendar-order-moved"]').first();
    const acadiaBlock = calendar.locator('[data-calendar-item-id="calendar-order-acadia"]').first();
    await expect(movedBlock.locator("time")).toContainText("Flexible");
    await expect(acadiaBlock.locator("time")).toContainText("Flexible");
    const [movedBox, acadiaBox, trackBox] = await Promise.all([
      movedBlock.boundingBox(),
      acadiaBlock.boundingBox(),
      calendar.locator(`[data-calendar-track="${dayId}"]`).boundingBox(),
    ]);
    if (!movedBox || !acadiaBox || !trackBox) {
      throw new Error("Missing flexible order drag geometry");
    }
    const x = movedBox.x + movedBox.width / 2;
    const y = movedBox.y + movedBox.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 8, y, { steps: 2 });
    await expect(calendar.locator("[data-calendar-drag-proxy]")).toBeVisible();
    await page.mouse.move(x, acadiaBox.y + acadiaBox.height + trackBox.height / 48, {
      steps: 4,
    });
    await page.mouse.up();
    await expect(movedBlock.locator("time")).not.toContainText("Flexible");
    await expect
      .poll(async () => {
        const [stored] = await db.select().from(documents).where(eq(documents.name, id));
        if (!stored) return [];
        const saved = new Y.Doc();
        Y.applyUpdate(saved, stored.data);
        const snapshot = readTripDocument(saved);
        saved.destroy();
        return snapshot.order.filter((itemId) => snapshot.items[itemId]?.dayId === dayId);
      })
      .toEqual(["calendar-order-acadia", "calendar-order-moved"]);
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("calendar drag follows scrolling and rejects outside drops", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Calendar drag coverage runs once");
  const dayId = "2027-04-10";
  const flexible = itemForCreate("place", dayId, {
    id: "calendar-flexible-drag",
    title: "Flexible stop",
    startTime: null,
    durationMinutes: 600,
  });
  const id = await createEmptyTrip([flexible], "2027-04-11");
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Calendar drag editor"),
    );
    await page.goto(`/trips/${id}?view=calendar#${dayId}`);
    const calendar = page.getByRole("region", { name: "Trip calendar" });
    const block = calendar.locator('[data-calendar-item-id="calendar-flexible-drag"]').first();
    const time = block.locator("time");
    await expect(time).toHaveText("Flexible · 08:00 - 18:00");
    const scroller = calendar.locator(":scope > div").first();
    await block.scrollIntoViewIfNeeded();

    const blockBox = await block.boundingBox();
    const initialScrollerBox = await scroller.boundingBox();
    if (!blockBox || !initialScrollerBox) throw new Error("Missing flexible block geometry");
    await page.mouse.click(
      blockBox.x + blockBox.width / 2,
      Math.min(
        blockBox.y + blockBox.height * 0.8,
        initialScrollerBox.y + initialScrollerBox.height - 20,
      ),
    );
    const editor = calendar.locator(".item-editor");
    await expect(editor).toBeVisible();
    await editor.getByRole("button", { name: "Close editor" }).click();

    const dragBox = await block.boundingBox();
    const scrollerBox = await scroller.boundingBox();
    const trackBox = await calendar.locator(`[data-calendar-track="${dayId}"]`).boundingBox();
    if (!dragBox || !scrollerBox || !trackBox) {
      throw new Error("Missing calendar drag geometry");
    }
    const dragX = dragBox.x + dragBox.width / 2;
    const dragY = dragBox.y + dragBox.height * 0.8;
    await page.mouse.move(dragX, dragY);
    await page.mouse.down();
    await page.mouse.move(dragX + 8, dragY, { steps: 2 });
    const proxy = calendar.locator("[data-calendar-drag-proxy]");
    const dropPreview = calendar.locator("[data-calendar-drop-preview]").first();
    await expect(proxy).toBeVisible();
    await expect(dropPreview).toBeVisible();
    const initialProxyBox = await proxy.boundingBox();
    const initialPreviewBox = await dropPreview.boundingBox();
    if (!initialProxyBox || !initialPreviewBox) {
      throw new Error("Missing initial calendar preview geometry");
    }
    const initialDifference = initialProxyBox.y - initialPreviewBox.y;
    await scroller.evaluate((element, distance) => {
      element.scrollTop += distance;
    }, trackBox.height / 24);
    await expect
      .poll(async () => {
        const proxyBox = await proxy.boundingBox();
        const previewBox = await dropPreview.boundingBox();
        if (!proxyBox || !previewBox) throw new Error("Missing calendar preview geometry");
        return Math.abs(proxyBox.y - previewBox.y - initialDifference);
      })
      .toBeLessThan(2);

    await page.mouse.move(
      scrollerBox.x + scrollerBox.width + 20,
      scrollerBox.y + scrollerBox.height / 2,
    );
    await page.mouse.up();
    await expect(proxy).toBeHidden();
    await expect(time).toHaveText("Flexible · 08:00 - 18:00");

    await block.scrollIntoViewIfNeeded();
    const restoredBox = await block.boundingBox();
    if (!restoredBox) throw new Error("Missing restored block geometry");
    await page.mouse.click(
      restoredBox.x + restoredBox.width / 2,
      restoredBox.y + restoredBox.height * 0.8,
    );
    await expect(editor).toBeVisible();
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("day changes and reload keep the current map viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Map viewport coverage runs once");
  const firstDay = "2027-04-10";
  const secondDay = "2027-04-11";
  const first = itemForCreate("place", firstDay, {
    id: "viewport-first",
    title: "Viewport first",
    place: { placeId: "museum" },
    startTime: "09:00",
  });
  const second = itemForCreate("place", firstDay, {
    id: "viewport-second",
    title: "Viewport second",
    place: { placeId: "cafe" },
    startTime: "10:00",
  });
  const third = itemForCreate("place", secondDay, {
    id: "viewport-third",
    title: "Viewport third",
    place: { placeId: "museum-anchor" },
    startTime: "09:00",
  });
  const id = await createEmptyTrip([first, second, third], secondDay);
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Map viewport editor"),
    );
    await page.goto(`/trips/${id}?view=calendar#${firstDay}`);
    const fitBoundsCalls = () =>
      page.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              __pacenotesMapFitBoundsCalls?: number;
            }
          ).__pacenotesMapFitBoundsCalls ?? 0,
      );
    await expect.poll(fitBoundsCalls).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    const initialFitBoundsCalls = await fitBoundsCalls();

    await page.locator(".date-tabs [data-day-tab]").nth(1).click();
    await page.waitForTimeout(100);
    expect(await fitBoundsCalls()).toBe(initialFitBoundsCalls);

    const block = page
      .getByRole("region", { name: "Trip calendar" })
      .locator('[data-calendar-item-id="viewport-first"]')
      .first();
    const panCalls = () =>
      page.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              __pacenotesMapPanCalls?: number;
            }
          ).__pacenotesMapPanCalls ?? 0,
      );
    await block.click();
    await expect.poll(panCalls).toBeGreaterThan(0);
    await page
      .locator(".item-editor")
      .getByRole("button", { name: "Close editor", exact: true })
      .click();
    await block.click({ button: "right" });
    expect(await fitBoundsCalls()).toBe(initialFitBoundsCalls);
    await page
      .getByRole("menu", { name: "Calendar actions for Viewport first" })
      .getByRole("menuitem", { name: "Next day", exact: true })
      .click();
    await expect
      .poll(async () => {
        const [stored] = await db.select().from(documents).where(eq(documents.name, id));
        if (!stored) return null;
        const saved = new Y.Doc();
        Y.applyUpdate(saved, stored.data);
        const dayId = readTripDocument(saved).items[first.id]?.dayId ?? null;
        saved.destroy();
        return dayId;
      })
      .toBe(secondDay);
    await page.waitForTimeout(500);
    expect(await fitBoundsCalls()).toBe(initialFitBoundsCalls);
    await page.evaluate(() => {
      const map = (
        globalThis as typeof globalThis & {
          __pacenotesMap?: {
            listeners: Map<string, () => void>;
            setCenter: (center: { lat: number; lng: number }) => void;
            setZoom: (zoom: number) => void;
          };
        }
      ).__pacenotesMap;
      if (!map) throw new Error("Map is not ready");
      map.setCenter({ lat: 44.123, lng: -71.456 });
      map.setZoom(9);
      map.listeners.get("idle")?.();
    });
    await page.reload();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const map = (
            globalThis as typeof globalThis & {
              __pacenotesMap?: {
                getCenter: () => { lat: () => number; lng: () => number };
                getZoom: () => number;
              };
            }
          ).__pacenotesMap;
          const center = map?.getCenter();
          return map && center
            ? { latitude: center.lat(), longitude: center.lng(), zoom: map.getZoom() }
            : null;
        }),
      )
      .toEqual({ latitude: 44.123, longitude: -71.456, zoom: 9 });
    expect(await fitBoundsCalls()).toBe(0);
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("each day can focus its route on the map", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Map viewport coverage runs once");
  const id = await createEmptyTrip([
    itemForCreate("place", "2027-04-10", {
      title: "First cafe",
      place: { placeId: "cafe-anchor" },
      startTime: "09:00",
    }),
    itemForCreate("place", "2027-04-10", {
      title: "Second cafe",
      place: { placeId: "cafe" },
      startTime: "10:00",
    }),
    itemForCreate("place", "2027-04-11", {
      title: "First museum",
      place: { placeId: "museum-anchor" },
      startTime: "09:00",
    }),
    itemForCreate("place", "2027-04-11", {
      title: "Second museum",
      place: { placeId: "museum" },
      startTime: "10:00",
    }),
  ]);
  const fittedLongitudes = () =>
    page
      .evaluate(() => [
        ...new Set(
          (
            globalThis as typeof globalThis & {
              __pacenotesMapFitBoundsPoints?: { lat: number; lng: number }[];
            }
          ).__pacenotesMapFitBoundsPoints?.map((point) => point.lng) ?? [],
        ),
      ])
      .then((values) => values.sort((left, right) => left - right));
  try {
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Day route map editor"),
    );
    await page.goto(`/trips/${id}`);
    const focusButtons = page.locator(".day-map-focus");
    await expect(focusButtons).toHaveCount(3);
    await expect(focusButtons.nth(0)).toHaveAccessibleName("Show Saturday, April 10 route on map");
    await expect(focusButtons.nth(0).locator("svg")).toBeVisible();
    await expect(focusButtons.nth(1)).toHaveAccessibleName("Show Sunday, April 11 route on map");
    await expect(focusButtons.nth(2)).toBeDisabled();

    await page.getByRole("button", { name: "Map", exact: true }).click();
    await focusButtons.nth(0).click();
    await expect.poll(fittedLongitudes).toEqual([139]);
    await focusButtons.nth(1).click();
    await expect.poll(fittedLongitudes).toEqual([139, 140]);
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("calendar reload keeps a flexible item below lodging leave time", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Calendar reload coverage runs once");
  const firstDay = "2027-04-10";
  const secondDay = "2027-04-11";
  const lodging = itemForCreate("lodging", firstDay, {
    id: "reload-lodging",
    title: "Reload hotel",
    place: { placeId: "reload-hotel-place" },
    lodging: {
      startDate: firstDay,
      endDate: secondDay,
      leaveTimes: { [secondDay]: "09:00" },
    },
  });
  const flexible = itemForCreate("place", secondDay, {
    id: "reload-flexible",
    title: "Flexible destination",
    startTime: null,
    durationMinutes: 60,
  });
  const id = await createEmptyTrip([lodging, flexible], secondDay);
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Calendar reload editor"),
    );
    await page.goto(`/trips/${id}?view=calendar#${secondDay}`);
    const calendar = page.getByRole("region", { name: "Trip calendar" });
    const stay = calendar.locator('[data-calendar-stay-id="reload-lodging"]');
    const block = calendar.locator('[data-calendar-item-id="reload-flexible"]').first();
    const expectBelowLeaveTime = async () => {
      await expect(block.locator("time")).toContainText("Flexible");
      const [stayBox, blockBox] = await Promise.all([stay.boundingBox(), block.boundingBox()]);
      if (!stayBox || !blockBox) throw new Error("Missing reload placement geometry");
      expect(blockBox.y).toBeGreaterThanOrEqual(stayBox.y + stayBox.height - 1);
    };

    await expectBelowLeaveTime();
    await page.reload();
    await expectBelowLeaveTime();
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("calendar menu reorders items and shows the leave time", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Calendar menu coverage runs once");
  const dayId = "2027-04-10";
  const first = itemForCreate("place", dayId, {
    id: "calendar-order-first",
    title: "First stop",
    startTime: "09:00",
    durationMinutes: 60,
  });
  const second = itemForCreate("place", dayId, {
    id: "calendar-order-second",
    title: "Second stop",
    startTime: "11:00",
    durationMinutes: 60,
  });
  const lodging = itemForCreate("lodging", dayId, {
    id: "calendar-order-hotel",
    title: "Calendar hotel",
    place: { placeId: "calendar-order-hotel-place" },
    lodging: {
      startDate: dayId,
      endDate: "2027-04-11",
      leaveTimes: { "2027-04-11": "09:30" },
    },
  });
  const nextLodging = itemForCreate("lodging", "2027-04-11", {
    id: "calendar-order-next-hotel",
    title: "Next hotel",
    place: { placeId: "calendar-order-next-hotel-place" },
    lodging: {
      startDate: "2027-04-11",
      endDate: "2027-04-12",
      leaveTimes: { "2027-04-12": "09:00" },
    },
  });
  const followingLodging = itemForCreate("lodging", "2027-04-12", {
    id: "calendar-order-following-hotel",
    title: "Following hotel",
    place: { placeId: "calendar-order-following-hotel-place" },
    lodging: {
      startDate: "2027-04-12",
      endDate: "2027-04-13",
      leaveTimes: { "2027-04-13": "09:00" },
    },
  });
  const id = await createEmptyTrip(
    [first, second, nextLodging, followingLodging, lodging],
    "2027-04-14",
  );
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1.25,
      mobile: false,
    });
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Calendar menu editor"),
    );
    await page.goto(`/trips/${id}?view=calendar#${dayId}`);
    const calendar = page.getByRole("region", { name: "Trip calendar" });
    await expect(calendar).toBeVisible();

    const stay = calendar.locator('[data-calendar-stay-id="calendar-order-hotel"]');
    const stayTitle = stay.getByText("Stay at Calendar hotel", { exact: true });
    const stayLeaveTime = calendar.locator(
      '[data-calendar-stay-leave-id="calendar-order-hotel"][data-calendar-stay-leave-date="2027-04-11"]',
    );
    await expect(stayTitle).toBeVisible();
    await expect(stayLeaveTime).toBeVisible();
    const stayTitleBox = await stayTitle.boundingBox();
    const stayLeaveTimeBox = await stayLeaveTime.boundingBox();
    if (!stayTitleBox || !stayLeaveTimeBox) throw new Error("Missing stay label geometry");
    expect(stayLeaveTimeBox.y).toBeGreaterThanOrEqual(stayTitleBox.y + stayTitleBox.height);
    const stayHandle = stay.getByRole("button", { name: "Leave at 09:30", exact: true });
    const stayHandleBox = await stayHandle.boundingBox();
    if (!stayHandleBox) throw new Error("Missing stay handle geometry");
    const stayLineY = stayHandleBox.y + stayHandleBox.height / 2;
    const leaveBottom = stayLeaveTimeBox.y + stayLeaveTimeBox.height;
    expect(leaveBottom).toBeLessThanOrEqual(stayLineY);
    expect(stayLineY - leaveBottom).toBeLessThan(8);
    const leaveLabelLayer = await stayLeaveTime.evaluate((label) =>
      Number(getComputedStyle(label).zIndex),
    );
    const allDayLayer = await calendar
      .locator(`[data-calendar-all-day="${dayId}"]`)
      .evaluate((cell) => Number(getComputedStyle(cell).zIndex));
    expect(leaveLabelLayer).toBeGreaterThan(2);
    expect(leaveLabelLayer).toBeLessThan(allDayLayer);
    const hourLines = calendar.locator("[data-calendar-hour-lines]");
    const stayLayering = await Promise.all([
      stay.evaluate((element) => Number(getComputedStyle(element).zIndex)),
      hourLines.evaluate((element) => Number(getComputedStyle(element).zIndex)),
    ]);
    expect(stayLayering[0]).toBeGreaterThan(stayLayering[1] ?? 0);
    await expect(stayLeaveTime).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

    const hoverTrack = calendar.locator(`[data-calendar-track="${dayId}"]`);
    const hoverTrackBox = await hoverTrack.boundingBox();
    if (!hoverTrackBox) throw new Error("Missing hover track geometry");
    await page.mouse.move(
      hoverTrackBox.x + hoverTrackBox.width / 2,
      hoverTrackBox.y + Math.min(100, hoverTrackBox.height / 4),
    );
    const hoverTime = calendar.locator("[data-calendar-hover-time]");
    await expect(hoverTime).toBeVisible();
    const hoverTag = await hoverTime.evaluate((element) => {
      const style = getComputedStyle(element);
      const arrow = getComputedStyle(element, "::after");
      return {
        background: style.backgroundColor,
        borderRadius: style.borderRadius,
        borderWidth: Number.parseFloat(style.borderTopWidth),
        color: style.color,
        fontSize: Number.parseFloat(style.fontSize),
        arrowWidth: Number.parseFloat(arrow.borderLeftWidth),
        arrowContent: arrow.content,
      };
    });
    const hoverTimeGap = await calendar.evaluate((element) => {
      const gutter = element.querySelector("[data-calendar-time-gutter]");
      const label = element.querySelector("[data-calendar-hover-time]");
      if (!gutter || !label) throw new Error("Missing hover time guide geometry");
      const gutterBox = gutter.getBoundingClientRect();
      const labelBox = label.getBoundingClientRect();
      const arrowWidth = Number.parseFloat(getComputedStyle(label, "::before").borderLeftWidth);
      return gutterBox.right - (labelBox.right + arrowWidth);
    });
    const hourFontSize = await calendar
      .locator("[data-calendar-time-gutter] time")
      .first()
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(hoverTag).toMatchObject({
      background: "rgb(34, 39, 45)",
      borderRadius: "0px",
      color: "rgb(255, 255, 255)",
    });
    expect(hoverTag.borderWidth).toBeGreaterThan(0);
    expect(hoverTag.fontSize).toBeGreaterThan(hourFontSize);
    expect(hoverTag.arrowWidth).toBeGreaterThan(0);
    expect(hoverTag.arrowContent).not.toBe("none");
    expect(hoverTimeGap).toBeLessThanOrEqual(0);

    const coveredHeader = calendar.locator('[data-calendar-day-header="2027-04-11"]');
    await expect(coveredHeader.getByText("No lodging", { exact: true })).toHaveCount(0);

    const firstLodgingBar = calendar.locator('[data-calendar-lodging-id="calendar-order-hotel"]');
    const nextLodgingBar = calendar.locator(
      '[data-calendar-lodging-id="calendar-order-next-hotel"]',
    );
    const followingLodgingBar = calendar.locator(
      '[data-calendar-lodging-id="calendar-order-following-hotel"]',
    );
    await expect(firstLodgingBar).toHaveCount(1);
    await expect(nextLodgingBar).toHaveCount(1);
    await expect(firstLodgingBar).toHaveAttribute("data-calendar-lodging-lane", "0");
    await expect(nextLodgingBar).toHaveAttribute("data-calendar-lodging-lane", "1");
    await expect(followingLodgingBar).toHaveAttribute("data-calendar-lodging-lane", "0");
    const firstLodgingBox = await firstLodgingBar.boundingBox();
    const nextLodgingBox = await nextLodgingBar.boundingBox();
    const dayHeaderBox = await calendar.locator("header").first().boundingBox();
    if (!firstLodgingBox || !nextLodgingBox || !dayHeaderBox) {
      throw new Error("Missing continued lodging geometry");
    }
    expect(firstLodgingBox.width).toBeGreaterThan(dayHeaderBox.width * 1.8);
    expect(firstLodgingBox.y).toBeLessThan(nextLodgingBox.y);
    const endDateHeader = calendar.locator('[data-calendar-day-header="2027-04-12"]');
    const finalDateHeader = calendar.locator('[data-calendar-day-header="2027-04-13"]');
    const endDateHeaderBox = await endDateHeader.boundingBox();
    const finalDateHeaderBox = await finalDateHeader.boundingBox();
    const nextLodgingEndBox = await nextLodgingBar.boundingBox();
    const finalAllDayBox = await calendar
      .locator('[data-calendar-all-day="2027-04-13"]')
      .boundingBox();
    const finalTrackBox = await calendar
      .locator('[data-calendar-track="2027-04-13"]')
      .boundingBox();
    const nextLodgingMargin = await nextLodgingBar.evaluate((bar) =>
      Number.parseFloat(getComputedStyle(bar).marginRight),
    );
    if (
      !endDateHeaderBox ||
      !finalDateHeaderBox ||
      !nextLodgingEndBox ||
      !finalAllDayBox ||
      !finalTrackBox
    ) {
      throw new Error("Missing lodging end geometry");
    }
    expect(finalAllDayBox.x).toBeCloseTo(finalDateHeaderBox.x, 0);
    expect(finalAllDayBox.width).toBeCloseTo(finalDateHeaderBox.width, 0);
    expect(finalTrackBox.x).toBeCloseTo(finalDateHeaderBox.x, 0);
    expect(finalTrackBox.width).toBeCloseTo(finalDateHeaderBox.width, 0);
    expect(
      endDateHeaderBox.x +
        endDateHeaderBox.width -
        nextLodgingMargin -
        (nextLodgingEndBox.x + nextLodgingEndBox.width),
    ).toBeCloseTo(0, 0);
    expect(nextLodgingEndBox.x + nextLodgingEndBox.width).toBeLessThan(finalDateHeaderBox.x);
    await firstLodgingBar.scrollIntoViewIfNeeded();
    const lodgingDragPoint = await firstLodgingBar.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const x = bounds.left + bounds.width * 0.7;
      const y = bounds.top + bounds.height / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        x,
        y,
        cursor: hit instanceof Element ? getComputedStyle(hit).cursor : "",
      };
    });
    expect(lodgingDragPoint.cursor).toBe("pointer");

    const lodgingActionMenu = page.getByRole("menu", {
      name: "Calendar actions for Calendar hotel",
    });
    for (const lodgingSurface of [firstLodgingBar, stay]) {
      await lodgingSurface.click({ button: "right" });
      await expect(lodgingActionMenu.getByRole("menuitem")).toHaveText([
        "Edit",
        "Duplicate",
        "Delete",
      ]);
      await page.keyboard.press("Escape");
    }

    const block = calendar.locator('[data-calendar-item-id="calendar-order-first"]').first();
    await block.click({ button: "right" });
    const actionMenu = page.getByRole("menu", {
      name: "Calendar actions for First stop",
    });
    const actionButtons = actionMenu.getByRole("menuitem");
    await expect(actionButtons).toHaveCount(12);
    expect(
      await actionButtons.evaluateAll((buttons) =>
        buttons.map((button) => button.ariaLabel || button.textContent?.trim()),
      ),
    ).toEqual([
      "Previous day",
      "Next day",
      "15 minutes earlier",
      "15 minutes later",
      "Move First stop up",
      "Move First stop down",
      "Edit",
      "Duplicate",
      "15 minutes longer",
      "15 minutes shorter",
      "Make flexible",
      "Delete",
    ]);
    const iconButtons = actionButtons.filter({ hasNotText: /\S/ });
    await expect(iconButtons).toHaveCount(6);
    const iconButtonTops = await iconButtons.evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().top),
    );
    expect(Math.max(...iconButtonTops) - Math.min(...iconButtonTops)).toBeLessThan(1);

    const moveUp = actionMenu.getByRole("menuitem", {
      name: "Move First stop up",
      exact: true,
    });
    const moveDown = actionMenu.getByRole("menuitem", {
      name: "Move First stop down",
      exact: true,
    });
    await expect(moveUp).toBeDisabled();
    await expect(moveDown).toBeEnabled();
    await moveDown.click();
    await block.click({ button: "right" });
    await expect(
      actionMenu.getByRole("menuitem", {
        name: "Move First stop down",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      actionMenu.getByRole("menuitem", {
        name: "Move First stop up",
        exact: true,
      }),
    ).toBeEnabled();
    await page.keyboard.press("Escape");
    await page.mouse.move(lodgingDragPoint.x, lodgingDragPoint.y);
    await page.mouse.down();
    await page.mouse.move(lodgingDragPoint.x + dayHeaderBox.width, lodgingDragPoint.y, {
      steps: 4,
    });
    await expect(calendar.locator("[data-calendar-lodging-drag-proxy]")).toBeVisible();
    await expect(calendar.locator("[data-calendar-lodging-preview]")).toHaveAttribute(
      "data-start-date",
      "2027-04-11",
    );
    const previewBox = await calendar.locator("[data-calendar-lodging-preview]").boundingBox();
    const otherLodgingBoxes = await Promise.all([
      nextLodgingBar.boundingBox(),
      followingLodgingBar.boundingBox(),
    ]);
    if (!previewBox || otherLodgingBoxes.some((box) => !box)) {
      throw new Error("Missing lodging preview geometry");
    }
    const previewOverlapsLodging = otherLodgingBoxes.some(
      (box) =>
        box &&
        previewBox.x < box.x + box.width &&
        previewBox.x + previewBox.width > box.x &&
        previewBox.y < box.y + box.height &&
        previewBox.y + previewBox.height > box.y,
    );
    expect(previewOverlapsLodging).toBe(false);
    await page.mouse.up();
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("calendar colors the full stay when departure conflicts", async ({ page }) => {
  const dayId = "2027-04-10";
  const lodging = itemForCreate("lodging", dayId, {
    id: "conflict-hotel",
    title: "Conflict hotel",
    place: { placeId: "conflict-hotel-place" },
    lodging: {
      startDate: dayId,
      endDate: "2027-04-11",
      leaveTimes: { "2027-04-11": "10:45" },
    },
  });
  const overlappingPlace = itemForCreate("place", "2027-04-11", {
    id: "conflict-breakfast",
    title: "Overlapping breakfast",
    place: { placeId: "conflict-breakfast-place" },
    startTime: "10:00",
    durationMinutes: 60,
  });
  const id = await createEmptyTrip([lodging, overlappingPlace], "2027-04-11");
  try {
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Calendar conflict editor"),
    );
    await page.goto(`/trips/${id}?view=calendar#2027-04-11`);
    const stay = page.locator('[data-calendar-stay-id="conflict-hotel"]');
    await expect(stay).toHaveAttribute("data-calendar-stay-conflict", "true");
    const geometry = await stay.evaluate(async (element) => {
      const track = element.parentElement;
      if (!track) return null;
      track.style.height = "1001px";
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const bottom = element.getBoundingClientRect().bottom * window.devicePixelRatio;
      track.style.removeProperty("height");
      return { bottom, roundedBottom: Math.round(bottom) };
    });
    expect(geometry).not.toBeNull();
    expect(Math.abs((geometry?.bottom ?? 0) - (geometry?.roundedBottom ?? 0))).toBeLessThan(0.01);
    const appearance = await stay.evaluate((element) => {
      const original = getComputedStyle(element);
      const color = original.color;
      const backgroundColor = original.backgroundColor;
      const backgroundImage = original.backgroundImage;
      const dangerProbe = document.createElement("span");
      dangerProbe.style.color = "var(--danger)";
      element.append(dangerProbe);
      const danger = getComputedStyle(dangerProbe).color;
      dangerProbe.remove();
      const htmlElement = element as HTMLElement;
      htmlElement.style.color = "rgb(0, 0, 255)";
      const changed = getComputedStyle(element);
      const changedBackgroundColor = changed.backgroundColor;
      const changedBackgroundImage = changed.backgroundImage;
      htmlElement.style.removeProperty("color");
      return {
        color,
        danger,
        backgroundColor,
        backgroundImage,
        changedBackgroundColor,
        changedBackgroundImage,
      };
    });
    expect(appearance.color).toBe(appearance.danger);
    expect(appearance.backgroundColor).not.toBe(appearance.changedBackgroundColor);
    expect(appearance.backgroundImage).not.toBe(appearance.changedBackgroundImage);
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});
test("duration-only changes keep a flexible item untimed", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Calendar resize coverage runs once");
  const dayId = "2027-04-10";
  const target = itemForCreate("place", dayId, {
    id: "duration-only-target",
    title: "Duration only target",
    startTime: null,
    durationMinutes: 60,
  });
  const id = await createEmptyTrip([target], dayId);
  const savedTiming = async () => {
    const [stored] = await db.select().from(documents).where(eq(documents.name, id));
    if (!stored) return null;
    const document = new Y.Doc();
    Y.applyUpdate(document, stored.data);
    const item = readTripDocument(document).items[target.id];
    document.destroy();
    return item ? { startTime: item.startTime, durationMinutes: item.durationMinutes } : null;
  };
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Duration-only editor"),
    );
    await page.goto(`/trips/${id}?view=calendar#${dayId}`);
    const calendar = page.getByRole("region", { name: "Trip calendar" });
    const block = calendar.locator('[data-calendar-item-id="duration-only-target"]').first();
    await expect(block.locator("time")).toContainText("Flexible");

    await block.getByRole("button", { name: "Duration only target", exact: true }).click();
    const editor = calendar.locator(".item-editor");
    await editor.getByLabel("Duration in minutes").fill("75");
    await expect.poll(savedTiming, { timeout: 5_000 }).toEqual({
      startTime: null,
      durationMinutes: 75,
    });
    await expect(block.locator("time")).toContainText("Flexible");
    await editor.getByRole("button", { name: "Close editor" }).click();

    await block.click({ button: "right" });
    const actions = page.getByRole("menu", {
      name: "Calendar actions for Duration only target",
    });
    await actions.getByRole("menuitem", { name: "15 minutes longer" }).click();
    await expect.poll(savedTiming, { timeout: 5_000 }).toEqual({
      startTime: null,
      durationMinutes: 90,
    });
    await expect(block.locator("time")).toContainText("Flexible");

    const track = calendar.locator(`[data-calendar-track="${dayId}"]`);
    const endHandle = block.getByRole("button", {
      name: "Change end of Duration only target",
    });
    const [endHandleBox, trackBox] = await Promise.all([
      endHandle.boundingBox(),
      track.boundingBox(),
    ]);
    if (!endHandleBox || !trackBox) throw new Error("Missing end resize geometry");
    const snapDistance = trackBox.height / 96;
    await page.mouse.move(
      endHandleBox.x + endHandleBox.width / 2,
      endHandleBox.y + endHandleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      endHandleBox.x + endHandleBox.width / 2,
      endHandleBox.y + endHandleBox.height / 2 + snapDistance,
      { steps: 4 },
    );
    await page.mouse.up();
    await expect.poll(savedTiming, { timeout: 5_000 }).toEqual({
      startTime: null,
      durationMinutes: 105,
    });
    await expect(block.locator("time")).toContainText("Flexible");

    const startHandle = block.getByRole("button", {
      name: "Change start of Duration only target",
    });
    const startHandleBox = await startHandle.boundingBox();
    if (!startHandleBox) throw new Error("Missing start resize geometry");
    await page.mouse.move(
      startHandleBox.x + startHandleBox.width / 2,
      startHandleBox.y + startHandleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      startHandleBox.x + startHandleBox.width / 2,
      startHandleBox.y + startHandleBox.height / 2 + snapDistance,
      { steps: 4 },
    );
    await page.mouse.up();
    await expect.poll(savedTiming, { timeout: 5_000 }).toEqual({
      startTime: "08:15",
      durationMinutes: 90,
    });
    await expect(block.locator("time")).not.toContainText("Flexible");
  } finally {
    if (!page.isClosed()) await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("changing calendar duration keeps itinerary order", async ({ page }) => {
  const dayId = "2027-04-10";
  const target = itemForCreate("place", dayId, {
    id: "duration-target",
    title: "Duration target",
    startTime: "09:00",
    durationMinutes: 60,
  });
  const peer = itemForCreate("place", dayId, {
    id: "duration-peer",
    title: "Same-time peer",
    startTime: "09:00",
    durationMinutes: 60,
  });
  const id = await createEmptyTrip([target, peer], dayId);
  try {
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Duration editor"),
    );
    await page.goto(`/trips/${id}`);
    const itineraryEntries = page.locator(`[data-day-id="${dayId}"] .entry-select`);
    await expect(itineraryEntries).toHaveText(["Duration target", "Same-time peer"]);
    await page.getByRole("button", { name: "Calendar", exact: true }).click();
    const targetBlock = page.locator('[data-calendar-item-id="duration-target"]').first();
    await targetBlock.click({ button: "right" });
    const actions = page.getByRole("menu", {
      name: "Calendar actions for Duration target",
    });
    await actions.getByRole("menuitem", { name: "15 minutes longer" }).click();
    await expect(targetBlock).toContainText("09:00 - 10:15");

    await page.getByRole("button", { name: "Itinerary", exact: true }).click();
    await expect(itineraryEntries).toHaveText(["Duration target", "Same-time peer"]);
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});
test("calendar ends on the final labeled hour", async ({ page }) => {
  const id = await createEmptyTrip([], "2027-04-10");
  try {
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Calendar edge editor"),
    );
    await page.goto(`/trips/${id}?view=calendar`);
    const calendar = page.locator("[data-trip-calendar]");
    const finalHourLabel = calendar.locator("[data-calendar-time-gutter] time").last();
    const hourLines = calendar.locator("[data-calendar-hour-lines]");
    const firstDayTrack = calendar.locator("[data-calendar-track]").first();
    await expect(finalHourLabel).toBeVisible();
    await expect(finalHourLabel).toHaveText("30:00");
    const [finalHourLabelBox, hourLinesBox, timeGutterBox, firstDayTrackBox] = await Promise.all([
      finalHourLabel.boundingBox(),
      hourLines.boundingBox(),
      calendar.locator("[data-calendar-time-gutter]").boundingBox(),
      firstDayTrack.boundingBox(),
    ]);
    if (!finalHourLabelBox || !hourLinesBox || !timeGutterBox || !firstDayTrackBox) {
      throw new Error("Missing final calendar hour geometry");
    }
    const trackEnd = hourLinesBox.y + hourLinesBox.height;
    expect(finalHourLabelBox.y + finalHourLabelBox.height / 2).toBeCloseTo(trackEnd, 0);
    expect(timeGutterBox.y + timeGutterBox.height).toBeCloseTo(trackEnd, 0);
    expect(firstDayTrackBox.y + firstDayTrackBox.height).toBeCloseTo(trackEnd, 0);
    await expect
      .poll(() =>
        hourLines.evaluate((canvas: HTMLCanvasElement) => {
          const context = canvas.getContext("2d");
          if (!context || canvas.height === 0) return false;
          const pixels = context.getImageData(0, canvas.height - 1, canvas.width, 1).data;
          return pixels.some((channel, index) => index % 4 === 3 && channel > 0);
        }),
      )
      .toBe(true);
    const calendarScroller = calendar.locator(":scope > div").first();
    await calendarScroller.evaluate((element) => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) / 2;
    });
    const [visibleTrackBox, calendarScrollerBox] = await Promise.all([
      firstDayTrack.boundingBox(),
      calendarScroller.boundingBox(),
    ]);
    if (!visibleTrackBox || !calendarScrollerBox) {
      throw new Error("Missing calendar hover geometry");
    }
    const pointer = {
      x: visibleTrackBox.x + visibleTrackBox.width / 2,
      y: calendarScrollerBox.y + calendarScrollerBox.height * 0.65,
    };
    await page.mouse.move(pointer.x, pointer.y);
    const timeGuide = calendar.locator("[data-calendar-time-guide]");
    await expect(timeGuide).toBeVisible();
    const timeGuideBox = await timeGuide.boundingBox();
    if (!timeGuideBox) throw new Error("Missing calendar time guide");
    expect(Math.abs(timeGuideBox.y - pointer.y)).toBeLessThanOrEqual(1);
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("calendar view schedules items and shows the calendar on mobile", async ({
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
  const timedSecond = itemForCreate("place", dayId, {
    id: "calendar-lunch",
    title: "Lunch",
    startTime: "11:00",
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
    lodging: {
      startDate: dayId,
      endDate: "2027-04-11",
      leaveTimes: { "2027-04-11": "09:30" },
    },
  });
  const id = await createEmptyTrip([note, timed, timedSecond, lodging], "2027-04-14");
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Calendar editor"),
    );
    await page.goto(`/trips/${id}?view=calendar#${dayId}`);
    const controls = page
      .getByRole("region", { name: "Itinerary", exact: true })
      .getByRole("group", { name: "Itinerary / Calendar" });
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
    const stay = calendar.locator('[data-calendar-stay-id="calendar-hotel"]');
    await expect(stay).toBeVisible();
    const stayTitle = stay.getByText("Stay at City hotel", { exact: true });
    const stayLeaveTime = calendar.locator(
      '[data-calendar-stay-leave-id="calendar-hotel"][data-calendar-stay-leave-date="2027-04-11"]',
    );
    const stayTitleBox = await stayTitle.boundingBox();
    const stayLeaveTimeBox = await stayLeaveTime.boundingBox();
    if (!stayTitleBox || !stayLeaveTimeBox) throw new Error("Missing stay label geometry");
    expect(stayLeaveTimeBox.y).toBeGreaterThanOrEqual(stayTitleBox.y + stayTitleBox.height);
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

    const mapViewButton = page
      .getByRole("group", { name: "Planner view" })
      .getByRole("button", { name: "Map", exact: true });
    await mapViewButton.click();
    await expect(mapViewButton).toHaveAttribute("aria-pressed", "false");
    const lodgingSegments = calendar.locator('[data-calendar-lodging-id="calendar-hotel"]');
    await expect(lodgingSegments).toHaveCount(1);
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
      '[data-calendar-lodging-id="calendar-hotel"][data-start-date="2027-04-12"]',
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
      calendar.locator('[data-calendar-lodging-id="calendar-hotel"][data-start-date="2027-04-10"]'),
    ).toHaveCount(0);
    await expect(
      calendar.locator('[data-calendar-lodging-id="calendar-hotel"][data-start-date="2027-04-11"]'),
    ).toBeVisible();

    const checkInHandle = calendar.getByRole("button", {
      name: "Change check-in for City hotel",
    });
    await checkInHandle.scrollIntoViewIfNeeded();
    const checkInBox = await checkInHandle.boundingBox();
    if (!checkInBox) throw new Error("Missing lodging check-in handle geometry");
    const checkInBlockBox = await checkInHandle.locator("..").boundingBox();
    if (!checkInBlockBox) throw new Error("Missing lodging check-in block geometry");
    expect(checkInBox.x - checkInBlockBox.x).toBeLessThanOrEqual(3);
    expect(Math.abs(checkInBox.y - checkInBlockBox.y)).toBeLessThanOrEqual(3);
    expect(
      Math.abs(checkInBox.y + checkInBox.height - (checkInBlockBox.y + checkInBlockBox.height)),
    ).toBeLessThanOrEqual(3);
    const lodgingBackground = await checkInHandle
      .locator("..")
      .evaluate((element) => getComputedStyle(element).backgroundColor);
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
    const lodgingResizeTargets = calendar.locator('[data-calendar-lodging-preview="true"]');
    await expect(resizeGuide).toBeVisible();
    await expect(lodgingResizeTargets).toHaveCount(1);
    await expect(lodgingResizeTargets).toHaveAttribute("data-start-date", "2027-04-10");
    await expect(lodgingResizeTargets).toHaveCSS("background-color", lodgingBackground);
    await expect(lodgingResizeTargets).toContainText("3 days");
    expect(
      await resizeGuide.evaluate((element) => Number(getComputedStyle(element).zIndex)),
    ).toBeLessThan(
      await lodgingResizeTargets
        .first()
        .evaluate((element) => Number(getComputedStyle(element).zIndex)),
    );
    await expect(lodgingResizeTargets).toHaveAttribute("data-end-date", "2027-04-12");
    const resizeGuideBox = await resizeGuide.boundingBox();
    if (!resizeGuideBox) throw new Error("Missing lodging resize guide geometry");
    const resizeLodgingBox = await lodgingResizeTargets.first().boundingBox();
    if (!resizeLodgingBox) throw new Error("Missing lodging resize preview geometry");
    expect(
      Math.abs(resizeGuideBox.y - (resizeLodgingBox.y + resizeLodgingBox.height)),
    ).toBeLessThanOrEqual(3);
    expect(resizeGuideBox.width).toBeGreaterThan(lodgingDayBox.width * 1.8);
    expect(resizeGuideBox.height).toBeLessThan(4);
    await page.mouse.up();
    await expect(
      calendar.locator('[data-calendar-lodging-id="calendar-hotel"][data-start-date="2027-04-10"]'),
    ).toBeVisible();

    const checkOutHandle = calendar.getByRole("button", {
      name: "Change check-out for City hotel",
    });
    await checkOutHandle.scrollIntoViewIfNeeded();
    const checkOutBox = await checkOutHandle.boundingBox();
    if (!checkOutBox) throw new Error("Missing lodging check-out handle geometry");
    const checkOutBlockBox = await checkOutHandle.locator("..").boundingBox();
    if (!checkOutBlockBox) throw new Error("Missing lodging check-out block geometry");
    expect(
      Math.abs(checkOutBox.x + checkOutBox.width - (checkOutBlockBox.x + checkOutBlockBox.width)),
    ).toBeLessThanOrEqual(3);
    expect(Math.abs(checkOutBox.y - checkOutBlockBox.y)).toBeLessThanOrEqual(3);
    expect(
      Math.abs(checkOutBox.y + checkOutBox.height - (checkOutBlockBox.y + checkOutBlockBox.height)),
    ).toBeLessThanOrEqual(3);
    await page.mouse.move(
      checkOutBox.x + checkOutBox.width / 2,
      checkOutBox.y + checkOutBox.height / 2,
    );
    await page.mouse.down();
    const calendarBox = await calendar.boundingBox();
    if (!calendarBox) throw new Error("Missing calendar geometry");
    await page.mouse.move(
      calendarBox.x + calendarBox.width + 200,
      checkOutBox.y + checkOutBox.height / 2,
      { steps: 4 },
    );
    await expect(resizeGuide).toBeVisible();
    const clippedGuideBox = await resizeGuide.boundingBox();
    if (!clippedGuideBox) throw new Error("Missing clipped lodging resize guide geometry");
    expect(clippedGuideBox.x + clippedGuideBox.width).toBeLessThanOrEqual(
      calendarBox.x + calendarBox.width + 1,
    );
    await page.mouse.move(
      checkOutBox.x + checkOutBox.width / 2 - lodgingDayBox.width,
      checkOutBox.y + checkOutBox.height / 2,
      { steps: 4 },
    );
    await expect(resizeGuide).toBeVisible();
    await expect(lodgingResizeTargets).toHaveCount(1);
    await expect(lodgingResizeTargets).toHaveAttribute("data-end-date", "2027-04-11");
    await expect(lodgingResizeTargets).toContainText("2 days");
    await expect(
      calendar.locator('[data-calendar-lodging-id="calendar-hotel"][data-end-date="2027-04-12"]'),
    ).toHaveCount(0);
    await page.mouse.up();
    await expect(
      calendar.locator('[data-calendar-lodging-id="calendar-hotel"][data-end-date="2027-04-12"]'),
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
    await expect(lodgingResizeTargets).toHaveCount(1);
    await expect(lodgingResizeTargets).toHaveAttribute("data-end-date", "2027-04-12");
    await expect(lodgingResizeTargets).toContainText("3 days");
    await page.mouse.up();
    await expect(
      calendar.locator('[data-calendar-lodging-id="calendar-hotel"][data-end-date="2027-04-12"]'),
    ).toBeVisible();

    await mapViewButton.click();
    await expect(mapViewButton).toHaveAttribute("aria-pressed", "true");
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
    expect(horizontallyScrolledAllDayLabelBox.x).toBeCloseTo(allDayLabelBox.x, 0);
    expect(horizontallyScrolledAllDayLabelBox.y).toBeCloseTo(allDayLabelBox.y, 0);
    const scrolledLodgingBox = await calendar
      .locator('[data-calendar-lodging-id="calendar-hotel"]')
      .first()
      .boundingBox();
    if (!scrolledLodgingBox) throw new Error("Missing scrolled lodging geometry");
    const gutterCoversLodging = await allDayLabel.evaluate(
      (label, point) => label.contains(document.elementFromPoint(point.x, point.y)),
      {
        x: horizontallyScrolledAllDayLabelBox.x + horizontallyScrolledAllDayLabelBox.width / 2,
        y: scrolledLodgingBox.y + scrolledLodgingBox.height / 2,
      },
    );
    expect(gutterCoversLodging).toBe(true);
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
    await expect(block).toHaveAttribute("data-calendar-selected", "true");
    await expect(calendarEditor).toBeVisible();
    await calendarEditor.getByRole("button", { name: "Close editor" }).click();
    await expect(calendarEditor).toBeHidden();
    await block.click({ button: "right" });
    const editMenu = page.getByRole("menu", {
      name: "Calendar actions for Morning museum",
    });
    await editMenu.getByRole("menuitem", { name: "Edit", exact: true }).click();
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
    const secondBlock = calendar.locator('[data-calendar-item-id="calendar-lunch"]').first();
    const secondBlockButton = secondBlock.getByRole("button", { name: "Lunch", exact: true });
    await blockButton.click({ modifiers: ["Control"] });
    await secondBlockButton.click({ modifiers: ["Control"] });
    await expect(block).toHaveAttribute("data-calendar-selected", "true");
    await expect(secondBlock).toHaveAttribute("data-calendar-selected", "true");
    const groupDragBox = await block.boundingBox();
    if (!groupDragBox) throw new Error("Missing group drag geometry");
    await page.mouse.move(
      groupDragBox.x + groupDragBox.width / 2,
      groupDragBox.y + groupDragBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      groupDragBox.x + groupDragBox.width / 2 + lodgingDayBox.width,
      groupDragBox.y + groupDragBox.height / 2,
      { steps: 4 },
    );
    await expect(dropPreview).toHaveCount(2);
    await page.mouse.up();
    const movedGroupTrack = calendar.locator('[data-calendar-track="2027-04-11"]');
    await expect(
      movedGroupTrack.locator('[data-calendar-item-id="calendar-museum"]'),
    ).toBeVisible();
    await expect(movedGroupTrack.locator('[data-calendar-item-id="calendar-lunch"]')).toBeVisible();

    const movedFirstBox = await block.boundingBox();
    const movedSecondBox = await secondBlock.boundingBox();
    const movedTrackBox = await movedGroupTrack.boundingBox();
    if (!movedFirstBox || !movedSecondBox || !movedTrackBox) {
      throw new Error("Missing drag selection geometry");
    }
    const selectionStartX = movedTrackBox.x + 1;
    const selectionStartY = Math.min(movedFirstBox.y, movedSecondBox.y) - 4;
    await page.mouse.click(selectionStartX, selectionStartY);
    await expect(block).toHaveAttribute("data-calendar-selected", "false");
    await expect(secondBlock).toHaveAttribute("data-calendar-selected", "false");
    await page.mouse.move(selectionStartX, selectionStartY);
    await page.mouse.down();
    await page.mouse.move(
      movedTrackBox.x + movedTrackBox.width - 1,
      Math.max(movedFirstBox.y + movedFirstBox.height, movedSecondBox.y + movedSecondBox.height) +
        4,
      { steps: 4 },
    );
    await expect(calendar.locator("[data-calendar-selection-box]")).toBeVisible();
    await expect(block).toHaveAttribute("data-calendar-selected", "true");
    await expect(secondBlock).toHaveAttribute("data-calendar-selected", "true");
    await page.mouse.up();
    await expect(calendar.locator("[data-calendar-selection-box]")).toBeHidden();

    await expect(block.getByRole("button", { name: /Calendar actions/ })).toHaveCount(0);
    await block.click({ button: "right" });
    const actionMenu = page.getByRole("menu", {
      name: "Calendar actions for Morning museum",
    });
    await expect(actionMenu).toBeVisible();
    const actionButtons = actionMenu.getByRole("menuitem");
    await expect(actionButtons).toHaveCount(12);
    expect(
      await actionButtons.evaluateAll((buttons) =>
        buttons.map((button) => button.ariaLabel || button.textContent?.trim()),
      ),
    ).toEqual([
      "Previous day",
      "Next day",
      "15 minutes earlier",
      "15 minutes later",
      "Move Morning museum up",
      "Move Morning museum down",
      "Edit",
      "Duplicate",
      "15 minutes longer",
      "15 minutes shorter",
      "Make flexible",
      "Delete",
    ]);
    expect(await actionButtons.locator("svg").count()).toBe(12);
    expect(
      await actionButtons
        .evaluateAll((buttons) => buttons.slice(0, 6).map((button) => button.textContent?.trim()))
        .then((labels) => labels.every((label) => label === "")),
    ).toBe(true);
    const directionButtonTops = await actionButtons.evaluateAll((buttons) =>
      buttons.slice(0, 6).map((button) => button.getBoundingClientRect().top),
    );
    expect(Math.max(...directionButtonTops) - Math.min(...directionButtonTops)).toBeLessThan(1);
    const moveUpAction = actionMenu.getByRole("menuitem", {
      name: "Move Morning museum up",
      exact: true,
    });
    const moveDownAction = actionMenu.getByRole("menuitem", {
      name: "Move Morning museum down",
      exact: true,
    });
    await expect(moveUpAction).toBeDisabled();
    await expect(moveDownAction).toBeEnabled();
    const nextDayAction = actionMenu.getByRole("menuitem", {
      name: "Next day",
      exact: true,
    });
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
    await actionMenu.getByRole("menuitem", { name: "15 minutes longer", exact: true }).click();
    await expect(block).toContainText("09:15 - 10:30");
    await block.click({ button: "right" });
    await actionMenu.getByRole("menuitem", { name: "15 minutes shorter", exact: true }).click();
    await expect(block).toContainText("09:15 - 10:15");
    await block.click({ button: "right" });
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
    await actionMenu.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
    await expect(actionMenu).toBeHidden();
    const duplicatedBlocks = calendar.getByRole("button", {
      name: "Morning museum",
      exact: true,
    });
    await expect(duplicatedBlocks).toHaveCount(2);
    await expect(duplicatedBlocks.nth(0)).toContainText("09:15 - 10:15");
    await expect(duplicatedBlocks.nth(1)).toContainText("09:15 - 10:15");

    await duplicatedBlocks.nth(1).click({ button: "right" });
    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      await dialog.dismiss();
    });
    await actionMenu.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await expect(duplicatedBlocks).toHaveCount(2);
    await duplicatedBlocks.nth(1).click({ button: "right" });
    page.once("dialog", async (dialog) => dialog.accept());
    await actionMenu.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await expect(duplicatedBlocks).toHaveCount(1);

    const allDayCell = calendar.locator('[data-calendar-all-day="2027-04-14"]');
    await allDayCell.click({ button: "right" });
    const addMenu = page.getByRole("menu", { name: "Add calendar item" });
    await expect(addMenu.getByRole("menuitem")).toHaveCount(1);
    await expect(addMenu.getByRole("menuitem", { name: "Add lodging" })).toBeVisible();
    await addMenu.getByRole("menuitem", { name: "Add lodging" }).click();
    const placeSearch = page.locator(".place-search");
    await expect(placeSearch).toBeVisible();
    await expect(placeSearch.getByRole("heading", { name: "Add lodging" })).toBeVisible();
    await expect(placeSearch.getByLabel("Check-in date")).toHaveValue("2027-04-14");
    await calendar.getByText("All day", { exact: true }).click();
    await expect(placeSearch).toBeHidden();

    const emptyTrack = calendar.locator('[data-calendar-track="2027-04-11"]');
    await emptyTrack.scrollIntoViewIfNeeded();
    const contextPoint = await emptyTrack.evaluate((track) => {
      const bounds = track.getBoundingClientRect();
      const x = bounds.left + bounds.width / 2;
      const firstY = Math.max(0, bounds.top) + 80;
      const lastY = Math.min(window.innerHeight, bounds.bottom) - 20;
      for (let y = firstY; y <= lastY; y += 20) {
        const target = document.elementFromPoint(x, y);
        if (
          target &&
          track.contains(target) &&
          !target.closest("[data-calendar-item-id], [data-calendar-stay-id]")
        ) {
          return { x, y };
        }
      }
      throw new Error("No visible empty calendar space");
    });
    await page.mouse.click(contextPoint.x, contextPoint.y, { button: "right" });
    await expect(addMenu.getByRole("menuitem")).toHaveCount(3);
    const placeMenuBox = await addMenu.boundingBox();
    await addMenu.getByRole("menuitem", { name: "Add place" }).click();
    await expect(placeSearch.getByRole("heading", { name: "Add a place" })).toBeVisible();
    const placeSearchBox = await placeSearch.boundingBox();
    if (!placeMenuBox || !placeSearchBox) throw new Error("Missing place search geometry");
    expect(placeSearchBox.x).toBeCloseTo(placeMenuBox.x, 0);
    expect(placeSearchBox.y).toBeCloseTo(placeMenuBox.y, 0);
    await calendar.getByText("All day", { exact: true }).click();

    await page.mouse.click(contextPoint.x, contextPoint.y, { button: "right" });
    const reservationMenuBox = await addMenu.boundingBox();
    await addMenu.getByRole("menuitem", { name: "Add reservation" }).click();
    await expect(placeSearch.getByRole("heading", { name: "Add reservation" })).toBeVisible();
    await expect(placeSearch.getByLabel("Date")).toHaveValue("2027-04-11");
    await expect(placeSearch.getByLabel("Start time")).not.toHaveValue("");
    const reservationSearchBox = await placeSearch.boundingBox();
    if (!reservationMenuBox || !reservationSearchBox) {
      throw new Error("Missing reservation search geometry");
    }
    expect(reservationSearchBox.x).toBeCloseTo(reservationMenuBox.x, 0);
    expect(reservationSearchBox.y).toBeCloseTo(reservationMenuBox.y, 0);
    await calendar.getByText("All day", { exact: true }).click();

    await page.mouse.click(contextPoint.x, contextPoint.y, { button: "right" });
    await addMenu.getByRole("menuitem", { name: "Add transport" }).click();
    await expect(emptyTrack.locator("[data-calendar-item-id]")).toHaveCount(3);

    await itineraryButton.click();
    await expect(calendar).toBeHidden();
    await expect(page).toHaveURL(/[?&]view=itinerary/);

    await page.setViewportSize({ width: 390, height: 800 });
    await calendarButton.click();
    await expect(page).toHaveURL(/[?&]view=calendar/);
    await expect(calendar).toBeVisible();
    await expect(page.locator(".calendar-mobile-itinerary")).toBeHidden();
    expect(
      await calendar.evaluate(
        (element) => element.getBoundingClientRect().width <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    if (!page.isClosed()) await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("calendar blocks travel before lodging leave time", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Calendar lodging conflict coverage runs once");
  const firstDay = "2027-04-10";
  const secondDay = "2027-04-11";
  const lodging = itemForCreate("lodging", firstDay, {
    id: "calendar-conflict-hotel",
    title: "Conflict hotel",
    place: { placeId: "calendar-conflict-hotel-place" },
    lodging: {
      startDate: firstDay,
      endDate: secondDay,
      leaveTimes: { [secondDay]: "09:00" },
    },
  });
  const early = itemForCreate("place", secondDay, {
    id: "calendar-conflict-early",
    title: "Early stop",
    place: { placeId: "calendar-conflict-early-place" },
    startTime: "08:30",
    durationMinutes: 60,
  });
  const id = await createEmptyTrip([lodging, early], secondDay);
  try {
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Calendar conflict editor"),
    );
    await page.goto(`/trips/${id}?view=calendar#${secondDay}`);
    const calendar = page.getByRole("region", { name: "Trip calendar" });
    const track = calendar.locator(`[data-calendar-track="${secondDay}"]`);
    const stay = track.locator(
      '[data-calendar-stay-id="calendar-conflict-hotel"][data-calendar-stay-conflict="true"]',
    );
    await expect(stay).toBeVisible();
    await expect(track.locator("[data-calendar-route-leg]")).toHaveCount(0);
    const lineColors = await stay.evaluate((element) => {
      const danger = getComputedStyle(element).getPropertyValue("--danger");
      const probe = document.createElement("span");
      probe.style.color = danger;
      document.body.append(probe);
      const normalizedDanger = getComputedStyle(probe).color;
      probe.remove();
      return {
        line: getComputedStyle(element).borderBottomColor,
        danger: normalizedDanger,
      };
    });
    expect(lineColors.line).toBe(lineColors.danger);
    await expect(
      track.locator(
        '[data-calendar-stay-leave-id="calendar-conflict-hotel"][data-calendar-stay-leave-date="2027-04-11"]',
      ),
    ).toHaveCSS("color", lineColors.danger);
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});
test("calendar transport legs follow overlap lanes and reduce details by width", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Calendar layout coverage runs once");
  const cases = [
    {
      dayId: "2027-04-10",
      lanes: 1,
      duration: true,
      mode: true,
      icon: true,
      destinationStart: "10:05",
      conflict: true,
    },
    {
      dayId: "2027-04-11",
      lanes: 2,
      duration: false,
      mode: true,
      icon: true,
      destinationStart: "11:00",
      conflict: false,
    },
    {
      dayId: "2027-04-12",
      lanes: 4,
      duration: false,
      mode: false,
      icon: false,
      destinationStart: "11:00",
      conflict: false,
    },
    {
      dayId: "2027-04-13",
      lanes: 8,
      duration: false,
      mode: false,
      icon: false,
      destinationStart: "11:00",
      conflict: false,
    },
  ] as const;
  const items = cases.flatMap(({ dayId, lanes, destinationStart }) => [
    ...Array.from({ length: lanes }, (_, index) =>
      itemForCreate("place", dayId, {
        id: `route-${dayId}-${index}`,
        title: `Route source ${dayId} ${index}`,
        place: { placeId: `route-place-${dayId}-${index}` },
        startTime: "09:00",
        durationMinutes: 60,
      }),
    ),
    itemForCreate("place", dayId, {
      id: `route-${dayId}-destination`,
      title: `Route destination ${dayId}`,
      place: { placeId: `route-place-${dayId}-destination` },
      startTime: destinationStart,
      durationMinutes: 60,
    }),
  ]);
  const id = await createEmptyTrip(items, "2027-04-13");
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1.25,
      mobile: false,
    });
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Route layout editor"),
    );
    await page.goto(`/trips/${id}?view=calendar#2027-04-10`);
    const calendar = page.getByRole("region", { name: "Trip calendar" });
    await expect(calendar).toBeVisible();
    await calendar.locator("[data-calendar-time-gutter]").evaluate((element) => {
      element.parentElement?.style.setProperty("--calendar-track-height", "2880px");
    });

    for (const expected of cases) {
      const track = calendar.locator(`[data-calendar-track="${expected.dayId}"]`);
      const source = track.locator(`[data-calendar-item-id="route-${expected.dayId}-0"]`);
      const route = track.locator("[data-calendar-route-leg]").first();
      await expect(route).toBeVisible();
      const sourceBox = await source.boundingBox();
      const routeBox = await route.boundingBox();
      if (!sourceBox || !routeBox) throw new Error("Missing route lane geometry");
      const trackBox = await track.boundingBox();
      if (!trackBox) throw new Error("Missing calendar track geometry");
      expect(routeBox.height).toBeCloseTo((trackBox.height * 15) / (24 * 60), 0);
      const em = await route.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).fontSize),
      );
      expect(routeBox.x - sourceBox.x).toBeCloseTo(em * 0.35, 0);
      expect(sourceBox.width - routeBox.width).toBeCloseTo(em * 0.7, 0);
      const connector = await route.locator("i").evaluate((line) => {
        const bounds = line.getBoundingClientRect();
        const routeBounds = line.parentElement?.getBoundingClientRect();
        const style = getComputedStyle(line);
        return {
          deviceWidth: bounds.width * devicePixelRatio,
          deviceCapHeight:
            Number.parseFloat(getComputedStyle(line, "::after").height) * devicePixelRatio,
          offset: routeBounds ? bounds.left - routeBounds.left : 0,
          expectedOffset: Number.parseFloat(style.fontSize) * 0.2,
        };
      });
      expect(connector.deviceWidth).toBeCloseTo(2, 1);
      expect(connector.deviceCapHeight).toBeCloseTo(2, 1);
      expect(connector.offset).toBeCloseTo(connector.expectedOffset, 1);
      if (expected.lanes === 1) {
        const routeInfo = route.locator("[data-calendar-route-info]");
        const routeInfoBox = await routeInfo.boundingBox();
        if (!routeInfoBox) throw new Error("Missing route label geometry");
        expect(routeInfoBox.width).toBeLessThan(routeBox.width * 0.75);
        await expect(routeInfo).toHaveCSS("justify-self", "start");
        const labelGap = await route.evaluate((element) => {
          const line = element.querySelector("i");
          const info = element.querySelector("[data-calendar-route-info]");
          if (!line || !info) return null;
          return info.getBoundingClientRect().left - line.getBoundingClientRect().right;
        });
        expect(labelGap).not.toBeNull();
        expect(labelGap ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(em * 0.5);
      }

      const duration = route.locator("[data-calendar-route-duration]");
      const mode = route.locator("[data-calendar-route-mode]");
      const icon = route.locator("[data-calendar-route-icon]");
      if (expected.duration) await expect(duration).toBeVisible();
      else await expect(duration).toBeHidden();
      if (expected.mode) await expect(mode).toBeVisible();
      else await expect(mode).toBeHidden();
      if (expected.icon) await expect(icon).toBeVisible();
      else await expect(icon).toBeHidden();
      await expect(route).toHaveAttribute("aria-label", /.+ - .+/);
      if (expected.conflict) {
        const colors = await route.evaluate((element) => {
          const line = element.querySelector("i");
          const info = element.querySelector("[data-calendar-route-info]");
          if (!line || !info) return null;
          const probe = document.createElement("span");
          probe.style.color = getComputedStyle(element).getPropertyValue("--danger");
          document.body.append(probe);
          const danger = getComputedStyle(probe).color;
          probe.remove();
          return {
            line: getComputedStyle(line).backgroundColor,
            end: getComputedStyle(line, "::after").backgroundColor,
            label: getComputedStyle(info).color,
            danger,
          };
        });
        expect(colors).toEqual({
          line: colors?.danger,
          end: colors?.danger,
          label: colors?.danger,
          danger: colors?.danger,
        });
      }
    }
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

test("mobile itinerary sheet follows pointer drag", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "The mobile project covers sheet resizing");
  const id = await createEmptyTrip();
  try {
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Mobile sheet editor"),
    );
    await page.goto(`/trips/${id}`);
    const panel = page.getByRole("region", { name: "Itinerary", exact: true });
    const handle = page.locator(".mobile-sheet-handle");
    await expect(handle).toBeVisible();
    const initialHeight = await panel.evaluate((element) => element.getBoundingClientRect().height);
    const bounds = await handle.boundingBox();
    if (!bounds) throw new Error("The mobile sheet handle is not visible");
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - 120 }],
    });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect
      .poll(() => panel.evaluate((element) => element.getBoundingClientRect().height))
      .toBeGreaterThan(initialHeight + 80);
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
    const entrySelect = row.locator(".entry-select");
    await entrySelect.focus();
    await entrySelect.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(entrySelect).toBeFocused();
    expect(
      await row.evaluate((entry) => {
        const title = entry.querySelector(".entry-select");
        if (!(title instanceof HTMLElement)) throw new Error("The entry title is missing");
        return {
          entryOutline: getComputedStyle(entry).outlineStyle,
          titleOutline: getComputedStyle(title).outlineStyle,
        };
      }),
    ).toEqual({
      entryOutline: "solid",
      titleOutline: "none",
    });
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
      lodging: lodgingForDates(dayId, "2027-04-11"),
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

test("pointer drops rejoin the reordered list without a pause", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Mouse drag coverage runs on desktop");
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
test("entries can be dragged to another day", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Mouse drag coverage runs on desktop");
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
test("itinerary drag remains active while the list scrolls", async ({ page }) => {
  const dates = Array.from(
    { length: 8 },
    (_, offset) => `2027-04-${String(10 + offset).padStart(2, "0")}`,
  );
  const items = dates.flatMap((date, dayIndex) =>
    Array.from({ length: 4 }, (_, itemIndex) =>
      itemForCreate("note", date, {
        id: `scroll-drag-${dayIndex}-${itemIndex}`,
        title: `Day ${dayIndex + 1} item ${itemIndex + 1}`,
      }),
    ),
  );
  const id = await createEmptyTrip(items, dates.at(-1));
  try {
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Scroll drag editor"),
    );
    await page.goto(`/trips/${id}`);
    const panel = page.locator(".planner-panel");
    const days = page.locator(".day-section");
    const sourceDay = days.nth(1);
    await sourceDay.scrollIntoViewIfNeeded();
    await expect(sourceDay).toHaveAttribute("data-rendered", "true");
    const sourceEntries = sourceDay.locator(".itinerary-entry");
    await expect(sourceEntries).toHaveCount(4);
    const sourceBox = await sourceEntries.first().boundingBox();
    if (!sourceBox) throw new Error("Missing scroll drag geometry");

    await page.mouse.move(sourceBox.x + 8, sourceBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(sourceBox.x + 8, sourceBox.y + 16);
    await expect(page.locator(".itinerary-entry.is-dragging")).toHaveCount(1);
    const scrollBefore = await panel.evaluate((element) => element.scrollTop);
    await panel.evaluate((element) => {
      element.scrollTop += 1000;
    });
    await expect
      .poll(() => panel.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(scrollBefore);
    await expect(sourceDay).toHaveAttribute("data-rendered", "true");
    await expect(sourceEntries).toHaveCount(4);
    await expect(page.locator(".itinerary-entry.is-dragging")).toHaveCount(1);

    await page.mouse.up();
    await expect(page.locator(".itinerary-entry.is-dragging")).toHaveCount(0);
    await expect
      .poll(() =>
        page
          .locator(".day-heading b")
          .allTextContents()
          .then((counts) => counts.reduce((total, count) => total + Number(count), 0)),
      )
      .toBe(items.length);
    await expect
      .poll(() => page.locator('.day-section[data-rendered="true"] .itinerary-entry').count())
      .toBeGreaterThan(0);
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("Places to visit can jump into view and drag an item into a day", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Mouse drag coverage runs on desktop");
  const id = await createEmptyTrip([
    itemForCreate("place", "2027-04-12", {
      id: "inbox-walk-anchor",
      title: "Existing stop",
      place: { placeId: "cafe-anchor" },
    }),
    itemForCreate("place", null, {
      id: "inbox-walk-candidate",
      title: "Visit later",
      place: { placeId: "cafe" },
      travelMode: "DRIVING",
    }),
  ]);
  const readCandidateTravelMode = async () => {
    const [stored] = await db.select().from(documents).where(eq(documents.name, id));
    if (!stored) return null;
    const saved = new Y.Doc();
    Y.applyUpdate(saved, stored.data);
    const travelMode = readTripDocument(saved).items["inbox-walk-candidate"]?.travelMode ?? null;
    saved.destroy();
    return travelMode;
  };
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
      destinationBox.y + destinationBox.height - 8,
      { steps: 8 },
    );
    await page.mouse.up();

    await expect(source).toHaveCount(0);
    await expect(destination.locator(".entry-select")).toHaveCount(2);
    await expect.poll(readCandidateTravelMode).toBe("WALKING");
    await page.reload();
    await expect(page.locator(".day-section").last().locator(".entry-select")).toHaveCount(2);
    await destination
      .locator(".transport-leg")
      .last()
      .getByLabel("Travel mode")
      .selectOption("DRIVING");
    await expect.poll(readCandidateTravelMode).toBe("DRIVING");
    await page.reload();
    await expect.poll(readCandidateTravelMode).toBe("DRIVING");
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

test("planner loads a trip with a lodging gap", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Planner route coverage runs once");
  const firstLodging = itemForCreate("lodging", "2027-04-10", {
    id: "lodging-before-gap",
    title: "Hotel before gap",
    place: { placeId: "hotel-before-gap" },
    lodging: {
      startDate: "2027-04-10",
      endDate: "2027-04-12",
      leaveTimes: { "2027-04-11": "09:00", "2027-04-12": "09:00" },
    },
  });
  const nextLodging = itemForCreate("lodging", "2027-04-13", {
    id: "lodging-after-gap",
    title: "Hotel after gap",
    place: { placeId: "hotel-after-gap" },
    lodging: {
      startDate: "2027-04-13",
      endDate: "2027-04-14",
      leaveTimes: { "2027-04-14": "09:00" },
    },
  });
  const stop = itemForCreate("place", "2027-04-13", {
    id: "place-after-gap",
    title: "Place after gap",
    place: { placeId: "place-after-gap" },
    startTime: "10:00",
  });
  const id = await createEmptyTrip([firstLodging, nextLodging, stop], "2027-04-14");
  try {
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Lodging gap editor"),
    );
    await page.goto(`/trips/${id}`);
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
      .toBeGreaterThan(0);
    await expect(page.getByRole("region", { name: "Itinerary", exact: true })).toBeVisible();
    await expect(page.getByText("Trip not found", { exact: true })).toHaveCount(0);
  } finally {
    if (!page.isClosed()) await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
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
  await expect(dialog.locator("p strong")).toHaveText("Shared Tokyo plan");
  await dialog.getByLabel("Trip title confirmation").fill("Shared Tokyo plan");
  await dialog.getByRole("button", { name: "Delete trip" }).click();
  await expect(page).toHaveURL("/");
  await expect
    .poll(async () => db.select().from(trips).where(eq(trips.id, tripId)))
    .toHaveLength(0);
  await page.goto(`/trips/${tripId}`);
  await expect(page.getByText("Trip not found", { exact: true })).toBeVisible();
});

test("transport endpoints connect to adjacent itinerary places", async ({ page }, testInfo) => {
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

    if (testInfo.project.name !== "mobile") {
      const trainEntry = unit("Train").locator(".itinerary-entry");
      const displacedEntry = unit("After transport").locator(".itinerary-entry");
      const trainBox = await trainEntry.boundingBox();
      const displacedBox = await displacedEntry.boundingBox();
      if (!trainBox || !displacedBox) throw new Error("Missing transport drag geometry");
      const list = trainEntry.locator(
        "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' itinerary-list ')][1]",
      );
      const listHeight = await list.evaluate((element) => element.getBoundingClientRect().height);
      await page.mouse.move(trainBox.x + 8, trainBox.y + 8);
      await page.mouse.down();
      await page.mouse.move(trainBox.x + 8, trainBox.y + 16);
      await expect(trainEntry).toHaveClass(/is-dragging/);
      await page.mouse.move(
        displacedBox.x + displacedBox.width / 2,
        displacedBox.y + displacedBox.height - 2,
        { steps: 8 },
      );
      const placeholder = page.locator("[data-rfd-placeholder-context-id]");
      await expect(placeholder).toBeVisible();
      const placeholderBox = await placeholder.boundingBox();
      if (!placeholderBox) throw new Error("Missing itinerary drop preview");
      expect(placeholderBox.height).toBeCloseTo(trainBox.height, 0);
      await expect(unit("Train").locator("[data-rfd-placeholder-context-id]")).toHaveCount(0);
      await expect
        .poll(async () => {
          const shiftedDisplacedBox = await displacedEntry.boundingBox();
          if (!shiftedDisplacedBox) throw new Error("Missing displaced itinerary entry");
          return displacedBox.y - shiftedDisplacedBox.y;
        })
        .toBeCloseTo(trainBox.height, 0);
      expect(await list.evaluate((element) => element.getBoundingClientRect().height)).toBeCloseTo(
        listHeight,
        0,
      );
      expect(
        await page
          .locator(".leg-mode")
          .evaluateAll((modes) =>
            modes.every((mode) => getComputedStyle(mode).visibility === "visible"),
          ),
      ).toBe(true);
      await page.mouse.up();
      await expect(page.locator(".itinerary-entry.is-dragging")).toHaveCount(0);
    }
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
    const language = dialog.getByLabel(/^Trip language/);
    await expect(language.locator('option[value="zh-CN"]')).toHaveText("简体中文");
    await expect(language.locator('option[value="zh-TW"]')).toHaveText("繁體中文");
    await language.selectOption("zh-CN");
    await dialog.getByRole("button", { name: "Save settings" }).click();

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("button", { name: "Share" })).toBeVisible();
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
      title: "Repeated second map place",
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
  const dashedTransportPolylines = () =>
    page.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            __pacenotesDashedTransportPolylines?: number;
          }
        ).__pacenotesDashedTransportPolylines ?? 0,
    );
  await page.addInitScript(() => localStorage.setItem("pacenotes-display-name", "Trip-wide map"));
  try {
    await page.goto(`/trips/${routeTrip}`);
    const dates = page.locator(".date-tabs [data-day-tab]");
    await expect(dates.nth(0)).toHaveAttribute("aria-current", "date");
    await expect(page.locator(".map-number-marker")).toHaveCount(3);
    expect(await page.locator(".map-number-marker span").allTextContents()).toEqual([
      "1",
      "1",
      "1",
    ]);
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
      "1",
      "2",
    ]);
    await expect.poll(transportPolylines).toBe(2);
    await expect.poll(dashedTransportPolylines).toBe(2);
    await dates.nth(1).click();
    await expect(page.locator(".map-number-marker")).toHaveCount(4);
    await expect.poll(transportPolylines).toBe(2);
    await expect.poll(dashedTransportPolylines).toBe(2);
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
    lodging: lodgingForDates("2027-04-10", "2027-04-11"),
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
test("transport endpoint search limits primary place types by travel method", async ({ page }) => {
  const id = await createEmptyTrip([
    itemForCreate("transport", "2027-04-10", {
      id: "plane-endpoint-search",
      title: "Flight",
      transport: {
        mode: "plane",
        customMode: "",
        from: null,
        to: null,
      },
    }),
  ]);
  try {
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Endpoint search editor"),
    );
    await page.goto(`/trips/${id}`);
    await page.locator(".itinerary-entry").click({ position: { x: 8, y: 8 } });
    const editor = page.locator(".item-editor");
    const endpointTypes = (label: string) =>
      page
        .locator(`gmp-place-autocomplete[aria-label="${label}"]`)
        .evaluate(
          (element) =>
            (element as HTMLElement & { includedPrimaryTypes?: string[] }).includedPrimaryTypes,
        );
    const travelMethod = editor.getByRole("combobox", { name: /^Travel method/ });
    for (const [mode, expectedTypes] of [
      ["plane", ["airport", "airstrip", "heliport", "international_airport"]],
      ["train", ["train_station", "transit_station", "subway_station"]],
      ["bus", ["bus_station", "bus_stop", "transit_station"]],
      ["ferry", ["ferry_terminal"]],
    ] as const) {
      await travelMethod.selectOption(mode);
      await expect.poll(() => endpointTypes("From")).toEqual(expectedTypes);
      await expect.poll(() => endpointTypes("To")).toEqual(expectedTypes);
    }
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("route legs without detailed geometry use a dashed direct map line", async ({ page }) => {
  const id = await createEmptyTrip([
    itemForCreate("place", "2027-04-10", {
      id: "fallback-route-start",
      title: "Museum",
      place: { placeId: "museum-anchor" },
    }),
    itemForCreate("place", "2027-04-10", {
      id: "fallback-route-end",
      title: "Hotel",
      place: { placeId: "museum" },
      travelMode: "TRANSIT",
    }),
  ]);
  try {
    await page.goto(`/trips/${id}`);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const records =
            (
              globalThis as typeof globalThis & {
                __pacenotesPolylineOptions?: Array<{
                  dashPath: unknown;
                  path: Array<{ lat?: number; lng?: number }>;
                  strokeOpacity: number | undefined;
                }>;
              }
            ).__pacenotesPolylineOptions ?? [];
          return records.some(
            (record) =>
              record.strokeOpacity === 0 &&
              record.dashPath === "M 0,-1 0,1" &&
              record.path[0]?.lat === 36 &&
              record.path[0]?.lng === 140 &&
              record.path[1]?.lat === 36.001 &&
              record.path[1]?.lng === 140,
          );
        }),
      )
      .toBe(true);
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("routes with provider geometry use a solid map line when details are incomplete", async ({
  page,
}) => {
  const id = await createEmptyTrip([
    itemForCreate("place", "2027-04-10", {
      id: "partial-route-start",
      title: "Start",
      place: { placeId: "no-detail-start" },
    }),
    itemForCreate("place", "2027-04-10", {
      id: "partial-route-end",
      title: "End",
      place: { placeId: "no-detail-end" },
    }),
  ]);
  try {
    await page.goto(`/trips/${id}`);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const records =
            (
              globalThis as typeof globalThis & {
                __pacenotesPolylineOptions?: Array<{
                  dashPath: unknown;
                  path: Array<{ lat?: number; lng?: number }>;
                  strokeOpacity: number | undefined;
                }>;
              }
            ).__pacenotesPolylineOptions ?? [];
          return records.some(
            (record) =>
              record.strokeOpacity === 0.82 &&
              record.dashPath === undefined &&
              record.path.some((point) => point.lat === 37.05 && point.lng === 141.08),
          );
        }),
      )
      .toBe(true);
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
    lodging: lodgingForDates("2027-04-09", "2027-04-10"),
  });
  const middle = itemForCreate("place", "2027-04-10", {
    title: "Only day stop",
    place: { placeId: "museum" },
  });
  const nextLodging = itemForCreate("lodging", "2027-04-10", {
    title: "Next overnight stay",
    place: { placeId: "overnight-stay" },
    lodging: lodgingForDates("2027-04-10", "2027-04-11"),
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
    lodging: lodgingForDates("2027-04-10", "2027-04-12"),
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

test("first and last day controls extend the trip", async ({ page }) => {
  const id = await createEmptyTrip();
  try {
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Day range editor"),
    );
    await page.goto(`/trips/${id}`);
    await expect(page.getByRole("button", { name: /^Add a day before / })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^Add a day after / })).toHaveCount(1);

    await page.getByRole("button", { name: /^Add a day before / }).click();
    await expect(page.locator(".day-section")).toHaveCount(4);
    await page.getByRole("button", { name: /^Add a day after / }).click();
    await expect(page.locator(".day-section")).toHaveCount(5);

    await expect
      .poll(async () => {
        const [stored] = await db.select().from(documents).where(eq(documents.name, id));
        if (!stored) return null;
        const document = new Y.Doc();
        Y.applyUpdate(document, new Uint8Array(stored.data));
        const snapshot = readTripDocument(document);
        document.destroy();
        return { startDate: snapshot.startDate, endDate: snapshot.endDate };
      })
      .toEqual({ startDate: "2027-04-09", endDate: "2027-04-13" });
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("trip settings change the date range without a fieldset border", async ({ page }) => {
  const id = await createEmptyTrip();
  try {
    await page.addInitScript(() =>
      localStorage.setItem("pacenotes-display-name", "Date settings editor"),
    );
    await page.goto(`/trips/${id}`);
    const settingsButton = page.getByRole("button", { name: "Trip settings" });
    await settingsButton.click();
    const settings = page.getByRole("dialog", { name: "Trip settings" });
    const startDate = settings.getByRole("textbox", { name: "Start", exact: true });
    const endDate = settings.getByRole("textbox", { name: "End", exact: true });
    await expect(startDate).toHaveValue("2027-04-10");
    await expect(endDate).toHaveValue("2027-04-12");
    await expect(settings.locator(".trip-date-range")).toHaveCSS("border-top-width", "0px");

    await startDate.fill("2027-04-09");
    await endDate.fill("2027-04-13");
    await settings.getByRole("button", { name: "Save settings" }).click();
    await expect(page.locator(".day-section")).toHaveCount(5);
    await expect
      .poll(async () => {
        const [stored] = await db.select().from(documents).where(eq(documents.name, id));
        if (!stored) return null;
        const document = new Y.Doc();
        Y.applyUpdate(document, new Uint8Array(stored.data));
        const snapshot = readTripDocument(document);
        document.destroy();
        return { startDate: snapshot.startDate, endDate: snapshot.endDate };
      })
      .toEqual({ startDate: "2027-04-09", endDate: "2027-04-13" });

    await page.reload();
    await settingsButton.click();
    await expect(settings.getByRole("textbox", { name: "Start", exact: true })).toHaveValue(
      "2027-04-09",
    );
    await expect(settings.getByRole("textbox", { name: "End", exact: true })).toHaveValue(
      "2027-04-13",
    );
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
    await page.locator(".day-section").first().getByRole("button", { name: "Place" }).click();
    await page.locator("gmp-place-autocomplete").evaluate((element) => {
      element.dispatchEvent(
        Object.assign(new Event("gmp-select"), {
          placePrediction: {
            toPlace: () => ({
              id: "near-settings-place",
              location: { lat: () => 35.001, lng: () => 139 },
              fetchFields: async () => {},
            }),
          },
        }),
      );
    });
    const nearPlaceUnit = page
      .locator(".itinerary-unit")
      .filter({ has: page.locator(".entry-select").filter({ hasText: /^Test destination$/ }) })
      .last();
    await expect(nearPlaceUnit.getByLabel("Travel mode")).toHaveValue("WALKING");

    const settingsButton = page.getByRole("button", { name: "Trip settings" });
    await settingsButton.click();
    const settings = page.getByRole("dialog", { name: "Trip settings" });
    const languageSelects = settings.locator(".settings-language-row select");
    await expect(languageSelects.nth(0)).toHaveValue("en");
    await expect(languageSelects.nth(1)).toHaveValue("");
    await expect(settings.getByLabel("Distance units")).toHaveValue("metric");
    await expect(settings.getByLabel("Default transportation")).toHaveValue("DRIVING");
    const calendarStart = settings.getByLabel("Calendar day starts");
    await expect(calendarStart).toHaveValue("6");
    await expect(calendarStart.locator("option")).toHaveCount(24);
    await page.keyboard.press("Escape");
    await expect(settings).toHaveCount(0);
    await settingsButton.click();
    await page.locator(".dialog-backdrop").click({ position: { x: 4, y: 4 } });
    await expect(settings).toHaveCount(0);

    await settingsButton.click();
    await settings.getByLabel("Distance units").selectOption("imperial");
    let discardPrompt = "";
    page.once("dialog", (dialog) => {
      discardPrompt = dialog.message();
      void dialog.dismiss();
    });
    await page.keyboard.press("Escape");
    await expect(settings).toBeVisible();
    expect(discardPrompt).toBe("Discard unsaved trip settings?");
    await expect(settings.getByLabel("Distance units")).toHaveValue("imperial");

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator(".dialog-backdrop").click({ position: { x: 4, y: 4 } });
    await expect(settings).toHaveCount(0);
    await settingsButton.click();
    await expect(settings.getByLabel("Distance units")).toHaveValue("metric");
    await languageSelects.nth(0).selectOption("fr");
    await settings.getByLabel("Distance units").selectOption("imperial");
    await settings.getByLabel("Default transportation").selectOption("WALKING");
    await calendarStart.selectOption("7");
    await settings.getByRole("button", { name: "Save settings" }).click();

    await expect(page.locator(".day-heading h2").first()).toContainText("samedi 10 avril");
    await page.getByRole("button", { name: "Calendrier", exact: true }).click();
    const calendarHourLabels = page.locator("[data-calendar-time-gutter] time");
    await expect(calendarHourLabels.first()).toHaveText("07:00");
    await expect(calendarHourLabels.last()).toHaveText("31:00");
    await page.getByRole("button", { name: "Itinéraire", exact: true }).click();
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
      .filter({ has: page.locator(".entry-select").filter({ hasText: /^Test destination$/ }) })
      .last();
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
          tripLanguage: snapshot.tripLanguage,
          distanceUnit: snapshot.distanceUnit,
          defaultTravelMode: snapshot.defaultTravelMode,
          calendarStartHour: snapshot.calendarStartHour,
        };
      })
      .toEqual({
        tripLanguage: null,
        distanceUnit: "imperial",
        defaultTravelMode: "WALKING",
        calendarStartHour: 7,
      });
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("pacenotes-ui-language")))
      .toBe("fr");
    await page.reload();
    await page.getByRole("button", { name: "Paramètres du voyage" }).click();
    const savedSettings = page.getByRole("dialog", { name: "Paramètres du voyage" });
    const savedLanguageSelects = savedSettings.locator(".settings-language-row select");
    await expect(savedLanguageSelects.nth(0)).toHaveValue("fr");
    await expect(savedLanguageSelects.nth(1)).toHaveValue("");
    await expect(
      page.getByRole("dialog", { name: "Paramètres du voyage" }).getByLabel("Unités de distance"),
    ).toHaveValue("imperial");
    await expect(
      page.getByRole("dialog", { name: "Paramètres du voyage" }).getByLabel("Transport par défaut"),
    ).toHaveValue("WALKING");
    await expect(
      page
        .getByRole("dialog", { name: "Paramètres du voyage" })
        .getByLabel("Début du jour du calendrier"),
    ).toHaveValue("7");
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("trip language can override the local UI language", async ({ page }) => {
  const id = await createEmptyTrip();
  try {
    await page.addInitScript(() => {
      localStorage.setItem("pacenotes-display-name", "Language override editor");
      localStorage.setItem("pacenotes-ui-language", "ja");
    });
    await page.goto(`/trips/${id}`);
    await expect(page.getByRole("button", { name: "旅行設定" })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                __pacenotesPlaceLanguages?: string[];
              }
            ).__pacenotesPlaceLanguages?.at(-1) ?? "",
        ),
      )
      .toBe("ja");

    await page.getByRole("button", { name: "旅行設定" }).click();
    const settings = page.getByRole("dialog", { name: "旅行設定" });
    const languageSelects = settings.locator(".settings-language-row select");
    await expect(languageSelects).toHaveCount(2);
    await expect(languageSelects.nth(0)).toHaveValue("ja");
    await expect(languageSelects.nth(1)).toHaveValue("");
    const [uiBox, tripBox] = await Promise.all([
      languageSelects.nth(0).boundingBox(),
      languageSelects.nth(1).boundingBox(),
    ]);
    expect(uiBox?.y).toBe(tripBox?.y);
    await languageSelects.nth(1).selectOption("fr");
    await settings.locator('button[type="submit"]').click();

    await expect
      .poll(async () => {
        const [stored] = await db.select().from(documents).where(eq(documents.name, id));
        if (!stored) return null;
        const document = new Y.Doc();
        Y.applyUpdate(document, new Uint8Array(stored.data));
        const tripLanguage = readTripDocument(document).tripLanguage;
        document.destroy();
        return tripLanguage;
      })
      .toBe("fr");
    await expect(page.getByRole("button", { name: "旅行設定" })).toBeVisible();
    await page.getByRole("button", { name: "旅行設定" }).click();
    const savedLanguageSelects = page
      .getByRole("dialog", { name: "旅行設定" })
      .locator(".settings-language-row select");
    await expect(savedLanguageSelects.nth(0)).toHaveValue("ja");
    await expect(savedLanguageSelects.nth(1)).toHaveValue("fr");
    await savedLanguageSelects.nth(0).selectOption("de");
    await expect(savedLanguageSelects.nth(1)).toHaveValue("fr");
    await page.getByRole("dialog", { name: "旅行設定" }).locator('button[type="submit"]').click();
    await expect(page.getByRole("button", { name: "Reiseeinstellungen" })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("pacenotes-ui-language")))
      .toBe("de");
    await page.getByRole("button", { name: "Google Places durchsuchen" }).click();
    await expect(page.locator("gmp-place-autocomplete")).toHaveJSProperty(
      "requestedLanguage",
      "fr",
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                __pacenotesPlaceLanguages?: string[];
              }
            ).__pacenotesPlaceLanguages?.at(-1) ?? "",
        ),
      )
      .toBe("fr");
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
    await expect(leg).toContainText("25 min");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                __pacenotesDirectionsComputes?: number;
              }
            ).__pacenotesDirectionsComputes ?? 0,
        ),
      )
      .toBe(1);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const scope = globalThis as typeof globalThis & {
            __pacenotesRouteEndpoints?: Array<{
              originPlaceId: string | null;
              destinationPlaceId: string | null;
              travelMode: string;
            }>;
          };
          return scope.__pacenotesRouteEndpoints?.at(-1) ?? null;
        }),
      )
      .toEqual({
        originPlaceId: "route-mode-museum",
        destinationPlaceId: "route-mode-cafe",
        travelMode: "TRANSIT",
      });
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
    ).toHaveCount(2);
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
    await page.locator("gmp-place-autocomplete").focus();
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
    await dates.nth(2).click();
    await expect(panel).toHaveAttribute("aria-busy", "false");
    await expect(dates.nth(2)).toHaveAttribute("aria-current", "date");
    await expect(days.nth(2).locator(".day-heading")).toBeInViewport();
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});
