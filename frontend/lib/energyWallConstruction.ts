import type { Room } from "./types";
import type { ConstructionAssembly, EnergyProject } from "./energyDocument";
import { assignEnergyElements, calculateAssemblyUValue, scenarioAssignments, type EnergyElement } from "./energyCalculations";

export const LAYER_COLOURS = ["#b96950", "#ecd59c", "#e9c844", "#a5b2bb", "#ece9e0", "#78a5b4"];
export const assemblyThickness = (a: ConstructionAssembly) => a.layers.reduce((s, l) => s + l.thicknessMm, 0);
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
