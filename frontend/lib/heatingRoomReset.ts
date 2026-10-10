import type { HeatingProject } from "./heatingDocument";
import type { Room } from "./types";
import { containsPoint } from "./elementPlacement";

/** Remove this room's layout, never its thermal inputs or another room's shared manifold. */
export function resetRoomHeating(data: HeatingProject, room: Room): HeatingProject {
  const zones = new Set(data.ufhZones.filter(z => z.roomId === room.id).map(z => z.zoneId));
  const removed = new Set(data.radiators.filter(r => r.roomId === room.id).map(r => r.radiatorId));
  const ufhZones = data.ufhZones.filter(z => !zones.has(z.zoneId));
  const ufhCircuits = data.ufhCircuits.filter(c => !zones.has(c.zoneId));
  data.ufhCircuits.filter(c => zones.has(c.zoneId)).forEach(c => removed.add(c.circuitId));
  const shared = new Set([...ufhZones.map(z => z.manifoldId), ...ufhCircuits.map(c => c.manifoldId)]);
  data.manifolds.forEach(m => {
    if (data.pipes.some(p => p.fromId === m.manifoldId && p.toId && !removed.has(p.toId) || p.toId === m.manifoldId && p.fromId && !removed.has(p.fromId))) shared.add(m.manifoldId);
  });
  data.manifolds.forEach(m => {
    if (containsPoint(m.positionMm, room.vertices) && !shared.has(m.manifoldId)) removed.add(m.manifoldId);
  });
  return { ...data, radiators: data.radiators.filter(r => !removed.has(r.radiatorId)), ufhZones, ufhCircuits,
    exclusions: data.exclusions.filter(e => e.roomId !== room.id),
    manifolds: data.manifolds.filter(m => !removed.has(m.manifoldId)),
    pipes: data.pipes.filter(p => !removed.has(p.fromId ?? "") && !removed.has(p.toId ?? "") &&
      !(!p.fromId && !p.toId && p.pathMm.every(point => containsPoint(point, room.vertices)))) };
}
