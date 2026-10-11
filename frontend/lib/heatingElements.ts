import { constrainObstacleToRoom, requiresHeatingWall } from "./elementPlacement";
import estimates from "./heatingEstimates.json";
import { heatingElementSpecSchema } from "./heatingDocument";
import type { Obstacle, Room } from "./types";
import { newHeatingProject, type HeatingProject, type HeatingRadiator } from "./heatingDocument";
import { projectOnSegment, snapRadiatorToWall } from "./heatingCalculations";

export type HeatingElementSpec = Omit<HeatingRadiator, "radiatorId" | "roomId" | "widthMm" | "heightMm" | "depthMm" | "positionMm" | "rotationDeg" | "wallIndex" | "positionAlongWallMm" | "placementSnapshot">;
export const isHeatingElement = requiresHeatingWall;
export const emptyHeatingSpec = (model: string): HeatingElementSpec => ({ category: "Custom", manufacturer: "", model, emitterTechnology: "Hydronic", ratedOutputW: null, ratedDeltaTK: 50, exponent: 1.3, electricalInputW: 0, fanMode: "Normal", manufacturerPerformanceData: [], locked: false });
/** A hybrid wattage is an operating point, not a universal water/fan rating. */
export function enteredHeatingOutput(spec: HeatingElementSpec, outputW: number | null, conditions: { flowC: number; returnC: number; roomC: number }): Partial<HeatingElementSpec> {
  if (spec.emitterTechnology !== "Hybrid" || spec.category === "Boiler") return { ratedOutputW: outputW, estimatedOutput: false, performanceReference: undefined, manufacturerPerformanceData: [] };
  const otherPoints = spec.manufacturerPerformanceData.filter(p => p.flowC !== conditions.flowC || p.returnC !== conditions.returnC || p.roomC !== conditions.roomC || p.fanMode !== spec.fanMode);
  const points = outputW === null ? otherPoints : [...otherPoints, { ...conditions, outputW, electricalW: spec.electricalInputW, fanMode: spec.fanMode }];
  if (points.length > 500) throw new Error("Performance table is full. Remove an unused operating point before adding another.");
  return { ratedOutputW: outputW, estimatedOutput: false, performanceReference: undefined, manufacturerPerformanceData: points };
}
export function heatingSpec(r: HeatingRadiator): HeatingElementSpec {
  const { radiatorId: _id, roomId: _room, widthMm: _w, heightMm: _h, depthMm: _d, positionMm: _p, rotationDeg: _rotation, wallIndex: _wall, positionAlongWallMm: _along, placementSnapshot: _snapshot, ...spec } = r;
  void [_id, _room, _w, _h, _d, _p, _rotation, _wall, _along, _snapshot]; return spec;
}
export function resolveHeatingSpec(value: unknown, widthMm: number, heightMm: number): HeatingElementSpec {
  const spec = heatingElementSpecSchema.parse(value);
  if (spec.category !== "Boiler" && spec.emitterTechnology === "Hydronic" && !spec.manufacturerPerformanceData.length && (spec.estimatedOutput || spec.ratedOutputW === null && spec.estimatedOutput !== false)) return { ...spec, ratedOutputW: Math.max(1, Math.round(estimates.referenceOutputW * widthMm / estimates.referenceWidthMm * heightMm / estimates.referenceHeightMm)), estimatedOutput: true, ratedDeltaTK: 50, performanceReference: estimates.reference };
  return spec;
}
export function radiatorFromElement(item: Obstacle, room: Room): HeatingRadiator {
  const spec = resolveHeatingSpec(item.heating_spec ?? emptyHeatingSpec(item.name), item.dimensions.width.value, item.dimensions.height.value);
  const radiator = { ...spec, placementSnapshot: Object.fromEntries(Object.entries(item).filter(([key]) => key !== "heating_spec")), radiatorId: item.id, roomId: room.id, widthMm: item.dimensions.width.value, depthMm: item.dimensions.depth.value, heightMm: item.dimensions.height.value, positionMm: item.center, rotationDeg: -item.rotation_deg };
  // Placement owns geometry; reconstruct snap metadata only when it still matches exactly.
  const snapped = snapRadiatorToWall(radiator, room, item.center);
  const angle = ((snapped.rotationDeg - radiator.rotationDeg) % 180 + 180) % 180;
  if (Math.hypot(snapped.positionMm.x - item.center.x, snapped.positionMm.y - item.center.y) < 1 && Math.min(angle, 180 - angle) < .01)
    return { ...radiator, wallIndex: snapped.wallIndex, positionAlongWallMm: snapped.positionAlongWallMm };
  // Ordinary Add-element placement uses the measured wall face, not the heating editor's 40 mm setback.
  const lockedEdge = item.wall_lock ? room.vertices.map((a, index) => {
    const b = room.vertices[(index + 1) % room.vertices.length], projection = projectOnSegment(item.center, a, b);
    const wall = room.wall_thickness_overrides_mm?.[`wall-${String(index + 1).padStart(3, "0")}`] ?? room.wall_thickness.value;
    const rotation = ((Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI - radiator.rotationDeg) % 180 + 180) % 180;
    return { index, along: projection.t * Math.hypot(b.x - a.x, b.y - a.y), matches: Math.abs(projection.distance - (radiator.depthMm / 2 + Math.max(0, wall) / 2 + 1)) < 1 && Math.min(rotation, 180 - rotation) < .01 };
  }).find(edge => edge.matches) : null;
  return lockedEdge ? { ...radiator, wallIndex: lockedEdge.index, positionAlongWallMm: lockedEdge.along } : radiator;
}
/** Runtime radiator view: dimensions and technical data belong to placed objects, not a second library. */
export function withHeatingElements(data: HeatingProject, rooms: readonly Room[]): HeatingProject {
  const placed = rooms.flatMap(room => room.obstacles.filter(isHeatingElement).map(item => radiatorFromElement(item, room)));
  return { ...data, radiators: [...placed, ...data.radiators.filter(r => !placed.some(p => p.radiatorId === r.radiatorId))] };
}
export function elementFromRadiator(r: HeatingRadiator, previous?: Obstacle): Obstacle {
  previous = previous ?? r.placementSnapshot as unknown as Obstacle | undefined;
  const measure = (value: number, old?: Obstacle["dimensions"]["width"]) => old?.value === value ? old : ({ value, uncertainty_mm: old?.uncertainty_mm ?? 0, verified: false, source_type: "USER_MEASURED" });
  return { ...previous, id: r.radiatorId, model_id: r.catalogueItemId ?? previous?.model_id, name: previous?.name ?? r.model, fixture_kind: "FURNITURE", wall_lock: true, kind: previous?.kind ?? "BOX", center: r.positionMm, rotation_deg: -r.rotationDeg, dimensions: { width: measure(r.widthMm, previous?.dimensions?.width), depth: measure(r.depthMm, previous?.dimensions?.depth), height: measure(r.heightMm, previous?.dimensions?.height) }, base_z_mm: previous?.base_z_mm ?? 100, verified: previous?.verified ?? false, source_type: previous?.source_type ?? "USER_MEASURED", representation_key: previous?.representation_key ?? "furniture-radiator-horizontal-2-1000", color_hex: previous?.color_hex ?? "#FFFFFF", heating_spec: resolveHeatingSpec(heatingSpec(r), r.widthMm, r.heightMm) };
}
/** Commit the derived editor view atomically. Stored radiators are empty: the placed object is authoritative. */
export function commitHeatingElements(data: HeatingProject, rooms: readonly Room[]) {
  const nextRooms = rooms.map(room => ({ ...room, obstacles: [...room.obstacles.filter(o => !isHeatingElement(o)), ...data.radiators.filter(r => r.roomId === room.id).map(r => { const previous = room.obstacles.find(o => o.id === r.radiatorId), item = elementFromRadiator(r, previous); return constrainObstacleToRoom(item, room) ?? previous ?? item; })] }));
  // Preserve orphan legacy entities for explicit recovery, never discard them on a room deletion.
  return { rooms: nextRooms, heatingLayout: { ...data, radiators: data.radiators.filter(r => !rooms.some(room => room.id === r.roomId)) } };
}
export function migrateHeatingElements(rooms: Room[], data?: HeatingProject) {
  return commitHeatingElements(withHeatingElements(data ?? newHeatingProject(), rooms), rooms);
}
