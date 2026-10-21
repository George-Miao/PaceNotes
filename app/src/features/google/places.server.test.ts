import { afterEach, expect, it, vi } from "vitest";
import { destinationTimeZone, searchPlaces } from "./places.server";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("reads the IANA time zone from Places Place Details", async () => {
  vi.stubEnv("GOOGLE_MAPS_SERVER_API_KEY", "test-server-key");
  const request = vi.fn(async (_url: unknown, init: RequestInit) => {
    expect((init.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe("timeZone");
    return new Response(JSON.stringify({ timeZone: { id: "Asia/Tokyo", version: "2027a" } }));
  });
  vi.stubGlobal("fetch", request);
  expect(await destinationTimeZone("test-place-id")).toBe("Asia/Tokyo");
  expect(request).toHaveBeenCalledTimes(1);
});

it("does not accept a malformed provider time zone or search result", async () => {
  vi.stubEnv("GOOGLE_MAPS_SERVER_API_KEY", "test-server-key");
  vi.stubGlobal(
    "fetch",
    async () => new Response(JSON.stringify({ timeZone: { id: "Bad/Zone" } })),
  );
  await expect(destinationTimeZone("test-place-id")).rejects.toMatchObject({
    code: "PROVIDER_UNAVAILABLE",
  });
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ places: [null] })));
  await expect(searchPlaces("test query")).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
});
