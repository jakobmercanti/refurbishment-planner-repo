import type { Room, Point2D } from "./types";
import { thermalElementId } from "./buildingThermalModel";
import { containsPoint, obstacleFootprint } from "./elementPlacement";
import { type HeatingProject, type RoomThermalData, type HeatingRadiator, type HybridPerformancePoint, type UFHZone, type UFHCircuit, ROOM_TEMPERATURES } from "./heatingDocument";

export const distanceMm = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y);
export const polygonAreaMm2 = (p: readonly Point2D[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.y - b.x * a.y; }, 0)) / 2;
export const calculateCircuitLength = (c: Pick<UFHCircuit, "pathMm" | "supplyPathMm" | "returnPathMm">) => [c.pathMm, c.supplyPathMm, c.returnPathMm].reduce((total, path) => total + path.slice(1).reduce((s, p, i) => s + distanceMm(path[i], p), 0), 0) / 1000;
export const calculateFabricLoss = (areaM2: number, uValue: number, insideC: number, adjacentC: number) => Math.max(0, areaM2 * uValue * (insideC - adjacentC));
export const calculateVentilationLoss = (volumeM3: number, ach: number, insideC: number, outsideC: number) => 0.33 * ach * volumeM3 * Math.max(0, insideC - outsideC);
export function thermalRoom(room: Room, project: HeatingProject): RoomThermalData {
  const defaultTemperature = Object.entries(project.buildingSettings.roomTypeTemperatures ?? ROOM_TEMPERATURES).find(([name]) => room.name.toLowerCase().includes(name.toLowerCase()))?.[1] ?? 20;
  const saved = project.rooms.find(r => r.roomId === room.id);
  if (saved) return { ...saved, designIndoorTemperatureC: saved.designTemperatureOverride === false ? defaultTemperature : saved.designIndoorTemperatureC, airChangeRate: saved.airChangeRateOverride === false ? project.buildingSettings.airChangeRate : saved.airChangeRate };
  return { roomId: room.id, designTemperatureOverride: false, airChangeRateOverride: false, designIndoorTemperatureC: defaultTemperature, airChangeRate: project.buildingSettings.airChangeRate, selectedEmitterType: "Radiator", floorBoundary: "Ground", ceilingBoundary: "External", adjacentTemperatureC: 10, walls: {} };
}
export type ThermalSurface = { key: string; label: string; areaM2: number; uValue: number; adjacentTemperatureC: number; lossW: number; boundary: string; edgeIndex?: number; startMm?: Point2D; endMm?: Point2D };
export type RoomHeatLoss = { roomId: string; areaM2: number; perimeterM: number; volumeM3: number; heightMm: number; externalWallAreaM2: number; internalWallAreaM2: number; windowAreaM2: number; doorAreaM2: number; surfaces: ThermalSurface[]; fabricW: number; ventilationW: number; totalW: number; designW: number; densityWm2: number; targetC: number; ach: number; warnings: string[] };
export function projectOnSegment(p: Point2D, a: Point2D, b: Point2D) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { point, t, distance: distanceMm(p, point) };
}
/** Split collinear shared boundaries, including partial walls and T junctions. */
export function wallAdjacencies(room: Room, edgeIndex: number, rooms: readonly Room[]) {
  const a = room.vertices[edgeIndex], b = room.vertices[(edgeIndex + 1) % room.vertices.length], length = distanceMm(a, b);
  const intervals: { start: number; end: number; room: Room }[] = [];
  for (const other of rooms) {
    if (other.id === room.id) continue;
    for (let i = 0; i < other.vertices.length; i++) {
      const p = other.vertices[i], q = other.vertices[(i + 1) % other.vertices.length];
      const cross = (v: Point2D) => length ? Math.abs((b.x - a.x) * (v.y - a.y) - (b.y - a.y) * (v.x - a.x)) / length : Infinity;
      if (cross(p) > 1 || cross(q) > 1) continue;
      const lo = Math.min(projectOnSegment(p, a, b).t, projectOnSegment(q, a, b).t) * length, hi = Math.max(projectOnSegment(p, a, b).t, projectOnSegment(q, a, b).t) * length;
      if (hi - lo > 1) intervals.push({ start: lo, end: hi, room: other });
    }
  }
  return { a, b, length, intervals };
}
export function calculateRoomHeatLoss(room: Room, rooms: readonly Room[], project: HeatingProject): RoomHeatLoss {
  const settings = thermalRoom(room, project), build = project.buildingSettings, u = settings.construction ?? build.construction;
  const areaM2 = polygonAreaMm2(room.vertices) / 1e6, heightMm = room.wall_height.value, targetC = settings.designIndoorTemperatureC;
  const surfaces: ThermalSurface[] = [], warnings: string[] = ["Unmatched walls assumed external; floor assumed ground-facing and ceiling exposed unless overridden. Preset U-values/ACH are planning assumptions, not a survey."];
  let perimeterM = 0, externalWallAreaM2 = 0, internalWallAreaM2 = 0, windowAreaM2 = 0, doorAreaM2 = 0;
  const add = (key: string, label: string, areaM2: number, uValue: number, adjacentTemperatureC: number, boundary: string, edgeIndex?: number) => {
    const lookupKey = key.startsWith("wall:") ? `wall:${edgeIndex}` : key;
    const energy = project.thermalOverrides?.[thermalElementId(room.id, key)] ?? project.thermalOverrides?.[thermalElementId(room.id, lookupKey)];
    if (energy?.warning) warnings.push(energy.warning);
    const actualU = energy?.uValue ?? uValue;
    if (key.startsWith("opening:") && energy) {
      if (energy.boundary && energy.boundary !== "Auto") boundary = energy.boundary;
      adjacentTemperatureC = boundary === "External" ? build.externalDesignTemperatureC : boundary === "Adiabatic" ? targetC : energy.adjacentTemperatureC ?? adjacentTemperatureC;
    }
    surfaces.push({ key, label, areaM2, uValue: actualU, adjacentTemperatureC, boundary, lossW: calculateFabricLoss(areaM2, actualU, targetC, adjacentTemperatureC), ...(edgeIndex !== undefined ? { edgeIndex, startMm: room.vertices[edgeIndex], endMm: room.vertices[(edgeIndex + 1) % room.vertices.length] } : {}) });
  };
  room.vertices.forEach((_, index) => {
    const { length, intervals } = wallAdjacencies(room, index, rooms); perimeterM += length / 1000;
    const energy = project.thermalOverrides?.[thermalElementId(room.id, `wall:${index}`)];
    const override = { ...settings.walls[String(index)], ...(energy?.boundary && energy.boundary !== "Auto" ? { boundary: energy.boundary } : {}), ...(energy?.adjacentTemperatureC !== undefined ? { adjacentTemperatureC: energy.adjacentTemperatureC } : {}) }, openingList = room.openings.filter(o => o.parent_wall_id === `wall-${String(index + 1).padStart(3, "0")}`);
    const boundaries = [...new Set([0, length, ...intervals.flatMap(i => [i.start, i.end])])].sort((a, b) => a - b);
    for (let k = 0; k < boundaries.length - 1; k++) {
      const start = boundaries[k], end = boundaries[k + 1], mid = (start + end) / 2;
      const adjacent = intervals.find(i => mid >= i.start && mid <= i.end)?.room;
      const segmentOverride = project.thermalOverrides?.[thermalElementId(room.id, `wall:${index}:${k}`)];
      const resolvedOverride = { ...override, ...(segmentOverride?.boundary && segmentOverride.boundary !== "Auto" ? { boundary: segmentOverride.boundary } : {}), ...(segmentOverride?.adjacentTemperatureC !== undefined ? { adjacentTemperatureC: segmentOverride.adjacentTemperatureC } : {}) };
      const boundary = resolvedOverride.boundary && resolvedOverride.boundary !== "Auto" ? resolvedOverride.boundary : adjacent ? "Heated" : "External";
      const adjacentC = boundary === "External" ? build.externalDesignTemperatureC : boundary === "Heated" ? resolvedOverride.adjacentTemperatureC ?? (adjacent ? thermalRoom(adjacent, project).designIndoorTemperatureC : targetC) : boundary === "Adiabatic" ? targetC : resolvedOverride.adjacentTemperatureC ?? settings.adjacentTemperatureC;
      let glazing = 0, doors = 0;
      for (const o of openingList) {
        const width = Math.max(0, Math.min(end, o.offset_mm + o.width.value) - Math.max(start, o.offset_mm));
        const openingArea = width * Math.min(heightMm, o.height.value) / 1e6;
        if (o.kind === "WINDOW") glazing += openingArea; else doors += openingArea;
      }
      const gross = (end - start) * heightMm / 1e6;
      if (glazing + doors > gross + 0.001) warnings.push(`Wall ${index + 1}: openings exceed wall area; check dimensions/overlaps.`);
      const opaque = Math.max(0, gross - glazing - doors);
      if (boundary === "External") { externalWallAreaM2 += opaque; windowAreaM2 += glazing; doorAreaM2 += doors; } else internalWallAreaM2 += opaque;
      const wallU = override?.uValue ?? (boundary === "External" ? u.externalWall : boundary === "Heated" ? u.internalWall : u.unheatedWall);
      add(`wall:${index}:${k}`, `Wall ${index + 1} (${boundary.toLowerCase()})`, opaque, wallU, adjacentC, boundary, index);
      const segmentSurface = surfaces.at(-1)!, a = room.vertices[index], b = room.vertices[(index + 1) % room.vertices.length];
      if (length) { segmentSurface.startMm = { x: a.x + (b.x - a.x) * start / length, y: a.y + (b.y - a.y) * start / length };segmentSurface.endMm = { x: a.x + (b.x - a.x) * end / length, y: a.y + (b.y - a.y) * end / length }; }
      for (const o of openingList) {
        const width = Math.max(0, Math.min(end, o.offset_mm + o.width.value) - Math.max(start, o.offset_mm));
        const openingArea = width * Math.min(heightMm, o.height.value) / 1e6;
        if (openingArea) add(`opening:${o.id}`, `${o.kind === "WINDOW" ? "Window" : "Door"} ${o.id}`, openingArea, o.kind === "WINDOW" ? u.window : u.door, adjacentC, boundary, index);
      }
    }
  });
  const adjacent = (boundary: string) => boundary === "External" || boundary === "Ground" ? build.externalDesignTemperatureC : boundary === "Unheated" ? settings.adjacentTemperatureC : targetC;
  const floorOverride = project.thermalOverrides?.[thermalElementId(room.id, "floor")], roofOverride = project.thermalOverrides?.[thermalElementId(room.id, "roof")];
  const floorBoundary = floorOverride?.boundary && floorOverride.boundary !== "Auto" ? floorOverride.boundary : settings.floorBoundary;
  const roofBoundary = roofOverride?.boundary && roofOverride.boundary !== "Auto" ? roofOverride.boundary : settings.ceilingBoundary;
  const temperature = (boundary: string, override?: { adjacentTemperatureC?: number }) => override?.adjacentTemperatureC ?? adjacent(boundary);
  add("floor", `Floor (${floorBoundary.toLowerCase()})`, areaM2, floorBoundary === "Ground" ? u.groundFloor : u.exposedFloor, temperature(floorBoundary, floorOverride), floorBoundary);
  add("roof", `Ceiling (${roofBoundary.toLowerCase()})`, areaM2, u.roof, temperature(roofBoundary, roofOverride), roofBoundary);
  const volumeM3 = areaM2 * heightMm / 1000, fabricW = surfaces.reduce((s, v) => s + v.lossW, 0), ventilationW = calculateVentilationLoss(volumeM3, settings.airChangeRate, targetC, build.externalDesignTemperatureC), totalW = fabricW + ventilationW, designW = totalW * (1 + build.designAllowancePercent / 100);
  return { roomId: room.id, areaM2, perimeterM, heightMm, volumeM3, externalWallAreaM2, internalWallAreaM2, windowAreaM2, doorAreaM2, surfaces, fabricW, ventilationW, totalW, designW, densityWm2: areaM2 ? designW / areaM2 : 0, targetC, ach: settings.airChangeRate, warnings };
}
/** Multilinear interpolation only within a complete supplied grid. No extrapolation. */
export function interpolatePerformance<T extends object>(points: readonly T[], coordinates: readonly (keyof T)[], query: Partial<T>, output: keyof T): { value: number; interpolated: boolean } | null {
  // Some manufacturer tables give a series of paired flow/return conditions,
  // not a Cartesian grid. Interpolate only on a segment that actually contains
  // the queried operating condition; never inverse-distance-average unrelated rows.
  const exact = points.find(p => coordinates.every(k => Math.abs(Number(p[k]) - Number(query[k])) < 1e-8));
  if (exact && exact[output] !== null && Number.isFinite(Number(exact[output]))) return { value: Number(exact[output]), interpolated: false };
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    const a = points[i], b = points[j], axis = coordinates.find(k => Math.abs(Number(b[k]) - Number(a[k])) > 1e-8);
    if (!axis) continue;
    const t = (Number(query[axis]) - Number(a[axis])) / (Number(b[axis]) - Number(a[axis]));
    if (t < 0 || t > 1 || !coordinates.every(k => Math.abs(Number(a[k]) + t * (Number(b[k]) - Number(a[k])) - Number(query[k])) < 1e-8)) continue;
    if (a[output] === null || b[output] === null) continue;
    return { value: Number(a[output]) + t * (Number(b[output]) - Number(a[output])), interpolated: true };
  }
  const brackets: number[][] = [];
  for (const key of coordinates) {
    const target = Number(query[key]); if (!Number.isFinite(target)) return null;
    const values = [...new Set(points.map(p => Number(p[key])))].filter(Number.isFinite).sort((a, b) => a - b);
    const lower = values.filter(v => v <= target + 1e-8).at(-1), upper = values.find(v => v >= target - 1e-8);
    if (lower === undefined || upper === undefined) return null;
    brackets.push(Math.abs(upper - lower) < 1e-8 ? [lower] : [lower, upper]);
  }
  let total = 0, interpolated = false;
  const corners: { values: number[]; weight: number }[] = [{ values: [], weight: 1 }];
  for (let i = 0; i < brackets.length; i++) {
    const previous = corners.splice(0), b = brackets[i], target = Number(query[coordinates[i]]);
    for (const c of previous) for (const value of b) corners.push({ values: [...c.values, value], weight: c.weight * (b.length === 1 ? 1 : value === b[0] ? (b[1] - target) / (b[1] - b[0]) : (target - b[0]) / (b[1] - b[0])) });
    interpolated ||= b.length > 1;
  }
  for (const corner of corners) {
    const p = points.find(p => coordinates.every((key, i) => Math.abs(Number(p[key]) - corner.values[i]) < 1e-8));
    if (!p || !Number.isFinite(Number(p[output]))) return null;
    total += Number(p[output]) * corner.weight;
  }
  return { value: total, interpolated };
}
export function lookupHybridRadiatorOutput(points: readonly HybridPerformancePoint[], flowC: number, returnC: number, roomC: number, fanMode: string) {
  const rows = points.filter(p => p.fanMode === fanMode), query = { flowC, returnC, roomC };
  const output = interpolatePerformance(rows, ["flowC", "returnC", "roomC"], query, "outputW"), electrical = interpolatePerformance(rows, ["flowC", "returnC", "roomC"], query, "electricalW");
  return output && electrical ? { outputW: output.value, electricalW: electrical.value, interpolated: output.interpolated } : null;
}
export function calculateRadiatorOutput(radiator: HeatingRadiator, flowC: number, returnC: number, roomC: number): { outputW: number | null; electricalW: number; note: string } {
  if (radiator.category === "Boiler") return { outputW: 0, electricalW: 0, note: `Heat generator: ${radiator.ratedOutputW ?? "Not set"} W central-heating capacity; not room heat output.` };
  if (radiator.emitterTechnology === "Electric") return { outputW: radiator.ratedOutputW, electricalW: radiator.ratedOutputW ?? 0, note: "Resistive input ≈ delivered heat; no water-temperature correction." };
  if (!radiator.estimatedOutput && (radiator.emitterTechnology === "Hybrid" || radiator.manufacturerPerformanceData.length)) {
    const result = lookupHybridRadiatorOutput(radiator.manufacturerPerformanceData, flowC, returnC, roomC, radiator.fanMode);
    if (result || radiator.emitterTechnology === "Hybrid") return { outputW: result?.outputW ?? null, electricalW: result?.electricalW ?? 0, note: result ? result.interpolated ? "Interpolated supplied performance grid." : "Supplied performance point." : "Performance not set at these conditions; no extrapolation." };
  }
  const delta = Math.max(0, (flowC + returnC) / 2 - roomC);
  return { outputW: radiator.ratedOutputW === null ? null : radiator.ratedOutputW * (delta / radiator.ratedDeltaTK) ** radiator.exponent, electricalW: 0, note: radiator.estimatedOutput ? "Estimated size-scaled panel surrogate, not this product’s tested rating. Confirm before sizing/installation." : "Estimated power-law correction from reference output and exponent." };
}
export function calculateElectricEmitterSize(demandW: number, sizes = [500, 750, 1000, 1250, 1500, 2000, 2500]): number[] {
  if (!(demandW > 0)) return [];
  const target = Math.ceil(demandW / 250), max = target + 10, dp: number[][] = Array.from({ length: max + 1 }, () => []);
  for (let i = 1; i <= max; i++) { const options = sizes.filter(s => i >= s / 250 && (i === s / 250 || dp[i - s / 250].length)).map(s => [...dp[i - s / 250], s]); dp[i] = options.sort((a, b) => a.length - b.length)[0] ?? []; }
  return dp.slice(target).find(p => p.length) ?? [];
}
export function sizeRadiator(demandW: number, candidates: readonly HeatingRadiator[], flowC: number, returnC: number, roomC: number) {
  return candidates.filter(r => (calculateRadiatorOutput(r, flowC, returnC, roomC).outputW ?? -1) >= demandW).sort((a, b) => a.widthMm * a.heightMm - b.widthMm * b.heightMm)[0] ?? null;
}
export function calculateUFHOutput(zone: UFHZone, flowC: number, returnC: number, roomC: number) {
  const dataset = zone.performanceDataset;
  if (!dataset || dataset.pipeDiameterMm !== zone.diameterMm || dataset.floorConstruction !== zone.floorConstruction) return null;
  const query = { spacingMm: zone.spacingMm, floorResistance: zone.floorThermalResistance, flowC, returnC, roomC }, keys = ["spacingMm", "floorResistance", "flowC", "returnC", "roomC"] as const;
  const output = interpolatePerformance(dataset.points, keys, query, "outputWm2");
  if (!output) return null;
  const surface = interpolatePerformance(dataset.points.filter(p => p.surfaceTemperatureC !== null), keys, query, "surfaceTemperatureC");
  return { outputWm2: output.value, surfaceTemperatureC: surface?.value ?? null, interpolated: output.interpolated, overLimit: surface !== null && surface.value > zone.maxSurfaceTemperatureC || dataset.maxOutputWm2 !== undefined && output.value > dataset.maxOutputWm2 };
}
/** Water approximation: cp 4180 J/kgK, density 998 kg/m³. Not glycol. */
export function calculateUFHFlowRate(outputW: number, flowC: number, returnC: number): number | null { return flowC > returnC ? outputW / (4180 * (flowC - returnC)) * 60 * 1000 / 998 : null; }
export function calculatePressureDrop(lengthM: number, flowLmin: number, internalDiameterMm: number | null, meanWaterC: number): number | null {
  if (!internalDiameterMm || meanWaterC < 20 || meanWaterC > 80) return null;
  const diameter = internalDiameterMm / 1000, velocity = flowLmin / 60000 / (Math.PI * diameter * diameter / 4), viscosity = 2.414e-5 * 10 ** (247.8 / (meanWaterC + 133.15)), re = 998 * velocity * diameter / viscosity;
  if (re <= 0) return 0;
  if (re >= 2300 && re <= 4000) return null;
  const friction = re < 2300 ? 64 / re : 0.25 / Math.log10(0.0000015 / (3.7 * diameter) + 5.74 / re ** 0.9) ** 2;
  return friction * lengthM / diameter * 998 * velocity * velocity / 2;
}
export function radiatorPlacementWarnings(r: HeatingRadiator, room: Room): string[] {
  const warnings: string[] = [];
  if (r.wallIndex === undefined) warnings.push("Not wall-snapped; check mounting position.");
  else {
    const a = room.vertices[r.wallIndex], b = room.vertices[(r.wallIndex + 1) % room.vertices.length];
    if (!a || !b || (r.positionAlongWallMm ?? 0) - r.widthMm / 2 < 0 || (r.positionAlongWallMm ?? 0) + r.widthMm / 2 > distanceMm(a, b)) warnings.push("Radiator does not fit the selected wall.");
    const wallIndex = r.wallIndex;
    for (const o of room.openings.filter(o => o.kind === "DOOR" && o.parent_wall_id === `wall-${String(wallIndex + 1).padStart(3, "0")}`)) if ((r.positionAlongWallMm ?? 0) + r.widthMm / 2 > o.offset_mm && (r.positionAlongWallMm ?? 0) - r.widthMm / 2 < o.offset_mm + o.width.value) warnings.push("Radiator overlaps a doorway.");
  }
  const angle = r.rotationDeg * Math.PI / 180, corners = [[-r.widthMm / 2, -r.depthMm / 2], [r.widthMm / 2, -r.depthMm / 2], [r.widthMm / 2, r.depthMm / 2], [-r.widthMm / 2, r.depthMm / 2]].map(([x, y]) => ({ x: r.positionMm.x + x * Math.cos(angle) - y * Math.sin(angle), y: r.positionMm.y + x * Math.sin(angle) + y * Math.cos(angle) }));
  if (!corners.every(p => containsPoint(p, room.vertices))) warnings.push("Radiator footprint extends outside room boundary.");
  if (room.obstacles.some(o => { if (o.id === r.radiatorId) return false; const footprint = obstacleFootprint(o); return corners.some(p => containsPoint(p, footprint)) || footprint.some(p => containsPoint(p, corners)); })) warnings.push("Radiator overlaps a placed fitting/furniture footprint.");
  return warnings;
}
export function snapRadiatorToWall(r: HeatingRadiator, room: Room, point: Point2D): HeatingRadiator {
  const edge = room.vertices.map((a, index) => { const b = room.vertices[(index + 1) % room.vertices.length]; return { a, b, index, ...projectOnSegment(point, a, b) }; }).sort((a, b) => a.distance - b.distance)[0];
  if (!edge) return r;
  const signed = room.vertices.reduce((s, a, i) => { const b = room.vertices[(i + 1) % room.vertices.length]; return s + a.x * b.y - b.x * a.y; }, 0), sign = signed >= 0 ? 1 : -1, length = distanceMm(edge.a, edge.b);
  const along = Math.max(r.widthMm / 2 + 30, Math.min(length - r.widthMm / 2 - 30, edge.t * length)), offset = r.depthMm / 2 + 40;
  return { ...r, wallIndex: edge.index, positionAlongWallMm: along, rotationDeg: Math.atan2(edge.b.y - edge.a.y, edge.b.x - edge.a.x) * 180 / Math.PI, positionMm: { x: edge.a.x + (edge.b.x - edge.a.x) / length * along - sign * (edge.b.y - edge.a.y) / length * offset, y: edge.a.y + (edge.b.y - edge.a.y) / length * along + sign * (edge.b.x - edge.a.x) / length * offset } };
}
export function geometryFingerprint(room: Room, exclusions: readonly { polygonMm: Point2D[] }[]) { return JSON.stringify([room.vertices, exclusions.map(e => e.polygonMm)]).length + ":" + JSON.stringify([room.vertices, exclusions.map(e => e.polygonMm)]).split("").reduce((s, c) => Math.imul(s ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261); }
