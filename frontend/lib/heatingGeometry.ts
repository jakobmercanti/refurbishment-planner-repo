import type { Point2D, Room } from "./types";
import { containsPoint } from "./elementPlacement";
import type { HeatingExclusion, HeatingManifold, UFHZone, UFHCircuit } from "./heatingDocument";
import { calculateCircuitLength, distanceMm, projectOnSegment, geometryFingerprint } from "./heatingCalculations";

const cross = (a: Point2D, b: Point2D, c: Point2D) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const edges = (polygon: readonly Point2D[]) => polygon.map((a, i) => [a, polygon[(i + 1) % polygon.length]] as const);
function segmentDistance(a: Point2D, b: Point2D, c: Point2D, d: Point2D) {
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0;
  return Math.min(projectOnSegment(a, c, d).distance, projectOnSegment(b, c, d).distance, projectOnSegment(c, a, b).distance, projectOnSegment(d, a, b).distance);
}
export function pipeSegmentAllowed(a: Point2D, b: Point2D, boundary: Point2D[], exclusions: readonly Point2D[][], margin: number): boolean {
  if (!containsPoint(a, boundary) || !containsPoint(b, boundary)) return false;
  if (edges(boundary).some(([c, d]) => segmentDistance(a, b, c, d) < margin - 0.01)) return false;
  return !exclusions.some(p => containsPoint(a, p) || containsPoint(b, p) || edges(p).some(([c, d]) => segmentDistance(a, b, c, d) < margin - 0.01));
}
function polygonIntervals(polygon: readonly Point2D[], y: number): [number, number][] {
  const crossings = edges(polygon).flatMap(([a, b]) => (a.y > y) !== (b.y > y) ? [a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y)] : []).sort((a, b) => a - b);
  return crossings.flatMap((x, i) => i % 2 === 0 && crossings[i + 1] !== undefined ? [[x, crossings[i + 1]] as [number, number]] : []);
}
function subtractIntervals(base: [number, number][], remove: [number, number][]) {
  return remove.reduce((spans, [a, b]) => spans.flatMap(([x, y]) => b <= x || a >= y ? [[x, y] as [number, number]] : [[x, Math.min(y, a)], [Math.max(x, b), y]].filter(([l, r]) => r > l) as [number, number][]), base);
}
/** Exact polygon-union subtraction by piecewise-linear sweep, including overlapping/clipped exclusions. */
export function activeUFHAreaM2(boundary: Point2D[], exclusions: readonly Point2D[][]): number {
  const polygons = [boundary, ...exclusions], levels = polygons.flatMap(p => p.map(v => v.y)), segments = polygons.flatMap(edges);
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const [a, b] = segments[i], [c, d] = segments[j], den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
    if (Math.abs(den) < 1e-9) continue;
    const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den, u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
    if (t > 0 && t < 1 && u > 0 && u < 1) levels.push(a.y + t * (b.y - a.y));
  }
  const sorted = [...new Set(levels)].sort((a, b) => a - b);
  return sorted.slice(1).reduce((area, top, i) => { const bottom = sorted[i], y = (top + bottom) / 2, spans = subtractIntervals(polygonIntervals(boundary, y), exclusions.flatMap(p => polygonIntervals(p, y))); return area + (top - bottom) * spans.reduce((s, [a, b]) => s + b - a, 0); }, 0) / 1e6;
}
/** Visibility routing within the room. Fail instead of crossing an exclusion/boundary. */
function routeInside(a: Point2D, b: Point2D, boundary: Point2D[], exclusions: Point2D[][], margin: number): Point2D[] | null {
  if (pipeSegmentAllowed(a, b, boundary, exclusions, margin)) return [a, b];
  const candidates = [a, b, ...[boundary, ...exclusions].flatMap(p => p.flatMap(v => [-1, 1].flatMap(x => [-1, 1].map(y => ({ x: v.x + x * margin * 1.6, y: v.y + y * margin * 1.6 }))))).filter(p => pipeSegmentAllowed(p, p, boundary, exclusions, margin))];
  if (candidates.length > 600) return null;
  const costs = candidates.map(() => Infinity), previous = candidates.map(() => -1), visited = new Set<number>();costs[0] = 0;
  for (let k = 0; k < candidates.length; k++) {
    let index = -1;
    for (let i = 0; i < costs.length; i++) if (!visited.has(i) && (index === -1 || costs[i] < costs[index])) index = i;
    if (index < 0 || !Number.isFinite(costs[index])) break;
    if (index === 1) { const path: Point2D[] = []; for (let i = 1; i !== -1; i = previous[i]) path.unshift(candidates[i]); return path; }
    visited.add(index);
    for (let i = 0; i < candidates.length; i++) if (!visited.has(i)) { const cost = costs[index] + distanceMm(candidates[index], candidates[i]); if (cost < costs[i] && pipeSegmentAllowed(candidates[index], candidates[i], boundary, exclusions, margin)) { costs[i] = cost; previous[i] = index; } }
  }
  return null;
}
/** Round corners to sampled arcs of the requested radius; the persisted polyline is authoritative. */
export function roundPipeCorners(path: Point2D[], radiusMm: number): Point2D[] | null {
  if (path.length < 3) return path;
  const result = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1], v = path[i], b = path[i + 1], l1 = distanceMm(a, v), l2 = distanceMm(v, b);
    if (l1 < 0.01 || l2 < 0.01) continue;
    const u = { x: (a.x - v.x) / l1, y: (a.y - v.y) / l1 }, w = { x: (b.x - v.x) / l2, y: (b.y - v.y) / l2 }, angle = Math.acos(Math.max(-1, Math.min(1, u.x * w.x + u.y * w.y)));
    if (Math.abs(Math.PI - angle) < 1e-6) continue;
    const tangent = radiusMm / Math.tan(angle / 2); if (!Number.isFinite(tangent) || tangent > l1 / 2 + 0.01 || tangent > l2 / 2 + 0.01) return null;
    const p = { x: v.x + u.x * tangent, y: v.y + u.y * tangent }, q = { x: v.x + w.x * tangent, y: v.y + w.y * tangent }, bisectorLength = Math.hypot(u.x + w.x, u.y + w.y), centreDistance = radiusMm / Math.sin(angle / 2);
    const centre = { x: v.x + (u.x + w.x) / bisectorLength * centreDistance, y: v.y + (u.y + w.y) / bisectorLength * centreDistance }, start = Math.atan2(p.y - centre.y, p.x - centre.x);
    let delta = Math.atan2(q.y - centre.y, q.x - centre.x) - start; while (delta > Math.PI) delta -= 2 * Math.PI; while (delta < -Math.PI) delta += 2 * Math.PI;
    result.push(p); const steps = Math.max(2, Math.ceil(Math.abs(delta) / (Math.PI / 36)));
    for (let step = 1; step <= steps; step++) result.push({ x: centre.x + radiusMm * Math.cos(start + delta * step / steps), y: centre.y + radiusMm * Math.sin(start + delta * step / steps) });
  }
  result.push(path.at(-1)!);return result;
}
function rectangularSpiral(boundary: Point2D[], spacing: number, margin: number): Point2D[] | null {
  if (boundary.length !== 4 || edges(boundary).some(([a, b]) => Math.abs(a.x - b.x) > 0.01 && Math.abs(a.y - b.y) > 0.01)) return null;
  const xs = boundary.map(p => p.x), ys = boundary.map(p => p.y), left = Math.min(...xs) + margin, right = Math.max(...xs) - margin, top = Math.min(...ys) + margin, bottom = Math.max(...ys) - margin;
  const inward = (offset: number) => { const path: Point2D[] = []; for (let d = offset; right - left - 2 * d > 4 * spacing && bottom - top - 2 * d > 4 * spacing; d += spacing * 2) path.push({ x: left + d, y: top + d }, { x: right - d, y: top + d }, { x: right - d, y: bottom - d }, { x: left + d + spacing * 2, y: bottom - d }, { x: left + d + spacing * 2, y: top + d + spacing * 2 }); return path.filter((p, i, all) => i === 0 || distanceMm(p, all[i - 1]) > 0.01); };
  const supply = inward(0), returning = inward(spacing).reverse();
  if (!supply.length || !returning.length) return null;
  const a = supply.at(-1)!, b = returning[0];
  const bridge = { x: b.x, y: a.y };
  return [...supply, ...(distanceMm(a, bridge) > 0.01 && distanceMm(bridge, b) > 0.01 ? [bridge] : []), ...returning];
}
export type GeneratedUFH = { circuits: UFHCircuit[]; warnings: string[]; fingerprint: string };
export function generateUFHLoops(room: Room, zone: UFHZone, manifold: HeatingManifold, exclusionList: readonly HeatingExclusion[], existing: readonly UFHCircuit[] = []): GeneratedUFH {
  const exclusions = exclusionList.filter(e => e.roomId === room.id).map(e => e.polygonMm), boundary = room.vertices, warnings: string[] = [], locked = existing.filter(c => c.zoneId === zone.zoneId && c.locked);
  const result = (circuits: UFHCircuit[]) => ({ circuits, warnings, fingerprint: geometryFingerprint(room, exclusionList.filter(e => e.roomId === room.id)) });
  // Do not generate overlapping circuits in a partially locked zone.
  if (locked.length) { warnings.push("Zone contains locked circuits. Unlock them explicitly before room regeneration; existing circuits retained."); return result(existing.filter(c => c.zoneId === zone.zoneId)); }
  if (zone.spacingMm < 2 * zone.minBendRadiusMm && zone.pattern === "Serpentine") { warnings.push("Spacing is below twice the requested bend radius. Increase spacing or use a validated alternative bend design."); return result([]); }
  const margin = zone.boundaryOffsetMm + zone.minBendRadiusMm;
  const validPath = (p: Point2D[]) => p.slice(1).every((b, i) => pipeSegmentAllowed(p[i], b, boundary, exclusions, zone.boundaryOffsetMm));
  const paths: Point2D[][] = [];
  if (zone.pattern === "Spiral" && exclusions.length === 0) {
    const spiral = rectangularSpiral(boundary, zone.spacingMm, margin), rounded = spiral && roundPipeCorners(spiral, zone.minBendRadiusMm);
    if (rounded && validPath(rounded)) paths.push(rounded);
  }
  let pattern: UFHCircuit["pattern"] = paths.length ? "Spiral" : "Serpentine";
  if (!paths.length) {
    if (zone.pattern === "Spiral") warnings.push("Spiral unavailable for this shape/exclusion/bend geometry; generated an explicit serpentine fallback.");
    if (zone.spacingMm < 2 * zone.minBendRadiusMm) { warnings.push("Serpentine fallback cannot satisfy the minimum bend radius at this spacing."); return result([]); }
    const xs = boundary.map(p => p.x), ys = boundary.map(p => p.y), vertical = zone.orientation === "Vertical" || zone.orientation === "Auto" && Math.max(...ys) - Math.min(...ys) > Math.max(...xs) - Math.min(...xs);
    const transform = (p: Point2D) => vertical ? { x: p.y, y: p.x } : p;
    const shape = boundary.map(transform), holes = exclusions.map(p => p.map(transform)), low = Math.min(...shape.map(p => p.y)) + margin, high = Math.max(...shape.map(p => p.y)) - margin;
    const count = Math.floor((high - low) / zone.spacingMm) + 1; if (count > 600) { warnings.push("Zone is too large for one generation operation; split into smaller rooms/zones."); return result([]); }
    let current: Point2D[] = [];
    for (let row = 0; row < count; row++) {
      const y = low + row * zone.spacingMm, spans = subtractIntervals(polygonIntervals(shape, y), holes.flatMap(h => polygonIntervals(h, y)));
      for (const [lo, hi] of spans) {
        const a = transform({ x: lo + margin, y }), b = transform({ x: hi - margin, y });
        if (hi - lo <= 2 * margin || !pipeSegmentAllowed(a, b, boundary, exclusions, zone.boundaryOffsetMm)) continue;
        const run = row % 2 ? [b, a] : [a, b];
        if (current.length) {
          // Orthogonal U bend rather than a diagonal corner joining adjacent runs.
          const end = current.at(-1)!, next = run[0], bend = vertical ? { x: next.x, y: end.y } : { x: end.x, y: next.y };
          const simple = [end, bend, next].filter((p, i, all) => !i || distanceMm(p, all[i - 1]) > 0.01);
          const connector = validPath(simple) ? simple : routeInside(end, next, boundary, exclusions, zone.boundaryOffsetMm + zone.minBendRadiusMm);
          const joined = connector && [...current, ...connector.slice(1), ...run.slice(1)], rounded = joined && roundPipeCorners(joined, zone.minBendRadiusMm);
          if (!rounded || !validPath(rounded)) { paths.push(current); current = run; } else current = joined!;
        } else current = run;
      }
    }
    if (current.length) paths.push(current);
  }
  const circuits: UFHCircuit[] = [];
  function make(pathMm: Point2D[]): UFHCircuit {
    // Leads are explicit editable straight routes; wall penetration is not inferred as approved.
    const inside = containsPoint(manifold.positionMm, boundary);
    const supplyPathMm = inside ? routeInside(manifold.positionMm, pathMm[0], boundary, exclusions, zone.boundaryOffsetMm) ?? [manifold.positionMm, pathMm[0]] : [manifold.positionMm, pathMm[0]];
    const returnPathMm = inside ? routeInside(pathMm.at(-1)!, manifold.positionMm, boundary, exclusions, zone.boundaryOffsetMm) ?? [pathMm.at(-1)!, manifold.positionMm] : [pathMm.at(-1)!, manifold.positionMm];
    const tailWarnings = ["Manifold lead routes are provisional: review wall/door penetrations and supply/return separation before installation."];
    return { circuitId: crypto.randomUUID(), zoneId: zone.zoneId, manifoldId: manifold.manifoldId, name: `${zone.name}-${String(circuits.length + 1).padStart(2, "0")}`, diameterMm: zone.diameterMm, spacingMm: zone.spacingMm, pipeType: zone.pipeType, pathMm, generatedPathMm: structuredClone(pathMm), supplyPathMm, returnPathMm, pattern, locked: false, manuallyEdited: false, generationWarnings: tailWarnings };
  }
  for (const raw of paths) {
    // Spiral arcs have already been rounded and sampled; rounding those samples
    // again creates tiny backwards segments/self-crossings at the arc joins.
    const rounded = pattern === "Spiral" ? raw : roundPipeCorners(raw, zone.minBendRadiusMm) ?? raw, full = make(rounded);
    if (!validPath(rounded)) { warnings.push("A route could not satisfy boundary/exclusion clearance; not generated."); continue; }
    const total = calculateCircuitLength(full), pieces = Math.max(1, Math.ceil(total / zone.maxCircuitLengthM));
    const splits = splitPathByLength(rounded, pieces);
    let accepted = false;
    for (let count = pieces; count <= Math.min(200, pieces + 100); count++) {
      const candidates = (count === pieces ? splits : splitPathByLength(rounded, count)).map(make);
      if (candidates.every(c => calculateCircuitLength(c) <= zone.maxCircuitLengthM + 1e-6)) { candidates.forEach(c => { c.name = `${zone.name}-${String(circuits.length + 1).padStart(2, "0")}`; circuits.push(c); }); accepted = true; break; }
    }
    if (!accepted) warnings.push("Manifold leads alone exceed the circuit length budget; move the manifold nearer. No over-length circuit generated.");
  }
  if (!circuits.length) warnings.push("No valid pipe route generated. Review spacing, boundary offset, bend radius and exclusions.");
  if (circuits.length > manifold.ports) warnings.push("Generated circuit count exceeds available manifold ports.");
  if (paths.length > 1) warnings.push("Disconnected safe pipe runs require separate circuits; inspect coverage and balancing.");
  pattern = circuits[0]?.pattern ?? pattern;
  return result(circuits);
}
export function splitPathByLength(path: Point2D[], count: number): Point2D[][] {
  const total = path.slice(1).reduce((s, b, i) => s + distanceMm(path[i], b), 0), target = total / count, result: Point2D[][] = [], current: Point2D[] = [path[0]];
  let used = 0;
  for (let i = 1; i < path.length; i++) {
    let a = current.at(-1)!;const b = path[i];let remaining = distanceMm(a, b);
    while (used + remaining > target + 0.001 && result.length < count - 1) {
      const t = (target - used) / remaining, p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      current.push(p);result.push([...current]);current.splice(0, current.length, p);a = p;remaining = distanceMm(a, b);used = 0;
    }
    current.push(b);used += remaining;
  }
  if (current.length > 1) result.push(current);return result;
}
export function validateCircuitGeometry(circuit: UFHCircuit, room: Room, zone: UFHZone, exclusions: readonly HeatingExclusion[]) {
  const warnings = [...circuit.generationWarnings], holes = exclusions.filter(e => e.roomId === room.id).map(e => e.polygonMm);
  if (!circuit.pathMm.slice(1).every((p, i) => pipeSegmentAllowed(circuit.pathMm[i], p, room.vertices, holes, zone.boundaryOffsetMm))) warnings.push("Pipe path crosses room boundary/exclusion or is too near an edge.");
  if (calculateCircuitLength(circuit) > zone.maxCircuitLengthM) warnings.push("Circuit exceeds preferred maximum length.");
  if (circuit.manuallyEdited) warnings.push("Manual route: verify pipe spacing, self-crossings and minimum bend radii before installation.");
  return [...new Set(warnings)];
}
