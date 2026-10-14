import type { HeatingRadiator, UFHPerformanceDataset } from "./heatingDocument";
import heatingProducts from "./heatingProducts.json";
import type { Room } from "./types";
import { snapRadiatorToWall } from "./heatingCalculations";

// Small, explicitly sourced reference library, verified 2026-10-08.
// Published product facts only; never silently substitute these for the user's installed system.
export const PURMO_REFERENCE = "https://www.purmo.com/au/products/panels/purmo-compact.htm";
export const JAGA_REFERENCE = "https://jaga.com/ex/download/strada-hybrid-brochure-ex/?wpdmdl=42784";
export const UPONOR_REFERENCE = "https://www.uponor.com/getmedia/55d4b2f6-778d-435d-9167-0e27ea46a9eb/ufh-installation-guidepdf?sitename=UK";
export type ReferenceRadiator = Omit<HeatingRadiator, "radiatorId" | "roomId" | "positionMm" | "rotationDeg" | "locked"> & { catalogueId: string };
// Shared with the persistent catalogue seeder; these are not a second product source.
export const REFERENCE_RADIATORS: ReferenceRadiator[] = heatingProducts as ReferenceRadiator[];
export function referenceRadiatorForRoom(product: ReferenceRadiator, room: Room): HeatingRadiator {
  const { catalogueId, ...data } = product;
  return snapRadiatorToWall({ ...structuredClone(data), catalogueItemId:data.catalogueItemId ?? `heating-${catalogueId}`, radiatorId:crypto.randomUUID(), roomId:room.id, positionMm:room.vertices[0], rotationDeg:0, locked:false },room,room.vertices[0]);
}
function ufhTable(name:string, pipeDiameterMm:number, floorConstruction:string, page:number, delta:number, rows:number[][]): UFHPerformanceDataset {
  return { name, pipeDiameterMm, floorConstruction, reference:`${UPONOR_REFERENCE}#page=${page}`, maxOutputWm2:70, points:rows.flatMap(([mean,roomC,lowResistance,highResistance]) => [0.01,0.1].map((floorResistance,i) => ({spacingMm:150,floorResistance,flowC:mean+delta/2,returnC:mean-delta/2,roomC,outputWm2:i===0?lowResistance:highResistance,surfaceTemperatureC:null}))) };
}
// Manufacturer tables specify MWT and a fixed water drop. Store the matching
// flow/return pair, not an invented equivalence between different water drops.
// Surface temperatures are absent in these tables and deliberately remain unknown.
export const REFERENCE_UFH_DATASETS: UFHPerformanceDataset[] = [
  ufhTable("Uponor Siccus FX — 16 mm, timber/foil insulation, 18 mm chipboard",16,"Uponor Siccus FX: timber suspended/floating, foil-faced insulation, 18 mm chipboard",33,5,[[45,20,59.8,47.3],[45,22,55,43.5],[50,20,71.8,56.9],[50,22,67,53.1],[55,20,83.9,66.4],[55,22,79,62.6]]),
  ufhTable("Uponor Tignum — 12 mm timber panel, gypsum/plywood decking",12,"Uponor Tignum timber panel: 25 mm gypsum or 12 mm plywood capping",37,10,[[35,20,52.9,38.2],[35,22,45.3,32.7],[40,20,71.8,51.9],[40,22,64.3,46.4],[45,20,90.5,65.4],[45,22,83.1,60]]),
];
// Additional common installation options, transcribed from the manufacturer's
// installation guide (pages 7, 18, 22, 25, 30 and 32), verified 2026-10-14.
// Where no complete operating table is published here, points stay empty. Never
// apply a different build-up's ratings to these systems.
const minitecRows = [
  [30,16,82,63,52,71,56,46,61,50,42],[30,18,69,53,44,60,47,39,52,42,35],[30,20,56,43,35,48,38,32,42,34,28],[30,22,42,32,27,36,28,24,31,25,21],[30,24,26,20,16,22,17,14,19,16,13],
  [35,16,114,87,72,98,77,64,85,69,58],[35,18,102,78,64,87,70,57,76,61,52],[35,20,90,68,56,76,60,50,66,54,45],[35,22,76,59,48,65,51,42,57,46,39],[35,24,63,48,40,54,43,35,47,38,32],
  [40,16,146,111,92,125,99,90,108,88,74],[40,18,133,102,84,114,90,75,99,80,68],[40,20,121,92,76,104,82,68,90,73,61],[40,22,108,83,68,93,73,61,80,65,55],[40,24,95,73,60,82,65,54,71,57,48],
];
REFERENCE_UFH_DATASETS.push({ name: "Uponor Minitec — 9.9 mm, 15 mm levelling compound", pipeDiameterMm: 9.9, floorConstruction: "Solid floor; 15 mm levelling compound; conductivity 1.0 W/mK", reference: `${UPONOR_REFERENCE}#page=18`, maxOutputWm2: 76, points: minitecRows.flatMap(([mean,roomC,...outputs]) => [50,100,150].flatMap((spacingMm,s) => [.05,.1,.15].map((floorResistance,r) => ({ spacingMm, floorResistance, flowC: mean+5, returnC: mean-5, roomC, outputWm2: outputs[s*3+r], surfaceTemperatureC: null })))) });
for (const [name,diameter,page,build] of [
  ["Uponor Kombi Klip / tacker — 16 mm screed",16,22,"16 mm pipe clipped over insulation; domestic sand/cement screed minimum 65 mm (guide p8)"],
  ["Uponor Clip Rail — 16 mm screed",16,22,"16 mm pipe in clip rails over insulation; confirm screed and covering"],
  ["Uponor Self Attaching — 16 × 1.8 mm PEX-a",16,25,"Self-attaching roll insulation and 16 × 1.8 mm PEX-a in screed"],
  ["Uponor Siccus floating floor — 16 mm / 200 mm centres",16,32,"Grooved floating insulation panels, heat-emission plates and decking"],
  ["Uponor HEP400 suspended floor — 16 mm",16,30,"400 mm joist centres, two-track aluminium heat-emission plates; insulation below"],
] as const) REFERENCE_UFH_DATASETS.push({ name, pipeDiameterMm: diameter, floorConstruction: build, reference: `${UPONOR_REFERENCE}#page=${page}`, points: [] });
export function referenceUFHSettings(dataset: UFHPerformanceDataset) {
  const d = dataset.pipeDiameterMm;
  const minBendRadiusMm = d === 9.9 ? 50 : d === 12 ? 60 : d === 20 ? 100 : 80;
  const spacingMm = dataset.points.length ? Math.max(...new Set(dataset.points.map(p => p.spacingMm))) : 200;
  return { diameterMm: d as import("./heatingDocument").UFHZone["diameterMm"], minBendRadiusMm, spacingMm, internalDiameterMm: d === 9.9 ? 7.7 : dataset.name.includes("Self Attaching") ? 12.4 : null, floorThermalResistance: dataset.points.length ? Math.min(...dataset.points.map(p => p.floorResistance)) : .01, pipeType: dataset.name, floorConstruction: dataset.floorConstruction, performanceDataset: structuredClone(dataset) };
}
