import { electricalConnectionPoints, type ElectricalConnection, type ElectricalLayoutData } from "./electricalLayout";
import type { Obstacle, Point2D } from "./types";

export interface ElectricalRouteBounds { left: number; right: number; bottom: number; top: number }
export interface ElectricalRouteOptions {
  endpoint?: (connection: ElectricalConnection, side: "from" | "to", fixture: Obstacle) => Point2D;
  bounds?: ReadonlyMap<string, ElectricalRouteBounds>;
  clearanceMm?: number;
  occupiedRoutes?: Point2D[][];
}
type Axis = "x" | "y";
type Direction = { axis: Axis; sign: number };
const EPS = 1e-6;
const same = (a: Point2D, b: Point2D) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
const distance = (a: Point2D, b: Point2D) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const inside = (p: Point2D, b: ElectricalRouteBounds) => p.x > b.left + EPS && p.x < b.right - EPS && p.y > b.bottom + EPS && p.y < b.top - EPS;
export function electricalSegmentHitsBounds(a: Point2D, b: Point2D, r: ElectricalRouteBounds) {
  if (Math.abs(a.y - b.y) < EPS) return a.y > r.bottom + EPS && a.y < r.top - EPS && Math.max(a.x, b.x) > r.left + EPS && Math.min(a.x, b.x) < r.right - EPS;
  if (Math.abs(a.x - b.x) < EPS) return a.x > r.left + EPS && a.x < r.right - EPS && Math.max(a.y, b.y) > r.bottom + EPS && Math.min(a.y, b.y) < r.top - EPS;
  return false;
}
function simplify(points: Point2D[]) {
  const result: Point2D[] = [];
  for (const p of points) {
    if (result.length && same(result.at(-1)!, p)) continue;
    while (result.length > 1) {
      const a = result.at(-2)!, b = result.at(-1)!;
      if ((Math.abs(a.x - b.x) < EPS && Math.abs(b.x - p.x) < EPS || Math.abs(a.y - b.y) < EPS && Math.abs(b.y - p.y) < EPS) && distance(a, b) + distance(b, p) <= distance(a, p) + EPS) result.pop();
      else break;
    }
    result.push(p);
  }
  return result;
}
function normal(fixture?: Obstacle): Direction | null {
  if (!/^electrical-(switch|socket)-/.test(fixture?.representation_key ?? "")) return null;
  const a = (fixture!.rotation_deg ?? 0) * Math.PI / 180;
  return Math.abs(Math.cos(a)) >= Math.SQRT1_2 ? { axis: "y", sign: -Math.sign(Math.cos(a)) } : { axis: "x", sign: Math.sign(Math.sin(a)) };
}
const directions = (axis?: Axis): Direction[] => (axis ? [axis] : ["x", "y"] as Axis[]).flatMap(axis => [{ axis, sign: 1 }, { axis, sign: -1 }]);

/** Small stable priority queue: no dependency on browser layout or random tie-breaking. */
class Queue {
  items: { state: number; cost: number; priority: number; order: number }[] = [];
  order = 0;
  push(state: number, cost: number, priority: number) {
    const item = { state, cost, priority, order: this.order++ };
    let i = this.items.length; this.items.push(item);
    while (i) { const parent = (i - 1) >> 1; if (!this.before(item, this.items[parent])) break; this.items[i] = this.items[parent]; i = parent; } this.items[i] = item;
  }
  before(a: typeof this.items[number], b: typeof this.items[number]) { return a.priority < b.priority || a.priority === b.priority && a.order < b.order; }
  pop() {
    const first = this.items[0], last = this.items.pop()!;
    if (this.items.length) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) { let child = i * 2 + 1; if (child + 1 < this.items.length && this.before(this.items[child + 1], this.items[child])) child++; if (!this.before(this.items[child], last)) break; this.items[i] = this.items[child]; i = child; } this.items[i] = last;
    }
    return first;
  }
}
function congestion(a: Point2D, b: Point2D, routes: Point2D[][], clearance: number) {
  let cost = 0;
  const horizontal = Math.abs(a.y - b.y) < EPS;
  for (const route of routes) for (let i = 1; i < route.length; i++) {
    const p = route[i - 1], q = route[i], otherHorizontal = Math.abs(p.y - q.y) < EPS;
    if (horizontal === otherHorizontal) {
      const axis = horizontal ? "x" : "y", across = horizontal ? "y" : "x";
      if (Math.abs(a[across] - p[across]) < EPS) cost += Math.max(0, Math.min(Math.max(a[axis], b[axis]), Math.max(p[axis], q[axis])) - Math.max(Math.min(a[axis], b[axis]), Math.min(p[axis], q[axis]))) * 4;
    } else {
      const x = horizontal ? p.x : a.x, y = horizontal ? a.y : p.y;
      if (x > Math.min(a.x, b.x) - EPS && x < Math.max(a.x, b.x) + EPS && y > Math.min(a.y, b.y) - EPS && y < Math.max(a.y, b.y) + EPS && x > Math.min(p.x, q.x) - EPS && x < Math.max(p.x, q.x) + EPS && y > Math.min(p.y, q.y) - EPS && y < Math.max(p.y, q.y) + EPS) cost += clearance * 3;
    }
  }
  return cost;
}

/** Rectilinear visibility-grid A*. Inflated fitting bounds are hard obstacles;
 * length, bends and existing wires are costs, not electrical connectivity. */
function findPath(start: Point2D, goal: Point2D, boxes: ElectricalRouteBounds[], routes: Point2D[][], clearance: number, firstAxis?: Axis, lastAxis?: Axis): { points: Point2D[]; cost: number } | null {
  if (same(start, goal)) return { points: [start], cost: 0 };
  if (boxes.some(b => inside(start, b) || inside(goal, b))) return null;
  const xs = new Set([start.x, goal.x]), ys = new Set([start.y, goal.y]);
  boxes.forEach(b => { xs.add(b.left); xs.add(b.right); ys.add(b.bottom); ys.add(b.top); });
  // Offer separate lanes next to existing wires instead of forcing shared runs.
  routes.slice(-80).forEach(route => route.forEach(p => { xs.add(p.x - clearance); xs.add(p.x + clearance); ys.add(p.y - clearance); ys.add(p.y + clearance); }));
  const x = [...xs].sort((a, b) => a - b), y = [...ys].sort((a, b) => a - b), width = x.length;
  const index = (p: Point2D) => y.indexOf(p.y) * width + x.indexOf(p.x);
  const point = (node: number) => ({ x: x[node % width], y: y[Math.floor(node / width)] });
  const source = index(start), target = index(goal), queue = new Queue(), costs = new Map<number, number>(), previous = new Map<number, number>();
  const initial = source * 2 + (firstAxis === "y" ? 1 : 0);
  costs.set(initial, 0); queue.push(initial, 0, distance(start, goal));
  let visited = 0;
  while (queue.items.length && visited++ < 60000) {
    const current = queue.pop(); if (current.cost !== costs.get(current.state)) continue;
    const node = Math.floor(current.state / 2), p = point(node), axis = current.state % 2;
    if (node === target) {
      const points: Point2D[] = []; let state: number | undefined = current.state;
      while (state !== undefined) { points.push(point(Math.floor(state / 2))); state = previous.get(state); }
      return { points: simplify(points.reverse()), cost: current.cost };
    }
    const ix = node % width, iy = Math.floor(node / width);
    for (const [nx, ny, direction] of [[ix - 1, iy, 0], [ix + 1, iy, 0], [ix, iy - 1, 1], [ix, iy + 1, 1]]) {
      if (nx < 0 || nx >= x.length || ny < 0 || ny >= y.length) continue;
      const next = ny * width + nx, q = point(next);
      if (boxes.some(b => electricalSegmentHitsBounds(p, q, b))) continue;
      const state = next * 2 + direction, cost = current.cost + distance(p, q) + (axis !== direction ? clearance * 1.5 : 0) + (next === target && lastAxis && (lastAxis === "x" ? 0 : 1) !== direction ? clearance * 1.5 : 0) + congestion(p, q, routes, clearance);
      if (cost >= (costs.get(state) ?? Infinity) - EPS) continue;
      costs.set(state, cost); previous.set(state, current.state); queue.push(state, cost, cost + distance(q, goal));
    }
  }
  return null;
}

export function electricalFixtureRouteBounds(fixture: Obstacle): ElectricalRouteBounds {
  const a = (fixture.rotation_deg ?? 0) * Math.PI / 180, w = fixture.dimensions?.width.value ?? 0, d = fixture.dimensions?.depth.value ?? 0;
  const width = Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * d, depth = Math.abs(Math.sin(a)) * w + Math.abs(Math.cos(a)) * d;
  return { left: fixture.center.x - width / 2, right: fixture.center.x + width / 2, bottom: fixture.center.y - depth / 2, top: fixture.center.y + depth / 2 };
}

/** Resolve the whole drawing once so overlay, hit-testing, crossings and exports
 * agree. Manual routes stay authored; junction anchors never drift with zoom. */
export function routeElectricalConnections(layout: Pick<ElectricalLayoutData, "connections" | "forceOrthogonalRouting" | "junctions">, fixtures: readonly Obstacle[], options: ElectricalRouteOptions = {}): Map<string, Point2D[]> {
  const devices = new Map(fixtures.map(f => [f.id, f])), clearance = Math.max(1, options.clearanceMm ?? 100);
  const bounds = fixtures.map(f => [f.id, options.bounds?.get(f.id) ?? electricalFixtureRouteBounds(f)] as const);
  const result = new Map<string, Point2D[]>(), occupied: Point2D[][] = [...options.occupiedRoutes ?? []];
  const automatic = (c: ElectricalConnection) => !c.waypoints.length && (c.routing === "ORTHOGONAL" || c.routing === "STRAIGHT" && layout.forceOrthogonalRouting);
  const ordered = [...layout.connections.filter(c => !automatic(c)), ...layout.connections.filter(automatic)];
  for (const c of ordered) {
    const from = devices.get(c.fromId), to = devices.get(c.toId); if (!from || !to) continue;
    const start = options.endpoint?.(c, "from", from) ?? from.center, end = options.endpoint?.(c, "to", to) ?? to.center;
    let path = electricalConnectionPoints(c, start, end, layout.forceOrthogonalRouting, from, to);
    if (automatic(c)) {
      const fromNormal = normal(from), toNormal = normal(to);
      const starts = fromNormal ? [fromNormal] : directions(toNormal?.axis), ends = toNormal ? [toNormal] : directions(fromNormal?.axis);
      const anchors = (layout.junctions ?? []).filter(j => j.connectionIds.includes(c.id)).map(j => j.position).sort((a, b) => distance(start, a) - distance(start, b));
      // Tight plans may not have a full label-width gap. Reduce presentation
      // padding before ever accepting a route through another fitting.
      for (const gap of [...new Set([clearance, Math.max(1, clearance * .4), 1])]) {
        let best: { points: Point2D[]; cost: number } | null = null;
        const boxes = new Map(bounds.map(([id, b]) => [id, { left: b.left - gap, right: b.right + gap, bottom: b.bottom - gap, top: b.top + gap }]));
        const stub = (p: Point2D, id: string, d: Direction) => { const b = boxes.get(id)!; return { ...p, [d.axis]: d.sign > 0 ? Math.max(p[d.axis] + gap, d.axis === "x" ? b.right : b.top) : Math.min(p[d.axis] - gap, d.axis === "x" ? b.left : b.bottom) }; };
        for (const departure of starts) for (const arrival of ends) {
          const first = stub(start, from.id, departure), last = stub(end, to.id, arrival);
          if ([...boxes].some(([id, b]) => id !== from.id && electricalSegmentHitsBounds(start, first, b) || id !== to.id && electricalSegmentHitsBounds(last, end, b))) continue;
          const checkpoints = [first, ...anchors, last];
          let points = [start], cost = distance(start, first) + distance(last, end), valid = true;
          for (let i = 1; i < checkpoints.length; i++) {
            const leg = findPath(checkpoints[i - 1], checkpoints[i], [...boxes.values()], occupied, gap, i === 1 ? departure.axis : undefined, i === checkpoints.length - 1 ? arrival.axis : undefined);
            if (!leg) { valid = false; break; } points = [...points, ...leg.points]; cost += leg.cost;
          }
          if (valid && (!best || cost < best.cost - EPS)) best = { points: simplify([...points, end]), cost };
        }
        if (best) { path = best.points; break; }
      }
      // If symbols overlap their own ports there is no collision-free escape.
      // Retain an editable route rather than moving fittings or deleting a link.
    }
    result.set(c.id, path); occupied.push(path);
  }
  return result;
}
