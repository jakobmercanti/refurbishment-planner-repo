import type { Point2D, Room } from "./types";
import type { UFHZone } from "./heatingDocument";
import { roundPipeCorners, ufhLayoutCorners } from "./heatingGeometry";

const sub = (a: Point2D, b: Point2D) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (p: Point2D) => Math.hypot(p.x, p.y);
const cross = (a: Point2D, b: Point2D) => a.x * b.y - a.y * b.x;
const unit = (p: Point2D) => { const d = len(p) || 1; return { x: p.x / d, y: p.y / d }; };
const middle = (a: Point2D, b: Point2D) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
function intersection(a: Point2D, u: Point2D, b: Point2D, v: Point2D): Point2D | null {
  const denominator = cross(u, v); if (Math.abs(denominator) < 1e-7) return null;
  const t = cross(sub(b, a), v) / denominator; return { x: a.x + t * u.x, y: a.y + t * u.y };
}
export interface UFHBend { indices: number[]; position: Point2D; direction: Point2D; radius: number; radiusHandle: Point2D }

function crossesItself(path: Point2D[]) {
  const segments = path.slice(1).map((b, i) => ({ a: path[i], b, i, low: Math.min(path[i].x, b.x), high: Math.max(path[i].x, b.x) })).sort((a, b) => a.low - b.low);
  let active: typeof segments = [];
  for (const segment of segments) {
    active = active.filter(s => s.high >= segment.low - .001);
    for (const other of active) {
      if (Math.abs(segment.i - other.i) <= 1) continue;
      const u = sub(segment.b, segment.a), v = sub(other.b, other.a), denominator = cross(u, v);
      if (Math.abs(denominator) < 1e-7) continue;
      const offset = sub(other.a, segment.a), t = cross(offset, v) / denominator, s = cross(offset, u) / denominator;
      if (t > 1e-6 && t < 1 - 1e-6 && s > 1e-6 && s < 1 - 1e-6) return true;
    }
    active.push(segment);
  }
  return false;
}

/** Recover tangent intersections, not dozens of sampled arc vertices. */
export function ufhBendControls(input: readonly Point2D[], radius: number, spacing: number) {
  const path = input.filter((p, i) => !i || len(sub(p, input[i - 1])) > .01);
  if (path.length < 2) return { controls: [...path], radii: [] as number[], bends: [] as UFHBend[] };
  const turns: number[] = [], angles: number[] = [];
  for (let i = 1; i < path.length - 1; i++) {
    const a = unit(sub(path[i], path[i - 1])), b = unit(sub(path[i + 1], path[i]));
    angles[i] = Math.abs(Math.atan2(cross(a, b), a.x * b.x + a.y * b.y));
    if (angles[i] > .001) turns.push(i);
  }
  const controls = [{ ...path[0] }], radii = [radius];
  for (let k = 0; k < turns.length;) {
    const start = turns[k]; let end = start;
    while (++k < turns.length && angles[end] < .5 && angles[turns[k]] < .5 && turns[k] === end + 1 && len(sub(path[turns[k]], path[end])) <= Math.max(1, Math.min(len(sub(path[end], path[end - 1])), len(sub(path[turns[k] + 1], path[turns[k]])))) * 3) end = turns[k];
    const incoming = unit(sub(path[start], path[start - 1])), outgoing = unit(sub(path[end + 1], path[end]));
    let corners: Point2D[];
    const corner = intersection(path[start], incoming, path[end], outgoing);
    if (corner) corners = [corner];
    else if (end > start) {
      const index = Math.floor((start + end) / 2), m = path[index], tangent = unit(sub(path[index + 1], path[Math.max(start, index - 1)]));
      const first = intersection(path[start], incoming, m, tangent), last = intersection(m, tangent, path[end], outgoing);
      corners = first && last ? [first, last] : [path[start], path[end]];
    } else corners = [path[start]];
    // A 90-degree arc's tangent length is its radius. Preserve existing radii.
    for (let i = 0; i < corners.length; i++) {
      const p = corners[i], recovered = end > start ? len(sub(p, i === 0 ? path[start] : path[end])) : radius;
      controls.push({ ...p }); radii.push(recovered > 1 ? recovered : radius);
    }
  }
  controls.push({ ...path.at(-1)! }); radii.push(radius);
  const bends: UFHBend[] = [];
  for (let i = 1; i < controls.length - 1; i++) {
    const direction = unit(sub(controls[i - 1], controls[i])); let indices = [i];
    if (i + 2 < controls.length) {
      const out = unit(sub(controls[i + 2], controls[i + 1]));
      if (direction.x * out.x + direction.y * out.y > .98 && len(sub(controls[i + 1], controls[i])) <= spacing * 1.6) indices = [i, ++i];
    }
    const position = indices.length === 2 ? middle(controls[indices[0]], controls[indices[1]]) : controls[i];
    const r = Math.max(radius, Math.min(...indices.map(index => radii[index])));
    bends.push({ indices, position, direction, radius: r, radiusHandle: { x: position.x + direction.x * r, y: position.y + direction.y * r } });
  }
  return { controls, radii, bends };
}

export function editUFHBend(path: readonly Point2D[], index: number, at: Point2D, mode: "POSITION" | "RADIUS", minimumRadius: number, spacing: number): Point2D[] {
  const model = ufhBendControls(path, minimumRadius, spacing), bend = model.bends[index];
  if (!bend) throw new Error("This bend is no longer available.");
  if (mode === "RADIUS") {
    const radius = Math.max(minimumRadius, len(sub(at, bend.position)));
    for (const index of bend.indices) model.radii[index] = radius;
  } else {
    let delta = sub(at, bend.position);
    // A U-turn slides along its tube runs; spacing is edited as a zone setting.
    if (bend.indices.length === 2) { const distance = delta.x * bend.direction.x + delta.y * bend.direction.y; delta = { x: distance * bend.direction.x, y: distance * bend.direction.y }; }
    for (const index of bend.indices) model.controls[index] = { x: model.controls[index].x + delta.x, y: model.controls[index].y + delta.y };
  }
  const rounded = roundPipeCorners(model.controls, model.radii);
  if (!rounded) throw new Error("This radius does not fit between the neighbouring tube runs.");
  if (crossesItself(rounded)) throw new Error("This bend would cross another part of the tube. Move it closer to its original position.");
  return rounded;
}

export function parallelRunCount(room: Room, zone: UFHZone) {
  const [a, b] = ufhLayoutCorners(room, zone);
  const width = b.x - a.x, depth = b.y - a.y;
  const vertical = zone.orientation === "Vertical" || zone.orientation === "Auto" && depth > width;
  const span = vertical ? width : depth;
  const available = span - 2 * (zone.boundaryOffsetMm + zone.minBendRadiusMm);
  return { available, count: zone.runCountTarget ?? Math.max(2, Math.floor(available / zone.spacingMm) + 1) };
}
