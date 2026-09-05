import { describe, expect, it, vi } from "vitest";
import { loadRoutesLibrary } from "./google";
import { type PlacementRouteStop, readGooglePlacementTravelTimes } from "./place-placement-routes";

vi.mock("./google", () => ({ loadRoutesLibrary: vi.fn() }));

describe("Google placement routes", () => {
  it("batches transit matrices within Google's 100-element limit", async () => {
    const computeRouteMatrix = vi.fn(
      async (request: google.maps.routes.ComputeRouteMatrixRequest) => {
        const origins = [...request.origins];
        const destinations = [...request.destinations];
        return {
          matrix: {
            rows: origins.map(() => ({
              items: destinations.map(() => ({ durationMillis: 60_000 })),
            })),
          },
        };
      },
    );
    vi.mocked(loadRoutesLibrary).mockResolvedValue({
      RouteMatrix: { computeRouteMatrix },
    } as unknown as google.maps.RoutesLibrary);
    const stops: PlacementRouteStop[] = Array.from({ length: 250 }, (_, index) => ({
      id: `stop-${index}`,
      latitude: 35 + index / 10_000,
      longitude: 139,
      travelMode: "TRANSIT",
    }));

    const travelTimes = await readGooglePlacementTravelTimes(stops, {
      id: "new",
      latitude: 35,
      longitude: 139,
      travelMode: "TRANSIT",
    });

    expect(computeRouteMatrix).toHaveBeenCalledTimes(6);
    for (const [request] of computeRouteMatrix.mock.calls) {
      expect([...request.origins].length * [...request.destinations].length).toBeLessThanOrEqual(
        100,
      );
    }
    expect(travelTimes).toHaveLength(500);
    expect(travelTimes.filter((leg) => leg.toId === "new")).toHaveLength(250);
    expect(travelTimes.filter((leg) => leg.fromId === "new")).toHaveLength(250);
  });
});
