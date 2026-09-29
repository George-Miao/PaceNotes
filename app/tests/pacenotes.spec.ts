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

async function createEmptyTrip(
  items: TripItem[] = [],
  endDate = "2027-04-12",
  currency: string | null = null,
): Promise<string> {
  const id = crypto.randomUUID().replaceAll("-", "");
  const snapshot = createInitialSnapshot(id, {
    startDate: "2027-04-10",
    endDate,
    destination,
    timeZone: "Asia/Tokyo",
  });
  snapshot.currency = currency;
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

async function clickPlannerAction(page: Page, name: string) {
  const header = page.locator(".planner-header");
  const action = header.getByRole("button", { name, exact: true });
  if (await page.evaluate(() => matchMedia("(max-width: 72rem)").matches))
    await header.locator(".planner-header-more-trigger").click();
  await action.click();
}

async function joinTripAs(page: Page, name: string) {
  const join = page.getByRole("dialog", { name: "Who are you on this trip?" });
  await join.getByRole("textbox", { name: "New tripmate" }).fill(name);
  await join.getByRole("button", { name: "Create tripmate" }).click();
  await expect(join).toHaveCount(0);
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
      listeners = new Map<string, Set<(event?: MockMapEvent) => void>>();
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
            this.emit("click", { placeId: name.toLowerCase(), stop() {} });
          });
          canvas.append(button);
        }
        host.replaceChildren(canvas);
      }
      addListener(name: string, listener: (event?: MockMapEvent) => void) {
        let callbacks = this.listeners.get(name);
        if (!callbacks) {
          callbacks = new Set();
          this.listeners.set(name, callbacks);
        }
        callbacks.add(listener);
        return {
          remove: () => {
            callbacks.delete(listener);
            if (callbacks.size === 0) this.listeners.delete(name);
          },
        };
      }
      emit(name: string, event?: MockMapEvent) {
        for (const listener of this.listeners.get(name) ?? []) listener(event);
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
    class MockLatLng {
      constructor(
        private readonly latitude: number,
        private readonly longitude: number,
      ) {}
      lat() {
        return this.latitude;
      }
      lng() {
        return this.longitude;
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
    for (const method of ["getMap", "getProjection", "setMap"]) {
      const descriptor = Object.getOwnPropertyDescriptor(MockOverlayView.prototype, method);
      if (!descriptor) throw new Error(`Missing mock OverlayView method: ${method}`);
      Object.defineProperty(MockOverlayView.prototype, method, { ...descriptor, enumerable: true });
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
                  : [
                      { toJSON: () => routeCoordinates(origin) },
                      { toJSON: () => routeCoordinates(destination) },
                    ],
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
        Map: MockMap,
        LatLng: MockLatLng,
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

test("tripmate changes save only after an edit and the add dialog keeps its parent open", async ({
  page,
}) => {
  const id = await createEmptyTrip();
  try {
    await page.goto(`/trips/${id}`);
    const join = page.getByRole("dialog", { name: "Who are you on this trip?" });
    const joinName = join.getByRole("textbox", { name: "New tripmate" });
    const joinColor = join.getByRole("button", { name: "Tripmate color" });
    const joinColorBox = await joinColor.boundingBox();
    const joinNameBox = await joinName.boundingBox();
    expect(joinColorBox?.width).toBeLessThanOrEqual(24);
    expect(joinNameBox?.x).toBeGreaterThan(joinColorBox?.x ?? 0);
    await expect(join.locator('input[type="color"]')).toHaveCSS("opacity", "0");
    await joinName.fill("Alice");
    await join.getByRole("button", { name: "Create tripmate" }).click();
    await clickPlannerAction(page, "Tripmates");

    const manager = page.getByRole("dialog", { name: "Tripmates" });
    const save = manager.getByRole("button", { name: "Save", exact: true });
    const add = manager.getByRole("button", { name: "Add Tripmate" });
    const aliceInput = manager.getByRole("textbox", { name: "Name for tripmate Alice" });
    const colorButton = manager.getByRole("button", { name: "Color for tripmate Alice" });
    const colorInput = manager.locator('input[type="color"]').first();
    await expect(aliceInput).toHaveValue("Alice");
    await expect(colorInput).toHaveCSS("opacity", "0");
    await expect(colorButton).toHaveCSS("border-radius", "50%");
    const colorBox = await colorButton.boundingBox();
    const nameBox = await aliceInput.boundingBox();
    const dialogBox = await manager.boundingBox();
    expect(colorBox?.width).toBeLessThanOrEqual(24);
    expect(colorBox?.x).toBeGreaterThan((dialogBox?.x ?? 0) + 8);
    expect(nameBox?.x).toBeGreaterThan(colorBox?.x ?? 0);
    await colorInput.evaluate((input) => {
      input.showPicker = () => {
        input.dataset.pickerOpened = "true";
      };
    });
    await colorButton.click();
    await expect(colorInput).toHaveAttribute("data-picker-opened", "true");
    await expect(save).toBeDisabled();
    await aliceInput.fill("Alicia");
    await aliceInput.press("Escape");
    await expect(aliceInput).toHaveValue("Alice");
    await expect(save).toBeDisabled();
    await aliceInput.fill("Alicia");
    await aliceInput.press("Enter");
    await expect(aliceInput).toHaveValue("Alicia");
    await expect(save).toBeEnabled();
    await aliceInput.fill("Alice");
    await aliceInput.press("Enter");
    await expect(save).toBeDisabled();
    await aliceInput.fill("Alicia");
    await aliceInput.press("Enter");

    await add.click();
    const newTripmate = page.getByRole("dialog", { name: "New Tripmate" });
    await expect(newTripmate).toBeVisible();
    await expect(manager).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await newTripmate.getByRole("button", { name: "Cancel" }).click();
    await expect(newTripmate).toHaveCount(0);
    await expect(manager).toBeVisible();
    await expect(aliceInput).toHaveValue("Alicia");

    await add.click();
    await newTripmate.getByRole("button", { name: "Close dialog" }).click();
    await expect(manager).toBeVisible();
    await add.click();
    await newTripmate.press("Escape");
    await expect(newTripmate).toHaveCount(0);
    await expect(manager).toBeVisible();
    await add.click();
    const newName = newTripmate.getByRole("textbox", { name: "Name" });
    await expect(newName).toHaveAttribute("placeholder", "Name");
    await newName.fill("Alicia");
    await newTripmate.getByRole("button", { name: "Save" }).click();
    await expect(newTripmate.getByRole("alert")).toBeVisible();
    await newName.fill("Bob");
    await newTripmate.getByRole("button", { name: "Save" }).click();
    await expect(newTripmate).toHaveCount(0);
    await expect(manager).toBeVisible();
    await expect(manager.getByRole("textbox", { name: "Name for tripmate Bob" })).toHaveValue(
      "Bob",
    );
    await expect(aliceInput).toHaveValue("Alicia");
    await save.click();
    await expect(manager).toHaveCount(0);

    await clickPlannerAction(page, "Tripmates");
    await expect(page.getByRole("dialog", { name: "Tripmates" })).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Tripmates" }).getByRole("textbox", {
        name: "Name for tripmate Alicia",
      }),
    ).toHaveValue("Alicia");
    await expect(
      page.getByRole("dialog", { name: "Tripmates" }).getByRole("button", {
        name: "Save",
        exact: true,
      }),
    ).toBeDisabled();
    const reopened = page.getByRole("dialog", { name: "Tripmates" });
    await expect(reopened.locator("details")).toHaveCount(0);
    await reopened.getByRole("button", { name: "Archive Bob" }).click();
    const archived = reopened.locator("details");
    const archivedSummary = archived.locator("summary");
    await expect(archivedSummary).toHaveText("Archived User");
    await expect(archived).not.toHaveAttribute("open", "");
    await expect(reopened.getByRole("button", { name: "Restore Bob" })).toHaveCount(0);
    await expect(reopened.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    await archivedSummary.focus();
    await archivedSummary.press("Enter");
    await expect(reopened.getByRole("button", { name: "Restore Bob" })).toBeVisible();
    await reopened.getByRole("button", { name: "Restore Bob" }).click();
    await expect(archived).toHaveCount(0);
    await expect(reopened.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    const pendingName = reopened.getByRole("textbox", { name: "Name for tripmate Alicia" });
    await pendingName.fill("Temporary");
    await pendingName.press("Enter");
    await expect(reopened.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    await reopened.getByRole("button", { name: "Close dialog" }).click();
    await clickPlannerAction(page, "Tripmates");
    await expect(
      page.getByRole("dialog", { name: "Tripmates" }).getByRole("textbox", {
        name: "Name for tripmate Alicia",
      }),
    ).toHaveValue("Alicia");
    const persisted = page.getByRole("dialog", { name: "Tripmates" });
    await persisted.getByRole("button", { name: "Archive Bob" }).click();
    await persisted.getByRole("button", { name: "Save", exact: true }).click();
    await clickPlannerAction(page, "Tripmates");
    const folded = page.getByRole("dialog", { name: "Tripmates" }).locator("details");
    await expect(folded.locator("summary")).toHaveText("Archived User");
    await expect(folded).not.toHaveAttribute("open", "");
    await folded.locator("summary").click();
    await expect(folded.getByRole("button", { name: "Restore Bob" })).toBeVisible();
    await folded.getByRole("button", { name: "Restore Bob" }).click();
    await page
      .getByRole("dialog", { name: "Tripmates" })
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await clickPlannerAction(page, "Tripmates");
    await expect(
      page.getByRole("dialog", { name: "Tripmates" }).getByRole("button", {
        name: "Archive Bob",
      }),
    ).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Tripmates" }).locator("details")).toHaveCount(0);
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("expense participant lists archived tripmates under a muted group", async ({ page }) => {
  const id = await createEmptyTrip();
  try {
    await page.goto(`/trips/${id}`);
    const join = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await join.getByRole("textbox", { name: "New tripmate" }).fill("Alice");
    await join.getByRole("button", { name: "Create tripmate" }).click();
    await clickPlannerAction(page, "Tripmates");
    const manager = page.getByRole("dialog", { name: "Tripmates" });
    await manager.getByRole("button", { name: "Add Tripmate" }).click();
    const newTripmate = page.getByRole("dialog", { name: "New Tripmate" });
    await newTripmate.getByRole("textbox", { name: "Name" }).fill("Bob");
    await newTripmate.getByRole("button", { name: "Save" }).click();
    await manager.getByRole("button", { name: "Archive Bob" }).click();
    await manager.getByRole("button", { name: "Save", exact: true }).click();

    await page.goto(`/trips/${id}?view=expenses`);
    const participant = page.getByRole("combobox", { name: "Participant: Everyone" });
    await participant.click();
    const list = page.getByRole("listbox", { name: "Participant" });
    await expect(list.getByRole("option")).toHaveText(["Everyone", "Alice", "Bob"]);
    await expect(list.locator("div", { hasText: /^Archived$/ })).toHaveCount(1);
    const active = list.getByRole("option", { name: "Alice" });
    const archived = list.getByRole("option", { name: "Bob (archived)" });
    await expect(archived).toHaveText("Bob");
    const activeColor = await active.evaluate((node) => getComputedStyle(node).color);
    await expect(archived).not.toHaveCSS("color", activeColor);
    await archived.click();
    const selected = page.getByRole("combobox", { name: "Participant: Bob (archived)" });
    await expect(selected).toHaveText("Bob");
    await expect(selected.getByText("Bob")).not.toHaveCSS("color", activeColor);
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("expense sort and involving-me controls have room to fit", async ({ page }, testInfo) => {
  const id = await createEmptyTrip();
  try {
    await page.goto(`/trips/${id}?view=expenses`);
    const join = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await join.getByRole("textbox", { name: "New tripmate" }).fill("Alice");
    await join.getByRole("button", { name: "Create tripmate" }).click();
    if (testInfo.project.name === "chromium") {
      await page.setViewportSize({ width: 1920, height: 900 });
    }

    const directionBox = await page.getByRole("button", { name: "High to low" }).boundingBox();
    const checkboxBox = await page.getByRole("checkbox", { name: "Involving me" }).boundingBox();
    expect(directionBox).not.toBeNull();
    expect(checkboxBox).not.toBeNull();
    if (directionBox && checkboxBox) {
      if (testInfo.project.name === "chromium") {
        expect(checkboxBox.y).toBeLessThan(directionBox.y + directionBox.height);
        expect(checkboxBox.x - (directionBox.x + directionBox.width)).toBeGreaterThanOrEqual(12);
      } else {
        expect(checkboxBox.y).toBeGreaterThanOrEqual(directionBox.y + directionBox.height);
      }
    }
    const amountFits = await page
      .getByRole("combobox", { name: "Sort expenses: Amount" })
      .getByText("Amount")
      .evaluate((element) => element.scrollWidth <= element.clientWidth);
    expect(amountFits).toBe(true);
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("expense sort direction describes the selected order", async ({ page }) => {
  const id = await createEmptyTrip();
  try {
    await page.goto(`/trips/${id}?view=expenses`);
    await page
      .getByRole("dialog", { name: "Who are you on this trip?" })
      .getByRole("button", { name: "Later" })
      .click();
    await expect(page.getByRole("heading", { name: "Expenses", exact: true })).toHaveCount(1);
    const participantLabel = await page.getByText("Participant", { exact: true }).boundingBox();
    const sortLabel = await page.getByText("Sort", { exact: true }).boundingBox();
    const participant = await page
      .getByRole("combobox", { name: "Participant: Everyone" })
      .boundingBox();
    const sort = await page.getByRole("combobox", { name: "Sort expenses: Amount" }).boundingBox();
    expect(participantLabel).not.toBeNull();
    expect(sortLabel).not.toBeNull();
    expect(participant).not.toBeNull();
    expect(sort).not.toBeNull();
    expect(sort?.height).toBe(participant?.height);
    if (await page.evaluate(() => matchMedia("(max-width: 600px)").matches)) {
      expect(sortLabel?.y).toBeGreaterThan(participantLabel?.y ?? 0);
    } else {
      expect(sortLabel?.y).toBe(participantLabel?.y);
      expect(sortLabel?.x).toBeGreaterThan(participantLabel?.x ?? 0);
    }

    const highToLow = page.getByRole("button", { name: "High to low" });
    await expect(highToLow).toHaveAttribute("title", "High to low");
    await highToLow.click();
    const lowToHigh = page.getByRole("button", { name: "Low to high" });
    await expect(lowToHigh).toHaveAttribute("title", "Low to high");

    await page.getByRole("combobox", { name: "Sort expenses: Amount" }).click();
    await page.getByRole("option", { name: "Date" }).click();
    const earlyToLate = page.getByRole("button", { name: "Early to late" });
    await expect(earlyToLate).toHaveAttribute("title", "Early to late");
    await earlyToLate.click();
    const lateToEarly = page.getByRole("button", { name: "Late to early" });
    await expect(lateToEarly).toHaveAttribute("title", "Late to early");

    await page.getByRole("combobox", { name: "Sort expenses: Date" }).click();
    await page.getByRole("option", { name: "Amount" }).click();
    await expect(page.getByRole("button", { name: "High to low" })).toHaveAttribute(
      "title",
      "High to low",
    );
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("expense export menu downloads CSV", async ({ page }) => {
  const id = await createEmptyTrip([], "2027-04-12", "USD");
  try {
    await page.goto(`/trips/${id}?view=expenses`);
    await page
      .getByRole("dialog", { name: "Who are you on this trip?" })
      .getByRole("button", { name: "Later" })
      .click();

    const settle = page.getByRole("button", { name: "Settle up" });
    const exportButton = page.getByRole("button", { name: "Export", exact: true });
    await expect(exportButton).toHaveAttribute("title", "Export");
    const settleBox = await settle.boundingBox();
    const exportBox = await exportButton.boundingBox();
    expect(settleBox).not.toBeNull();
    expect(exportBox).not.toBeNull();
    expect(exportBox?.x).toBeGreaterThan(settleBox?.x ?? 0);

    const formats = page.getByRole("menu", { name: "Export format" });
    await exportButton.click();
    await expect(exportButton).toHaveAttribute("aria-expanded", "true");
    await expect(exportButton).toHaveAttribute("aria-haspopup", "menu");
    const csv = formats.getByRole("menuitem", { name: "CSV" });
    await expect(csv).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(formats).toHaveCount(0);
    await expect(exportButton).toBeFocused();

    await exportButton.click();
    const downloadPromise = page.waitForEvent("download");
    await formats.getByRole("menuitem", { name: "CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("trip-expenses.csv");
    await expect(formats).toHaveCount(0);
    await expect(exportButton).toBeFocused();
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("guest can plan without a tripmate and choose one later", async ({ page }) => {
  const id = await createEmptyTrip();
  try {
    await page.goto(`/trips/${id}`);
    const join = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await expect(join.getByRole("button", { name: "Later" })).toBeVisible();
    await join.getByRole("button", { name: "Later" }).click();
    const guest = page.getByRole("button", { name: "Guest", exact: true });
    await expect(guest).toBeVisible();
    await expect(guest.locator("svg")).toBeVisible();
    await expect(join).toHaveCount(0);

    const title = page.getByLabel("Trip title", { exact: true });
    await title.fill("Guest plan");
    await title.press("Enter");
    await expect(title).toHaveValue("Guest plan");
    await page.reload();
    await expect(guest).toBeVisible();
    await expect(join).toHaveCount(0);

    await guest.click();
    await expect(join).toBeVisible();
    await join.getByRole("textbox", { name: "New tripmate" }).fill("Alice");
    await join.getByRole("button", { name: "Create tripmate" }).click();
    await expect(guest).toHaveCount(0);
    await page.reload();
    await expect(join).toHaveCount(0);
    await clickPlannerAction(page, "Tripmates");
    await expect(
      page.getByRole("dialog", { name: "Tripmates" }).getByRole("combobox", {
        name: "Your Tripmate identity: Alice",
      }),
    ).toBeVisible();
    const manager = page.getByRole("dialog", { name: "Tripmates" });
    await manager.getByRole("combobox", { name: "Your Tripmate identity: Alice" }).click();
    await manager.getByRole("option", { name: "Guest" }).click();
    await expect(
      manager.getByRole("combobox", { name: "Your Tripmate identity: Guest" }),
    ).toBeVisible();
    await manager.getByRole("button", { name: "Save", exact: true }).click();
    await expect(manager).toHaveCount(0);
    await expect(guest).toBeVisible();
    await page.reload();
    await expect(join).toHaveCount(0);
    await expect(guest).toBeVisible();
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("tripmate join dialog dismisses on Escape and outside click", async ({ page }) => {
  const id = await createEmptyTrip();
  try {
    await page.goto(`/trips/${id}`);
    const join = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await join.getByRole("textbox", { name: "New tripmate" }).fill("Not saved");
    await page.keyboard.press("Escape");
    await expect(join).toHaveCount(0);

    const guest = page.getByRole("button", { name: "Guest", exact: true });
    await guest.click();
    await expect(join.getByRole("textbox", { name: "New tripmate" })).toHaveValue("");
    await join.getByRole("heading", { name: "Who are you on this trip?" }).click();
    await expect(join).toBeVisible();
    await page.mouse.click(2, 2);
    await expect(join).toHaveCount(0);
    await expect(guest).toBeVisible();
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("icon buttons show their accessible labels on hover", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Touch screens do not have hover");
  await page.goto(`/trips/${tripId}`);
  const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
  await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("Tooltip tester");
  await tripmate.getByRole("button", { name: "Create tripmate" }).click();
  await expect(tripmate).toHaveCount(0);
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
    const join = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await join.getByRole("textbox", { name: "New tripmate" }).fill("Creating editor");
    await join.getByRole("button", { name: "Create tripmate" }).click();
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
    await page.goto(`/trips/${id}`);
    await joinTripAs(page, "Map number editor");

    await expect(page.getByRole("button", { name: "Stop 1: First day place" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop 1: Later day place" })).toBeVisible();
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});
test("map search stays on the map and the itinerary starts below the date tabs", async ({
  page,
}) => {
  const id = await createEmptyTrip();
  try {
    await page.goto(`/trips/${id}#2027-04-10`);
    const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("Toolbar search editor");
    await tripmate.getByRole("button", { name: "Create tripmate" }).click();
    await expect(tripmate).toHaveCount(0);

    const itinerary = page.locator(".planner-header .content-tabs").getByRole("button", {
      name: "Itinerary",
      exact: true,
    });
    const mapPanel = page.locator(".map-panel");
    const search = mapPanel.getByRole("button", { name: "Search Google Places" });
    await expect(itinerary).toHaveAttribute("aria-pressed", "true");
    await itinerary.click();
    await expect(page.locator(".planner-body")).toHaveClass(/view-map/);
    await expect(page.locator(".planner-header .view-tabs button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await itinerary.click();
    await expect(page.locator(".planner-body")).toHaveClass(/view-split/);
    await expect(itinerary).toHaveAttribute("aria-pressed", "true");
    const layout = await page.evaluate(() => {
      const dates = document.querySelector(".planner-tabs");
      const body = document.querySelector(".planner-body");
      const panel = document.querySelector(".planner-panel");
      const scroll = panel?.querySelector(".planner-scroll");
      const map = document.querySelector(".map-panel");
      const button = map?.querySelector(".planner-search-button");
      if (!dates || !body || !panel || !scroll || !map || !button)
        throw new Error("Missing planner layout");
      const mapBox = map.getBoundingClientRect();
      const buttonBox = button.getBoundingClientRect();
      return {
        dateGap: body.getBoundingClientRect().top - dates.getBoundingClientRect().bottom,
        desktopPanelGap: panel.getBoundingClientRect().top - body.getBoundingClientRect().top,
        mobile: matchMedia("(max-width: 48rem)").matches,
        panelGap: scroll.getBoundingClientRect().top - panel.getBoundingClientRect().top,
        mapRightGap: mapBox.right - buttonBox.right,
        mapTopGap: buttonBox.top - mapBox.top,
      };
    });
    expect(Math.abs(layout.dateGap)).toBeLessThan(1);
    if (!layout.mobile) expect(Math.abs(layout.desktopPanelGap)).toBeLessThan(1);
    expect(Math.abs(layout.panelGap)).toBeLessThanOrEqual(1);
    expect(layout.mapRightGap).toBeGreaterThanOrEqual(0);
    expect(layout.mapRightGap).toBeLessThanOrEqual(16);
    expect(layout.mapTopGap).toBeGreaterThanOrEqual(0);
    expect(layout.mapTopGap).toBeLessThanOrEqual(16);
    await search.click();
    await expect(mapPanel.locator(".map-global-search .place-search")).toBeVisible();
    await expect(page.locator("[data-day-id] .place-search")).toHaveCount(0);
    await expect(page.locator("gmp-place-autocomplete")).toHaveAttribute(
      "aria-label",
      "Search Google Places",
    );
    await expect(itinerary).toHaveAttribute("aria-pressed", "true");
    await search.click();
    await page.getByRole("button", { name: "Hide itinerary", exact: true }).click();
    await search.click();
    await expect(page.locator(".planner-body")).toHaveClass(/view-map/);
    await expect(mapPanel.locator(".map-global-search .place-search")).toBeVisible();
    await expect(page.locator(".planner-header .view-tabs button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator(".planner-header .view-tabs button")).toBeDisabled();
    await search.click();
    await itinerary.click();
    await expect(page.locator(".planner-body")).toHaveClass(/view-split/);
    await expect(itinerary).toHaveAttribute("aria-pressed", "true");
  } finally {
    try {
      await page.goto("/");
    } finally {
      await db.delete(trips).where(eq(trips.id, id));
    }
  }
});

test("an unplanned map place opens its details from expenses", async ({ page }) => {
  const id = await createEmptyTrip([], "2027-04-12", "USD");
  try {
    await page.goto(`/trips/${id}?view=expenses`);
    await joinTripAs(page, "Map expense editor");
    await expect(page.getByRole("heading", { name: "Expenses", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Map location: Museum", exact: true }).click();
    const details = page.getByRole("dialog", { name: "Place details" });
    await expect(details.getByRole("heading", { name: "City Museum" })).toBeVisible();
    await expect(details.getByRole("button", { name: "Add to trip" })).toBeVisible();
  } finally {
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
    await page.goto(`/trips/${id}`);
    await joinTripAs(page, "Map editor");
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
    const museumTravelMode = museumDay.getByRole("combobox", { name: /^Travel mode:/ }).last();
    await expect(museumTravelMode).toHaveAccessibleName("Travel mode: Walk");
    await museumTravelMode.click();
    await page
      .getByRole("listbox", { name: "Travel mode" })
      .getByRole("option", { name: "Car" })
      .click();
    await expect(museumTravelMode).toHaveAccessibleName("Travel mode: Car");
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
    await page.goto(`/trips/${id}`);
    await joinTripAs(page, "Map focus regression");
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
    await page.goto(`/trips/${id}`);
    await joinTripAs(page, "Walking route regression");
    await page.getByRole("button", { name: "Map location: Museum", exact: true }).click();
    const details = page.getByRole("dialog", { name: "Place details", exact: true });
    await details.getByRole("button", { name: "Add to trip" }).click();

    await expect.poll(lodgingTravelMode).toBe("WALKING");
    await expect(
      page
        .locator('[data-day-id="2027-04-10"]')
        .getByRole("combobox", { name: "Travel mode: Walk" }),
    ).toBeVisible();
  } finally {
    if (!page.isClosed()) await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("lodging entries use a select cursor rather than a drag cursor", async ({ page }) => {
  const lodging = itemForCreate("lodging", "2027-04-10", {
    id: "cursor-lodging",
    title: "Lodging",
    place: { placeId: "museum-anchor" },
    lodging: {
      startDate: "2027-04-10",
      endDate: "2027-04-11",
      confirmation: "",
      leaveTimes: { "2027-04-11": "09:00" },
    },
  });
  const id = await createEmptyTrip([lodging], "2027-04-11");
  try {
    await page.goto(`/trips/${id}`);
    const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("Cursor editor");
    await tripmate.getByRole("button", { name: "Create tripmate" }).click();
    await expect(tripmate).toHaveCount(0);
    for (const day of ["2027-04-10", "2027-04-11"]) {
      await expect(
        page.locator(`[data-day-id="${day}"] .lodging-boundary .entry-select`),
      ).toHaveCSS("cursor", "pointer");
    }
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

    await page.goto(`/trips/${id}`);
    await joinTripAs(page, "Map editor");
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

test("navbar centers view controls and keeps each view mode available", async ({ page }) => {
  const id = await createEmptyTrip();
  try {
    await page.goto(`/trips/${id}`);
    const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("View editor");
    await tripmate.getByRole("button", { name: "Create tripmate" }).click();
    await expect(tripmate).toHaveCount(0);
    const controls = page.getByRole("group", { name: "Planner view" });
    const map = controls.getByRole("button", { name: "Map", exact: true });
    const itinerary = page.getByRole("region", { name: "Itinerary", exact: true });
    const mapPanel = page.locator(".map-panel");
    await expect(controls.getByRole("button")).toHaveCount(1);
    await expect
      .poll(() =>
        page.locator(".planner-header").evaluate((header) => {
          const group = header.querySelector(".planner-view-tools");
          if (!group) return Number.POSITIVE_INFINITY;
          const headerBox = header.getBoundingClientRect();
          const groupBox = group.getBoundingClientRect();
          return Math.abs((groupBox.left + groupBox.right - headerBox.left - headerBox.right) / 2);
        }),
      )
      .toBeLessThan(1);
    await expect(map).toHaveAttribute("aria-pressed", "true");
    await map.click();
    await expect(mapPanel).toBeHidden();
    await expect(itinerary).toBeVisible();
    await expect(map).toHaveAttribute("aria-pressed", "false");

    await map.focus();
    await map.press("Enter");
    await expect(mapPanel).toBeVisible();
    await expect(itinerary).toBeVisible();
    await expect(map).toHaveAttribute("aria-pressed", "true");
    await expect(map).toBeEnabled();

    const hideItinerary = page.getByRole("button", { name: "Hide itinerary", exact: true });
    await expect(hideItinerary).toHaveAttribute("aria-expanded", "true");
    await hideItinerary.click();
    await expect(itinerary).toBeHidden();
    await expect(map).toHaveAttribute("aria-pressed", "true");
    await expect(map).toBeDisabled();
    const calendar = page.locator(".planner-header .content-tabs").getByRole("button", {
      name: "Calendar",
      exact: true,
    });
    await calendar.click();
    await expect(calendar).toHaveAttribute("aria-pressed", "true");
    await expect(itinerary).toBeVisible();
    await expect(mapPanel).toBeVisible();
  } finally {
    try {
      await page.goto("/");
    } finally {
      await db.delete(trips).where(eq(trips.id, id));
    }
  }
});

test("planner header keeps controls compact with larger text", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop header layout");
  const id = await createEmptyTrip();
  try {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto(`/trips/${id}`);
    const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("Header editor");
    await tripmate.getByRole("button", { name: "Create tripmate" }).click();
    await expect(tripmate).toHaveCount(0);
    for (const fontSize of [20, 24]) {
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = `${size}px`;
      }, fontSize);
      const layout = await page.locator(".planner-header").evaluate((header, size) => {
        const bounds = (selector: string) => {
          const element = header.querySelector(selector);
          if (!element) throw new Error(`Missing header control: ${selector}`);
          return element.getBoundingClientRect();
        };
        const tools = bounds(".planner-view-tools");
        const actions = bounds(".planner-header-actions");
        const status = bounds(".sync-state");
        const dot = bounds(".sync-state i");
        const share = bounds(".planner-header-actions .secondary-button");
        const selected = bounds('.planner-view-tools [aria-pressed="true"]');
        return {
          shareOnFirstRow: share.top - actions.top <= 8,
          tabsAreCompact: selected.height <= size * 2.4,
          controlsDoNotOverlap: tools.right <= status.left,
          statusDotCentered: Math.abs(dot.top + dot.bottom - status.top - status.bottom) <= 2,
        };
      }, fontSize);
      expect(layout).toEqual({
        shareOnFirstRow: true,
        tabsAreCompact: true,
        controlsDoNotOverlap: true,
        statusDotCentered: true,
      });
    }
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("narrow planner controls keep titles and actions readable", async ({ page }) => {
  const id = await createEmptyTrip();
  try {
    await page.goto(`/trips/${id}`);
    const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("Mobile editor");
    await tripmate.getByRole("button", { name: "Create tripmate" }).click();
    await expect(tripmate).toHaveCount(0);

    for (const width of [490, 390, 320]) {
      await page.setViewportSize({ width, height: 720 });
      const layout = await page.locator(".planner-header").evaluate((header) => {
        const title = header.querySelector(".planner-header-title");
        const actions = header.querySelector(".planner-header-actions");
        if (!title || !actions) throw new Error("Missing header controls");
        return {
          height: header.getBoundingClientRect().height,
          rowDifference: Math.abs(
            title.getBoundingClientRect().top - actions.getBoundingClientRect().top,
          ),
        };
      });
      expect(layout.height).toBeLessThanOrEqual(100);
      expect(layout.rowDifference).toBeLessThanOrEqual(12);
      const navigation = await page.locator(".planner-header").evaluate((header) => {
        const group = header.querySelector(".planner-view-tools");
        const buttons = [...(group?.querySelectorAll("button") ?? [])];
        if (!group || buttons.length !== 4) throw new Error("Missing planner view tabs");
        const headerBox = header.getBoundingClientRect();
        const groupBox = group.getBoundingClientRect();
        const padding = getComputedStyle(header);
        const left = headerBox.left + Number.parseFloat(padding.paddingLeft);
        const right = headerBox.right - Number.parseFloat(padding.paddingRight);
        const first = buttons[0]?.getBoundingClientRect();
        const last = buttons.at(-1)?.getBoundingClientRect();
        return {
          fillsRow:
            Math.abs(groupBox.left - left) <= 1 &&
            Math.abs(groupBox.right - right) <= 1 &&
            first !== undefined &&
            last !== undefined &&
            Math.abs(first.left - left) <= 1 &&
            Math.abs(last.right - right) <= 1,
          labelsVisible: buttons.every(
            (button) =>
              Number.parseFloat(getComputedStyle(button).fontSize) > 0 &&
              button.textContent?.trim() !== "" &&
              button.scrollWidth <= button.clientWidth + 1,
          ),
        };
      });
      expect(navigation).toEqual({ fillsRow: true, labelsVisible: true });
      const dayLayout = await page
        .locator(".day-heading")
        .first()
        .evaluate((heading) => {
          const title = heading.querySelector("h2");
          const actions = heading.querySelector(".day-actions");
          if (!title || !actions) throw new Error("Missing day controls");
          const bounds = heading.getBoundingClientRect();
          return {
            titleHeight: title.getBoundingClientRect().height,
            actionsInside: [...actions.children].every((action) => {
              const rect = action.getBoundingClientRect();
              return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
            }),
          };
        });
      expect(dayLayout.titleHeight).toBeLessThanOrEqual(44);
      expect(dayLayout.actionsInside).toBe(true);
    }

    const more = page.getByRole("button", { name: "More actions" });
    await expect(more).toBeVisible();
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(more).toBeFocused();
    await more.click();
    for (const name of ["Undo", "Redo", "Tripmates", "Trip settings", "Delete trip"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "Trip settings" }).click();
    await expect(page.getByRole("dialog", { name: "Trip settings" })).toBeVisible();
    await expect(more).toHaveAttribute("aria-expanded", "false");
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("planner keeps tabs in the header when right actions collapse", async ({ page }) => {
  const id = await createEmptyTrip();
  try {
    await page.goto(`/trips/${id}`);
    await joinTripAs(page, "Header editor");
    const header = page.locator(".planner-header");
    const more = header.getByRole("button", { name: "More actions" });
    for (const width of [1280, 1100, 900, 800]) {
      await page.setViewportSize({ width, height: 800 });
      const layout = await header.evaluate((element) => {
        const title = element.querySelector(".planner-header-title")?.getBoundingClientRect();
        const tabs = element.querySelector(".planner-view-tools")?.getBoundingClientRect();
        const actions = element.querySelector(".planner-header-actions")?.getBoundingClientRect();
        if (!title || !tabs || !actions) throw new Error("Missing planner header controls");
        const bounds = element.getBoundingClientRect();
        return {
          titleRight: title.right,
          titleCenter: title.top + title.height / 2,
          tabsLeft: tabs.left,
          tabsRight: tabs.right,
          tabsCenter: tabs.top + tabs.height / 2,
          tabsMidpoint: (tabs.left + tabs.right) / 2,
          actionsLeft: actions.left,
          actionsRight: actions.right,
          actionsCenter: actions.top + actions.height / 2,
          headerMidpoint: (bounds.left + bounds.right) / 2,
          headerRight: bounds.right,
        };
      });
      expect(Math.abs(layout.titleCenter - layout.tabsCenter)).toBeLessThan(3);
      expect(Math.abs(layout.tabsCenter - layout.actionsCenter)).toBeLessThan(3);
      expect(Math.abs(layout.tabsMidpoint - layout.headerMidpoint)).toBeLessThan(1);
      expect(layout.titleRight).toBeLessThanOrEqual(layout.tabsLeft + 1);
      expect(layout.tabsRight).toBeLessThanOrEqual(layout.actionsLeft + 1);
      expect(layout.actionsRight).toBeLessThanOrEqual(layout.headerRight + 1);
      if (width <= 1152) {
        await expect(more).toBeVisible();
        await more.click();
        await expect(header.getByRole("button", { name: "Trip settings" })).toBeVisible();
        await page.keyboard.press("Escape");
      } else {
        await expect(more).toBeHidden();
      }
    }
    for (const width of [490, 390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(more).toBeVisible();
      const layout = await header.evaluate((element) => {
        const tabs = element.querySelector(".planner-view-tools")?.getBoundingClientRect();
        const title = element.querySelector(".planner-header-title")?.getBoundingClientRect();
        if (!tabs || !title) throw new Error("Missing planner tabs");
        return {
          tabsTop: tabs.top,
          titleBottom: title.bottom,
          tabsBottom: tabs.bottom,
          headerBottom: element.getBoundingClientRect().bottom,
        };
      });
      expect(layout.tabsTop).toBeGreaterThanOrEqual(layout.titleBottom);
      expect(layout.tabsBottom).toBeLessThanOrEqual(layout.headerBottom + 1);
      for (const name of ["Itinerary", "Calendar", "Expenses", "Map"])
        await expect(header.getByRole("button", { name, exact: true })).toBeVisible();
    }
  } finally {
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
    await page.goto(`/trips/${id}?view=calendar#${dayId}`);
    await joinTripAs(page, "Calendar order editor");
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
    await page.goto(`/trips/${id}?view=calendar#${dayId}`);
    await joinTripAs(page, "Calendar drag editor");
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
    await page.goto(`/trips/${id}?view=calendar#${firstDay}`);
    await joinTripAs(page, "Map viewport editor");
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
            emit: (name: string) => void;
            setCenter: (center: { lat: number; lng: number }) => void;
            setZoom: (zoom: number) => void;
          };
        }
      ).__pacenotesMap;
      if (!map) throw new Error("Map is not ready");
      map.setCenter({ lat: 44.123, lng: -71.456 });
      map.setZoom(9);
      map.emit("idle");
    });
    await expect
      .poll(() =>
        page.evaluate(
          (tripId) =>
            JSON.parse(localStorage.getItem(`pacenotes-map-viewport-${tripId}`) ?? "null"),
          id,
        ),
      )
      .toEqual({ latitude: 44.123, longitude: -71.456, zoom: 9 });
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
    await page.goto(`/trips/${id}`);
    await joinTripAs(page, "Day route map editor");
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
    await page.goto(`/trips/${id}?view=calendar#${secondDay}`);
    await joinTripAs(page, "Calendar reload editor");
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
    await page.goto(`/trips/${id}?view=calendar#${dayId}`);
    await joinTripAs(page, "Calendar menu editor");
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
    await page.goto(`/trips/${id}?view=calendar#2027-04-11`);
    await joinTripAs(page, "Calendar conflict editor");
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
    await page.goto(`/trips/${id}?view=calendar#${dayId}`);
    const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("Duration-only editor");
    await tripmate.getByRole("button", { name: "Create tripmate" }).click();
    await expect(tripmate).toHaveCount(0);
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
    await expect(calendar.locator("[data-calendar-drop-preview] time")).toContainText(
      "08:00 - 09:45 (1 hr 45 min)",
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
    await expect(calendar.locator("[data-calendar-drop-preview] time")).toContainText(
      "08:15 - 09:45 (1 hr 30 min)",
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
    await page.goto(`/trips/${id}`);
    await joinTripAs(page, "Duration editor");
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
    await page.goto(`/trips/${id}?view=calendar`);
    await joinTripAs(page, "Calendar edge editor");
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
    await page.goto(`/trips/${id}?view=calendar#${dayId}`);
    const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("Calendar editor");
    await tripmate.getByRole("button", { name: "Create tripmate" }).click();
    await expect(tripmate).toHaveCount(0);
    const controls = page
      .locator(".planner-header")
      .getByRole("group", { name: "Itinerary / Calendar / Expenses" });
    const calendarButton = controls.getByRole("button", { name: "Calendar", exact: true });
    const itineraryButton = controls.getByRole("button", { name: "Itinerary", exact: true });
    const calendar = page.getByRole("region", { name: "Trip calendar" });
    await expect(calendarButton).toHaveAttribute("aria-pressed", "true");
    await expect(calendar).toBeVisible();
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
    await calendarScroller.evaluate((element) => {
      element.scrollTop = 300;
      element.scrollLeft = 0;
    });
    await plannerPanel.evaluate((element) => {
      element.scrollTop = 300;
    });
    const panelScrollTop = await plannerPanel.evaluate((element) => element.scrollTop);
    const panelBox = await plannerPanel.boundingBox();
    const scrollerBox = await calendarScroller.boundingBox();
    const headerBox = await firstDayHeader.boundingBox();
    const allDayLabelBox = await allDayLabel.boundingBox();
    if (!scrollerBox || !panelBox || !headerBox || !allDayLabelBox) {
      throw new Error("Missing sticky calendar header geometry");
    }
    expect(panelScrollTop).toBe(0);
    expect(scrollerBox.y).toBeCloseTo(panelBox.y, 0);
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
    await page.goto(`/trips/${id}?view=calendar#${secondDay}`);
    await joinTripAs(page, "Calendar conflict editor");
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
    await page.goto(`/trips/${id}?view=calendar#2027-04-10`);
    await joinTripAs(page, "Route layout editor");
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
    await page.goto(`/trips/${id}`);
    const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("Drawer editor");
    await tripmate.getByRole("button", { name: "Create tripmate" }).click();
    await expect(tripmate).toHaveCount(0);
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
    await expect(controls.getByRole("button")).toHaveCount(1);
    await expect(controls.getByRole("button", { name: "Map", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
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
    await page.goto(`/trips/${id}`);
    const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("Mobile sheet editor");
    await tripmate.getByRole("button", { name: "Create tripmate" }).click();
    await expect(tripmate).toHaveCount(0);
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
    await handle.focus();
    await handle.press("Enter");
    await expect(panel).toBeHidden();
  } finally {
    await page.goto("/");
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("selected places and item edits save automatically", async ({ page }) => {
  const id = await createEmptyTrip();
  try {
    await page.goto(`/trips/${id}`);
    const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("Place editor");
    await tripmate.getByRole("button", { name: "Create tripmate" }).click();
    await expect(tripmate).toHaveCount(0);
    await addDayItem(page, "place");
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
    await clickPlannerAction(page, "Undo");
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
    await page.goto(`/trips/${id}`);
    await joinTripAs(page, "Day editor");
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
    await page.goto(`/trips/${id}`);
    await joinTripAs(page, "Warning editor");

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
    await page.goto(`/trips/${id}`);
    await joinTripAs(page, "Placement editor");
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

test("first trip open asks for a tripmate", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "The collaboration project covers editor identity",
  );
  await page.goto(`/trips/${tripId}`);
  const dialog = page.getByRole("dialog", { name: "Who are you on this trip?" });
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

  await dialog.getByRole("textbox", { name: "New tripmate" }).fill("Tokyo editor");
  await dialog.getByRole("button", { name: "Create tripmate" }).click();
  await expect(dialog).toHaveCount(0);
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
  await clickPlannerAction(page, "Tripmates");
  await expect(
    page
      .getByRole("dialog", { name: "Tripmates" })
      .getByRole("combobox", { name: "Your Tripmate identity: Tokyo editor" }),
  ).toBeVisible();
});

test("item editors expand inline after their entries", async ({ page }) => {
  const id = await createEmptyTrip();
  try {
    await page.goto(`/trips/${id}`);
    await joinTripAs(page, "Inline editor");
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
  const id = await createEmptyTrip([
    itemForCreate("note", "2027-04-10", { title: "First stop" }),
    itemForCreate("note", "2027-04-10", { title: "Second stop" }),
  ]);
  try {
    await page.goto(`/trips/${id}`);
    const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("Drag editor");
    await tripmate.getByRole("button", { name: "Create tripmate" }).click();
    await expect(tripmate).toHaveCount(0);
    const entries = page.locator(".day-section").first().locator(".itinerary-entry");
    await expect(entries).toHaveCount(2);

    const handleBox = await entries.nth(0).boundingBox();
    const targetBox = await entries.nth(1).boundingBox();
    if (!handleBox || !targetBox) throw new Error("Missing drag geometry");
    const list = page.locator(".day-section").first().locator(".itinerary-list");
    const nextBoxBefore = await entries.nth(1).boundingBox();
    if (!nextBoxBefore) throw new Error("Missing next entry geometry");
    await page.mouse.move(handleBox.x + 8, handleBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 9, handleBox.y + 8);
    await expect(page.locator(".itinerary-entry.is-dragging")).toHaveCount(0);
    await page.mouse.move(handleBox.x + 10, handleBox.y + 8);
    await expect(page.locator(".itinerary-entry.is-dragging")).toHaveCount(1);
    await expect(list.locator(".itinerary-entry")).toHaveCount(2);
    await expect(list).toHaveAttribute("data-drop-preview", "");
    const originalPreviewTop = await list.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.top + Number.parseFloat(getComputedStyle(element, "::after").top);
    });
    expect(originalPreviewTop).toBeCloseTo(handleBox.y, 0);
    await page.mouse.move(handleBox.x + handleBox.width + 400, handleBox.y + 150, { steps: 8 });
    await expect(list).toHaveAttribute("data-drop-preview", "");
    const sourceOverlap = await list.evaluate((element) => {
      const other = element.querySelector<HTMLElement>(".itinerary-entry:not(.is-dragging)");
      if (!other) throw new Error("Missing entry beside the source target");
      const listBox = element.getBoundingClientRect();
      const style = getComputedStyle(element, "::after");
      const top = listBox.top + Number.parseFloat(style.top);
      const bottom = top + Number.parseFloat(style.height);
      const box = other.getBoundingClientRect();
      return Math.max(0, Math.min(bottom, box.bottom) - Math.max(top, box.top));
    });
    expect(sourceOverlap).toBeLessThanOrEqual(1);
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 2, {
      steps: 8,
    });
    await expect(list).toHaveAttribute("data-drop-preview", "");
    const previewHeight = await list.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element, "::after").height),
    );
    expect(previewHeight).toBeCloseTo(handleBox.height, 0);
    await page.mouse.move(handleBox.x + 8, handleBox.y + 8, { steps: 8 });
    await expect(list).toHaveAttribute("data-origin-preview", "");
    const nextBoxAtReturn = await entries.nth(1).boundingBox();
    if (!nextBoxAtReturn) throw new Error("Missing next entry on return");
    expect(nextBoxAtReturn.y).toBeLessThanOrEqual(nextBoxBefore.y + 1);
    await expect
      .poll(async () => (await entries.nth(1).boundingBox())?.y)
      .toBeCloseTo(nextBoxBefore.y, 0);
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 2, {
      steps: 8,
    });
    await page.evaluate(() => {
      const observer = new MutationObserver(() => {
        if (!document.querySelector(".itinerary-entry.is-dragging")) {
          performance.mark("drag-drop-complete");
          observer.disconnect();
        }
      });
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class"],
        childList: true,
        subtree: true,
      });
      document.addEventListener("mouseup", () => performance.mark("drag-mouseup"), {
        capture: true,
        once: true,
      });
    });
    await page.mouse.up();
    await expect(page.locator(".itinerary-entry.is-dragging")).toHaveCount(0, { timeout: 200 });
    await expect(list).not.toHaveAttribute("data-drop-preview", "");
    const dropDuration = await page.evaluate(
      () => performance.measure("drag-drop", "drag-mouseup", "drag-drop-complete").duration,
    );
    expect(dropDuration).toBeLessThan(200);
    await expect(entries.nth(1).locator(".entry-select")).toHaveText("First stop");
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});
test("upward drag shows only the target marker", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Mouse drag coverage runs on desktop");
  const id = await createEmptyTrip([
    itemForCreate("note", "2027-04-10", { title: "First stop" }),
    itemForCreate("note", "2027-04-10", { title: "Second stop" }),
    itemForCreate("note", "2027-04-10", { title: "Third stop" }),
  ]);
  try {
    await page.goto(`/trips/${id}`);
    const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("Upward drag");
    await tripmate.getByRole("button", { name: "Create tripmate" }).click();
    await expect(tripmate).toHaveCount(0);
    const list = page.locator(".day-section").first().locator(".itinerary-list");
    const entries = list.locator(".itinerary-entry");
    await expect(entries).toHaveCount(3);
    const first = await entries.nth(0).boundingBox();
    const second = await entries.nth(1).boundingBox();
    if (!first || !second) throw new Error("Missing upward drag entries");
    await page.mouse.move(second.x + 8, second.y + 8);
    await page.mouse.down();
    await page.mouse.move(second.x + 8, second.y + 16);
    await page.mouse.move(first.x + first.width / 2, first.y + 2, { steps: 8 });
    await expect(list).toHaveAttribute("data-drop-preview", "");
    await expect(list.locator(".itinerary-entry")).toHaveCount(3);
    const previewTop = await list.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.top + Number.parseFloat(getComputedStyle(element, "::after").top);
    });
    expect(previewTop).toBeCloseTo(first.y, 0);
    await page.mouse.up();
    await expect(list.locator(".entry-select")).toHaveText([
      "Second stop",
      "First stop",
      "Third stop",
    ]);
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("entries can be dragged to another day", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Mouse drag coverage runs on desktop");
  const id = await createEmptyTrip([
    itemForCreate("note", "2027-04-11", { title: "Destination note" }),
  ]);
  try {
    await page.goto(`/trips/${id}`);
    const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("Day editor");
    await tripmate.getByRole("button", { name: "Create tripmate" }).click();
    await expect(tripmate).toHaveCount(0);
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
    const targetList = destination.locator(".itinerary-list");
    await page.mouse.move(destinationBox.x + destinationBox.width / 2, destinationBox.y + 8, {
      steps: 8,
    });
    await expect(targetList).toHaveAttribute("data-drop-preview", "");
    const targetTop = await targetList.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.top + Number.parseFloat(getComputedStyle(element, "::after").top);
    });
    expect(targetTop).toBeCloseTo(destinationBox.y, 0);
    await expect(source.locator(".itinerary-entry")).toHaveCount(1);
    await page.mouse.up();
    await expect(source.locator(".itinerary-entry")).toHaveCount(0);
    await expect(source.locator(".day-empty")).toBeVisible();
    await expect(destination.locator(".entry-select")).toHaveCount(2);
    await clickPlannerAction(page, "Undo");
    await expect(source.locator(".entry-select")).toHaveText("New note");
    await expect(destination.locator(".entry-select")).toHaveCount(1);
    await clickPlannerAction(page, "Redo");
    await expect(destination.locator(".entry-select")).toHaveCount(2);
    await page.reload();
    await expect(days.nth(1).locator(".entry-select")).toHaveCount(2);
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
    await page.goto(`/trips/${id}`);
    const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("Scroll drag editor");
    await tripmate.getByRole("button", { name: "Create tripmate" }).click();
    await expect(tripmate).toHaveCount(0);
    const scroll = page.locator(".planner-scroll");
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
    const scrollBefore = await scroll.evaluate((element) => element.scrollTop);
    await scroll.evaluate((element) => {
      element.scrollTop += 1000;
    });
    await expect
      .poll(() => scroll.evaluate((element) => element.scrollTop))
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
    await page.goto(`/trips/${id}`);
    const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("Inbox editor");
    await tripmate.getByRole("button", { name: "Create tripmate" }).click();
    await expect(tripmate).toHaveCount(0);
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
    await destination.getByRole("combobox").click();
    await page.getByRole("option", { name: "Car", exact: true }).click();
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
  await page.goto(`/trips/${tripId}`);
  await joinTripAs(page, "Performance editor");
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
  await joinTripAs(page, "Resize performance editor");
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
  await Promise.all([first.goto(`/trips/${tripId}`), second.goto(`/trips/${tripId}`)]);
  await Promise.all([joinTripAs(first, "Editor one"), joinTripAs(second, "Editor two")]);
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
  await expect(second.locator(".sync-state")).toContainText(/connected/i);
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

test("remote trip edits preserve an unsaved cost draft", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Two-editor draft coverage runs once");
  const item = itemForCreate("note", "2027-04-10", {
    id: "shared-cost-note",
    title: "Shared cost note",
  });
  const id = await createEmptyTrip([item], "2027-04-12", "JPY");
  const first = await browser.newPage();
  const second = await browser.newPage();
  try {
    await Promise.all([mockGoogle(first), mockGoogle(second)]);
    await Promise.all([first.goto(`/trips/${id}`), second.goto(`/trips/${id}`)]);
    await Promise.all([joinTripAs(first, "Cost editor"), joinTripAs(second, "Note editor")]);
    await first
      .locator(".entry-select")
      .filter({ hasText: /^Shared cost note$/ })
      .click();
    const amount = first.locator(".item-editor").getByRole("textbox", { name: "Amount" });
    await expect(amount).toBeEnabled();
    await amount.fill("12");
    await amount.press("Enter");
    await expect(first.getByRole("button", { name: "Clear cost" })).toBeVisible();
    await expect(amount).toHaveValue("12");

    await amount.fill("13");
    await second
      .locator(".entry-select")
      .filter({ hasText: /^Shared cost note$/ })
      .click();
    await second.getByRole("button", { name: "Edit Shared cost note label" }).click();
    await second.getByRole("textbox", { name: "Itinerary label" }).fill("Remote note title");
    await expect(
      first.locator(".entry-select").filter({ hasText: /^Remote note title$/ }),
    ).toBeVisible();
    await expect(amount).toHaveValue("13");
  } finally {
    await Promise.all([first.close(), second.close()]);
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("undo keeps a tripmate used by another editor's expense", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Two-editor ledger coverage runs once");
  const id = await createEmptyTrip([], "2027-04-12", "USD");
  const first = await browser.newPage();
  const second = await browser.newPage();
  try {
    await Promise.all([mockGoogle(first), mockGoogle(second)]);
    await Promise.all([first.goto(`/trips/${id}`), second.goto(`/trips/${id}?view=expenses`)]);
    await Promise.all([joinTripAs(first, "Editor one"), joinTripAs(second, "Editor two")]);
    const title = first.getByRole("textbox", { name: "Trip title" });
    const initialTitle = await title.inputValue();
    await title.fill("Temporary title");
    await title.press("Enter");
    await expect(second.getByRole("textbox", { name: "Trip title" })).toHaveValue(
      "Temporary title",
    );

    await clickPlannerAction(first, "Tripmates");
    const tripmates = first.getByRole("dialog", { name: "Tripmates" });
    await tripmates.getByRole("button", { name: "Add tripmate" }).click();
    const add = first.getByRole("dialog", { name: "New tripmate" });
    await add.getByRole("textbox", { name: "Name" }).fill("Charlie");
    await add.getByRole("button", { name: "Save" }).click();
    await tripmates.getByRole("button", { name: "Close dialog" }).click();

    await expect(
      second.getByRole("region", { name: "Balances" }).getByText("Charlie"),
    ).toBeVisible();
    await second.getByRole("button", { name: "Add expense" }).click();
    const expense = second.getByRole("dialog", { name: "Add expense" });
    await expense.getByRole("textbox", { name: "Description (optional)" }).fill("Remote lunch");
    await expense.getByRole("textbox", { name: "Amount" }).fill("12");
    await expense.getByRole("combobox", { name: /^Paid by:/ }).click();
    await second
      .getByRole("listbox", { name: "Paid by" })
      .getByRole("option", { name: "Charlie" })
      .click();
    await expense.getByRole("button", { name: "Save expense" }).click();
    await expect(second.getByText("Remote lunch")).toBeVisible();

    await clickPlannerAction(first, "Undo");
    await expect(title).toHaveValue(initialTitle);
    await expect(first.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await expect(
      second.getByRole("region", { name: "Balances" }).getByText("Charlie"),
    ).toBeVisible();
    await expect(second.getByText("Remote lunch")).toBeVisible();
  } finally {
    await Promise.all([first.close(), second.close()]);
    await db.delete(trips).where(eq(trips.id, id));
  }
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
    await page.goto(`/trips/${id}`);
    await joinTripAs(page, "Lodging gap editor");
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
  await page.goto(`/trips/${tripId}`);
  await joinTripAs(page, "Deleting editor");
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
    await page.goto(`/trips/${id}`);
    const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("Transport routing");
    await tripmate.getByRole("button", { name: "Create tripmate" }).click();
    await expect(tripmate).toHaveCount(0);
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
      const train = unit("Train");
      const trainEntry = train.locator(".itinerary-entry");
      const trainLeg = train.locator(".transport-leg");
      const displaced = unit("Departing train");
      const displacedEntry = displaced.locator(".itinerary-entry");
      const displacedLeg = displaced.locator(".transport-leg");
      const displacedSummary = displacedLeg.locator(".leg-summary");
      const displacedMode = displacedLeg.locator(".leg-mode");
      const displacedRail = displacedLeg.locator(".leg-rail");
      const trainBox = await trainEntry.boundingBox();
      const trainLegBox = await trainLeg.boundingBox();
      const displacedBox = await displacedEntry.boundingBox();
      const displacedLegBox = await displacedLeg.boundingBox();
      const displacedSummaryBox = await displacedSummary.boundingBox();
      const displacedModeBox = await displacedMode.boundingBox();
      if (
        !trainBox ||
        !trainLegBox ||
        !displacedBox ||
        !displacedLegBox ||
        !displacedSummaryBox ||
        !displacedModeBox
      )
        throw new Error("Missing transport drag geometry");
      const list = train.locator(
        "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' itinerary-list ')][1]",
      );
      const listHeightBefore = await list.evaluate(
        (element) => element.getBoundingClientRect().height,
      );
      const nextTop = () =>
        train.evaluate((element) => {
          const next = element.nextElementSibling?.querySelector(
            ".transport-leg, .itinerary-entry",
          );
          if (!next) throw new Error("Missing entry after train");
          return next.getBoundingClientRect().top;
        });
      const nextTopBefore = await nextTop();
      const x = trainBox.x + trainBox.width / 2;
      const y = trainBox.y + trainBox.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await list.evaluate((element, initialY) => {
        let pointerY = initialY;
        const trackPointer = (event: MouseEvent) => {
          pointerY = event.clientY;
        };
        document.addEventListener("mousemove", trackPointer);
        const tops: number[] = [];
        const started = performance.now();
        const sample = () => {
          const card = element.querySelector(".itinerary-entry.is-dragging");
          if (pointerY >= initialY + 11 && card) tops.push(card.getBoundingClientRect().top);
          if (performance.now() - started < 350) requestAnimationFrame(sample);
          else {
            document.removeEventListener("mousemove", trackPointer);
            element.dataset.dragLiftTops = JSON.stringify(tops);
          }
        };
        requestAnimationFrame(sample);
      }, y);
      await page.mouse.move(x + 12, y + 12, { steps: 4 });
      await expect(trainEntry).toHaveClass(/is-dragging/);
      await expect(list).toHaveAttribute("data-drag-lift-tops", /.+/);
      const liftTops = await list.evaluate((element) => {
        const tops = JSON.parse(element.dataset.dragLiftTops ?? "[]") as number[];
        delete element.dataset.dragLiftTops;
        return tops;
      });
      if (liftTops.length < 2) throw new Error("Missing steady drag frames");
      expect(Math.max(...liftTops) - Math.min(...liftTops)).toBeLessThanOrEqual(1);
      await expect(train.locator(".transport-leg")).toHaveCount(0);
      await expect(list).toHaveAttribute("data-transport-drop-preview", "");
      const sourcePreviewLeg = await list.locator(".leg-preview").boundingBox();
      if (!sourcePreviewLeg) throw new Error("Missing source transport preview");
      expect(sourcePreviewLeg.y).toBeCloseTo(trainLegBox.y, 0);
      expect(sourcePreviewLeg.height).toBeCloseTo(trainLegBox.height, 0);
      await expect(list.locator(".leg-preview .leg-summary")).toHaveText("Transport");
      await expect(list.locator(".leg-preview .leg-mode, .leg-preview .leg-export")).toHaveCount(0);
      await expect(train.locator(".itinerary-entry")).toHaveCount(1);
      await expect(list).toHaveAttribute("data-drop-preview", "");
      const originalPreviewTop = await list.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.top + Number.parseFloat(getComputedStyle(element, "::after").top);
      });
      expect(originalPreviewTop).toBeCloseTo(trainBox.y, 0);
      expect(await nextTop()).toBeCloseTo(nextTopBefore, 0);
      const listHeightAtOrigin = await list.evaluate(
        (element) => element.getBoundingClientRect().height,
      );
      expect(listHeightAtOrigin).toBeCloseTo(listHeightBefore, 0);
      const unchangedEntry = await displacedEntry.boundingBox();
      const unchangedSummary = await displacedSummary.boundingBox();
      const unchangedMode = await displacedMode.boundingBox();
      if (!unchangedEntry || !unchangedSummary || !unchangedMode)
        throw new Error("Missing original-slot entries");
      const entryShift = unchangedEntry.y - displacedBox.y;
      expect(unchangedSummary.y - displacedSummaryBox.y).toBeCloseTo(entryShift, 0);
      expect(unchangedMode.y - displacedModeBox.y).toBeCloseTo(entryShift, 0);
      await page.mouse.move(
        displacedBox.x + displacedBox.width / 2,
        displacedBox.y - trainBox.height / 2,
        { steps: 8 },
      );
      await expect(list).toHaveAttribute("data-drop-preview", "");
      await expect
        .poll(async () => {
          const preceding = await unit("After transport").locator(".itinerary-entry").boundingBox();
          const previewLeg = await list.locator(".leg-preview").boundingBox();
          if (!preceding || !previewLeg) throw new Error("Missing transport preview geometry");
          return Math.max(0, preceding.y + preceding.height - previewLeg.y);
        })
        .toBeLessThanOrEqual(1);
      const shiftedEntry = await displacedEntry.boundingBox();
      const shiftedLeg = await displacedLeg.boundingBox();
      if (!shiftedEntry || !shiftedLeg) throw new Error("Missing moved transport geometry");
      expect(shiftedLeg.y - displacedLegBox.y).toBeCloseTo(shiftedEntry.y - displacedBox.y, 0);
      const preview = await list.evaluate((element) => {
        const listBox = element.getBoundingClientRect();
        const style = getComputedStyle(element, "::after");
        return {
          top: listBox.top + Number.parseFloat(style.top),
          height: Number.parseFloat(style.height),
        };
      });
      const shiftedRail = await displacedRail.boundingBox();
      if (!shiftedRail) throw new Error("Missing moved transport rail");
      expect(preview.top + preview.height).toBeCloseTo(shiftedRail.y, 0);
      expect(preview.height).toBeCloseTo(trainBox.height, 0);
      const targetPreviewLeg = await list.locator(".leg-preview").boundingBox();
      if (!targetPreviewLeg) throw new Error("Missing target transport preview");
      expect(targetPreviewLeg.y).toBeCloseTo(preview.top - (trainBox.y - trainLegBox.y), 0);
      expect(targetPreviewLeg.height).toBeCloseTo(trainLegBox.height, 0);
      expect(preview.top).toBeCloseTo(targetPreviewLeg.y + targetPreviewLeg.height, 0);
      await expect(list.locator(".leg-preview .leg-summary")).toHaveText("Transport");
      await page.mouse.move(x, y, { steps: 8 });
      await expect(list).toHaveAttribute("data-drop-preview", "");
      const returnedPreviewTop = await list.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.top + Number.parseFloat(getComputedStyle(element, "::after").top);
      });
      expect(returnedPreviewTop).toBeCloseTo(trainBox.y, 0);
      await expect(train.locator(".transport-leg")).toHaveCount(0);
      const returnedPreviewLeg = await list.locator(".leg-preview").boundingBox();
      if (!returnedPreviewLeg) throw new Error("Missing returned transport preview");
      expect(returnedPreviewLeg.y).toBeCloseTo(trainLegBox.y, 0);
      expect(await nextTop()).toBeLessThanOrEqual(nextTopBefore + 1);
      await expect.poll(nextTop).toBeCloseTo(nextTopBefore, 0);
      const listHeightAtReturn = await list.evaluate(
        (element) => element.getBoundingClientRect().height,
      );
      expect(listHeightAtReturn).toBeCloseTo(listHeightBefore, 0);
      await expect
        .poll(async () => {
          const entry = await displacedEntry.boundingBox();
          const summary = await displacedSummary.boundingBox();
          const mode = await displacedMode.boundingBox();
          if (!entry || !summary || !mode) throw new Error("Missing original-slot transport leg");
          const entryShift = entry.y - displacedBox.y;
          return [
            Math.round(summary.y - displacedSummaryBox.y - entryShift),
            Math.round(mode.y - displacedModeBox.y - entryShift),
          ];
        })
        .toEqual([0, 0]);
      const farTarget = await unit("After one-sided transport")
        .locator(".itinerary-entry")
        .boundingBox();
      if (!farTarget) throw new Error("Missing far drop target");
      await page.mouse.move(farTarget.x + 20, farTarget.y + farTarget.height / 2, { steps: 12 });
      await expect(list).toHaveAttribute("data-drop-preview", "");
      await list.evaluate((element, itemId) => {
        const tops: number[] = [];
        const started = performance.now();
        const sample = () => {
          const card = element.querySelector<HTMLElement>(`[data-rfd-draggable-id="${itemId}"]`);
          if (card && !card.classList.contains("is-dragging"))
            tops.push(card.getBoundingClientRect().top);
          if (performance.now() - started < 650) requestAnimationFrame(sample);
          else element.dataset.dropTops = JSON.stringify(tops);
        };
        requestAnimationFrame(sample);
      }, transport.id);
      await page.mouse.up();
      await expect(page.locator(".itinerary-entry.is-dragging")).toHaveCount(0);
      await expect(train.locator(".transport-leg")).toHaveCount(0);
      await expect(list).toHaveAttribute("data-drop-tops", /.+/);
      const dropTops = await list.evaluate((element) => {
        const tops = JSON.parse(element.dataset.dropTops ?? "[]") as number[];
        delete element.dataset.dropTops;
        return tops;
      });
      const settledTrain = await train.locator(".itinerary-entry").boundingBox();
      if (!settledTrain || dropTops.length < 2) throw new Error("Missing drop motion");
      expect(Math.max(...dropTops) - settledTrain.y).toBeLessThanOrEqual(1);
      const laterEntry = unit("After one-sided transport").locator(".itinerary-entry");
      const laterBox = await laterEntry.boundingBox();
      const earlierBox = await displacedEntry.boundingBox();
      if (!laterBox || !earlierBox) throw new Error("Missing transport reorder targets");
      await page.mouse.move(laterBox.x + laterBox.width / 2, laterBox.y + laterBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        laterBox.x + laterBox.width / 2 + 12,
        laterBox.y + laterBox.height / 2 + 12,
        {
          steps: 4,
        },
      );
      await expect(laterEntry).toHaveClass(/is-dragging/);
      await list.evaluate((element) => {
        const target = [...element.querySelectorAll(".itinerary-unit")].find(
          (item) => item.querySelector(".entry-select")?.textContent === "Departing train",
        );
        const entry = target?.querySelector(".itinerary-entry");
        const leg = target?.querySelector(".transport-leg");
        if (!entry || !leg) throw new Error("Missing displaced transport pair");
        const entryTop = entry.getBoundingClientRect().top;
        const legTop = leg.getBoundingClientRect().top;
        const frames: Array<[number, number]> = [];
        const started = performance.now();
        const sample = () => {
          frames.push([
            entry.getBoundingClientRect().top - entryTop,
            leg.getBoundingClientRect().top - legTop,
          ]);
          if (performance.now() - started < 350) requestAnimationFrame(sample);
          else element.dataset.transportFrames = JSON.stringify(frames);
        };
        requestAnimationFrame(sample);
      });
      await page.mouse.move(earlierBox.x + earlierBox.width / 2, earlierBox.y + 8, { steps: 8 });
      await expect(list).toHaveAttribute("data-transport-frames", /.+/);
      const motion = await list.evaluate((element) => {
        const frames = JSON.parse(element.dataset.transportFrames ?? "[]") as Array<
          [number, number]
        >;
        delete element.dataset.transportFrames;
        return {
          travel: Math.max(...frames.map(([entry]) => Math.abs(entry))),
          mismatch: Math.max(...frames.map(([entry, leg]) => Math.abs(entry - leg))),
        };
      });
      expect(motion.travel).toBeGreaterThan(5);
      expect(motion.mismatch).toBeLessThanOrEqual(1);
      await page.mouse.up();
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
    await page.goto(`/trips/${id}`);
    const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("Route export");
    await tripmate.getByRole("button", { name: "Create tripmate" }).click();
    await expect(tripmate).toHaveCount(0);
    const dates = page.locator(".date-tabs [data-day-tab]");
    const dayTwoRoute = page
      .locator(".day-section")
      .nth(1)
      .locator(".itinerary-unit .transport-leg");
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
    await page.goto(`/trips/${id}`);
    const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("Language test");
    await tripmate.getByRole("button", { name: "Create tripmate" }).click();
    await expect(tripmate).toHaveCount(0);
    await expect(page.locator(".entry-select").first()).toHaveText("Test destination");

    await clickPlannerAction(page, "Trip settings");
    const dialog = page.getByRole("dialog", { name: "Trip settings" });
    const language = dialog.getByRole("combobox", { name: /^Trip language:/ });
    await expect(language).toHaveAccessibleName("Trip language: Follow UI language (English)");
    await language.click();
    const languages = page.getByRole("listbox", { name: "Trip language" });
    await expect(languages.getByRole("option", { name: "简体中文" })).toBeVisible();
    await expect(languages.getByRole("option", { name: "繁體中文" })).toBeVisible();
    await languages.getByRole("option", { name: "简体中文" }).click();
    await expect(language).toHaveAccessibleName("Trip language: 简体中文");
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
    await expect(page.locator(".transport-leg").first()).toContainText("10 min - 1.0 km");
    await page.getByRole("button", { name: "Calendar", exact: true }).click();
    await expect(page.locator("[data-calendar-route-duration]").first()).toContainText("10 min");
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
  try {
    await page.goto(`/trips/${routeTrip}`);
    await joinTripAs(page, "Trip-wide map");
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
    await joinTripAs(page, "Transport map");
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
    const dates = page.locator(".date-tabs [data-day-tab]");
    await page.goto(`/trips/${id}`);
    const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("Cross-day transport");
    await tripmate.getByRole("button", { name: "Create tripmate" }).click();
    await expect(tripmate).toHaveCount(0);
    const days = page.locator(".day-section");
    await expect(days.nth(0).locator(".missing-lodging")).toHaveCount(0);
    const missingLodging = days.nth(1).locator(".missing-lodging");
    await expect(missingLodging).toHaveText("No lodging");

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
    await expect(days.nth(0).locator(".itinerary-unit .transport-leg")).toBeVisible();
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
    await expect(days.nth(1).locator(".itinerary-unit .transport-leg")).toHaveCount(1);
    await expect(days.nth(1).locator(".route-endpoint-start")).toHaveCount(0);
    await expect(days.nth(1).locator(".route-endpoint-end")).toHaveCount(0);
    await dates.nth(2).click();
    await expect(dates.nth(2)).toHaveAttribute("aria-current", "date");
    const leg = days.nth(2).locator(".itinerary-unit .transport-leg");
    await expect(leg).toBeVisible();
    await expect(leg.locator(".leg-cap")).toHaveCount(0);
    const transportStart = days.nth(2).locator(".route-endpoint-start");
    await expect(transportStart).toHaveClass(/route-endpoint-transport/);
    await expect(transportStart.locator(".route-endpoint-cap")).toHaveCount(1);
    await expect(transportStart.locator(".route-endpoint-rail")).toBeHidden();
    expect((await transportStart.boundingBox())?.height).toBe(0);
    await expect(days.nth(2).locator(".route-endpoint-end")).toHaveCount(0);
    await expect(leg).toContainText("10 min - 1.0 km");
    await expect(page.locator(".transport-leg").filter({ hasText: "Updating route" })).toHaveCount(
      0,
    );
    const travelMode = leg.getByRole("combobox", { name: /^Travel mode:/ });
    await expect(travelMode).toHaveAccessibleName("Travel mode: Car");
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
    await travelMode.click();
    await page.getByRole("option", { name: "Walk", exact: true }).click();
    await expect.poll(routeComputes).toBeGreaterThan(beforeModeChange);
    await expect(travelMode).toHaveAccessibleName("Travel mode: Walk");

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
    await page.goto(`/trips/${id}`);
    await joinTripAs(page, "Endpoint search editor");
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
    for (const [method, expectedTypes] of [
      ["Plane", ["airport", "airstrip", "heliport", "international_airport"]],
      ["Train", ["train_station", "transit_station", "subway_station"]],
      ["Bus", ["bus_station", "bus_stop", "transit_station"]],
      ["Ferry", ["ferry_terminal"]],
    ] as const) {
      await travelMethod.click();
      await page
        .getByRole("listbox", { name: "Travel method" })
        .getByRole("option", { name: method, exact: true })
        .click();
      await expect(travelMethod).toHaveAccessibleName(`Travel method: ${method}`);
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
    await page.goto(`/trips/${id}`);
    await joinTripAs(page, "Lodging gap");
    const day = page.locator(".day-section").first();
    const routeModes = day.getByRole("combobox", { name: /^Travel mode:/ });
    await expect(routeModes).toHaveCount(2);

    await page.getByRole("button", { name: "Map location: Museum", exact: true }).click();
    const details = page.getByRole("dialog", { name: "Place details" });
    await details.getByRole("button", { name: "Remove from day 1" }).click();
    await expect(details).toHaveCount(0);
    await expect(day.getByRole("button", { name: "Only day stop", exact: true })).toHaveCount(0);
    await expect(
      page.locator(".inbox-section").getByRole("button", { name: "Only day stop", exact: true }),
    ).toBeVisible();
    await expect(routeModes).toHaveCount(0);

    await page.reload();
    await expect(day.getByRole("button", { name: "Only day stop", exact: true })).toHaveCount(0);
    await expect(
      page.locator(".inbox-section").getByRole("button", { name: "Only day stop", exact: true }),
    ).toBeVisible();
    await expect(routeModes).toHaveCount(0);
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
    await page.goto(`/trips/${id}`);
    await joinTripAs(page, "Route color check");
    await page.locator(".date-tabs [data-day-tab]").nth(1).click();
    const legs = page.locator(".day-section").nth(1).locator(".itinerary-unit .transport-leg");
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
    await page.goto(`/trips/${id}`);
    await joinTripAs(page, "Itinerary editor");
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
      .poll(() => page.locator(".planner-scroll").evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await addDayItem(page, "transport", 1);
    const transportRow = days.nth(1).locator(".itinerary-entry");
    await transportRow.click({ position: { x: 8, y: 8 } });
    const editor = page.locator(".item-editor");
    await editor.getByRole("combobox", { name: /^Travel method:/ }).click();
    await page
      .getByRole("listbox", { name: "Travel method" })
      .getByRole("option", { name: "Custom" })
      .click();
    await expect(editor.getByRole("combobox", { name: "Travel method: Custom" })).toBeVisible();
    await expect(editor.getByLabel("Start time")).toHaveCount(0);
    await expect(editor.getByLabel("Duration in minutes")).toHaveCount(0);
    await editor.getByLabel("Departure time").fill("23:30");
    await expect(editor.getByLabel("Arrival time")).toHaveValue("23:30");
    await editor.getByLabel("Arrival time").fill("01:15");
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
    const checkInBox = await editor.getByLabel("Check-in date").boundingBox();
    await expect(editor.getByLabel("Check-in date")).toHaveValue("2027-04-10");
    await expect(editor.getByLabel("Check-out date")).toHaveValue("2027-04-12");
    await editor.getByLabel("Check-out date").fill("2027-04-11");
    const notesBox = await editor.getByText("Notes", { exact: true }).boundingBox();
    expect(checkInBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(notesBox?.y ?? 0);
    await editor.getByRole("button", { name: "Close editor", exact: true }).click();
    await dates.nth(1).click();
    await expect(dates.nth(1)).toHaveAttribute("aria-current", "date");
    const duplicateStay = days.nth(1).locator(".lodging-boundary");
    await expect(duplicateStay).toHaveCount(1);
    await expect(duplicateStay).toHaveCSS("border-left-width", "1px");
    await expect(duplicateStay).toHaveCSS("box-shadow", "none");
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
    await page.goto(`/trips/${id}`);
    await joinTripAs(page, "Day range editor");
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
    await page.goto(`/trips/${id}`);
    const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("Date settings editor");
    await tripmate.getByRole("button", { name: "Create tripmate" }).click();
    await expect(tripmate).toHaveCount(0);
    await clickPlannerAction(page, "Trip settings");
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
    await clickPlannerAction(page, "Trip settings");
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

test("settings save keeps currency unchanged when dates exclude a reservation", async ({
  page,
}) => {
  const id = await createEmptyTrip(
    [
      itemForCreate("reservation", "2027-04-10", {
        title: "Dinner",
        startTime: "18:00",
        place: { placeId: "reservation-settings" },
      }),
    ],
    "2027-04-12",
    "USD",
  );
  try {
    await page.goto(`/trips/${id}`);
    await joinTripAs(page, "Settings editor");
    page.on("dialog", (dialog) => void dialog.accept());
    await clickPlannerAction(page, "Trip settings");
    const settings = page.getByRole("dialog", { name: "Trip settings" });
    await settings.getByRole("textbox", { name: "Start", exact: true }).fill("2027-04-11");
    await settings.getByRole("combobox", { name: "Trip currency: USD" }).click();
    await page
      .getByRole("listbox", { name: "Trip currency" })
      .getByRole("option", { name: "EUR" })
      .click();
    await settings.getByRole("button", { name: "Save settings" }).click();
    await expect(settings.getByRole("alert")).toHaveText("Could not save trip settings");
    await page.reload();
    await clickPlannerAction(page, "Trip settings");
    await expect(settings.getByRole("textbox", { name: "Start", exact: true })).toHaveValue(
      "2027-04-10",
    );
    await expect(settings.getByRole("combobox", { name: "Trip currency: USD" })).toBeVisible();

    await settings.getByRole("textbox", { name: "End", exact: true }).fill("2027-04-13");
    await settings.getByRole("combobox", { name: "Trip currency: USD" }).click();
    await page
      .getByRole("listbox", { name: "Trip currency" })
      .getByRole("option", { name: "EUR" })
      .click();
    await settings.getByRole("button", { name: "Save settings" }).click();
    await expect(settings).toHaveCount(0);
    await page.reload();
    await clickPlannerAction(page, "Trip settings");
    await expect(settings.getByRole("textbox", { name: "End", exact: true })).toHaveValue(
      "2027-04-13",
    );
    await expect(settings.getByRole("combobox", { name: "Trip currency: EUR" })).toBeVisible();
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
    await page.goto(`/trips/${id}`);
    const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("Settings editor");
    await tripmate.getByRole("button", { name: "Create tripmate" }).click();
    await expect(tripmate).toHaveCount(0);

    await expect(page.locator(".transport-leg").first()).toContainText("10 min - 1.0 km");
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
    await expect(nearPlaceUnit.getByRole("combobox", { name: "Travel mode: Walk" })).toBeVisible();

    await clickPlannerAction(page, "Trip settings");
    const settings = page.getByRole("dialog", { name: "Trip settings" });
    const uiLanguage = settings.getByRole("combobox", { name: "UI language: English" });
    const tripLanguage = settings.getByRole("combobox", {
      name: "Trip language: Follow UI language (English)",
    });
    await expect(uiLanguage).toBeVisible();
    await expect(tripLanguage).toBeVisible();
    await expect(settings.getByRole("combobox", { name: "Distance units: Metric" })).toBeVisible();
    await expect(
      settings.getByRole("combobox", { name: "Default transportation: Car" }),
    ).toBeVisible();
    const calendarStart = settings.getByRole("combobox", {
      name: "Calendar day starts: 06:00",
    });
    await calendarStart.click();
    await expect(
      page.getByRole("listbox", { name: "Calendar day starts" }).getByRole("option"),
    ).toHaveCount(24);
    await calendarStart.press("Escape");
    await page.keyboard.press("Escape");
    await expect(settings).toHaveCount(0);
    await clickPlannerAction(page, "Trip settings");
    await page.mouse.click(4, 4);
    await expect(settings).toHaveCount(0);

    await clickPlannerAction(page, "Trip settings");
    await settings.getByRole("combobox", { name: "Distance units: Metric" }).click();
    await page
      .getByRole("listbox", { name: "Distance units" })
      .getByRole("option", { name: "Imperial" })
      .click();
    let discardPrompt = "";
    page.once("dialog", (dialog) => {
      discardPrompt = dialog.message();
      void dialog.dismiss();
    });
    await page.keyboard.press("Escape");
    await expect(settings).toBeVisible();
    expect(discardPrompt).toBe("Discard unsaved trip settings?");
    await expect(
      settings.getByRole("combobox", { name: "Distance units: Imperial" }),
    ).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.mouse.click(4, 4);
    await expect(settings).toHaveCount(0);
    await clickPlannerAction(page, "Trip settings");
    await expect(settings.getByRole("combobox", { name: "Distance units: Metric" })).toBeVisible();
    await uiLanguage.click();
    await page
      .getByRole("listbox", { name: "UI language" })
      .getByRole("option", { name: "Français" })
      .click();
    await settings.getByRole("combobox", { name: "Distance units: Metric" }).click();
    await page
      .getByRole("listbox", { name: "Distance units" })
      .getByRole("option", { name: "Imperial" })
      .click();
    await settings.getByRole("combobox", { name: "Default transportation: Car" }).click();
    await page
      .getByRole("listbox", { name: "Default transportation" })
      .getByRole("option", { name: "Walk" })
      .click();
    await calendarStart.click();
    await page
      .getByRole("listbox", { name: "Calendar day starts" })
      .getByRole("option", { name: "07:00" })
      .click();
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
    await expect(
      addedUnit.getByRole("combobox", { name: "Mode de déplacement: Marche" }),
    ).toBeVisible();

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
    await clickPlannerAction(page, "Paramètres du voyage");
    const savedSettings = page.getByRole("dialog", { name: "Paramètres du voyage" });
    await expect(
      savedSettings.getByRole("combobox", { name: "Langue de l’interface: Français" }),
    ).toBeVisible();
    await expect(
      savedSettings.getByRole("combobox", {
        name: "Langue du voyage: Utiliser la langue de l’interface (Français)",
      }),
    ).toBeVisible();
    await expect(
      savedSettings.getByRole("combobox", { name: "Unités de distance: Impérial" }),
    ).toBeVisible();
    await expect(
      savedSettings.getByRole("combobox", { name: "Transport par défaut: Marche" }),
    ).toBeVisible();
    await expect(
      savedSettings.getByRole("combobox", { name: "Début du jour du calendrier: 07:00" }),
    ).toBeVisible();
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});

test("trip language can override the local UI language", async ({ page }) => {
  const id = await createEmptyTrip();
  try {
    await page.addInitScript(() => localStorage.setItem("pacenotes-ui-language", "ja"));
    await page.goto(`/trips/${id}`);
    const join = page.getByRole("dialog", { name: "この旅行であなたは誰ですか？" });
    await join.getByRole("textbox", { name: "新しい旅行仲間" }).fill("言語の確認");
    await join.getByRole("button", { name: "旅行仲間を作成" }).click();
    await expect(join).toHaveCount(0);
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

    await clickPlannerAction(page, "旅行設定");
    const settings = page.getByRole("dialog", { name: "旅行設定" });
    const uiLanguage = settings.getByRole("combobox", { name: "UIの言語: 日本語" });
    const tripLanguage = settings.getByRole("combobox", {
      name: "旅行の言語: UIの言語に合わせる（日本語）",
    });
    await expect(uiLanguage).toBeVisible();
    await expect(tripLanguage).toBeVisible();
    const [uiBox, tripBox] = await Promise.all([
      uiLanguage.boundingBox(),
      tripLanguage.boundingBox(),
    ]);
    expect(uiBox?.y).toBe(tripBox?.y);
    await tripLanguage.click();
    await page
      .getByRole("listbox", { name: "旅行の言語" })
      .getByRole("option", { name: "Français" })
      .click();
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
    await clickPlannerAction(page, "旅行設定");
    const savedSettings = page.getByRole("dialog", { name: "旅行設定" });
    const savedUiLanguage = savedSettings.getByRole("combobox", { name: "UIの言語: 日本語" });
    const savedTripLanguage = savedSettings.getByRole("combobox", {
      name: "旅行の言語: Français",
    });
    await expect(savedUiLanguage).toBeVisible();
    await expect(savedTripLanguage).toBeVisible();
    await savedUiLanguage.click();
    await page
      .getByRole("listbox", { name: "UIの言語" })
      .getByRole("option", { name: "Deutsch" })
      .click();
    await expect(savedTripLanguage).toHaveAccessibleName("旅行の言語: Français");
    await page.getByRole("dialog", { name: "旅行設定" }).locator('button[type="submit"]').click();
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
    await page.goto(`/trips/${id}`);
    const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("Route layout editor");
    await tripmate.getByRole("button", { name: "Create tripmate" }).click();
    await expect(tripmate).toHaveCount(0);
    const leg = page.locator(".itinerary-unit .transport-leg").first();
    await expect(leg).toBeVisible();
    const routeMode = leg.getByRole("combobox", { name: /^Travel mode:/ });
    await expect(routeMode).toHaveAccessibleName("Travel mode: Car");
    const initialHeight = await leg.evaluate((element) => element.getBoundingClientRect().height);
    await routeMode.click();
    await expect(page.getByRole("listbox", { name: "Travel mode" }).getByRole("option")).toHaveText(
      ["Car", "Public transport", "Walk"],
    );
    await page.getByRole("option", { name: "Public transport" }).click();
    await expect(routeMode).toHaveAccessibleName("Travel mode: Public transport");
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
    await page.goto(`/trips/${id}`);
    const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("Scroll editor");
    await tripmate.getByRole("button", { name: "Create tripmate" }).click();
    await expect(tripmate).toHaveCount(0);
    const panel = page.locator(".planner-panel");
    const scroll = page.locator(".planner-scroll");
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
    await scroll.evaluate((element) => {
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

test("itinerary renders nearby days after view and date changes", async ({ page }) => {
  const dates = ["2027-04-10", "2027-04-11", "2027-04-12", "2027-04-13", "2027-04-14"];
  const id = await createEmptyTrip(
    dates.map((day, index) => itemForCreate("note", day, { title: `Day ${index + 1} note` })),
    dates[dates.length - 1],
  );
  try {
    await page.goto(`/trips/${id}?view=expenses`);
    await expect(page.locator("#expenses-title")).toBeVisible();
    const tripmate = page.getByRole("dialog", { name: "Who are you on this trip?" });
    await tripmate.getByRole("textbox", { name: "New tripmate" }).fill("Date editor");
    await tripmate.getByRole("button", { name: "Create tripmate" }).click();
    await expect(tripmate).toHaveCount(0);
    await page.getByRole("button", { name: "Itinerary", exact: true }).click();

    const sections = page.locator(".day-section");
    await expect(sections).toHaveCount(dates.length);
    await expect(sections.nth(0).locator(".entry-select")).toContainText("Day 1 note");
    await expect(sections.nth(1).locator(".entry-select")).toContainText("Day 2 note");

    await page.locator(".date-tabs [data-day-tab]").last().click();
    await expect(page.locator(".date-tabs [data-day-tab]").last()).toHaveAttribute(
      "aria-current",
      "date",
    );
    await expect(sections.nth(3).locator(".entry-select")).toContainText("Day 4 note");
    await expect(sections.nth(4).locator(".entry-select")).toContainText("Day 5 note");
  } finally {
    await db.delete(trips).where(eq(trips.id, id));
  }
});
