import type { HeatingProject, UFHZone } from "./heatingDocument";
import type { Point2D, Room } from "./types";
import { regenerateHeatingRoom } from "./heatingDesign";
import { parallelRunCount } from "./ufhBendControls";
import { withParallelRuns } from "./ufhRunCount";
import { geometryFingerprint } from "./heatingCalculations";

type RoomOutline = Pick<Room, "id" | "vertices">;
const changedOutline = (a: RoomOutline, b: RoomOutline) => JSON.stringify(a.vertices) !== JSON.stringify(b.vertices);

/** Record the last routed outline once, even across multiple edits and reloads. */
export function queueHeatingRoomResize(previous: readonly RoomOutline[], rooms: readonly Room[], heating: HeatingProject): HeatingProject {
  const routedRooms = new Set(heating.ufhZones.filter(zone => heating.ufhCircuits.some(c => c.zoneId === zone.zoneId)).map(zone => zone.roomId));
  const saved = heating.pendingRoomResize ?? {};
  const pending = Object.fromEntries(rooms.flatMap(room => {
    if (!routedRooms.has(room.id)) return [];
    if (saved[room.id]) {
      const fingerprint = geometryFingerprint(room, heating.exclusions.filter(exclusion => exclusion.roomId === room.id));
      if (heating.ufhZones.filter(zone => zone.roomId === room.id && heating.ufhCircuits.some(circuit => circuit.zoneId === zone.zoneId)).every(zone => zone.geometryFingerprint === fingerprint)) return [];
    }
    const old = saved[room.id] ? { id: room.id, vertices: saved[room.id] } : previous.find(item => item.id === room.id);
    return old && changedOutline(old, room) ? [[room.id, old.vertices] as const] : [];
  }));
  if (JSON.stringify(saved) === JSON.stringify(pending)) return heating;
  return { ...heating, pendingRoomResize: Object.keys(pending).length ? pending : undefined };
}

export function refreshHeatingRoomResizes(rooms: readonly Room[], heating: HeatingProject) {
  let next = heating;
  const errors: string[] = [];
  const pending = { ...heating.pendingRoomResize };
  for (const room of rooms) {
    if (!pending[room.id]) continue;
    try {
      next = resizeHeatingRooms([{ id: room.id, vertices: pending[room.id] }], [room], next);
      delete pending[room.id];
    } catch (cause) { errors.push(cause instanceof Error ? cause.message : `${room.name}: UFH needs review.`); }
  }
  return { heating: next === heating ? heating : { ...next, pendingRoomResize: Object.keys(pending).length ? pending : undefined }, errors };
}

function regenerateResizedZone(room: Room, heating: HeatingProject, zone: UFHZone, reopenLocked: boolean): HeatingProject {
  const original = heating.ufhCircuits.filter(circuit => circuit.zoneId === zone.zoneId);
  if (!original.length) return heating;
  const minimum = Math.max(50, 2 * zone.minBendRadiusMm);
  const preferred = original[0].spacingMm >= minimum ? original[0].spacingMm : Math.max(minimum, zone.spacingMm);
  let resized = zone;
  if (zone.runCountTarget !== undefined) {
    const { available } = parallelRunCount(room, zone);
    const count = Math.min(300, Math.floor(available / minimum + 1e-8) + 1, Math.max(2, Math.floor(available / preferred + 1e-8) + 1));
    resized = withParallelRuns(room, zone, count);
  } else if (preferred <= 600 && zone.spacingMm < minimum) {
    resized = { ...zone, spacingMm: preferred };
  }
  const next = regenerateHeatingRoom(room, {
    ...heating,
    ufhZones: heating.ufhZones.map(item => item.zoneId === zone.zoneId ? resized : item),
    ufhCircuits: reopenLocked ? heating.ufhCircuits.map(circuit => circuit.zoneId === zone.zoneId ? { ...circuit, locked: false } : circuit) : heating.ufhCircuits,
  }, zone.zoneId).heating;
  let index = 0;
  next.ufhCircuits = next.ufhCircuits.map(circuit => {
    if (circuit.zoneId !== zone.zoneId) return circuit;
    const previous = original[index++];
    return previous ? { ...circuit, circuitId: previous.circuitId, locked: previous.locked } : circuit;
  });
  next.manifolds = next.manifolds.map(manifold => {
    const count = next.ufhCircuits.filter(circuit => circuit.manifoldId === manifold.manifoldId).length;
    if (count > 50) throw new Error(`${room.name}: the resized UFH needs another manifold (more than 50 loops).`);
    return count > manifold.ports ? { ...manifold, ports: count } : manifold;
  });
  return next;
}

export function resizeUFHFootprint(room: Room, heating: HeatingProject, zone: UFHZone, layoutBoundsMm: [Point2D, Point2D]) {
  if (heating.pendingRoomResize?.[room.id]) throw new Error("Review the pending room resize before changing the UFH footprint.");
  return regenerateResizedZone(room, heating, { ...zone, layoutBoundsMm }, false);
}

/** A committed room edit and its regenerated UFH are saved as one history item. */
export function resizeHeatingRooms(previous: readonly RoomOutline[], rooms: readonly Room[], heating: HeatingProject): HeatingProject {
  const changed = rooms.filter(room => previous.some(old => old.id === room.id && changedOutline(old, room)) && heating.ufhZones.some(zone => zone.roomId === room.id));
  if (!changed.length) return heating;
  let next = structuredClone(heating);
  for (const room of changed) {
    const old = previous.find(r => r.id === room.id)!;
    const bounds = (r: RoomOutline) => ({ x: Math.min(...r.vertices.map(p => p.x)), y: Math.min(...r.vertices.map(p => p.y)), w: Math.max(...r.vertices.map(p => p.x)) - Math.min(...r.vertices.map(p => p.x)), h: Math.max(...r.vertices.map(p => p.y)) - Math.min(...r.vertices.map(p => p.y)) });
    const a = bounds(old), b = bounds(room);
    if (!(a.w > 0 && a.h > 0 && b.w > 0 && b.h > 0)) throw new Error(`${room.name}: UFH needs a closed room with usable width and depth.`);
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
      try {
        next = regenerateResizedZone(room, next, { ...zone, layoutBoundsMm: zone.layoutBoundsMm ? [move(zone.layoutBoundsMm[0]), move(zone.layoutBoundsMm[1])] : undefined }, true);
      }
      catch (cause) { throw new Error(`${room.name}: room resize could not regenerate UFH. ${cause instanceof Error ? cause.message : "Review the UFH geometry."}`); }
    }
  }
  return next;
}
