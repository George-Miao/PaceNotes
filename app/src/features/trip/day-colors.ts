const dayColors = Array.from({ length: 30 }, (_, index) => {
  const hue = (201 + index * 137.508) % 360;
  const background = hslToHex(hue, 0.82, 0.48);
  return { background, text: contrastText(background) };
});

export function dayColor(index: number): { background: string; text: string } {
  return dayColors[index % dayColors.length] ?? { background: "#007bb8", text: "#ffffff" };
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const segment = hue / 60;
  const secondary = chroma * (1 - Math.abs((segment % 2) - 1));
  const [red, green, blue] =
    segment < 1
      ? [chroma, secondary, 0]
      : segment < 2
        ? [secondary, chroma, 0]
        : segment < 3
          ? [0, chroma, secondary]
          : segment < 4
            ? [0, secondary, chroma]
            : segment < 5
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  const match = lightness - chroma / 2;
  return `#${[red, green, blue]
    .map((channel) =>
      Math.round((channel + match) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function contrastText(background: string): string {
  const channels = [1, 3, 5].map((offset) =>
    Number.parseInt(background.slice(offset, offset + 2), 16),
  );
  const luminance = channels
    .map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    })
    .reduce((total, channel, index) => total + channel * ([0.2126, 0.7152, 0.0722][index] ?? 0), 0);
  return luminance > 0.179 ? "#000000" : "#ffffff";
}
