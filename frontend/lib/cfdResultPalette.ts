import { Color, SRGBColorSpace } from "three";

export const RESULT_PALETTES = {
  spectrum: "Spectrum",
  sequential: "Blue to yellow",
  viridis: "Viridis",
  inferno: "Inferno",
  diverging: "Blue–white–red",
} as const;
export type ResultPalette = keyof typeof RESULT_PALETTES;

const stops = {
  viridis: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"].map(value => new Color(value)),
  inferno: ["#000004", "#420a68", "#932667", "#dd513a", "#fca50a", "#fcffa4"].map(value => new Color(value)),
  diverging: ["#2166ac", "#f7f7f7", "#b2182b"].map(value => new Color(value)),
};

export function paintResult(colour: Color, fraction: number, palette: ResultPalette) {
  if (palette === "spectrum") return colour.setHSL((1 - fraction) * .66, .8, .5);
  if (palette === "sequential") return colour.setRGB(.02 + .98 * fraction, .08 + .71 * fraction, .65 - .60 * fraction);
  const colours = stops[palette], offset = fraction * (colours.length - 1);
  const segment = Math.min(colours.length - 2, Math.floor(offset));
  return colour.lerpColors(colours[segment], colours[segment + 1], offset - segment);
}

const screenColours = new Map<ResultPalette, number[][]>();
export function resultPaletteStops(palette: string) {
  if (!Object.hasOwn(RESULT_PALETTES, palette)) return undefined;
  const name = palette as ResultPalette;
  const cached = screenColours.get(name);
  if (cached) return cached;
  const colour = new Color(), rgb = {r: 0, g: 0, b: 0};
  const sampled = Array.from({length: 25}, (_, index) => {
    paintResult(colour, index / 24, name).getRGB(rgb, SRGBColorSpace);
    return [rgb.r, rgb.g, rgb.b];
  });
  screenColours.set(name, sampled);
  return sampled;
}
