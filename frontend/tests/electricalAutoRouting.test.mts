import test from "node:test";
import assert from "node:assert/strict";
import { electricalSegmentHitsBounds, routeElectricalConnections, electricalFixtureRouteBounds } from "../lib/electricalAutoRouting";
import { electricalPlanRouteOptions } from "../lib/electricalPlanPorts";
import { DEFAULT_ELECTRICAL_CONNECTION, DEFAULT_ELECTRICAL_LAYOUT, type ElectricalConnection } from "../lib/electricalLayout";
import { electricalCrossings } from "../lib/electricalCrossings";
import { simulateLighting } from "../lib/electricalSimulation";
import type { Obstacle, Point2D } from "../lib/types";
const m = (value: number) => ({ value, uncertainty_mm: 0, verified: true, source_type: "USER_MEASURED" });
const fixture = (id: string, x: number, y: number, key = "electrical-pendant-dome", rotation = 0): Obstacle => ({ id, name: id, kind: "BOX", representation_key: key, center: { x, y }, rotation_deg: rotation, dimensions: { width: m(150), depth: m(150), height: m(150) } });
const wire = (id = "wire", fromId = "s2", toId = "l2"): ElectricalConnection => ({ ...DEFAULT_ELECTRICAL_CONNECTION, id, fromId, toId, circuitId: DEFAULT_ELECTRICAL_LAYOUT.circuits[0].id, routing: "ORTHOGONAL", waypoints: [] });
const items = [fixture("s2", 3500, 0, "electrical-switch-single", 180), fixture("l1", 2200, 2200), fixture("l2", 600, 2200)];
function square(path: Point2D[]) { assert.ok(path.slice(1).every((p, i) => Math.abs(p.x - path[i].x) < 1e-6 || Math.abs(p.y - path[i].y) < 1e-6)); }

test("S2 to L2 avoids L1 with normal departure and arrival, including enlarged labels and zoom", () => {
  const initial = structuredClone(items), link = wire(), layout = { ...DEFAULT_ELECTRICAL_LAYOUT, connections: [link] };
  let baseline: Point2D[] | undefined;
  for (const zoom of [.5, 1, 2, 3]) {
    const screen = (p: Point2D) => ({ x: 100 + p.x * .1 * zoom, y: 500 - p.y * .1 * zoom });
    const options = electricalPlanRouteOptions(items, screen, true, zoom);
    const path = routeElectricalConnections(layout, items, options).get(link.id)!;
    square(path); assert.equal(path[0].x, path[1].x); assert.ok(path[1].y > path[0].y);
    assert.equal(path.at(-1)!.x, path.at(-2)!.x); assert.ok(path.at(-2)!.y < path.at(-1)!.y);
    const obstacle = options.bounds!.get("l1")!;
    assert.ok(path.slice(1).every((p, i) => !electricalSegmentHitsBounds(path[i], p, obstacle)), JSON.stringify(path));
    if (baseline) { assert.equal(path.length, baseline.length); path.forEach((p, i) => assert.ok(Math.hypot(p.x - baseline![i].x, p.y - baseline![i].y) < 1e-6)); } else baseline = path;
  }
  assert.deepEqual(items, initial); assert.deepEqual(link.waypoints, []);
});
test("normal routes work on all four wall orientations and in the reverse direction", () => {
  for (const rotation of [0, 90, 180, 270]) for (const reverse of [false, true]) {
    const s = fixture("s2", 0, 0, "electrical-switch-single", rotation), l = fixture("l2", 3000, 2000);
    const link = reverse ? wire("w", "l2", "s2") : wire();
    const path = routeElectricalConnections({ ...DEFAULT_ELECTRICAL_LAYOUT, connections: [link] }, [s, l]).get(link.id)!;
    square(path); const ends = reverse ? [...path].reverse() : path;
    const axis = rotation % 180 ? "y" : "x"; assert.equal(ends[0][axis], ends[1][axis]);
    assert.equal(ends.at(-1)![axis], ends.at(-2)![axis]);
  }
});
test("manual corners and unrestricted straight connections never get silently rerouted", () => {
  for (const routing of ["MANUAL", "STRAIGHT"] as const) {
    const c = { ...wire(), routing, waypoints: routing === "MANUAL" ? [{ x: 1700, y: 2200 }] : [] };
    const path = routeElectricalConnections({ ...DEFAULT_ELECTRICAL_LAYOUT, forceOrthogonalRouting: false, connections: [c] }, items).get(c.id)!;
    assert.deepEqual(path, routing === "MANUAL" ? [items[0].center, ...c.waypoints, items[2].center] : [items[0].center, items[2].center]);
  }
});
test("a tight gap reduces drawing clearance instead of falling back through the obstructing light", () => {
  const devices = [fixture("s2", 0, 0, "electrical-switch-single", 180), fixture("l1", 0, 210), fixture("l2", 3000, 3000)];
  const path = routeElectricalConnections({ ...DEFAULT_ELECTRICAL_LAYOUT, connections: [wire()] }, devices).get("wire")!;
  square(path); assert.equal(path[0].x, path[1].x);
  assert.ok(path.slice(1).every((p, i) => !electricalSegmentHitsBounds(path[i], p, electricalFixtureRouteBounds(devices[1]))));
});
test("explicit junction anchors remain connected after automatic routing and readable-port zoom", () => {
  const devices = [fixture("a", 0, 0, "electrical-switch-single", 180), fixture("b", 4000, 4000), fixture("c", 0, 4000, "electrical-switch-single", 0), fixture("d", 4000, 0)];
  const links = [wire("one", "a", "b"), wire("two", "c", "d")], position = { x: 2000, y: 2000 };
  const layout = { ...DEFAULT_ELECTRICAL_LAYOUT, connections: links, junctions: [{ id: "join", connectionIds: links.map(c => c.id), position }] };
  for (const zoom of [.5, 1, 2]) {
    const options = electricalPlanRouteOptions(devices, p => ({ x: p.x * .1 * zoom, y: -p.y * .1 * zoom }), true, zoom);
    const crossings = electricalCrossings(layout, devices, options.endpoint, options);
    assert.ok(crossings.some(c => c.connected && Math.hypot(c.position.x - position.x, c.position.y - position.y) < .01));
  }
});
test("multiple automatic cables choose separate lanes around a dense row of fittings deterministically", () => {
  const devices = [fixture("s2", 5000, 0, "electrical-switch-single", 180), fixture("l2", 1000, 4000), fixture("s3", 6000, 0, "electrical-switch-single", 180), fixture("l3", 2000, 4000),
    ...Array.from({ length: 18 }, (_, i) => fixture(`obstacle-${i}`, 700 + i % 6 * 1000, 900 + Math.floor(i / 6) * 900))];
  const layout = { ...DEFAULT_ELECTRICAL_LAYOUT, connections: [wire(), wire("second", "s3", "l3")] };
  const paths = routeElectricalConnections(layout, devices);
  assert.deepEqual(routeElectricalConnections(layout, devices), paths);
  for (const c of layout.connections) {
    const path = paths.get(c.id)!; square(path);
    for (const f of devices.filter(f => f.id !== c.fromId && f.id !== c.toId)) assert.ok(path.slice(1).every((p, i) => !electricalSegmentHitsBounds(path[i], p, electricalFixtureRouteBounds(f))), `Hit ${f.id}: ${JSON.stringify(path)}`);
  }
});
test("an explicit collinear junction conducts, while an unjoined shared run never does", () => {
  const devices = [fixture("a", 0, 0, "electrical-switch-single"), fixture("b", 4000, 0), fixture("c", 1000, 0, "electrical-switch-single"), fixture("d", 5000, 0)];
  const connections = [wire("one", "a", "b"), wire("two", "c", "d")].map(c => ({ ...c, routing: "STRAIGHT" as const }));
  const layout = { ...DEFAULT_ELECTRICAL_LAYOUT, forceOrthogonalRouting: false, connections };
  assert.equal(electricalCrossings(layout, devices).length, 0); assert.equal(simulateLighting(layout, devices, {}).groups.length, 2);
  const joined = { ...layout, junctions: [{ id: "join", connectionIds: connections.map(c => c.id), position: { x: 2000, y: 0 } }] };
  assert.ok(electricalCrossings(joined, devices).some(c => c.connected)); assert.equal(simulateLighting(joined, devices, {}).groups.length, 1);
});
