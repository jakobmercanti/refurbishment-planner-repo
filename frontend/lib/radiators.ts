/** Representation identifiers match the additive database radiator defaults. */
export const RADIATOR_KEYS = [
  { family: "horizontal", widths: [600, 900, 1200] },
  { family: "vertical", widths: [300, 450, 600] },
  { family: "bathroom", widths: [400, 500, 600] },
].flatMap(({ family, widths }) => [1, 2].flatMap(rows => widths.map(width => `furniture-radiator-${family}-${rows}-${width}`)));
