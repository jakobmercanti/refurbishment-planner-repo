import estimates from "./heatingEstimates.json";
import { heatingElementSpecSchema } from "./heatingDocument";
import type { Obstacle, Room } from "./types";
import { newHeatingProject, type HeatingProject, type HeatingRadiator } from "./heatingDocument";

export type HeatingElementSpec = Omit<HeatingRadiator, "radiatorId" | "roomId" | "widthMm" | "heightMm" | "depthMm" | "positionMm" | "rotationDeg" | "wallIndex" | "positionAlongWallMm" | "placementSnapshot">;
export const isHeatingElement = (item: Pick<Obstacle, "representation_key" | "heating_spec">) => Boolean(item.heating_spec || item.representation_key?.startsWith("furniture-radiator-") || item.representation_key?.startsWith("radiator-"));
export const emptyHeatingSpec = (model: string): HeatingElementSpec => ({ category: "Custom", manufacturer: "", model, emitterTechnology: "Hydronic", ratedOutputW: null, ratedDeltaTK: 50, exponent: 1.3, electricalInputW: 0, fanMode: "Normal", manufacturerPerformanceData: [], locked: false });
export function heatingSpec(r: HeatingRadiator): HeatingElementSpec {
  const { radiatorId: _id, roomId: _room, widthMm: _w, heightMm: _h, depthMm: _d, positionMm: _p, rotationDeg: _rotation, wallIndex: _wall, positionAlongWallMm: _along, placementSnapshot: _snapshot, ...spec } = r;
  void [_id, _room, _w, _h, _d, _p, _rotation, _wall, _along, _snapshot]; return spec;
}
export function resolveHeatingSpec(value: unknown, widthMm: number, heightMm: number): HeatingElementSpec {
  const spec = heatingElementSpecSchema.parse(value);
  if (spec.category !== "Boiler" && spec.emitterTechnology !== "Electric" && !spec.manufacturerPerformanceData.length && (spec.ratedOutputW === null || spec.estimatedOutput)) return { ...spec, ratedOutputW: Math.max(1, Math.round(estimates.referenceOutputW * widthMm / estimates.referenceWidthMm * heightMm / estimates.referenceHeightMm)), estimatedOutput: true, ratedDeltaTK: 50, performanceReference: estimates.reference };
  return spec;
}
export function radiatorFromElement(item: Obstacle, room: Room): HeatingRadiator {
  const spec = resolveHeatingSpec(item.heating_spec ?? emptyHeatingSpec(item.name), item.dimensions.width.value, item.dimensions.height.value);
  return { ...spec, placementSnapshot: Object.fromEntries(Object.entries(item).filter(([key]) => key !== "heating_spec")), radiatorId: item.id, roomId: room.id, widthMm: item.dimensions.width.value, depthMm: item.dimensions.depth.value, heightMm: item.dimensions.height.value, positionMm: item.center, rotationDeg: -item.rotation_deg };
}
/** Runtime radiator view: dimensions and technical data belong to placed objects, not a second library. */
export function withHeatingElements(data: HeatingProject, rooms: readonly Room[]): HeatingProject {
  const placed = rooms.flatMap(room => room.obstacles.filter(isHeatingElement).map(item => radiatorFromElement(item, room)));
  return { ...data, radiators: [...placed, ...data.radiators.filter(r => !placed.some(p => p.radiatorId === r.radiatorId))] };
}
export function elementFromRadiator(r: HeatingRadiator, previous?: Obstacle): Obstacle {
  previous = previous ?? r.placementSnapshot as unknown as Obstacle | undefined;
  const measure = (value: number, old?: Obstacle["dimensions"]["width"]) => old?.value === value ? old : ({ value, uncertainty_mm: old?.uncertainty_mm ?? 0, verified: false, source_type: "USER_MEASURED" });
  return { ...previous, id: r.radiatorId, model_id: r.catalogueItemId ?? previous?.model_id, name: previous?.name ?? r.model, fixture_kind: "FURNITURE", kind: previous?.kind ?? "BOX", center: r.positionMm, rotation_deg: -r.rotationDeg, dimensions: { width: measure(r.widthMm, previous?.dimensions?.width), depth: measure(r.depthMm, previous?.dimensions?.depth), height: measure(r.heightMm, previous?.dimensions?.height) }, base_z_mm: previous?.base_z_mm ?? 100, verified: previous?.verified ?? false, source_type: previous?.source_type ?? "USER_MEASURED", representation_key: previous?.representation_key ?? "furniture-radiator-horizontal-2-1000", color_hex: previous?.color_hex ?? "#FFFFFF", heating_spec: resolveHeatingSpec(heatingSpec(r), r.widthMm, r.heightMm) };
}
/** Commit the derived editor view atomically. Stored radiators are empty: the placed object is authoritative. */
export function commitHeatingElements(data: HeatingProject, rooms: readonly Room[]) {
  const nextRooms = rooms.map(room => ({ ...room, obstacles: [...room.obstacles.filter(o => !isHeatingElement(o)), ...data.radiators.filter(r => r.roomId === room.id).map(r => elementFromRadiator(r, room.obstacles.find(o => o.id === r.radiatorId)))] }));
  // Preserve orphan legacy entities for explicit recovery, never discard them on a room deletion.
  return { rooms: nextRooms, heatingLayout: { ...data, radiators: data.radiators.filter(r => !rooms.some(room => room.id === r.roomId)) } };
}
export function migrateHeatingElements(rooms: Room[], data?: HeatingProject) {
  return commitHeatingElements(withHeatingElements(data ?? newHeatingProject(), rooms), rooms);
}
