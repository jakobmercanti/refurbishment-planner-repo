import type { Point2D, Room, TilePattern } from "./types";

export function appearanceSeed(value: string): number {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

const PALETTE = ["#e5d4b4", "#c3d8db", "#d5d9c6", "#e2c9bc", "#d3cddd", "#ddd8cc", "#c2d4c7", "#e5dcbc"];
const validColour = (value: string | undefined) => value && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;

/** Stable identities choose contrasting defaults; explicit 3D finishes always win. */
export function roomAppearances(rooms: Room[]) {
  const assigned = new Map<string, number>();
  [...rooms].sort((a, b) => a.id.localeCompare(b.id)).forEach((room) => {
    const start = appearanceSeed(room.id) % PALETTE.length;
    let index = start;
    for (let offset = 0; offset < PALETTE.length; offset++) {
      const candidate = (start + offset) % PALETTE.length;
      if (![...assigned.values()].includes(candidate)) { index = candidate; break; }
    }
    assigned.set(room.id, index);
  });
  return rooms.map((room) => {
    const finishes = room.finishes;
    const custom = finishes?.floor_tile_colours?.[finishes.floor_tile_id ?? ""];
    const explicit = Boolean(finishes && (finishes.floor_color || finishes.floor_tile_id || finishes.floor_pattern !== undefined));
    const wetRoom = /bath|shower|toilet|laundry|utility/i.test(room.name);
    const base = validColour(custom?.base) ?? validColour(finishes?.floor_color) ?? PALETTE[assigned.get(room.id) ?? 0];
    return { room, base, accent: validColour(custom?.accent) ?? base, grout: validColour(custom?.grout) ?? "#f6f3eb",
      pattern: (finishes?.floor_pattern ?? (explicit ? "NONE" : wetRoom ? "SQUARE_300" : "WOOD")) as TilePattern | "WOOD",
      explicit };
  });
}

function inside(point: Point2D, polygon: Point2D[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

/** Decorative planting only: a complete canopy must clear every room and wall edge. */
export function gardenClear(point: Point2D, radius: number, polygons: Point2D[][]): boolean {
  return polygons.every((polygon) => !inside(point, polygon) && polygon.every((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy) > radius;
  }));
}
