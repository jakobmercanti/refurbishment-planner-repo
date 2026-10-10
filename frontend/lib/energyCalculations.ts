import type { Room, Point2D } from "./types";
import { withLayerColours } from "./energyLayerColours";
import { calculateRoomHeatLoss, wallAdjacencies, type ThermalSurface } from "./heatingCalculations";
import type { HeatingProject } from "./heatingDocument";
import { thermalElementId, type BuildingThermalOverrides } from "./buildingThermalModel";
import type { ConstructionAssembly, ConstructionLayer, EnergyCategory, EnergyProject, ElementAssignment, ThermalMaterial } from "./energyDocument";

export function calculateLayerResistance(layer: ConstructionLayer, materials: readonly ThermalMaterial[]): number | null {
  if (layer.resistanceOverride !== null) return layer.resistanceOverride;
  const material = materials.find(m => m.materialId === layer.materialId);
  if (layer.lambdaOverride == null && material?.resistance != null) return layer.thicknessMm >= (material.resistanceMinThicknessMm ?? 0) && (material.resistanceReferenceThicknessMm == null || Math.abs(layer.thicknessMm - material.resistanceReferenceThicknessMm) < .001) ? material.resistance : null;
  const lambda = layer.lambdaOverride ?? material?.lambda;
  return lambda && layer.thicknessMm >= 0 ? layer.thicknessMm / 1000 / lambda : null;
}
export function calculateAssemblyUValue(assembly: ConstructionAssembly, materials: readonly ThermalMaterial[]) {
  const layers = assembly.layers.map(layer => ({ layer, resistance: calculateLayerResistance(layer, materials) }));
  if (assembly.directUValue !== null) return { uValue: assembly.directUValue, totalR: 1 / assembly.directUValue, layers, method: "Entered whole-element U-value" };
  const missing = !layers.length || layers.some(l => l.resistance === null), totalR = assembly.rsi + assembly.rse + layers.reduce((s, l) => s + (l.resistance ?? 0), 0);
  return { uValue: missing || totalR <= 0 ? null : 1 / totalR, totalR: missing ? null : totalR, layers, method: "One-dimensional layers: U = 1 / (Rsi + sum R + Rse)" };
}
export function scenarioAssignments(data: EnergyProject, scenarioId: string | null = data.activeScenarioId) {
  return [...new Map([...data.existingAssignments, ...(data.scenarios.find(s => s.scenarioId === scenarioId)?.assignments ?? [])].map(a => [a.elementId, a])).values()];
}
export function wallGeometrySignature(room: Room, index: number) { return JSON.stringify([room.vertices[index], room.vertices[(index + 1) % room.vertices.length]]); }
function segmentGeometrySignature(room: Room, index: number, segment: number, rooms: readonly Room[]) {
  if (!room.vertices[index]) return "Removed wall";
  const { a, b, length, intervals } = wallAdjacencies(room, index, rooms), breaks = [...new Set([0, length, ...intervals.flatMap(i => [i.start, i.end])])].sort((a, b) => a - b);
  const at = (d: number) => ({ x: a.x + (b.x - a.x) * d / length, y: a.y + (b.y - a.y) * d / length });
  return length && breaks[segment + 1] !== undefined ? JSON.stringify([at(breaks[segment]), at(breaks[segment + 1])]) : "Removed segment";
}
export function resolveThermalOverrides(data: EnergyProject, rooms: readonly Room[], scenarioId: string | null = data.activeScenarioId): BuildingThermalOverrides {
  const result: BuildingThermalOverrides = {};
  for (const assignment of scenarioAssignments(data, scenarioId)) {
    const [roomId, element] = assignment.elementId.split("|"), room = rooms.find(r => r.id === roomId);
    if (!room) continue;
    if (element.startsWith("wall:") && assignment.geometrySignature) { const parts = element.split(":");const current = parts.length === 3 ? segmentGeometrySignature(room, Number(parts[1]), Number(parts[2]), rooms) : wallGeometrySignature(room, Number(parts[1]));if (assignment.geometrySignature !== current) { result[assignment.elementId] = { warning: "Energy construction assignment no longer matches this wall geometry; reassign it. Heating fallback retained." };continue; } }
    const assembly = data.assemblies.find(a => a.assemblyId === assignment.assemblyId), uValue = assignment.uValue ?? (assembly ? calculateAssemblyUValue(assembly, data.materials).uValue : null);
    result[assignment.elementId] = { ...(uValue !== null ? { uValue } : {}), ...(assignment.boundary ? { boundary: assignment.boundary } : {}), ...(assignment.adjacentTemperatureC !== undefined ? { adjacentTemperatureC: assignment.adjacentTemperatureC } : {}), ...(assembly && uValue === null ? { warning: `Energy assembly ${assembly.name}: missing thermal inputs; Heating fallback retained, result unverified.` } : {}) };
  }
  return result;
}
export function withEnergyFabric(heating: HeatingProject, energy: EnergyProject, rooms: readonly Room[], scenarioId: string | null = energy.activeScenarioId): HeatingProject { return { ...heating, thermalOverrides: resolveThermalOverrides(energy, rooms, scenarioId) }; }
export function withoutDerivedFabric(heating: HeatingProject): HeatingProject { const { thermalOverrides, ...stored } = heating;void thermalOverrides;return stored; }
export type EnergyElement = { elementId: string; roomId: string; roomName: string; label: string; category: EnergyCategory; areaM2: number; uValue: number; heatLossW: number; boundary: string; deltaTK: number; startMm?: Point2D; endMm?: Point2D; geometrySignature?: string; warnings: string[] };
function categoryFor(surface: ThermalSurface, room: Room): EnergyCategory { if (surface.key === "floor" || surface.key === "roof") return surface.key;if (surface.key.startsWith("opening:")) return room.openings.find(o => o.id === surface.key.slice(8))?.kind === "WINDOW" ? "window" : "door";return "wall"; }
export function energyElements(rooms: readonly Room[], heating: HeatingProject, energy: EnergyProject, scenarioId: string | null = energy.activeScenarioId): EnergyElement[] {
  const effective = withEnergyFabric(heating, energy, rooms, scenarioId), elements: EnergyElement[] = [];
  for (const room of rooms) {
    const loss = calculateRoomHeatLoss(room, rooms, effective);
    for (const surface of loss.surfaces) {
      const category = categoryFor(surface, room), multipleWallSegments = category === "wall" && loss.surfaces.filter(s => s.key.startsWith(`wall:${surface.edgeIndex}:`)).length > 1, key = category === "wall" ? multipleWallSegments ? surface.key : `wall:${surface.edgeIndex}` : surface.key, elementId = thermalElementId(room.id, key), existing = elements.find(e => e.elementId === elementId);
      if (existing) { existing.areaM2 += surface.areaM2;existing.heatLossW += surface.lossW;if (existing.boundary !== surface.boundary) existing.boundary = "Mixed";continue; }
      let startMm = surface.startMm, endMm = surface.endMm;
      if (surface.key.startsWith("opening:") && surface.edgeIndex !== undefined) {
        const o = room.openings.find(o => o.id === surface.key.slice(8)), a = room.vertices[surface.edgeIndex], b = room.vertices[(surface.edgeIndex + 1) % room.vertices.length], length = Math.hypot(b.x - a.x, b.y - a.y);
        if (o && length) { const at = (offset: number) => ({ x: a.x + (b.x - a.x) * offset / length, y: a.y + (b.y - a.y) * offset / length });startMm = at(o.offset_mm);endMm = at(o.offset_mm + o.width.value); }
      }
      elements.push({ elementId, roomId: room.id, roomName: room.name, label: `${room.name} · ${surface.label}${multipleWallSegments ? ` · segment ${Number(surface.key.split(":")[2]) + 1}` : ""}`, category, areaM2: surface.areaM2, uValue: surface.uValue, heatLossW: surface.lossW, boundary: surface.boundary, deltaTK: Math.max(0, loss.targetC - surface.adjacentTemperatureC), startMm, endMm, ...(category === "wall" ? { geometrySignature: multipleWallSegments ? JSON.stringify([startMm, endMm]) : wallGeometrySignature(room, surface.edgeIndex!) } : {}), warnings: effective.thermalOverrides?.[elementId]?.warning ? [effective.thermalOverrides[elementId].warning!] : [] });
    }
  }
  return elements;
}
export function calculateBuildingHeatLossCoefficient(rooms: readonly Room[], heating: HeatingProject) {
  let fabric = 0, ventilation = 0;
  for (const room of rooms) { const loss = calculateRoomHeatLoss(room, rooms, heating);fabric += loss.surfaces.filter(s => !["Heated", "Adiabatic"].includes(s.boundary)).reduce((sum, s) => sum + s.areaM2 * s.uValue, 0);ventilation += .33 * loss.ach * loss.volumeM3; }
  return { fabric, ventilation, total: fabric + ventilation };
}
/** Degree-day comparison; no inferred climate, fuel costs, DHW or solar/occupancy gains. */
export function calculateAnnualEnergyEstimate(coefficientWK: number, settings: EnergyProject["energySettings"]) {
  if (settings.heatingDegreeDays === null || !settings.climateReference.trim()) return null;
  const usefulKwh = coefficientWK * settings.heatingDegreeDays * 24 / 1000 * settings.scheduleFactor;
  return { usefulKwh, deliveredKwh: settings.seasonalEfficiency === null || !settings.efficiencyBasis.trim() ? null : usefulKwh / settings.seasonalEfficiency };
}
export function energyResults(rooms: readonly Room[], heating: HeatingProject, data: EnergyProject, scenarioId: string | null = data.activeScenarioId) {
  const effective = withEnergyFabric(heating, data, rooms, scenarioId), roomResults = rooms.map(room => ({ room, loss: calculateRoomHeatLoss(room, rooms, effective) })), elements = energyElements(rooms, heating, data, scenarioId), coefficient = calculateBuildingHeatLossCoefficient(rooms, effective), bridgesWK = data.thermalBridges.reduce((s, b) => s + b.psiWmK * b.lengthMm / 1000, 0), areaM2 = roomResults.reduce((s, r) => s + r.loss.areaM2, 0), outside = heating.buildingSettings.externalDesignTemperatureC;
  // Bridge endpoint/room references are not yet modelled: report coefficient only, not an invented room allocation.
  const designW = roomResults.reduce((s, r) => s + r.loss.designW, 0), annual = calculateAnnualEnergyEstimate(coefficient.total + bridgesWK, data.energySettings), categories = ["wall", "window", "door", "floor", "roof"].map(category => ({ category, lossW: elements.filter(e => e.category === category).reduce((s, e) => s + e.heatLossW, 0), areaM2: elements.filter(e => e.category === category && !["Heated", "Adiabatic"].includes(e.boundary)).reduce((s, e) => s + e.areaM2, 0) })), exposed = elements.filter(e => !["Heated", "Adiabatic"].includes(e.boundary)), fabricArea = exposed.reduce((s, e) => s + e.areaM2, 0);
  const warnings = [...new Set([...roomResults.flatMap(r => r.loss.warnings), ...elements.flatMap(e => e.warnings), "Ground floor uses a simplified entered U-value; roof/ceiling area uses the room footprint, not roof slope. Unheated-space annual coefficients assume the same climate exposure; indicative upper bound.", ...(data.thermalBridges.length ? ["Entered linear bridge coefficients included in annual H only; not allocated to Heating room demand. Obtain junction/room data before final emitter design."] : ["Thermal bridges are not included unless entered; repeating bridges and fixings are not modelled."]), ...(annual ? ["HDD estimate uses the supplied base temperature and schedule multiplier; no separate solar/internal gains, hot water or lighting model. It is not an EPC."] : ["Annual estimate not set: provide degree days and their location/year/base-temperature source."]), ...(rooms.length ? [] : ["No detected rooms. Draw closed rooms to reuse their geometry."])])];
  return { rooms: roomResults, elements, designW, coefficient: { ...coefficient, bridges: bridgesWK, total: coefficient.total + bridgesWK }, areaM2, annual, usefulIntensity: annual && areaM2 ? annual.usefulKwh / areaM2 : null, averageU: fabricArea ? coefficient.fabric / fabricArea : null, ventilationW: roomResults.reduce((s, r) => s + r.loss.ventilationW, 0), categories, ranking: [...elements].sort((a, b) => b.heatLossW - a.heatLossW), warnings, outside, verified: !elements.some(e => e.warnings.length) };
}
export function compareThermalScenarios(rooms: readonly Room[], heating: HeatingProject, data: EnergyProject) {
  const current = energyResults(rooms, heating, data, null);
  return [{ scenarioId: null, name: "Existing Building", result: current, reductionW: 0 }, ...data.scenarios.map(s => { const result = energyResults(rooms, heating, data, s.scenarioId);return { scenarioId: s.scenarioId, name: s.name, result, reductionW: current.designW - result.designW }; })];
}
export function calculateInsulationUpgrade(uBefore: number, lambda: number, thicknessMm: number) { return uBefore > 0 && lambda > 0 ? 1 / (1 / uBefore + thicknessMm / 1000 / lambda) : null; }
export function findInsulationThickness(uBefore: number, targetU: number, lambda: number) { return uBefore > 0 && targetU > 0 && lambda > 0 ? Math.max(0, (1 / targetU - 1 / uBefore) * lambda * 1000) : null; }
export function assignEnergyElements(data: EnergyProject, assignments: ElementAssignment[]): EnergyProject {
  const merge = (values: ElementAssignment[]) => [...new Map([...values, ...assignments].map(a => [a.elementId, a])).values()];
  return data.activeScenarioId ? { ...data, scenarios: data.scenarios.map(s => s.scenarioId === data.activeScenarioId ? { ...s, assignments: merge(s.assignments) } : s) } : { ...data, existingAssignments: merge(data.existingAssignments) };
}
export function duplicateRetrofitScenario(data: EnergyProject, scenarioId: string): EnergyProject {
  const source = data.scenarios.find(s => s.scenarioId === scenarioId);if (!source) throw new Error("Scenario not found.");
  const newId = crypto.randomUUID(), cloned = new Map<string, ConstructionAssembly>();
  const assignments = source.assignments.map(assignment => {
    if (!assignment.assemblyId) return { ...assignment };
    const original = data.assemblies.find(a => a.assemblyId === assignment.assemblyId)!;
    if (!cloned.has(original.assemblyId)) cloned.set(original.assemblyId, { ...structuredClone(original), assemblyId: crypto.randomUUID(), name: `${original.name} — scenario copy` });
    return { ...assignment, assemblyId: cloned.get(original.assemblyId)!.assemblyId };
  });
  return { ...data, activeScenarioId: newId, assemblies: [...data.assemblies, ...cloned.values()], scenarios: [...data.scenarios, { scenarioId: newId, name: `${source.name} — copy`, assignments }] };
}
export function addInsulation(data: EnergyProject, elements: EnergyElement[], materialId: string, thicknessMm: number, position: ConstructionLayer["position"]): EnergyProject {
  const material = data.materials.find(m => m.materialId === materialId);if (!material?.lambda) throw new Error("Enter the insulation material's thermal conductivity first.");
  if (!data.activeScenarioId) throw new Error("Create/select a proposed scenario before adding insulation; existing construction is preserved.");
  let next = data.materials.some(m => m.materialId === "existing-resistance") ? data : { ...data, materials: [...data.materials, { materialId: "existing-resistance", name: "Existing whole-element resistance (not a material layer)", category: "Equivalent resistance", lambda: null, density: null, vapourResistance: null, reference: "Captured existing whole-element U-value including surface resistances; verify the original Heating/fabric input.", editable: true }] };
  for (const element of elements) {
    const assigned = scenarioAssignments(next).find(a => a.elementId === element.elementId), original = next.assemblies.find(a => a.assemblyId === assigned?.assemblyId);
    if (original && calculateAssemblyUValue(original, next.materials).uValue === null) throw new Error("Complete the existing assembly inputs before upgrading it.");
    const base: ConstructionAssembly = original && original.directUValue === null ? structuredClone(original) : { assemblyId: "", name: element.label, category: element.category, rsi: 0, rse: 0, directUValue: null, notes: "Existing whole-element resistance retained, including its surface resistances; do not add them twice.", layers: [{ layerId: crypto.randomUUID(), materialId: "existing-resistance", thicknessMm: 0, resistanceOverride: element.uValue > 0 ? 1 / element.uValue : 0, position: "Within", upgrade: false }] };
    if (!original && element.uValue <= 0) throw new Error("Cannot upgrade an adiabatic/zero-U surface without a defined construction.");
    base.assemblyId = crypto.randomUUID();base.name = `${element.label} + ${thicknessMm} mm ${material.name}`;
    const layer: ConstructionLayer = { layerId: crypto.randomUUID(), materialId, thicknessMm, resistanceOverride: null, position, upgrade: true };
    base.layers = position === "Outside" ? [layer, ...base.layers] : [...base.layers, layer];
    next = assignEnergyElements({ ...next, assemblies: [...next.assemblies, withLayerColours(base)] }, [{ ...assigned, elementId: element.elementId, assemblyId: base.assemblyId, uValue: null, geometrySignature: element.geometrySignature }]);
  }
  return next;
}
export function calculateMaterialQuantities(rooms: readonly Room[], heating: HeatingProject, data: EnergyProject) {
  const elements = energyElements(rooms, heating, data), assignments = scenarioAssignments(data), rows: { element: EnergyElement; material: string; thicknessMm: number; areaM2: number; volumeM3: number; orderAreaM2: number; orderVolumeM3: number }[] = [];
  for (const element of elements) { const assembly = data.assemblies.find(a => a.assemblyId === assignments.find(a => a.elementId === element.elementId)?.assemblyId);for (const layer of assembly?.layers.filter(l => l.upgrade) ?? []) { const volumeM3 = element.areaM2 * layer.thicknessMm / 1000;rows.push({ element, material: data.materials.find(m => m.materialId === layer.materialId)?.name ?? "Not set", thicknessMm: layer.thicknessMm, areaM2: element.areaM2, volumeM3, orderAreaM2: element.areaM2 * (1 + data.energySettings.wastePercent / 100), orderVolumeM3: volumeM3 * (1 + data.energySettings.wastePercent / 100) }); } }
  return rows;
}
export function calculateIndicativeEnergyRating() { return { score: null, band: null, reason: "Not available: a validated SAP/RdSAP-compatible rating method is not implemented. Compare design heat loss and supplied-HDD useful heat intensity instead; no arbitrary EPC points." }; }
