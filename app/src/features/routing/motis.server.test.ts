import { afterEach, describe, expect, it, vi } from "vitest";
import type { MotisRouteBatch } from "./model";
import { computeMotisRoutes, decodePolyline } from "./motis.server";

const batch: MotisRouteBatch = {
  routes: [
    {
      id: "tokyo",
      from: { latitude: 35.6812, longitude: 139.7671, countryCode: "JP" },
      to: { latitude: 35.658, longitude: 139.7016, countryCode: "JP" },
      departureTime: "2027-04-10T09:00:00+09:00",
    },
  ],
};

afterEach(() => {
  delete process.env.MOTIS_URL;
  delete process.env.MOTIS_TIMEOUT_MS;
  vi.unstubAllGlobals();
});

describe("MOTIS route adapter", () => {
  it("returns a typed fallback when MOTIS is disabled", async () => {
    expect(await computeMotisRoutes(batch)).toEqual({
      routes: [{ id: "tokyo", state: "fallback" }],
    });
  });

  it("validates and converts a MOTIS itinerary", async () => {
    process.env.MOTIS_URL = "http://motis.test:8080";
    const fetch = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json({
        itineraries: [
          {
            duration: 900,
            legs: [
              {
                mode: "RAIL",
                startTime: "2027-04-10T00:00:00Z",
                endTime: "2027-04-10T00:15:00Z",
                duration: 900,
                distance: 12_300,
                legGeometry: {
                  points: "_}rtE_e~vXowHowHowHowH",
                  precision: 5,
                  length: 3,
                },
              },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetch);

    expect(await computeMotisRoutes(batch)).toEqual({
      routes: [
        {
          id: "tokyo",
          state: "ready",
          durationMillis: 900_000,
          distanceMeters: 12_300,
          geometryQuality: "detailed",
          path: [
            { lat: 35, lng: 135, altitude: 0 },
            { lat: 35.05, lng: 135.05, altitude: 0 },
            { lat: 35.1, lng: 135.1, altitude: 0 },
          ],
        },
      ],
    });
    const requestUrl = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toBe("/api/v6/plan");
    expect(requestUrl.searchParams.get("transitModes")).toBe("TRANSIT");
    expect(requestUrl.searchParams.get("radius")).toBe("1000");
    expect(requestUrl.searchParams.get("time")).toBe(batch.routes[0]?.departureTime);
  });

  it("does not report a partial distance when a transit leg has no distance", async () => {
    process.env.MOTIS_URL = "http://motis.test:8080";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          itineraries: [
            {
              duration: 2_700,
              legs: [
                {
                  mode: "WALK",
                  startTime: "2027-04-10T00:00:00Z",
                  endTime: "2027-04-10T00:05:00Z",
                  duration: 300,
                  distance: 500,
                  legGeometry: {
                    points: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
                    precision: 5,
                    length: 3,
                  },
                },
                {
                  mode: "RAIL",
                  startTime: "2027-04-10T00:05:00Z",
                  endTime: "2027-04-10T00:45:00Z",
                  duration: 2_400,
                  legGeometry: {
                    points: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
                    precision: 5,
                    length: 3,
                  },
                },
              ],
            },
          ],
        }),
      ),
    );

    const route = (await computeMotisRoutes(batch)).routes[0];
    if (route?.state !== "ready") throw new Error("Expected a ready MOTIS route");
    expect(route.distanceMeters).toBeNull();
    expect(route.geometryQuality).toBe("approximate");
  });

  it("falls back when MOTIS returns invalid geometry metadata", async () => {
    process.env.MOTIS_URL = "http://motis.test:8080";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          itineraries: [
            {
              duration: 900,
              legs: [
                {
                  mode: "RAIL",
                  startTime: "2027-04-10T00:00:00Z",
                  endTime: "2027-04-10T00:15:00Z",
                  duration: 900,
                  legGeometry: {
                    points: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
                    precision: 5,
                    length: 4,
                  },
                },
              ],
            },
          ],
        }),
      ),
    );

    expect(await computeMotisRoutes(batch)).toEqual({
      routes: [{ id: "tokyo", state: "fallback" }],
    });
  });
});

describe("MOTIS encoded geometry", () => {
  it("decodes the response precision into provider-neutral map points", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5)).toEqual([
      { lat: 38.5, lng: -120.2, altitude: 0 },
      { lat: 40.7, lng: -120.95, altitude: 0 },
      { lat: 43.252, lng: -126.453, altitude: 0 },
    ]);
  });
});
