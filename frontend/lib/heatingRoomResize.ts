import type { HeatingProject } from "./heatingDocument";
import type { Point2D, Room } from "./types";
import { regenerateHeatingRoom } from "./heatingDesign";

/** A committed room edit and its regenerated UFH are saved as one history item. */
export function resizeHeatingRooms(previous: readonly Room[], rooms: readonly Room[], heating: HeatingProject): HeatingProject {
  const changed = rooms.filter(room => previous.some(old => old.id === room.id && JSON.stringify(old.vertices) !== JSON.stringify(room.vertices)) && heating.ufhZones.some(zone => zone.roomId === room.id));
  if (!changed.length) return heating;
  let next = structuredClone(heating);
  for (const room of changed) {
    const old = previous.find(r => r.id === room.id)!;
    const bounds = (r: Room) => ({ x: Math.min(...r.vertices.map(p => p.x)), y: Math.min(...r.vertices.map(p => p.y)), w: Math.max(...r.vertices.map(p => p.x)) - Math.min(...r.vertices.map(p => p.x)), h: Math.max(...r.vertices.map(p => p.y)) - Math.min(...r.vertices.map(p => p.y)) });
    const a = bounds(old), b = bounds(room);
    const move = (p: Point2D): Point2D => ({ x: b.x + (p.x - a.x) * b.w / a.w, y: b.y + (p.y - a.y) * b.h / a.h });
    const movedManifolds = new Set<string>();
    const zones = next.ufhZones.filter(z => z.roomId === room.id);
    next.exclusions = next.exclusions.map(e => e.roomId === room.id ? { ...e, polygonMm: e.polygonMm.map(move) } : e);
    if (next.roomIndicatorPositions?.[room.id]) next.roomIndicatorPositions[room.id] = move(next.roomIndicatorPositions[room.id]);
    for (const zone of zones) {
      const shared = next.ufhZones.some(z => z.roomId !== room.id && z.manifoldId === zone.manifoldId);
      if (zone.manifoldId && !shared && !movedManifolds.has(zone.manifoldId)) {
        next.manifolds = next.manifolds.map(m => m.manifoldId === zone.manifoldId ? { ...m, positionMm: move(m.positionMm) } : m);
        movedManifolds.add(zone.manifoldId);
      }
      const original = heating.ufhCircuits.filter(c => c.zoneId === zone.zoneId);
      if (!original.length) continue;
      // A room resize explicitly requests a new layout, including previously locked loops.
      next.ufhCircuits = next.ufhCircuits.map(c => c.zoneId === zone.zoneId ? { ...c, locked: false } : c);
      try { next = regenerateHeatingRoom(room, next, zone.zoneId).heating; }
      catch (cause) { throw new Error(`${room.name}: room resize could not regenerate UFH. ${cause instanceof Error ? cause.message : "Review the UFH geometry."}`); }
      let index = 0;
      next.ufhCircuits = next.ufhCircuits.map(circuit => {
        if (circuit.zoneId !== zone.zoneId) return circuit;
        const previous = original[index++];
        return previous ? { ...circuit, circuitId: previous.circuitId, locked: previous.locked } : circuit;
      });
    }
    next.manifolds = next.manifolds.map(m => {
      const count = next.ufhCircuits.filter(c => c.manifoldId === m.manifoldId).length;
      if (count > 50) throw new Error(`${room.name}: the resized UFH needs another manifold (more than 50 loops).`);
      return count > m.ports ? { ...m, ports: count } : m;
    });
  }
  return next;
}
