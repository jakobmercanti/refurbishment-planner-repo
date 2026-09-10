import flooringPatterns from "./flooringPatterns.json" with { type: "json" };
import type { MaterialCollection } from "./types";
import tileMaterials from "./tileMaterials.json" with { type: "json" };
export const TILE_MATERIALS = tileMaterials;

export const WOOD_COLOURS = [
  { id: "natural-oak", name: "Natural oak", base: "#b89a70", grain: "#786044", seed: 11 },
  { id: "white-oak", name: "White oak", base: "#d7c6a5", grain: "#a08b68", seed: 23 },
  { id: "smoked-oak", name: "Smoked oak", base: "#85715a", grain: "#493c30", seed: 31 },
  { id: "walnut", name: "Walnut", base: "#71503a", grain: "#35281f", seed: 43 },
  { id: "maple", name: "Maple", base: "#e3cda5", grain: "#b2986d", seed: 59 },
  { id: "ash", name: "Ash", base: "#cdb996", grain: "#877255", seed: 67 },
  { id: "birch", name: "Birch", base: "#dfc5a2", grain: "#b38d64", seed: 79 },
  { id: "beech", name: "Beech", base: "#cba380", grain: "#976f51", seed: 83 },
  { id: "cherry", name: "Cherry", base: "#ac7253", grain: "#72422f", seed: 97 },
  { id: "mahogany", name: "Mahogany", base: "#814d3e", grain: "#482820", seed: 103 },
  { id: "teak", name: "Teak", base: "#ad8752", grain: "#72532f", seed: 113 },
  { id: "pine", name: "Pine", base: "#d7b37c", grain: "#9b723e", seed: 127 },
  { id: "douglas-fir", name: "Douglas fir", base: "#c89569", grain: "#935e39", seed: 139 },
  { id: "wenge", name: "Wenge", base: "#493a30", grain: "#201c19", seed: 149 },
  { id: "grey-oak", name: "Grey oak", base: "#a9a397", grain: "#6f695e", seed: 163 },
] as const;

export type FlooringPattern = "tile-square" | "tile-rectangle" | "tile-herringbone" | "tile-chevron" | "tile-double-herringbone" | "wood-plank" | "wood-herringbone" | "wood-double-herringbone" | "wood-chevron" | "wood-weave" | "wood-hexagonal" | "wood-versailles" | "wood-mosaic" | "wood-chantilly" | "wood-double-basket-weave";
export const FLOORING_PATTERNS = flooringPatterns as { id: FlooringPattern; name: string; material: "wood" | "tile"; width: number; length: number }[];
export interface FloorDesign {
  tile_material_id?: string;
  pattern: FlooringPattern;
  width_mm: number;
  length_mm: number;
  rotation_deg: number;
  wood_id: string;
  tile_colour: string;
  grout_colour: string;
  grout_mm: number;
}
export function defaultFloorDesign(pattern: FlooringPattern = "tile-square"): FloorDesign {
  const preset = FLOORING_PATTERNS.find((p) => p.id === pattern) ?? FLOORING_PATTERNS[0];
  return { pattern: preset.id, width_mm: preset.width, length_mm: preset.length, rotation_deg: 0,
    wood_id: "natural-oak", tile_colour: "#d8d4c9", grout_colour: preset.material === "wood" ? "#65523d" : "#efede7", grout_mm: preset.material === "wood" ? 1 : 3 };
}
const bounded = (value: number, fallback: number, min: number, max: number) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const colour = (value: string, fallback: string) => /^#[\da-f]{6}$/i.test(value) ? value : fallback;
/** Validate imported finishes as well as editor input. Values remain millimetre-authoritative. */
export function normalizeFloorDesign(input: FloorDesign): FloorDesign {
  const fallback = defaultFloorDesign(input.pattern);
  const width = bounded(input.width_mm, fallback.width_mm, 20, 3000);
  const { tile_material_id, ...settings } = input;
  return { ...fallback, ...settings, pattern: fallback.pattern,
    ...(TILE_MATERIALS.some((tile) => tile.id === tile_material_id) ? { tile_material_id } : {}),
    width_mm: width, length_mm: fallback.pattern === "tile-square" || fallback.pattern === "wood-hexagonal" ? width : bounded(input.length_mm, fallback.length_mm, width, 6000),
    rotation_deg: ((bounded(input.rotation_deg, 0, -36000, 36000) % 360) + 360) % 360,
    wood_id: WOOD_COLOURS.some((w) => w.id === input.wood_id) ? input.wood_id : fallback.wood_id,
    tile_colour: colour(input.tile_colour, fallback.tile_colour), grout_colour: colour(input.grout_colour, fallback.grout_colour),
    grout_mm: bounded(input.grout_mm, fallback.grout_mm, 0, Math.min(20, width / 4)) };
}
export function floorDesignColour(input: FloorDesign) {
  const d = normalizeFloorDesign(input);
  return d.pattern.startsWith("wood-") ? WOOD_COLOURS.find((w) => w.id === d.wood_id)!.base : d.tile_colour;
}

/** A periodic, self-contained SVG swatch: shared by catalogue, 3D and offline 2D exports.
 * Board-local grain is deterministic and clipped to each element; no external images or AI.
 * Rotation is applied by consumers in world coordinates, never baked into a repeating bitmap.
 */
export function flooringSwatch(input: FloorDesign): { width: number; height: number; svg: string; url: string; diagonal: boolean } {
  const d = normalizeFloorDesign(input), w = d.width_mm, l = d.length_mm;
  const wood = d.pattern.startsWith("wood-") ? WOOD_COLOURS.find((c) => c.id === d.wood_id)! : null;
  const base = wood?.base ?? d.tile_colour;
  const tile = !wood ? TILE_MATERIALS.find((tile) => tile.id === d.tile_material_id) : undefined;
  let width = l, height = w * 2;
  const shapes: string[] = [];
  let serial = 0;
  const diagonal = d.pattern.endsWith("herringbone");
  function board(x: number, y: number, length: number, breadth: number, angle = 0, polygon?: string, grainAngle = 0, variation?: number) {
    if (diagonal) {
      const radians = angle * Math.PI / 180;
      const corners = [[0, 0], [length, 0], [length, breadth], [0, breadth]].map(([px, py]) => {
        const tx = x + px * Math.cos(radians) - py * Math.sin(radians), ty = y + px * Math.sin(radians) + py * Math.cos(radians);
        return { u: (tx - ty) / 2, v: (tx + ty) / 2 };
      });
      if (Math.max(...corners.map((p) => p.u)) < 0 || Math.min(...corners.map((p) => p.u)) > width || Math.max(...corners.map((p) => p.v)) < 0 || Math.min(...corners.map((p) => p.v)) > height) return;
    }
    const n = serial++, seed = (wood?.seed ?? 1) + (variation ?? n) * 37;
    const outline = polygon ? `<polygon points="${polygon}"` : `<rect width="${length}" height="${breadth}"`;
    const grain = wood ? Array.from({ length: 32 }, (_, j) => {
      const gy = breadth * (j - 8) / 16, bend = Math.sin(seed + j * .2) * breadth * .11;
      return `<path d="M${-length} ${gy} C${length * .2} ${gy + bend} ${length * .23} ${gy - bend} ${length * .5} ${gy} S${length * .8} ${gy + bend} ${length * 2} ${gy + bend}" fill="none" stroke="${wood.grain}" stroke-opacity="${.16 + j % 3 * .08}" stroke-width="${Math.max(.4, breadth / 130)}"/>`;
    }).join("") : "";
    const knot = wood && seed % 3 === 0 ? `<ellipse cx="${length * .37}" cy="${breadth * .55}" rx="${Math.min(length * .1, breadth * .35)}" ry="${breadth * .09}" fill="none" stroke="${wood.grain}" stroke-opacity=".3" stroke-width="${breadth / 90}"/>` : "";
    let texture = "";
    const accent = tile?.id === "heritage-green" ? "#49675A" : "#365573";
    if (tile?.pattern === "checker" && (variation ?? n) % 2 !== 0) texture = `<rect width="${length}" height="${breadth}" fill="#303437"/>`;
    if (tile?.pattern === "heritage") texture = `<path d="M${length/2} 0 L${length} ${breadth/2} L${length/2} ${breadth} L0 ${breadth/2} Z" fill="none" stroke="${accent}" stroke-width="${breadth*.08}"/><circle cx="${length/2}" cy="${breadth/2}" r="${Math.min(length,breadth)*.19}" fill="${accent}"/>`;
    if (tile && ["vein", "speckle", "mottle"].includes(tile.pattern)) texture = Array.from({length: 36}, (_, j) => {
      const px = ((j*73+seed*11)%997)/997*length, py = ((j*137+seed*17)%991)/991*breadth;
      return tile.pattern === "vein" ? `<path d="M0 ${py} Q${length*.4} ${py+breadth*.18} ${length} ${py-breadth*.08}" fill="none" stroke="#786F63" stroke-opacity=".17" stroke-width="${breadth*.004}"/>` : `<circle cx="${px}" cy="${py}" r="${breadth*(tile.pattern === "speckle" ? .014 : .08)}" fill="${j%2 ? "#fff" : "#625B51"}" opacity="${tile.pattern === "speckle" ? .3 : .04}"/>`;
    }).join("");
    shapes.push(`<g transform="translate(${x} ${y}) rotate(${angle})"><defs><clipPath id="b${n}">${outline}/></clipPath></defs>${outline} fill="${base}"/><g clip-path="url(#b${n})"><g transform="rotate(${grainAngle} ${length / 2} ${breadth / 2})">${grain}${knot}${texture}</g><rect width="${length}" height="${breadth}" fill="${seed % 2 ? "#fff" : "#000"}" opacity="${wood ? .025 + (seed % 5) * .012 : .012}"/></g>${outline} fill="none" stroke="${d.grout_colour}" stroke-width="${d.grout_mm}"/></g>`);
  }
  if (diagonal) {
    // Basis (w,-w), (l,l) tiles for ANY board aspect ratio. Consumers undo
    // the SVG's basis transform, preserving entered physical board dimensions.
    const pair = d.pattern === "tile-double-herringbone" || d.pattern === "wood-double-herringbone" ? 2 : 1;
    const band = pair * w;
    width = 2 * band; height = 2 * l;
    const count = Math.ceil((2 * l + band) / band) + 2;
    for (let a = -count; a <= count; a++) for (let b = -2; b <= 3; b++) {
      const x = a * band + b * l, y = -a * band + b * l;
      const variation = ((a % 2 + 2) % 2) * 2 + ((b % 2 + 2) % 2) * 4;
      for (let j = 0; j < pair; j++) {
        board(x, y + j * w, l, w, 0, undefined, 0, variation + j);
        board(x + l + band - j * w, y, l, w, 90, undefined, 0, variation + j + 2);
      }
    }
  } else if (d.pattern.endsWith("chevron")) {
    width = l * Math.SQRT2; height = w * Math.SQRT2;
    const half = width / 2;
    for (let j = -Math.ceil(l / w); j <= 1; j++) {
      const y = j * height;
      board(0, y, half, half + height, 0, `0,0 ${half},${half} ${half},${half + height} 0,${height}`, 45, 0);
      board(half, y, half, half + height, 0, `0,${half} ${half},0 ${half},${height} 0,${half + height}`, -45, 1);
    }
  } else if (d.pattern === "wood-chantilly") {
    width = height = l;
    const border = Math.min(w, l / 8), cell = (l - 2 * border) / 3, rail = cell / 4;
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
      const x = border + col * cell, y = border + row * cell;
      board(x, y, cell - rail, cell - rail, 0, undefined, (row + col) % 2 ? 90 : 0);
      board(x + cell, y, cell, rail, 90);
      board(x, y + cell - rail, cell - rail, rail);
    }
    board(0, 0, l, border); board(0, l - border, l, border);
    board(border, border, l - 2 * border, border, 90); board(l, border, l - 2 * border, border, 90);
  } else if (d.pattern === "wood-double-basket-weave") {
    width = height = 2 * l;
    for (let row = -2; row < 4; row++) for (let col = -2; col < 4; col++) {
      for (let j = 0; j < 2; j++) {
        if ((row + col) % 2) board((col + 1) * l - j * l / 2, row * l, l, l / 2, 90);
        else board(col * l, row * l + j * l / 2, l, l / 2);
      }
    }
    const weave = shapes.join(""); shapes.length = 0;
    // A square repeat in the rotated lattice, without seams at the swatch edge.
    width = height = Math.SQRT2 * l;
    shapes.push(`<g transform="rotate(45) scale(1)">${weave}</g>`);
  } else if (d.pattern === "wood-mosaic" || d.pattern === "wood-weave" || d.pattern === "wood-versailles") {
    const framed = d.pattern === "wood-versailles", border = framed ? Math.min(w, l / 5) : 0;
    width = height = framed ? l : 2 * l;
    const cell = framed ? (l - border * 2) / 2 : l;
    const count = Math.max(1, Math.ceil(cell / w));
    for (let y = framed ? -1 : 0; y < (framed ? 3 : 2); y++) for (let x = framed ? -1 : 0; x < (framed ? 3 : 2); x++) for (let j = 0; j < count; j++) {
      const breadth = Math.min(w, cell - j * w);
      if ((x + y) % 2) board(border + (x + 1) * cell - j * w, border + y * cell, cell, breadth, 90);
      else board(border + x * cell, border + y * cell + j * w, cell, breadth);
    }
    if (framed) {
      const weave = shapes.join("");
      shapes.length = 0;
      shapes.push(`<defs><clipPath id="panel"><rect x="${border}" y="${border}" width="${l - 2 * border}" height="${l - 2 * border}"/></clipPath></defs><g clip-path="url(#panel)"><g transform="translate(${l / 2} ${l / 2}) rotate(45) translate(${-l / 2} ${-l / 2})">${weave}</g></g>`);
      board(0, 0, l, border); board(0, l - border, l, border); board(border, border, l - 2 * border, border, 90); board(l, border, l - 2 * border, border, 90);
    }
  } else if (d.pattern === "wood-hexagonal") {
    const r = w / 2, h = Math.sqrt(3) * r;
    width = 3 * r; height = h;
    for (let x = -1; x <= 2; x++) for (let y = -1; y <= 1; y++) {
      const cy = y * h + (x % 2 ? h / 2 : 0);
      const points = Array.from({ length: 6 }, (_, j) => `${r + r * Math.cos(j * Math.PI / 3)},${h / 2 + r * Math.sin(j * Math.PI / 3)}`).join(" ");
      board(x * r * 1.5 - r, cy - h / 2, w, h, 0, points, x % 2 ? 60 : -60, Math.abs(x % 2));
    }
  } else {
    const stagger = d.pattern === "wood-plank";
    if (tile?.pattern === "checker") width = l * 2;
    for (let row = 0; row < 2; row++) for (let col = -1; col < 3; col++) board(col * l + (stagger && row % 2 ? l / 2 : 0), row * w, l, w, 0, undefined, 0, tile?.pattern === "checker" ? Math.abs(row + col) : row);
  }
  const svg = `<svg preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" width="${Math.max(64, Math.round(1024 * width / Math.max(width, height)))}" height="${Math.max(64, Math.round(1024 * height / Math.max(width, height)))}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${base}"/><g${diagonal ? ' transform="matrix(.5 .5 -.5 .5 0 0)"' : ""}>${shapes.join("")}</g></svg>`.replace(/-?\d+\.\d{4,}/g, (value) => Number(value).toFixed(3));
  return { width, height, svg, url: `data:image/svg+xml,${encodeURIComponent(svg)}`, diagonal };
}

export const FLOORING_COLLECTIONS: MaterialCollection[] = [
  { id: "wood-colours", kind: "PAINT", name: "Wood colours", families: [{ id: "wood-types", name: "Wood types", items: WOOD_COLOURS.map((wood) => ({ id: wood.id, name: wood.name, color_hex: wood.base, metadata: { wood_id: wood.id } })) }] },
  ...(["tile", "wood"] as const).map((material): MaterialCollection => ({ id: `flooring-${material}`, kind: "TILE", name: material === "tile" ? "Tiles" : "Wooden flooring", families: FLOORING_PATTERNS.filter((p) => p.material === material).map((p) => ({ id: p.id, name: p.name, items: [{ id: p.id, name: p.name, color_hex: material === "tile" ? "#d8d4c9" : WOOD_COLOURS[0].base, metadata: { flooring_pattern: p.id } }] })) })),
];
