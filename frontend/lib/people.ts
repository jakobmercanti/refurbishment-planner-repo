import { z } from "zod";
import models from "./personModels.json";
import { obstacleFitsInRoom, type PlacementWall } from "./elementPlacement";
import type { Obstacle, Point2D, Room } from "./types";

export const STATURE_PRESETS = [900, 1200, 1500, 1650, 1800, 1950] as const;
export const personSpecSchema = z.object({
  posture: z.enum(["STANDING", "SEATED", "LYING"]),
  stature_mm: z.number().finite().min(600).max(2300),
  style: z.enum(["CASUAL", "SMART", "MANNEQUIN"]),
  seat_height_mm: z.number().finite().min(100).max(3000),
  support: z.object({ obstacle_id: z.string().min(1).max(150), surface_height_mm: z.number().finite().min(0).max(20000), lateral_offset_mm: z.number().finite().min(-20000).max(20000) }).strict().optional().nullable(),
}).strict().refine(p => p.posture !== "STANDING" || !p.support, "Standing people cannot be attached to furniture");
export type CataloguePerson = z.infer<typeof personSpecSchema>;
export type PersonPosture = CataloguePerson["posture"];
export const PERSON_MODELS = models;
export const isCataloguePerson = (item: Pick<Obstacle, "representation_key">) => models.some(p => p.key === item.representation_key);

export function personDimensions(spec: Pick<CataloguePerson, "posture" | "stature_mm" | "seat_height_mm">) {
  const model = models.find(p => p.posture === spec.posture)!;
  return { width: spec.stature_mm * model.widthFactor, depth: spec.stature_mm * model.depthFactor,
    height: spec.posture === "SEATED" ? spec.seat_height_mm + .52 * spec.stature_mm : spec.stature_mm * model.heightFactor };
}
export function defaultPersonSpec(key: string | undefined, posedHeight: number): CataloguePerson | undefined {
  const model = models.find(p => p.key === key);
  if (!model) return;
  const stature = Math.max(600, Math.min(2300, posedHeight / model.heightFactor));
  return { posture: model.posture as PersonPosture, stature_mm: stature, style: "CASUAL", seat_height_mm: .245 * stature };
}
export const personSpec = (item: Obstacle) => item.person_spec ?? defaultPersonSpec(item.representation_key, item.dimensions.height.value);

export function withPersonSpec(item: Obstacle, spec: CataloguePerson): Obstacle {
  if (!personSpecSchema.safeParse(spec).success) throw new Error("Use a supported posture/style, stature of 600–2,300 mm and seat height of 100–3,000 mm.");
  const sizes = personDimensions(spec);
  const model = models.find(p => p.posture === spec.posture)!;
  const measure = (axis: "width" | "depth" | "height") => ({ ...item.dimensions[axis], value: sizes[axis], verified: false, source_type: "USER_MEASURED" });
  return { ...item, person_spec: spec, representation_key: model.key, plan_symbol_url: `/fixture-symbols/${model.key}.svg`,
    name: /^(Standing|Seated|Lying down) person/.test(item.name) ? `${model.label} person · ${Math.round(spec.stature_mm)} mm stature` : item.name,
    wall_lock: false, verified: false, dimensions: { width: measure("width"), depth: measure("depth"), height: measure("height") } };
}
export function supportsPerson(item: Obstacle, posture: PersonPosture) {
  if (isCataloguePerson(item) || posture === "STANDING") return false;
  const key = item.representation_key ?? "";
  return posture === "LYING" ? /^furniture-bed-/.test(key) : /^furniture-(chair|armchair|sofa|bed|bench)(-|$)/.test(key);
}
export function nominalSupportHeight(item: Obstacle) {
  const key = item.representation_key ?? "";
  const fraction = key.startsWith("furniture-bed-") ? .62 : key.startsWith("furniture-sofa-") ? .56 : key.includes("bench") ? 1 : .53;
  return Math.round(item.dimensions.height.value * fraction);
}
export function supportPosition(host: Obstacle, lateral: number, forward: number): Point2D {
  const angle = host.rotation_deg * Math.PI / 180;
  return { x: host.center.x + lateral * Math.cos(angle) + forward * Math.sin(angle), y: host.center.y + lateral * Math.sin(angle) - forward * Math.cos(angle) };
}
export function placePersonOnSupport(item: Obstacle, host: Obstacle, surfaceHeight = nominalSupportHeight(host), lateralOffset = 0): Obstacle {
  const previous = personSpec(item);
  if (!previous || !supportsPerson(host, previous.posture)) throw new Error("Choose a seat for a seated person, or a bed for a lying person.");
  if (!Number.isFinite(surfaceHeight) || surfaceHeight < 0 || surfaceHeight > host.dimensions.height.value) throw new Error("Contact height must be within the furniture's measured height.");
  const hipWidth = previous.stature_mm * .20;
  if (Math.abs(lateralOffset) + hipWidth / 2 > host.dimensions.width.value * .45) throw new Error("This person does not fit on that support at this side position.");
  if (previous.posture === "LYING" && personDimensions(previous).depth > host.dimensions.depth.value * .92) throw new Error("This person is too long for the bed's usable length. Choose a longer bed or shorter stature.");
  const seatHeight = host.base_z_mm + surfaceHeight;
  const spec: CataloguePerson = { ...previous, support: { obstacle_id: host.id, surface_height_mm: surfaceHeight, lateral_offset_mm: lateralOffset },
    ...(previous.posture === "SEATED" ? { seat_height_mm: seatHeight } : {}) };
  const next = withPersonSpec(item, spec);
  return { ...next, base_z_mm: previous.posture === "SEATED" ? 0 : seatHeight, rotation_deg: host.rotation_deg,
    center: supportPosition(host, lateralOffset, previous.posture === "SEATED" ? .16 * spec.stature_mm : .04 * host.dimensions.depth.value) };
}

/** Preserve intentional support contacts; moving a person manually detaches it. */
export function syncSupportedPeople(items: Obstacle[], previous: Obstacle[] = [], room?: Room, walls: PlacementWall[] = []): Obstacle[] {
  return items.map(item => {
    const spec = item.person_spec;
    if (!spec?.support) return item;
    const host = items.find(candidate => candidate.id === spec.support!.obstacle_id);
    const old = previous.find(candidate => candidate.id === item.id);
    const oldHost = previous.find(candidate => candidate.id === spec.support!.obstacle_id);
    const manuallyMoved = old?.person_spec?.support && JSON.stringify(old.person_spec.support) === JSON.stringify(spec.support)
      && old.person_spec.stature_mm === spec.stature_mm && old.person_spec.posture === spec.posture && old.person_spec.seat_height_mm === spec.seat_height_mm
      && oldHost && host && oldHost.center.x === host.center.x && oldHost.center.y === host.center.y && oldHost.rotation_deg === host.rotation_deg
      && (old.center.x !== item.center.x || old.center.y !== item.center.y || old.rotation_deg !== item.rotation_deg);
    if (host && !manuallyMoved) {
      try {
        const next = placePersonOnSupport(item, host, spec.support.surface_height_mm, spec.support.lateral_offset_mm);
        if (!room || obstacleFitsInRoom(next, room, walls) && next.base_z_mm + next.dimensions.height.value <= room.wall_height.value) return next;
      } catch { /* Keep the last safe pose, detached. */ }
    }
    return { ...item, person_spec: { ...spec, support: undefined } };
  });
}
