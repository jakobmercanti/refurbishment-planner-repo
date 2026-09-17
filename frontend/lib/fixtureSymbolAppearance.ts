type Rgb = [number, number, number];

type PartColours = Record<string, string>;
type MaterialRole = "base" | "frame" | "cushions" | "back" | "bedding" | "blanket" | "legs" | "glass" | "hardware";

function parseColour(value?: string): Rgb | null {
  const match = /^#([\da-f]{6})$/i.exec(value ?? "");
  if (!match) return null;
  return [Number.parseInt(match[1].slice(0, 2), 16), Number.parseInt(match[1].slice(2, 4), 16), Number.parseInt(match[1].slice(4, 6), 16)];
}

function toHex(colour: Rgb): string {
  return `#${colour.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function mixColour(source: Rgb, target: Rgb, amount: number): string {
  const rgb = source.map((channel, index) => Math.round(channel + (target[index] - channel) * amount)) as Rgb;
  return toHex(rgb);
}

function partColour(partColours: PartColours | undefined, ids: string[], fallback?: string): Rgb | null {
  for (const id of ids) {
    const colour = parseColour(partColours?.[id]);
    if (colour) return colour;
  }
  return parseColour(fallback);
}

function styleGradient(id: string, colour: Rgb, creative: boolean): string {
  // Keep the source colour dominant. The two tones add the small amount of
  // depth used by the styled floorplans without washing a coloured asset out.
  const light = mixColour(colour, [255, 255, 255], creative ? .10 : .06);
  const shade = mixColour(colour, [0, 0, 0], creative ? .12 : .09);
  return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${light}"/><stop offset="100%" stop-color="${shade}"/></linearGradient>`;
}

function fallbackBase(key: string, creative: boolean): Rgb {
  const colour = key.startsWith("shower")
    ? (creative ? "#edf5ec" : "#edf8f8")
    : /vanity|furniture/.test(key)
      ? (creative ? "#e8dfcf" : "#eadcc3")
      : creative ? "#fffaf0" : "#ffffff";
  return parseColour(colour) ?? [244, 243, 238];
}

function baseColour(key: string, actualColour: string | undefined, partColours: PartColours | undefined, creative: boolean): Rgb {
  const fallback = fallbackBase(key, creative);
  const ids = key.startsWith("shower") ? ["tray", "frame", "body", "full"]
    : key.startsWith("basin") ? ["basin", "body", "fronts", "full"]
      : key.startsWith("toilet") ? ["body", "full"]
      : key.startsWith("door") ? ["leaf", "fronts", "body", "frame", "full"]
        : key.startsWith("window") ? ["frame", "sash", "body", "full"]
          : key.startsWith("furniture-stair-") ? ["treads", "structure", "infill", "full"]
            : /^furniture-(kitchen-|storage-|wardrobe-)/.test(key) ? ["body", "fronts", "top", "full"]
              : /^furniture-(sofa|armchair|chair|bed)-/.test(key) ? ["frame", "body", "cushions", "full"]
                : /^furniture-table-/.test(key) ? ["top", "frame", "body", "full"]
                  : ["body", "frame", "top", "full"];
  return partColour(partColours, ids, actualColour) ?? fallback;
}

function roleColours(key: string, actualColour: string | undefined, partColours: PartColours | undefined, creative: boolean): Record<MaterialRole, Rgb> {
  const base = baseColour(key, actualColour, partColours, creative);
  const colour = (ids: string[], fallback = base) => partColour(partColours, ids) ?? fallback;
  return {
    base,
    frame: colour(["frame", "body", "full"]),
    cushions: colour(["cushions", "bedding", "body", "full"]),
    back: colour(["back", "frame", "body", "full"]),
    bedding: colour(["bedding", "cushions", "secondary", "full"]),
    blanket: colour(["blanket", "bedding", "cushions", "full"]),
    legs: colour(["legs", "timber", "structure", "hardware"], base),
    glass: colour(["glass", "infill"], base),
    hardware: colour(["hardware", "clamps", "seals"], base),
  };
}

function addFillToElement(match: string, fill: string): string {
  const close = match.endsWith("/>") ? "/>" : ">";
  const attrs = match.slice(0, -close.length);
  if (/\sfill\s*=/i.test(attrs)) return `${attrs.replace(/\sfill\s*=\s*"[^"]*"/i, ` fill="${fill}"`)}${close}`;
  return `${attrs} fill="${fill}"${close}`;
}

function overrideShapeFills(svg: string, shapeNames: string[], predicate: (index: number, name: string) => boolean, fill: string): string {
  const shapePattern = shapeNames.join("|");
  let index = 0;
  return svg.replace(new RegExp(`<(${shapePattern})\\b[^>]*?(?:/?>)`, "gi"), (match, name: string) => {
    const current = index++;
    return predicate(current, name.toLowerCase()) ? addFillToElement(match, fill) : match;
  });
}

function semanticFurnitureFills(svg: string, key: string): string {
  if (/^furniture-(sofa)-/.test(key)) {
    // The simple sofa plan symbol has an outer body and an inset seat area.
    // Keep the body inherited from the frame and colour the inset like the 3D
    // cushions. Corner symbols only expose the body path, so they retain it.
    return overrideShapeFills(svg, ["rect"], (index) => index === 1, "url(#fixture-cushions)");
  }
  if (/^furniture-bed-/.test(key)) {
    // Bed symbols use the first rectangle for the frame and following
    // rectangles for pillows. The bedding remains independent of the frame.
    return overrideShapeFills(svg, ["rect"], (index) => index > 0, "url(#fixture-bedding)");
  }
  if (/^furniture-table-/.test(key)) {
    // The four closed subpaths mark the leg positions in the plan symbol.
    return overrideShapeFills(svg, ["path"], () => true, "url(#fixture-legs)");
  }
  return svg;
}

function fillFurnitureSilhouette(svg: string, fill: string): string {
  // A number of the architectural furniture symbols are deliberately drawn
  // as outline-only groups. Styled floorplans still need a quiet colour wash
  // for those closed silhouettes so they do not disappear beside the 3D
  // preview.
  return svg.replace(/(<g\b[^>]*?)\sfill\s*=\s*"none"/gi, `$1 fill="${fill}"`);
}

function materialDefs(roles: Record<MaterialRole, Rgb>, creative: boolean): string {
  return Object.entries(roles).map(([role, colour]) => styleGradient(`fixture-${role}`, colour, creative)).join("");
}

function replaceNeutralFills(svg: string, fill: string): string {
  return svg.replace(/fill="(?:white|#fff|#ffffff|#f1eee7|#e3e7e2|#ddd)"/gi, `fill="${fill}"`);
}

/** Colour the existing vector symbol without changing its measured outline. */
export function colouredFixtureSymbol(svg: string, key: string, creative: boolean, actualColour?: string, partColours?: PartColours): string {
  const roles = roleColours(key, actualColour, partColours, creative);
  const defs = `<defs>${materialDefs(roles, creative)}</defs>`;
  const baseFill = "url(#fixture-base)";
  let coloured = svg.replace(/(<svg\b[^>]*>)/i, `$1${defs}`);
  coloured = replaceNeutralFills(coloured, baseFill)
    .replace(/stroke="#202724"/gi, `stroke="${creative ? "#77796d" : "#526763"}"`)
    .replace(/stroke="#bbb"/gi, 'stroke="#92b4b2"')
    .replace(/(<ellipse\b[^>]*?)(\/?>)/gi, (match, attrs: string, close: string) => attrs.includes("fill=") ? match : `${attrs} fill="url(#fixture-base)"${close}`);

  if (/^furniture-/.test(key)) {
    coloured = fillFurnitureSilhouette(coloured, baseFill);
    coloured = semanticFurnitureFills(coloured, key);
  }

  // Outline-only catalogue symbols should still carry the actual object's
  // primary colour, while keeping a readable edge in both styled modes.
  const outline = mixColour(roles.frame, [0, 0, 0], creative ? .28 : .24);
  if (!/fill="url\(#fixture-(?:base|cushions|bedding|legs)\)"/i.test(coloured)) {
    coloured = coloured.replace(/stroke="(?:#26332e|#26342d|#283e36|#293538|#222|#111)"/gi, `stroke="${outline}"`);
  }
  return coloured;
}
