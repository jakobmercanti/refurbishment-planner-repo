import { orthogonalisePath } from "./electricalLayout";
import type { HeatingProject } from "./heatingDocument";
import type { Point2D } from "./types";
export function heatingEndpoint(data: HeatingProject, id: string): Point2D | undefined {
  return data.radiators.find(r => r.radiatorId === id)?.positionMm ?? data.manifolds.find(m => m.manifoldId === id)?.positionMm;
}
export function refreshHeatingPipeEndpoints(data: HeatingProject): HeatingProject {
  return { ...data, pipes: data.pipes.map(pipe => {
    const pathMm = pipe.pathMm.map(p => ({ ...p })), from = pipe.fromId ? heatingEndpoint(data, pipe.fromId) : null, to = pipe.toId ? heatingEndpoint(data, pipe.toId) : null;
    if (from) pathMm[0] = from; if (to) pathMm[pathMm.length - 1] = to;
    return { ...pipe, pathMm: data.forceOrthogonalRouting === true ? orthogonalisePath(pathMm) : pathMm };
  }) };
}
export const heatingPipeLengthM = (path: Point2D[]) => path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - path[i].x, p.y - path[i].y), 0) / 1000;

export function moveHeatingRouteVertex(path: readonly Point2D[], index: number, at: Point2D, square: boolean, fixedStart = false, fixedEnd = false): Point2D[] {
  const next = path.map(p => ({ ...p }));
  if (!path[index] || index === 0 && fixedStart || index === path.length - 1 && fixedEnd) return next;
  next[index] = { ...at };
  if (square) {
    for (const adjacent of [index - 1, index + 1]) {
      if (!path[adjacent] || adjacent === 0 && fixedStart || adjacent === path.length - 1 && fixedEnd) continue;
      if (Math.abs(path[adjacent].x - path[index].x) < .01) next[adjacent].x = at.x;
      else if (Math.abs(path[adjacent].y - path[index].y) < .01) next[adjacent].y = at.y;
    }
  }
  return square ? orthogonalisePath(next) : next;
}
export function moveHeatingRouteSegment(path: readonly Point2D[], index: number, delta: Point2D, square: boolean, fixedStart = false, fixedEnd = false): Point2D[] {
  if (!path[index + 1]) return path.map(p => ({ ...p }));
  const horizontal = Math.abs(path[index + 1].x - path[index].x) >= Math.abs(path[index + 1].y - path[index].y);
  const offset = square ? horizontal ? { x: 0, y: delta.y } : { x: delta.x, y: 0 } : delta;
  const moved = [path[index], path[index + 1]].map(p => ({ x: p.x + offset.x, y: p.y + offset.y }));
  const result = [...path.slice(0, index), ...moved, ...path.slice(index + 2)].map(p => ({ ...p }));
  if (index === 0 && fixedStart) result.unshift({ ...path[0] });
  if (index + 1 === path.length - 1 && fixedEnd) result.push({ ...path.at(-1)! });
  return square ? orthogonalisePath(result) : result;
}
