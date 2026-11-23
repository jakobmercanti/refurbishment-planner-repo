import { ShapeUtils, Vector2 } from "three";
import { z } from "zod";
import type { MeshGeometry, MeshSection } from "./cfdMeshInspection";

const schema = z.object({schemaVersion: z.literal(1), units: z.literal("mm"), meshId: z.string(),
  points: z.int().min(4).max(2_000_000), faces: z.int().min(4).max(4_000_000),
  triangles: z.int().min(4).max(3_000_000), cells: z.int().min(1).max(500_000)});
type Source = ReturnType<typeof readSource>;
const BINS = 64;

function readSource(bytes: ArrayBuffer, meshId: string) {
  if (bytes.byteLength < 16 || bytes.byteLength > 64 * 1024**2 || new TextDecoder().decode(new Uint8Array(bytes, 0, 4)) !== "CMS1")
    throw new Error("Local section source unavailable.");
  const size = new DataView(bytes).getUint32(4, true);
  if (size > 8192 || size % 8 || size + 8 > bytes.byteLength) throw new Error("Invalid section source.");
  const header = schema.parse(JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 8, size))));
  if (header.meshId !== meshId || bytes.byteLength !== 8 + size + header.points * 24 + header.triangles * 16 + header.faces * 8)
    throw new Error("Section source belongs to a different mesh.");
  let offset = 8 + size;
  const points = new Float64Array(bytes, offset, header.points * 3); offset += points.byteLength;
  const triangles = new Uint32Array(bytes, offset, header.triangles * 3); offset += triangles.byteLength;
  const faces = new Uint32Array(bytes, offset, header.triangles); offset += faces.byteLength;
  const owner = new Int32Array(bytes, offset, header.faces); offset += owner.byteLength;
  const neighbour = new Int32Array(bytes, offset, header.faces);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i++) {
    if (!Number.isFinite(points[i]) || Math.abs(points[i]) > 1e9) throw new Error("Invalid mesh coordinates.");
    min[i % 3] = Math.min(min[i % 3], points[i]); max[i % 3] = Math.max(max[i % 3], points[i]);
  }
  if (min.some((value, axis) => value >= max[axis])) throw new Error("Degenerate mesh.");
  for (const index of triangles) if (index >= header.points) throw new Error("Invalid triangle addressing.");
  for (const face of faces) if (face >= header.faces) throw new Error("Invalid face addressing.");
  for (let i = 0; i < owner.length; i++) if (owner[i] < 0 || owner[i] >= header.cells || neighbour[i] < -1 || neighbour[i] >= header.cells)
    throw new Error("Invalid cell addressing.");
  const bin = (value: number, axis: number) => Math.max(0, Math.min(BINS - 1, Math.floor((value - min[axis]) / (max[axis] - min[axis]) * BINS)));
  const indices = [0, 1, 2].map(axis => {
    const starts = new Uint8Array(header.triangles), ends = new Uint8Array(header.triangles), counts = new Uint32Array(BINS + 1);
    let total = 0;
    for (let i = 0; i < header.triangles; i++) {
      const a = points[triangles[i * 3] * 3 + axis], b = points[triangles[i * 3 + 1] * 3 + axis], c = points[triangles[i * 3 + 2] * 3 + axis];
      starts[i] = bin(Math.min(a,b,c), axis); ends[i] = bin(Math.max(a,b,c), axis);
      total += ends[i] - starts[i] + 1;
      if (total > 4_000_000) return null; // Bound the index; ordinary scan is still exact.
      for (let slot = starts[i]; slot <= ends[i]; slot++) counts[slot + 1]++;
    }
    for (let i = 1; i <= BINS; i++) counts[i] += counts[i - 1];
    const cursor = counts.slice(), items = new Uint32Array(total);
    for (let i = 0; i < header.triangles; i++) for (let slot = starts[i]; slot <= ends[i]; slot++) items[cursor[slot]++] = i;
    return {counts, items};
  });
  return {header, points, triangles, faces, owner, neighbour, min, max, bin, indices};
}

function cut(source: Source, section: MeshSection): MeshGeometry {
  const axis = "XYZ".indexOf(section.axis), coordinate = section.coordinateMm;
  if (axis < 0 || !Number.isFinite(coordinate) || coordinate < source.min[axis] || coordinate > source.max[axis]) throw new Error("Invalid section.");
  const uv = [0,1,2].filter(value => value !== axis);
  const tolerance = Math.max(1e-9, Math.max(...source.max.map((value,i) => value - source.min[i])) * 1e-12);
  const points: number[] = [], cutEdges = new Map<string, number>();
  const cells = new Map<number, Map<number, Set<number>>>();
  const connect = (cell: number, a: number, b: number) => {
    if (cell < 0 || a === b) return;
    let graph = cells.get(cell);
    if (!graph) {
      if (cells.size >= 100_000) throw new Error("Cut needs server sectioning.");
      graph = new Map(); cells.set(cell, graph);
    }
    if (!graph.has(a)) graph.set(a, new Set()); if (!graph.has(b)) graph.set(b, new Set());
    graph.get(a)!.add(b); graph.get(b)!.add(a);
  };
  const intersect = (first: number, second: number) => {
    const a = Math.min(first, second), b = Math.max(first, second), key = `${a}:${b}`;
    const cached = cutEdges.get(key); if (cached !== undefined) return cached;
    const t = (coordinate - source.points[a * 3 + axis]) / (source.points[b * 3 + axis] - source.points[a * 3 + axis]);
    const id = points.length / 3;
    if (id >= 1_000_000) throw new Error("Cut exceeds rendering budget.");
    for (let i = 0; i < 3; i++) points.push(i === axis ? coordinate : source.points[a * 3 + i] + t * (source.points[b * 3 + i] - source.points[a * 3 + i]));
    cutEdges.set(key, id); return id;
  };
  const index = source.indices[axis], slot = source.bin(coordinate, axis);
  const candidates = index ? index.items.subarray(index.counts[slot], index.counts[slot + 1]) : null;
  const count = candidates?.length ?? source.header.triangles;
  for (let row = 0; row < count; row++) {
    const triangle = candidates ? candidates[row] : row;
    const ids = [source.triangles[triangle * 3], source.triangles[triangle * 3 + 1], source.triangles[triangle * 3 + 2]];
    const distance = ids.map(id => source.points[id * 3 + axis] - coordinate);
    if (distance.every(value => value > tolerance) || distance.every(value => value < -tolerance)) continue;
    // Coincident vertices/faces require the server's robust polygon noding.
    if (distance.some(value => Math.abs(value) <= tolerance)) throw new Error("Coincident cut.");
    const intersections: number[] = [];
    for (let edge = 0; edge < 3; edge++) if (distance[edge] * distance[(edge + 1) % 3] < 0)
      intersections.push(intersect(ids[edge], ids[(edge + 1) % 3]));
    if (intersections.length !== 2) throw new Error("Degenerate cut.");
    const face = source.faces[triangle];
    connect(source.owner[face], intersections[0], intersections[1]); connect(source.neighbour[face], intersections[0], intersections[1]);
  }
  const triangles: number[] = [], edges: number[] = [], edgeSet = new Set<string>();
  const inside = (point: number, ring: number[]) => {
    const x = points[point * 3 + uv[0]], y = points[point * 3 + uv[1]];
    let result = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = points[ring[i] * 3 + uv[0]], yi = points[ring[i] * 3 + uv[1]], xj = points[ring[j] * 3 + uv[0]], yj = points[ring[j] * 3 + uv[1]];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) result = !result;
    }
    return result;
  };
  for (const graph of cells.values()) {
    for (const neighbours of graph.values()) if (neighbours.size !== 2) throw new Error("Complex cut junction.");
    const remaining = new Set(graph.keys()), rings: number[][] = [];
    while (remaining.size) {
      const start = remaining.values().next().value!, ring: number[] = [];
      let current = start, previous = -1;
      do {
        if (!remaining.delete(current)) throw new Error("Non-simple cut loop.");
        ring.push(current);
        const next = [...graph.get(current)!].find(value => value !== previous)!;
        previous = current; current = next;
      } while (current !== start);
      if (ring.length < 3) throw new Error("Degenerate loop.");
      // Native face-triangulation diagonals split straight cut edges. Collapse
      // their collinear joins before filling; they are not physical mesh edges.
      const outline = ring.filter((id, i) => {
        const a = ring[(i + ring.length - 1) % ring.length] * 3, b = id * 3, c = ring[(i + 1) % ring.length] * 3;
        const x1 = points[b + uv[0]] - points[a + uv[0]], y1 = points[b + uv[1]] - points[a + uv[1]];
        const x2 = points[c + uv[0]] - points[b + uv[0]], y2 = points[c + uv[1]] - points[b + uv[1]];
        return Math.abs(x1 * y2 - y1 * x2) > tolerance * Math.max(Math.hypot(x1,y1), Math.hypot(x2,y2));
      });
      if (outline.length < 3) throw new Error("Degenerate outline.");
      rings.push(outline);
    }
    const depths = rings.map(ring => rings.filter(other => other !== ring && inside(ring[0], other)).length);
    rings.forEach((ring, row) => {
      if (depths[row] % 2) return;
      const holes = rings.filter((hole,i) => depths[i] === depths[row] + 1 && inside(hole[0], ring));
      const vertices = [ring, ...holes].flat();
      const vectors = (ids: number[]) => ids.map(id => new Vector2(points[id * 3 + uv[0]], points[id * 3 + uv[1]]));
      let sign = 0;
      const convex = !holes.length && ring.every((id,i) => {
        const a = id * 3, b = ring[(i + 1) % ring.length] * 3, c = ring[(i + 2) % ring.length] * 3;
        const cross = (points[b + uv[0]] - points[a + uv[0]]) * (points[c + uv[1]] - points[b + uv[1]])
          - (points[b + uv[1]] - points[a + uv[1]]) * (points[c + uv[0]] - points[b + uv[0]]);
        const direction = Math.sign(cross);
        if (!sign) sign = direction;
        return !!direction && direction === sign;
      });
      // Most volume cells have a convex cut. A fan avoids allocations and an
      // earcut traversal for each one; concave cells and holes retain earcut.
      const pieces = convex ? Array.from({length: ring.length - 2}, (_,i) => [0,i + 1,i + 2])
        : ShapeUtils.triangulateShape(vectors(ring), holes.map(vectors));
      if (!pieces.length) throw new Error("Cannot triangulate cut.");
      const area = (ids: number[]) => {
        const x = points[ids[0] * 3 + uv[0]], y = points[ids[0] * 3 + uv[1]];
        let value = 0;
        for (let i = 0; i < ids.length; i++) {
          const a = ids[i] * 3, b = ids[(i + 1) % ids.length] * 3;
          value += (points[a + uv[0]] - x) * (points[b + uv[1]] - y) - (points[b + uv[0]] - x) * (points[a + uv[1]] - y);
        }
        return Math.abs(value) / 2;
      };
      const expected = area(ring) - holes.reduce((sum, hole) => sum + area(hole), 0);
      const filled = pieces.reduce((sum, piece) => sum + area(piece.map(id => vertices[id])), 0);
      if (expected <= tolerance**2 || Math.abs(filled - expected) > Math.max(tolerance**2, expected * 1e-7))
        throw new Error("Cut needs robust polygon noding.");
      for (const piece of pieces) triangles.push(...piece.map(id => vertices[id]));
      for (const loop of [ring, ...holes]) for (let i = 0; i < loop.length; i++) {
        const a = Math.min(loop[i], loop[(i + 1) % loop.length]), b = Math.max(loop[i], loop[(i + 1) % loop.length]), key = `${a}:${b}`;
        if (!edgeSet.has(key)) { edgeSet.add(key); edges.push(a,b); }
      }
    });
  }
  if (points.length * 8 + triangles.length * 4 + edges.length * 4 > 48 * 1024**2) throw new Error("Cut exceeds rendering budget.");
  return {meshId: source.header.meshId, pointsMm: new Float64Array(points), triangles: new Uint32Array(triangles), edges: new Uint32Array(edges),
    sectionCells: cells.size, axis: section.axis, coordinateMm: coordinate};
}

let source: Source | undefined;
self.onmessage = ({data}: MessageEvent<{type: string; id: number; meshId: string; bytes: ArrayBuffer; section: MeshSection}>) => {
  try {
    if (data.type === "source") { source = readSource(data.bytes, data.meshId); self.postMessage({type: "ready"}); }
    else if (source && data.type === "cut") {
      const geometry = cut(source, data.section);
      self.postMessage({type: "section", id: data.id, geometry}, {transfer: [geometry.pointsMm.buffer, geometry.triangles.buffer, geometry.edges.buffer]});
    }
  } catch { self.postMessage({type: data.type === "source" ? "unavailable" : "fallback", id: data.id}); }
};
