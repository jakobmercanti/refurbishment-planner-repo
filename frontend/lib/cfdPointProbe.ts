import { Ray, ShapeUtils, Triangle, Vector2, Vector3 } from "three";
import type { ResultField } from "./cfdResultData";

export type ProbePosition = [number, number, number];
export interface ProbeMesh { points: ArrayLike<number>; triangles: number[]; cells: number[] }
export interface ResultPointValue {
  position: ProbePosition; value: number; field: string; component: string; cell: boolean;
}

/** Display-data topology only. Never changes source geometry or solver inputs. */
export function resultProbeMesh(points: ArrayLike<number>, polygons: ArrayLike<number>, cellOffset = 0, strips?: ArrayLike<number>): ProbeMesh {
  const triangles: number[] = [], cells: number[] = [];
  const append = (a: number, b: number, c: number, cell: number) => {
    if (cells.length >= 500000) throw new Error("Point probing supports up to 500,000 surface triangles. Export a smaller plane to probe this result.");
    triangles.push(a, b, c); cells.push(cell);
  };
  let cell = cellOffset;
  for (let at = 0; at < polygons.length; cell++) {
    const count = polygons[at++], ids = Array.from({ length: count }, () => polygons[at++]);
    if (ids.length > 3 && ids[0] === ids.at(-1)) ids.pop();
    if (ids.length === 3) append(ids[0], ids[1], ids[2], cell);
    else if (ids.length > 3) {
      // Project the planar polygon along its largest normal component. Earcut
      // handles concave planes; a fan would falsely probe outside their boundary.
      const normal = [0, 0, 0];
      ids.forEach((id, i) => {
        const next = ids[(i + 1) % ids.length];
        for (let axis = 0; axis < 3; axis++) {
          const a = (axis + 1) % 3, b = (axis + 2) % 3;
          normal[axis] += (points[id * 3 + a] - points[next * 3 + a]) * (points[id * 3 + b] + points[next * 3 + b]);
        }
      });
      const drop = normal.reduce((best, value, i) => Math.abs(value) > Math.abs(normal[best]) ? i : best, 0);
      const axes = [0, 1, 2].filter(axis => axis !== drop);
      const outline = ids.map(id => new Vector2(points[id * 3 + axes[0]], points[id * 3 + axes[1]]));
      for (const [a, b, c] of ShapeUtils.triangulateShape(outline, [])) append(ids[a], ids[b], ids[c], cell);
    }
  }
  for (let at = 0; strips && at < strips.length; cell++) {
    const count = strips[at++], ids = Array.from({ length: count }, () => strips[at++]);
    for (let i = 2; i < ids.length; i++) append(ids[i - 2], ids[i - 1], ids[i], cell);
  }
  return { points, triangles, cells };
}

export function intersectResultPlane(mesh: ProbeMesh, near: ProbePosition, far: ProbePosition) {
  const start = new Vector3(...near), direction = new Vector3(...far).sub(start);
  if (!direction.lengthSq() || ![...near, ...far].every(Number.isFinite)) return null;
  const limit = direction.lengthSq(), ray = new Ray(start, direction.normalize());
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), point = new Vector3();
  let closest = Infinity, result: { triangle: number; position: ProbePosition } | null = null;
  for (let i = 0; i < mesh.cells.length; i++) {
    a.fromArray(mesh.points, mesh.triangles[i * 3] * 3); b.fromArray(mesh.points, mesh.triangles[i * 3 + 1] * 3); c.fromArray(mesh.points, mesh.triangles[i * 3 + 2] * 3);
    if (!ray.intersectTriangle(a, b, c, false, point)) continue;
    const distance = start.distanceToSquared(point);
    if (distance <= limit && distance < closest) { closest = distance; result = { triangle: i, position: point.toArray() }; }
  }
  return result;
}

/** Linear point-field interpolation; cell fields retain their stored value. */
export function sampleResultPoint(mesh: ProbeMesh, triangle: number, position: ProbePosition, field: ResultField, values: ArrayLike<number>, component = -1): ResultPointValue | null {
  if (!Number.isInteger(triangle) || triangle < 0 || triangle >= mesh.cells.length || !position.every(Number.isFinite)) return null;
  if (!Number.isInteger(component) || component < -1 || component >= field.components) return null;
  const ids = mesh.triangles.slice(triangle * 3, triangle * 3 + 3);
  const vertices = ids.map(id => new Vector3().fromArray(mesh.points, id * 3));
  const weights = Triangle.getBarycoord(new Vector3(...position), vertices[0], vertices[1], vertices[2], new Vector3());
  if (!weights || weights.toArray().some(value => !Number.isFinite(value) || value < -1e-5 || value > 1 + 1e-5)) return null;
  const tuple = Array.from({ length: field.components }, (_, axis) => field.cell ? values[mesh.cells[triangle] * field.components + axis] : ids.reduce((sum, id, i) => sum + values[id * field.components + axis] * weights.getComponent(i), 0));
  const value = field.components === 1 ? tuple[0] : component < 0 ? Math.hypot(...tuple) : tuple[component];
  if (!Number.isFinite(value)) return null;
  return { position, value, field: field.name, component: field.components === 1 ? "" : component < 0 ? "magnitude" : ["X", "Y", "Z"][component] ?? String(component + 1), cell: field.cell };
}

export const probeNumber = (value: number) => String(Number(value.toPrecision(7)));
