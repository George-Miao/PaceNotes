import { describe, expect, it } from "vitest";
import { dayColor } from "./day-colors";

describe("day colors", () => {
  it("gives every supported trip day a distinct bright identity", () => {
    const colors = Array.from({ length: 30 }, (_, index) => dayColor(index));

    expect(new Set(colors.map((color) => color.background))).toHaveLength(30);
    expect(colors.every((color) => color.text === "#000000" || color.text === "#ffffff")).toBe(
      true,
    );
    for (const color of colors) {
      expect(contrast(color.background, color.text)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

function contrast(left: string, right: string): number {
  const [dark, light] = [luminance(left), luminance(right)].toSorted((a, b) => a - b);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

function luminance(color: string): number {
  return [1, 3, 5]
    .map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    .reduce((total, channel, index) => total + channel * ([0.2126, 0.7152, 0.0722][index] ?? 0), 0);
}
