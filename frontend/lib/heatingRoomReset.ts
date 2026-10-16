import type { HeatingProject } from "./heatingDocument";
import type { Room } from "./types";
import { containsPoint } from "./elementPlacement";
import { thermalRoom } from "./heatingCalculations";

export type HeatingResetFeature = "ALL" | "UFH" | "EMITTERS" | "PIPES";

/** Remove this room's layout, never its thermal inputs or another room's shared manifold. */
export function resetRoomHeating(data: HeatingProject, room: Room): HeatingProject {
  return resetRoomHeatingFeature(data, room, "ALL");
}

/** Feature-local removal is one undoable edit, with no dangling pipe endpoints. */
export function resetRoomHeatingFeature(data: HeatingProject, room: Room, feature: HeatingResetFeature): HeatingProject {
  const clearUFH = feature === "ALL" || feature === "UFH";
  const zones = new Set(clearUFH ? data.ufhZones.filter(z => z.roomId === room.id).map(z => z.zoneId) : []);
  const removed = new Set(feature === "ALL" || feature === "EMITTERS" ? data.radiators.filter(r => r.roomId === room.id).map(r => r.radiatorId) : []);
  const ufhZones = data.ufhZones.filter(z => !zones.has(z.zoneId));
  const ufhCircuits = data.ufhCircuits.filter(c => !zones.has(c.zoneId));
  data.ufhCircuits.filter(c => zones.has(c.zoneId)).forEach(c => removed.add(c.circuitId));
  const shared = new Set([...ufhZones.map(z => z.manifoldId), ...ufhCircuits.map(c => c.manifoldId)]);
  data.manifolds.forEach(m => {
    if (data.pipes.some(p => p.fromId === m.manifoldId && p.toId && !removed.has(p.toId) || p.toId === m.manifoldId && p.fromId && !removed.has(p.fromId))) shared.add(m.manifoldId);
  });
  const zoneManifolds = new Set(data.ufhZones.filter(z => zones.has(z.zoneId)).map(z => z.manifoldId));
  data.ufhCircuits.filter(c => zones.has(c.zoneId)).forEach(c => zoneManifolds.add(c.manifoldId));
  data.manifolds.forEach(m => {
    if ((feature === "ALL" && containsPoint(m.positionMm, room.vertices) || zoneManifolds.has(m.manifoldId)) && !shared.has(m.manifoldId)) removed.add(m.manifoldId);
  });
  const local = new Set([...data.radiators.filter(r => r.roomId === room.id).map(r => r.radiatorId),
    ...data.manifolds.filter(m => containsPoint(m.positionMm, room.vertices)).map(m => m.manifoldId),
    ...data.ufhCircuits.filter(c => data.ufhZones.some(z => z.zoneId === c.zoneId && z.roomId === room.id)).map(c => c.circuitId)]);
  const radiators = data.radiators.filter(r => !removed.has(r.radiatorId));
  const hasUFH = ufhZones.some(z => z.roomId === room.id);
  const emitters = radiators.filter(r => r.roomId === room.id && r.category !== "Boiler");
  const current = data.rooms.find(r => r.roomId === room.id) ?? thermalRoom(room, data);
  const selectedEmitterType = feature === "PIPES" ? current.selectedEmitterType : hasUFH ? emitters.length ? "Radiator + UFH" : "Underfloor Heating" : !emitters.length ? "None" : emitters.every(r => r.emitterTechnology === "Electric") ? "Electric Radiator" : emitters.some(r => r.emitterTechnology === "Hybrid") ? "Hybrid Radiator" : "Radiator";
  return { ...data, radiators, ufhZones, ufhCircuits,
    rooms: feature === "PIPES" ? data.rooms : [...data.rooms.filter(r => r.roomId !== room.id), { ...current, selectedEmitterType }],
    exclusions: clearUFH ? data.exclusions.filter(e => e.roomId !== room.id) : data.exclusions,
    manifolds: data.manifolds.filter(m => !removed.has(m.manifoldId)),
    pipes: data.pipes.filter(p => !removed.has(p.fromId ?? "") && !removed.has(p.toId ?? "") &&
      !((feature === "ALL" || feature === "PIPES") && (p.fromId || p.toId
        ? [p.fromId, p.toId].filter(Boolean).every(id => local.has(id!)) && p.pathMm.every(point => containsPoint(point, room.vertices))
        : p.pathMm.every(point => containsPoint(point, room.vertices))))) };
}

/** Explicit manifold deletion removes dependent routes, never another manifold. */
export function removeHeatingManifold(data: HeatingProject, id: string): HeatingProject {
  const removed = new Set([id, ...data.ufhCircuits.filter(c => c.manifoldId === id).map(c => c.circuitId)]);
  return { ...data, manifolds: data.manifolds.filter(m => m.manifoldId !== id), ufhZones: data.ufhZones.map(z => z.manifoldId === id ? { ...z, manifoldId: null } : z), ufhCircuits: data.ufhCircuits.filter(c => !removed.has(c.circuitId)), pipes: data.pipes.filter(p => !removed.has(p.fromId ?? "") && !removed.has(p.toId ?? "")) };
}
