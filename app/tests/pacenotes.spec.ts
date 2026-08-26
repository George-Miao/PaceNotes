import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as Y from "yjs";
import { db, sql } from "../src/db/client";
import { documents, trips } from "../src/db/schema";
import { addTripItem, initializeTripDocument } from "../src/features/collaboration/document";
import { createInitialSnapshot, itemForCreate } from "../src/features/trip/model";

let tripId = "";

const destination = {
  placeId: "tokyo-e2e",
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    class MockPlaceAutocompleteElement extends HTMLElement {
      locationBias: unknown;
    }
    if (!customElements.get("gmp-place-autocomplete")) {
      customElements.define("gmp-place-autocomplete", MockPlaceAutocompleteElement);
    }
    class MockPlace {
      id: string;
      location = { lat: () => 35.6762, lng: () => 139.6503 };
      constructor({ id }: { id: string }) {
        this.id = id;
      }
      async fetchFields(): Promise<void> {}
    }
    class MockMap {
      constructor(host: HTMLElement) {
        const scope = globalThis as typeof globalThis & {
          __pacenotesMapConstructions?: number;
        };
        scope.__pacenotesMapConstructions = (scope.__pacenotesMapConstructions ?? 0) + 1;
        host.replaceChildren(document.createElement("div"));
      }
    }
    class MockPolyline {
      setMap(): void {}
    }
    class MockLatLngBounds {
      extend(): void {}
    }
    const scope = globalThis as typeof globalThis & {
      __pacenotesMapConstructions?: number;
    };
    scope.__pacenotesMapConstructions = 0;
    globalThis.google = {
      maps: {
        LatLngBounds: MockLatLngBounds,
        importLibrary: async (name: string) => {
          if (name === "places") {
            return { PlaceAutocompleteElement: MockPlaceAutocompleteElement, Place: MockPlace };
          }
          if (name === "maps") return { Map: MockMap, Polyline: MockPolyline };
          return {};
        },
      },
    } as unknown as typeof google;
  });
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
test("a 500-place trip changes days within the interaction budget", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "The desktop project runs the interaction benchmark",
  );
  await page.addInitScript(() =>
    localStorage.setItem("pacenotes-display-name", "Performance editor"),
  );
  await page.goto(`/trips/${tripId}`);
  await expect(page.getByRole("textbox", { name: "Trip title" })).toHaveValue("Shared Tokyo plan");
  const responseTime = await page.evaluate(async () => {
    const days = document.querySelectorAll<HTMLButtonElement>(".date-tabs button");
    const lastDay = days.item(days.length - 1);
    const start = performance.now();
    lastDay.click();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    return performance.now() - start;
  });
  expect(responseTime).toBeLessThanOrEqual(100);
  await expect(page.getByText("Sunday, May 9", { exact: true })).toBeVisible();
});

test("two open planners exchange a live item edit", async ({ browser }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "The mobile project covers layout and accessibility",
  );
  const first = await browser.newPage();
  const second = await browser.newPage();
  await first.addInitScript(() => localStorage.setItem("pacenotes-display-name", "Editor one"));
  await second.addInitScript(() => localStorage.setItem("pacenotes-display-name", "Editor two"));
  await Promise.all([first.goto(`/trips/${tripId}`), second.goto(`/trips/${tripId}`)]);
  await expect(first.getByRole("textbox", { name: "Trip title" })).toHaveValue("Shared Tokyo plan");
  await expect(second.getByRole("textbox", { name: "Trip title" })).toHaveValue(
    "Shared Tokyo plan",
  );

  await first.getByRole("button", { name: "Add note" }).click();
  const editor = first.locator(".item-editor");
  await editor.getByLabel("Title").fill("Meet at Tokyo Station");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(
    first.getByRole("button", { name: "Meet at Tokyo Station", exact: true }),
  ).toBeVisible();
  await expect(second.locator(".sync-state")).toContainText(/synced/i);
  await expect(second.getByText("Meet at Tokyo Station", { exact: true })).toBeVisible();
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
