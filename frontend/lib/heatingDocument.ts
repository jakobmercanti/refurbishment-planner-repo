import { z } from "zod";
import type { BuildingThermalOverrides } from "./buildingThermalModel";

const n = z.number().finite();
const positive = n.positive();
const id = z.string().min(1).max(150).regex(/^[\w:-]+$/);
const text = z.string().max(1000);
const point = z.object({ x: n.min(-1e7).max(1e7), y: n.min(-1e7).max(1e7) });
const path = z.array(point).max(12000);
export const heatingMethodSchema = z.enum(["Radiator", "Electric Radiator", "Hybrid Radiator", "Underfloor Heating", "Radiator + UFH", "None"]);
export type HeatingMethod = z.infer<typeof heatingMethodSchema>;
export const constructionSchema = z.object({ externalWall: n.min(0).max(10), window: n.min(0).max(10), door: n.min(0).max(10), groundFloor: n.min(0).max(10), exposedFloor: n.min(0).max(10), roof: n.min(0).max(10), unheatedWall: n.min(0).max(10), internalWall: n.min(0).max(10) });
export type ThermalConstruction = z.infer<typeof constructionSchema>;
export const wallOverrideSchema = z.object({ boundary: z.enum(["Auto", "External", "Heated", "Unheated", "Adiabatic"]), adjacentTemperatureC: n.min(-50).max(40).optional(), uValue: n.min(0).max(10).optional() });
const roomSchema = z.object({ roomId: id, designTemperatureOverride: z.boolean().optional(), airChangeRateOverride: z.boolean().optional(), designIndoorTemperatureC: n.min(5).max(35), airChangeRate: n.min(0).max(10), selectedEmitterType: heatingMethodSchema, floorBoundary: z.enum(["Ground", "External", "Heated", "Unheated", "Adiabatic"]), ceilingBoundary: z.enum(["External", "Heated", "Unheated", "Adiabatic"]), adjacentTemperatureC: n.min(-30).max(35), walls: z.record(z.string(), wallOverrideSchema), construction: constructionSchema.optional() });
export type RoomThermalData = z.infer<typeof roomSchema>;
const performancePoint = z.object({ flowC: n, returnC: n, roomC: n, outputW: n.nonnegative(), fanMode: z.enum(["Silent", "Normal", "Boost"]), electricalW: n.nonnegative(), soundDb: n.nonnegative().optional() });
export type HybridPerformancePoint = z.infer<typeof performancePoint>;
const radiatorSchema = z.object({ radiatorId: id, catalogueItemId: id.optional(), roomId: id, category: z.enum(["Type 10", "Type 11", "Type 21", "Type 22", "Type 33", "Towel", "Custom"]), manufacturer: text, performanceReference: text.optional(), model: text, emitterTechnology: z.enum(["Hydronic", "Electric", "Hybrid"]), widthMm: positive.max(10000), heightMm: positive.max(5000), depthMm: positive.max(2000), positionMm: point, rotationDeg: n, wallIndex: n.int().nonnegative().optional(), positionAlongWallMm: n.nonnegative().optional(), ratedOutputW: n.nonnegative().nullable(), ratedDeltaTK: positive.max(100), exponent: positive.max(3), electricalInputW: n.nonnegative(), fanMode: z.enum(["Silent", "Normal", "Boost"]), manufacturerPerformanceData: z.array(performancePoint).max(500), placementSnapshot: z.record(z.string(), z.unknown()).optional(), locked: z.boolean() });
export type HeatingRadiator = z.infer<typeof radiatorSchema>;
export const heatingElementSpecSchema = radiatorSchema.omit({ radiatorId: true, roomId: true, widthMm: true, heightMm: true, depthMm: true, positionMm: true, rotationDeg: true, wallIndex: true, positionAlongWallMm: true, placementSnapshot: true });
const pipeSchema = z.object({ pipeId: id, name: text, fromId: id.optional(), toId: id.optional(), kind: z.enum(["Supply", "Return"]), diameterMm: positive.max(100), pathMm: path.min(2), locked: z.boolean() });
export type HeatingPipe = z.infer<typeof pipeSchema>;
const ufhPerformancePoint = z.object({ spacingMm: positive, floorResistance: n.nonnegative(), flowC: n, returnC: n, roomC: n, outputWm2: n.nonnegative(), surfaceTemperatureC: n.nullable() });
export type UFHPerformancePoint = z.infer<typeof ufhPerformancePoint>;
const dataset = z.object({ name: text, maxOutputWm2: n.nonnegative().optional(), reference: text, pipeDiameterMm: positive, floorConstruction: text, points: z.array(ufhPerformancePoint).max(2000) });
export type UFHPerformanceDataset = z.infer<typeof dataset>;
const exclusionSchema = z.object({ exclusionId: id, roomId: id, name: text, polygonMm: path.min(3) });
export type HeatingExclusion = z.infer<typeof exclusionSchema>;
const manifoldSchema = z.object({ manifoldId: id, name: text, positionMm: point, rotationDeg: n, ports: n.int().min(1).max(50) });
export type HeatingManifold = z.infer<typeof manifoldSchema>;
const zoneSchema = z.object({ zoneId: id, roomId: id, name: text, pipeType: text, diameterMm: z.union([z.literal(12), z.literal(16), z.literal(17), z.literal(20)]), internalDiameterMm: positive.nullable(), spacingMm: n.min(50).max(600), boundaryOffsetMm: n.min(20).max(1000), minBendRadiusMm: n.min(20).max(1000), maxCircuitLengthM: n.min(10).max(300), pattern: z.enum(["Spiral", "Serpentine"]), orientation: z.enum(["Auto", "Horizontal", "Vertical"]), floorConstruction: text, floorCovering: text, floorThermalResistance: n.min(0).max(2), maxSurfaceTemperatureC: n.min(20).max(40), manifoldId: id.nullable(), performanceDataset: dataset.nullable(), geometryFingerprint: text });
export type UFHZone = z.infer<typeof zoneSchema>;
const circuitSchema = z.object({ circuitId: id, zoneId: id, manifoldId: id, name: text, pipeType: text, diameterMm: positive, spacingMm: positive, pathMm: path.min(2), generatedPathMm: path.min(2).optional(), supplyPathMm: path.min(2), returnPathMm: path.min(2), pattern: z.enum(["Spiral", "Serpentine"]), locked: z.boolean(), manuallyEdited: z.boolean(), generationWarnings: z.array(text).max(100) });
export type UFHCircuit = z.infer<typeof circuitSchema>;
export const heatingSchema = z.object({ version: z.literal(1), enabled: z.boolean(), buildingSettings: z.object({ location: text, externalDesignTemperatureC: n.min(-50).max(25), preset: text, construction: constructionSchema, airChangeRate: n.min(0).max(10), designAllowancePercent: n.min(0).max(100), wastagePercent: n.min(0).max(100), roomTypeTemperatures: z.record(z.string(), n.min(5).max(35)) }), heatingSystem: z.object({ name: text, flowTemperatureC: n.min(5).max(95), returnTemperatureC: n.min(5).max(95) }), rooms: z.array(roomSchema).max(1000), pipes: z.array(pipeSchema).max(5000).default([]), radiators: z.array(radiatorSchema).max(2000), manifolds: z.array(manifoldSchema).max(100), ufhZones: z.array(zoneSchema).max(1000), ufhCircuits: z.array(circuitSchema).max(2000), exclusions: z.array(exclusionSchema).max(1000), display: z.object({ demand: z.boolean(), temperature: z.boolean(), density: z.boolean(), radiators: z.boolean(), output: z.boolean(), zones: z.boolean(), loops: z.boolean(), manifolds: z.boolean(), tails: z.boolean(), exclusions: z.boolean(), labels: z.boolean(), warnings: z.boolean() }) });
export type HeatingProject = z.infer<typeof heatingSchema> & { thermalOverrides?: BuildingThermalOverrides };
export const CONSTRUCTION_PRESETS: Record<string, { construction: ThermalConstruction; ach: number }> = {
  "Older / poorly insulated": { construction: { externalWall: 2.1, window: 4.8, door: 3, groundFloor: 0.8, exposedFloor: 1.2, roof: 1.5, unheatedWall: 1.5, internalWall: 1.5 }, ach: 1 },
  "Typical older renovated": { construction: { externalWall: 0.6, window: 1.6, door: 1.8, groundFloor: 0.5, exposedFloor: 0.5, roof: 0.25, unheatedWall: 0.6, internalWall: 1.5 }, ach: 0.7 },
  "Modern insulated": { construction: { externalWall: 0.3, window: 1.4, door: 1.4, groundFloor: 0.25, exposedFloor: 0.25, roof: 0.18, unheatedWall: 0.3, internalWall: 1.5 }, ach: 0.5 },
  "New build": { construction: { externalWall: 0.18, window: 1.2, door: 1.2, groundFloor: 0.13, exposedFloor: 0.18, roof: 0.11, unheatedWall: 0.18, internalWall: 1.5 }, ach: 0.5 },
};
export const ROOM_TEMPERATURES = { "Living room": 21, Kitchen: 20, Bedroom: 18, Bathroom: 22, Hallway: 18, Utility: 18 };
export function newHeatingProject(): HeatingProject {
  const preset = CONSTRUCTION_PRESETS["Modern insulated"];
  return { version: 1, enabled: false, buildingSettings: { location: "", externalDesignTemperatureC: -3, preset: "Modern insulated", construction: { ...preset.construction }, airChangeRate: preset.ach, designAllowancePercent: 0, wastagePercent: 0, roomTypeTemperatures: { ...ROOM_TEMPERATURES } }, heatingSystem: { name: "Heat pump", flowTemperatureC: 45, returnTemperatureC: 40 }, rooms: [], pipes: [], radiators: [], manifolds: [], ufhZones: [], ufhCircuits: [], exclusions: [], display: { demand: true, temperature: true, density: true, radiators: true, output: true, zones: true, loops: true, manifolds: true, tails: true, exclusions: true, labels: true, warnings: true } };
}
export function parseHeatingProject(value: unknown): HeatingProject {
  const data = heatingSchema.parse(value);
  for (const ids of [data.rooms.map(r => r.roomId), data.radiators.map(r => r.radiatorId), data.manifolds.map(r => r.manifoldId), data.ufhZones.map(r => r.zoneId), data.ufhCircuits.map(r => r.circuitId), data.exclusions.map(r => r.exclusionId)]) if (new Set(ids).size !== ids.length) throw new Error("Duplicate heating entity ID.");
  if (data.ufhCircuits.some(c => !data.ufhZones.some(z => z.zoneId === c.zoneId) || !data.manifolds.some(m => m.manifoldId === c.manifoldId))) throw new Error("Heating circuit references a missing zone or manifold.");
  return data;
}
export const HEATING_DISCLAIMER = "Heating calculations are for planning and preliminary design, not certified calculations. Final design, regulatory compliance and installation must be checked by an appropriately qualified heating professional.";
