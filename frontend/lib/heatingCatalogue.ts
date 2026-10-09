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
