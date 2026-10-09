import type { HeatingProject } from "./heatingDocument";
import type { Point2D } from "./types";
export function heatingEndpoint(data: HeatingProject, id: string): Point2D | undefined {
  return data.radiators.find(r => r.radiatorId === id)?.positionMm ?? data.manifolds.find(m => m.manifoldId === id)?.positionMm;
}
export function refreshHeatingPipeEndpoints(data: HeatingProject): HeatingProject {
  return { ...data, pipes: data.pipes.map(pipe => {
    const pathMm = pipe.pathMm.map(p => ({ ...p })), from = pipe.fromId ? heatingEndpoint(data, pipe.fromId) : null, to = pipe.toId ? heatingEndpoint(data, pipe.toId) : null;
    if (from) pathMm[0] = from; if (to) pathMm[pathMm.length - 1] = to;
    return { ...pipe, pathMm };
  }) };
}
export const heatingPipeLengthM = (path: Point2D[]) => path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - path[i].x, p.y - path[i].y), 0) / 1000;
