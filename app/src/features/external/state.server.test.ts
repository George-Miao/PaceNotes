import { expect, it } from "vitest";
import { ExternalError } from "./contract";
import { assertLocalTime } from "./state.server";

it("rejects a daylight-saving gap without moving the local clock", () => {
  expect(() => assertLocalTime("2027-03-14", "02:30", "America/New_York")).toThrow(
    /daylight-saving gap/,
  );
});

it("returns both offsets for a duplicate local time", () => {
  try {
    assertLocalTime("2027-11-07", "01:30", "America/New_York");
    throw new Error("Expected an ambiguous local time error");
  } catch (error) {
    expect(error).toBeInstanceOf(ExternalError);
    expect(error).toMatchObject({
      code: "INVALID_PARAMS",
      data: { offsets: ["-04:00", "-05:00"] },
    });
  }
});
