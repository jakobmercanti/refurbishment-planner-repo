import type { Room } from "./types";
import type { ConstructionAssembly, EnergyProject } from "./energyDocument";
import { RETAINED_RESISTANCE_MATERIAL } from "./energyDocument";
import { withLayerColours } from "./energyLayerColours";
import { assignEnergyElements, calculateAssemblyUValue, scenarioAssignments, type EnergyElement } from "./energyCalculations";

export { LAYER_COLOURS } from "./energyLayerColours";
export const assemblyThickness = (a: ConstructionAssembly) => a.layers.reduce((s, l) => s + l.thicknessMm, 0);

/** Opening the editor must not replace an unknown build-up with invented concrete.
 * Preserve the effective whole-element R; measured thickness is presentation only
 * for this equivalent layer. Surface films are already included, exactly once. */
export function createElementAssemblyDraft(data: EnergyProject, element: EnergyElement, thicknessMm: number) {
  const assignment = scenarioAssignments(data).find(a => a.elementId === element.elementId);
  const original = data.assemblies.find(a => a.assemblyId === assignment?.assemblyId);
  const stale = element.warnings.some(w => w.includes("no longer matches"));
  if (original && assignment?.uValue == null && original.directUValue === null && !stale) return { data, assembly: structuredClone(original) };
  const next = data.materials.some(m => m.materialId === RETAINED_RESISTANCE_MATERIAL.materialId) ? data : { ...data, materials: [...data.materials, { ...RETAINED_RESISTANCE_MATERIAL }] };
  const entered = !stale && (assignment?.uValue != null || original?.directUValue != null);
  const assembly: ConstructionAssembly = withLayerColours({ assemblyId: crypto.randomUUID(), name: element.label, category: element.category, rsi: 0, rse: 0, directUValue: null,
    notes: "Existing whole-element U-value retained as equivalent resistance, including surface films. Physical composition is unknown; do not add surface films twice. Choose a starting composition only to replace this baseline deliberately.",
    layers: [{ layerId: crypto.randomUUID(), materialId: RETAINED_RESISTANCE_MATERIAL.materialId, thicknessMm, resistanceOverride: element.uValue > 0 ? 1 / element.uValue : null, resistanceSource: entered ? "ENTERED_U" : "HEATING_ESTIMATE", position: "Within", upgrade: false }] });
  return { data: next, assembly };
}
/** Reorder by identity; material, colour and thermal overrides travel with their layer. */
export function reorderConstructionLayer(a: ConstructionAssembly, layerId: string, targetId: string): ConstructionAssembly {
  const from = a.layers.findIndex(l => l.layerId === layerId), to = a.layers.findIndex(l => l.layerId === targetId);
  if (from < 0 || to < 0 || from === to) return a;
  const layers = [...a.layers];
  layers.splice(to, 0, layers.splice(from, 1)[0]);
  return { ...a, layers, directUValue: null };
}
/** Drop at a boundary in the original list, including before first / after last. */
export function insertConstructionLayer(a: ConstructionAssembly, layerId: string, boundary: number): ConstructionAssembly {
  const from = a.layers.findIndex(l => l.layerId === layerId);
  if (from < 0 || !Number.isInteger(boundary) || boundary < 0 || boundary > a.layers.length) return a;
  const to = boundary - (from < boundary ? 1 : 0);
  if (from === to) return a;
  const layers = [...a.layers];
  layers.splice(to, 0, layers.splice(from, 1)[0]);
  return { ...a, layers, directUValue: null };
}
export function wallThicknessForElement(e: Pick<EnergyElement, "roomId" | "elementId">, rooms: readonly Room[]) {
  const room = rooms.find(r => r.id === e.roomId), index = Number(e.elementId.split("|wall:")[1]?.split(":")[0]);
  return room?.wall_thickness_overrides_mm?.[`wall-${String(index + 1).padStart(3, "0")}`] ?? room?.wall_thickness.value ?? 150;
}
/** Scaling is explicit: no fake material properties are filled in. A cavity's entered R stays fixed. */
export function resizeAssembly(a: ConstructionAssembly, thicknessMm: number): ConstructionAssembly {
  const total = assemblyThickness(a);
  if (!(total > 0) || !(thicknessMm > 0 && thicknessMm <= 2000)) return a;
  return { ...a, directUValue: null, layers: a.layers.map(l => ({ ...l, thicknessMm: l.thicknessMm * thicknessMm / total })) };
}
/** A selected wall gets its own assembly; shared templates and other scenarios are never edited. */
export function setWallAssembly(data: EnergyProject, element: EnergyElement, assembly: ConstructionAssembly): EnergyProject {
  const previous = scenarioAssignments(data).find(a => a.elementId === element.elementId);
  const assigned = data.assemblies.find(a => a.assemblyId === previous?.assemblyId);
  const refs = [...data.existingAssignments, ...data.scenarios.flatMap(s => s.assignments)].filter(a => a.assemblyId === assigned?.assemblyId);
  const own = assigned?.assemblyId === assembly.assemblyId && refs.length === 1 &&
    (!data.activeScenarioId || !data.existingAssignments.some(a => a.assemblyId === assembly.assemblyId));
  const nextAssembly = { ...assembly, assemblyId: own ? assembly.assemblyId : crypto.randomUUID(), directUValue: null };
  const next = { ...data, assemblies: own ? data.assemblies.map(a => a.assemblyId === nextAssembly.assemblyId ? nextAssembly : a) : [...data.assemblies, nextAssembly] };
  return assignEnergyElements(next, [{ ...previous, elementId: element.elementId, assemblyId: nextAssembly.assemblyId, uValue: null, geometrySignature: element.geometrySignature }]);
}
/** Synchronise an existing construction to a main-floorplan thickness edit. */
export function syncWallAssemblyThickness(data: EnergyProject, elements: readonly EnergyElement[], rooms: readonly Room[]): EnergyProject {
  let next = data;
  for (const e of elements.filter(e => e.category === "wall")) {
    const a = next.assemblies.find(a => a.assemblyId === scenarioAssignments(next).find(v => v.elementId === e.elementId)?.assemblyId);
    const target = wallThicknessForElement(e, rooms);
    if (a && assemblyThickness(a) > 0 && Math.abs(assemblyThickness(a) - target) > .00001) next = setWallAssembly(next, e, resizeAssembly(a, target));
  }
  return next;
}
/** Minimum additional serial insulation, rounded UP to a whole millimetre, not a compliance assessment. */
export function minimumInsulationThickness(a: ConstructionAssembly, data: EnergyProject, lambda: number | null, targetU: number): number | null {
  const u = calculateAssemblyUValue(a, data.materials).uValue;
  if (u === null || !lambda || !(targetU > 0)) return null;
  return Math.ceil(Math.max(0, 1 / targetU - 1 / u) * lambda * 1000 - 1e-9);
}
/** Transparent project-target metric, not SAP/RdSAP/EPC or annual energy use. */
export function fabricTargetScore(elements: readonly EnergyElement[], data: EnergyProject) {
  const exposed = elements.filter(e => !["Heated", "Adiabatic"].includes(e.boundary) && e.areaM2 > 0);
  let knownArea = 0, weighted = 0;
  for (const e of exposed) {
    const a = scenarioAssignments(data).find(a => a.elementId === e.elementId);
    const assembly = data.assemblies.find(v => v.assemblyId === a?.assemblyId);
    const known = a?.uValue != null || (assembly && calculateAssemblyUValue(assembly, data.materials).uValue !== null);
    if (!known || e.warnings.length) continue;
    knownArea += e.areaM2;weighted += e.areaM2 * Math.min(1, data.targets[e.category] / Math.max(e.uValue, .000001));
  }
  const totalArea = exposed.reduce((s, e) => s + e.areaM2, 0);
  return { score: knownArea ? Math.round(weighted / knownArea * 100) : null, coveragePercent: totalArea ? Math.round(knownArea / totalArea * 100) : 0 };
}
