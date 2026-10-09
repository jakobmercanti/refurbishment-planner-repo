import type { HeatingRadiator, UFHPerformanceDataset } from "./heatingDocument";
import type { Room } from "./types";
import { snapRadiatorToWall } from "./heatingCalculations";

// Small, explicitly sourced reference library, verified 2026-10-08.
// Published product facts only; never silently substitute these for the user's installed system.
export const PURMO_REFERENCE = "https://www.purmo.com/au/products/panels/purmo-compact.htm";
export const JAGA_REFERENCE = "https://jaga.com/ex/download/strada-hybrid-brochure-ex/?wpdmdl=42784";
export const UPONOR_REFERENCE = "https://www.uponor.com/getmedia/55d4b2f6-778d-435d-9167-0e27ea46a9eb/ufh-installation-guidepdf?sitename=UK";
export type ReferenceRadiator = Omit<HeatingRadiator, "radiatorId" | "roomId" | "positionMm" | "rotationDeg" | "locked"> & { catalogueId: string };
const base = { ratedDeltaTK: 50, electricalInputW: 0, fanMode: "Normal" as const };
export const REFERENCE_RADIATORS: ReferenceRadiator[] = [
  ...[[600,1025,817],[800,1367,1090],[1000,1709,1362],[1200,2051,1635],[1400,2393,1907],[1600,2734,2180],[1800,3076,2452],[2000,3418,2725]].map(([widthMm,rating,lower]) => ({ ...base, catalogueId:`purmo-c22-600-${widthMm}`, manufacturer:"Purmo", model:`Compact C22 600 × ${widthMm}`, category:"Type 22" as const, emitterTechnology:"Hydronic" as const, widthMm, heightMm:600, depthMm:102, ratedOutputW:rating, exponent:1.3358, performanceReference:PURMO_REFERENCE, manufacturerPerformanceData:[{flowC:75,returnC:65,roomC:20,fanMode:"Normal" as const,outputW:rating,electricalW:0},{flowC:70,returnC:55,roomC:20,fanMode:"Normal" as const,outputW:lower,electricalW:0}] })),
  ...[
    { width:600,type:16,depth:170,rows:[[301,581,726,793,4.8,26],[323,624,779,851,5.5,30],[428,826,1031,1126,7.2,41.1]] },
    { width:800,type:21,depth:220,rows:[[606,1135,1404,1527,6,26],[650,1217,1505,1638,6.7,30],[873,1634,2020,2197,9,42.4]] },
    { width:1000,type:16,depth:170,rows:[[566,1092,1364,1490,7,26],[606,1169,1460,1595,7.7,30],[836,1612,2013,2199,10.7,44.1]] },
  ].map(product => ({ ...base, catalogueId:`jaga-strw-035-${product.width}-${product.type}`, manufacturer:"Jaga", model:`Strada Hybrid STRW 035 ${String(product.width/10).padStart(3,"0")} ${product.type}`, category:"Custom" as const, emitterTechnology:"Hybrid" as const, widthMm:product.width, heightMm:350, depthMm:product.depth, ratedOutputW:null, exponent:1.3, performanceReference:`${JAGA_REFERENCE}#page=10`, manufacturerPerformanceData:product.rows.flatMap((row,i) => [[35,30],[45,40],[50,45],[55,45]].map(([flowC,returnC],j) => ({flowC,returnC,roomC:20,fanMode:(["Silent","Normal","Boost"] as const)[i],outputW:row[j],electricalW:row[4],soundDb:row[5]}))) })),
];
export function referenceRadiatorForRoom(product: ReferenceRadiator, room: Room): HeatingRadiator {
  const { catalogueId: _catalogueId, ...data } = product;void _catalogueId;
  return snapRadiatorToWall({ ...structuredClone(data), radiatorId:crypto.randomUUID(), roomId:room.id, positionMm:room.vertices[0], rotationDeg:0, locked:false },room,room.vertices[0]);
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
