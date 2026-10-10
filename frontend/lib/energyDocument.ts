import { z } from "zod";
import { withLayerColours } from "./energyLayerColours";
import { CONSTRUCTION_MATERIAL_DEFAULTS, upgradeLegacyMaterial } from "./thermalMaterialDefaults";

const finite = z.number().finite(), text = z.string().max(2000), id = z.string().min(1).max(180);
export const elementCategorySchema = z.enum(["wall", "floor", "roof", "window", "door"]);
export type EnergyCategory = z.infer<typeof elementCategorySchema>;
const materialSchema = z.object({ materialId: id, name: text, category: text, lambda: finite.positive().max(20).nullable(), density: finite.positive().nullable(), vapourResistance: finite.nonnegative().nullable(), reference: text, editable: z.boolean(), resistance: finite.nonnegative().max(100).nullable().optional(), resistanceMinThicknessMm: finite.nonnegative().max(3000).optional(), resistanceReferenceThicknessMm: finite.positive().max(3000).nullable().optional() });
export type ThermalMaterial = z.infer<typeof materialSchema>;
const layerSchema = z.object({ layerId: id, materialId: id, thicknessMm: finite.min(0).max(3000), resistanceOverride: finite.nonnegative().max(100).nullable(), lambdaOverride: finite.positive().max(20).nullable().optional(), colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), position: z.enum(["Inside", "Outside", "Within"]), upgrade: z.boolean() });
export type ConstructionLayer = z.infer<typeof layerSchema>;
const assemblySchema = z.object({ assemblyId: id, name: text, category: elementCategorySchema, rsi: finite.nonnegative().max(10), rse: finite.nonnegative().max(10), directUValue: finite.positive().max(10).nullable(), layers: z.array(layerSchema).max(100), notes: text });
export type ConstructionAssembly = z.infer<typeof assemblySchema>;
const assignmentSchema = z.object({ elementId: z.string().max(400).regex(/^[\w:-]+\|(wall:\d+(?::\d+)?|floor|roof|opening:[\w:-]+)$/), assemblyId: id.nullable(), uValue: finite.min(0).max(10).nullable(), boundary: z.enum(["Auto", "External", "Heated", "Unheated", "Adiabatic", "Ground"]).optional(), adjacentTemperatureC: finite.min(-50).max(40).optional(), geometrySignature: text.optional(), glazingType: text.optional(), frameType: text.optional(), orientationDeg: finite.min(0).max(360).nullable().optional(), solarGainValue: finite.min(0).max(1).nullable().optional() });
export type ElementAssignment = z.infer<typeof assignmentSchema>;
const scenarioSchema = z.object({ scenarioId: id, name: text, assignments: z.array(assignmentSchema).max(10000) });
export type RetrofitScenario = z.infer<typeof scenarioSchema>;
export const energySchema = z.object({ version: z.literal(1), enabled: z.boolean(), labelPositions: z.record(z.string(), z.object({ x: finite.min(-1e7).max(1e7), y: finite.min(-1e7).max(1e7) })).optional(), materials: z.array(materialSchema).max(300), assemblies: z.array(assemblySchema).max(1000), existingAssignments: z.array(assignmentSchema).max(10000), scenarios: z.array(scenarioSchema).max(100), activeScenarioId: id.nullable(), targets: z.object({ wall: finite.positive().max(10), roof: finite.positive().max(10), floor: finite.positive().max(10), window: finite.positive().max(10), door: finite.positive().max(10) }), energySettings: z.object({ heatingDegreeDays: finite.min(0).max(15000).nullable(), baseTemperatureC: finite.min(0).max(30), climateReference: text, scheduleFactor: finite.min(0).max(1), seasonalEfficiency: finite.positive().max(10).nullable(), efficiencyBasis: text, wastePercent: finite.min(0).max(100) }), thermalBridges: z.array(z.object({ bridgeId: id, name: text, psiWmK: finite.nonnegative().max(10), lengthMm: finite.nonnegative().max(1e7) })).max(1000), display: z.object({ walls: z.boolean(), floors: z.boolean(), roofs: z.boolean(), openings: z.boolean(), labels: z.boolean(), heatLoss: z.boolean(), improvements: z.boolean() }) });
export type EnergyProject = z.infer<typeof energySchema>;

/** Product-specific reference samples, not universal values for material families. */
export const REFERENCE_MATERIALS: ThermalMaterial[] = [
  { materialId: "pir-tw55", name: "PIR — Kingspan TW55 reference", category: "Insulation", lambda: .022, density: null, vapourResistance: null, reference: "https://www.kingspan.com/content/dam/kingspan/kil/products/general-gb-and-ireland/kingspan-product-selector-brochure-en-ie.pdf", editable: true },
  { materialId: "wool-roll", name: "Mineral wool — ROCKWOOL Roll reference", category: "Insulation", lambda: .044, density: null, vapourResistance: null, reference: "https://www.rockwool.com/siteassets/rw-uk/downloads/datasheets/roll-twinroll-rollbatt.pdf", editable: true },
  { materialId: "brick-english-red", name: "Brick — Wienerberger English Red reference", category: "Masonry", lambda: .45, density: null, vapourResistance: null, reference: "https://www.wienerberger.co.uk/product-range/bricks/english-red.html", editable: true },
  ...CONSTRUCTION_MATERIAL_DEFAULTS,
];
export const CONSTRUCTION_TEMPLATES: { name: string; category: EnergyCategory; materials: [string, number][] }[] = [
  { name: "Solid brick — illustrative layers", category: "wall", materials: [["brick-english-red", 215], ["custom-8", 13]] },
  { name: "Cavity wall uninsulated — confirm cavity R", category: "wall", materials: [["brick-english-red", 102.5], ["custom-9", 50], ["custom-0", 100], ["custom-7", 12.5]] },
  { name: "Insulated cavity — illustrative PIR layers", category: "wall", materials: [["brick-english-red", 102.5], ["pir-tw55", 100], ["custom-0", 100], ["custom-7", 12.5]] },
  { name: "Timber frame — bridging not modelled", category: "wall", materials: [["custom-6", 100], ["wool-roll", 100], ["custom-7", 12.5]] },
  { name: "Loft insulation — confirm ceiling layers", category: "roof", materials: [["wool-roll", 270], ["custom-7", 12.5]] },
  { name: "Warm / flat roof — confirm build-up", category: "roof", materials: [["pir-tw55", 120], ["custom-12", 18], ["custom-7", 12.5]] },
  { name: "Solid / insulated slab — simplified ground model", category: "floor", materials: [["custom-1", 150], ["pir-tw55", 100], ["custom-10", 65]] },
  { name: "Suspended timber / exposed floor — confirm layers", category: "floor", materials: [["custom-6", 20], ["wool-roll", 100]] },
];
export function newAssembly(template = CONSTRUCTION_TEMPLATES[0]): ConstructionAssembly {
  return withLayerColours({ assemblyId: crypto.randomUUID(), name: template.name, category: template.category, rsi: template.category === "roof" ? .10 : template.category === "floor" ? .17 : .13, rse: .04, directUValue: null, layers: template.materials.map(([materialId, thicknessMm]) => ({ layerId: crypto.randomUUID(), materialId, thicknessMm, resistanceOverride: null, position: "Within", upgrade: false })), notes: "Illustrative starting assembly; confirm every value. Surface R defaults are explicit planning inputs. One-dimensional model excludes repeating bridges, moisture and fixings." });
}
export function newEnergyProject(): EnergyProject { return { version: 1, enabled: false, materials: structuredClone(REFERENCE_MATERIALS), assemblies: [], existingAssignments: [], scenarios: [], activeScenarioId: null, targets: { wall: .30, roof: .18, floor: .25, window: 1.4, door: 1.6 }, energySettings: { heatingDegreeDays: null, baseTemperatureC: 15.5, climateReference: "", scheduleFactor: 1, seasonalEfficiency: null, efficiencyBasis: "", wastePercent: 0 }, thermalBridges: [], display: { walls: true, floors: false, roofs: false, openings: true, labels: true, heatLoss: true, improvements: false } }; }
export function parseEnergyProject(value: unknown): EnergyProject {
  const p = energySchema.parse(value), unique = (values: string[]) => { if (new Set(values).size !== values.length) throw new Error("Duplicate energy entity ID."); };
  unique(p.materials.map(m => m.materialId));unique(p.assemblies.map(a => a.assemblyId));unique(p.scenarios.map(s => s.scenarioId));unique(p.thermalBridges.map(b => b.bridgeId));
  if (p.activeScenarioId && !p.scenarios.some(s => s.scenarioId === p.activeScenarioId)) throw new Error("Missing active retrofit scenario.");
  for (const a of p.assemblies) { unique(a.layers.map(l => l.layerId));if (a.layers.some(l => !p.materials.some(m => m.materialId === l.materialId))) throw new Error("Missing assembly material."); }
  for (const assignments of [p.existingAssignments, ...p.scenarios.map(s => s.assignments)]) { unique(assignments.map(a => a.elementId));if (assignments.some(a => a.assemblyId && !p.assemblies.some(v => v.assemblyId === a.assemblyId))) throw new Error("Missing assigned construction."); }
  return { ...p, materials: p.materials.map(upgradeLegacyMaterial), assemblies: p.assemblies.map(withLayerColours) };
}
export const ENERGY_DISCLAIMER = "Preliminary retrofit planning estimate, not an official EPC. This does not replace an accredited energy assessor using approved software/methodology, or a qualified professional's thermal, moisture, fire and installation design. Simplified ground, roof and one-dimensional layers omit junctions and repeating thermal bridges unless separately entered.";
