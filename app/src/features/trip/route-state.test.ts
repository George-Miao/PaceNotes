import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { requireTripMetadata, TripLoadError } from "./route-state";

describe("trip route loading", () => {
  it("classifies only an absent trip as not found", async () => {
    await expect(requireTripMetadata(async () => null)).rejects.toMatchObject({
      isNotFound: true,
    });
  });

  it("keeps load failures as errors", async () => {
    const failure = new Error("Database unavailable");

    await expect(
      requireTripMetadata(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });

  it("shows a load error instead of a missing-trip message", () => {
    const html = renderToStaticMarkup(createElement(TripLoadError));

    expect(html).toContain("Trip could not be loaded");
    expect(html).toContain("Something went wrong");
    expect(html).not.toContain("Trip not found");
  });
});
