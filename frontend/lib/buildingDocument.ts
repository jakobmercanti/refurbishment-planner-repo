import { z } from "zod";
import type { ProjectDocument } from "./projectDocument";
import { validateFloorSupports } from "./buildingGeometry";

const id = z.string().min(1).max(150).regex(/^[\w:-]+$/);
const mm = z.number().finite().min(-1e7).max(1e7);
const point = z.object({ x: mm, y: mm });
export const roofFinishSchema = z.object({
  material: z.enum(["CLAY_TILES", "CONCRETE_TILES", "SLATE", "CEMENT", "METAL", "ASPHALT_SHINGLES", "TIMBER_SHINGLES", "BITUMEN", "CORRUGATED_METAL"]),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  tileWidthMm: z.number().finite().min(100).max(2000),
  tileHeightMm: z.number().finite().min(100).max(4000),
}).strict();
export type RoofFinish = z.infer<typeof roofFinishSchema>;
export const floorOpeningSchema = z.object({ id, name: z.string().trim().min(1).max(100), shape: z.enum(["RECTANGLE", "POLYGON"]), vertices: z.array(point).min(3).max(200) }).strict();
export type FloorOpening = z.infer<typeof floorOpeningSchema>;
export const roofSchema = z.object({
  enabled: z.boolean().optional(), finish: roofFinishSchema.optional(),
  type: z.enum(["FLAT", "MONO", "GABLE", "STEPPED"]),
  lowHeightMm: z.number().finite().min(1800).max(20000), highHeightMm: z.number().finite().min(1800).max(20000),
  orientationDeg: z.number().finite().min(0).max(360), splitFraction: z.number().finite().min(.05).max(.95),
  thicknessMm: z.number().finite().min(20).max(1000), ceilingMode: z.enum(["FOLLOWS_ROOF", "FLAT"]),
  ceilingHeightMm: z.number().finite().min(1800).max(20000),
}).strict().superRefine((r, ctx) => {
  if ((r.type === "MONO" || r.type === "GABLE") && r.highHeightMm < r.lowHeightMm + 50) ctx.addIssue({ code: "custom", message: "The high side/ridge must be at least 50 mm above the eaves.", path: ["highHeightMm"] });
  if (r.type === "STEPPED" && Math.abs(r.highHeightMm-r.lowHeightMm)<50) ctx.addIssue({code:"custom",message:"Stepped roof zones must differ by at least 50 mm.",path:["highHeightMm"]});
  if (r.ceilingMode === "FLAT" && r.ceilingHeightMm > minimumRoofHeight(r)) ctx.addIssue({ code: "custom", message: "The flat ceiling must not pass above the lowest roof underside.", path: ["ceilingHeightMm"] });
});
export type RoofConfiguration = z.infer<typeof roofSchema>;
export function minimumRoofHeight(roof:{type:string;lowHeightMm:number;highHeightMm:number}):number {
  return roof.type==="STEPPED"?Math.min(roof.lowHeightMm,roof.highHeightMm):roof.lowHeightMm;
}
/** Preserve an entered rise when it is valid for the newly selected profile. */
export function withRoofProfile(roof:RoofConfiguration,type:RoofConfiguration["type"]):RoofConfiguration {
  const validRise=type==="STEPPED"?Math.abs(roof.highHeightMm-roof.lowHeightMm)>=50:roof.highHeightMm-roof.lowHeightMm>=50;
  return {...roof,type,highHeightMm:type==="FLAT"||validRise?roof.highHeightMm:roof.lowHeightMm+1000};
}
/** Active-floor content lives in the legacy project fields, never twice in storage. */
export type FloorContent = Pick<ProjectDocument, "rooms" | "floorplan" | "assetInstances" | "electricalLayout" | "heatingLayout" | "energyLayout">;
const floorSchema = z.object({ id, name: z.string().trim().min(1).max(100), elevationMm: mm,
  heightMm: z.number().finite().min(2000).max(20000), slabThicknessMm: z.number().finite().min(20).max(1000),
  openings: z.array(floorOpeningSchema).max(100), content: z.unknown().optional(),
}).strict();
export const floorSettingsSchema=floorSchema.pick({name:true,elevationMm:true,heightMm:true,slabThicknessMm:true});
export type FloorSettings=z.infer<typeof floorSettingsSchema>;
export const buildingSchema = z.object({ version: z.literal(1), activeFloorId: id, floors: z.array(floorSchema).min(1).max(20), roof: roofSchema }).strict();
export type FloorLevel = Omit<z.infer<typeof floorSchema>, "content"> & { content?: FloorContent };
export type BuildingDocument = Omit<z.infer<typeof buildingSchema>, "floors"> & { floors: FloorLevel[] };
export const floorContent = (p: FloorContent): FloorContent => ({ rooms: p.rooms, floorplan: p.floorplan, assetInstances: p.assetInstances, ...(p.electricalLayout?{electricalLayout:p.electricalLayout}:{}), ...(p.heatingLayout?{heatingLayout:p.heatingLayout}:{}), ...(p.energyLayout?{energyLayout:p.energyLayout}:{}) });
export function defaultBuilding(p: FloorContent): BuildingDocument {
  const heights=[p.floorplan?.wallHeight,...p.rooms.map(r=>r.wall_height.value)].filter((v):v is number=>typeof v==="number"&&Number.isFinite(v)&&v>0);
  const height=heights.length?Math.max(1800,...heights):2400;
  return { version: 1, activeFloorId: "floor-ground", floors: [{ id: "floor-ground", name: "Ground Floor", elevationMm: 0, heightMm: height + 200, slabThicknessMm: 200, openings: [] }], roof: { type: "FLAT", lowHeightMm: height, highHeightMm: height + 1000, orientationDeg: 0, splitFraction: .5, thicknessMm: 180, ceilingMode: "FOLLOWS_ROOF", ceilingHeightMm: height } };
}
export function buildingOf(p: ProjectDocument): BuildingDocument { return p.building ?? defaultBuilding(p); }
export function projectFloors(p: ProjectDocument) { const b = buildingOf(p); return b.floors.map(f => ({ ...f, content: f.id === b.activeFloorId ? floorContent(p) : f.content! })); }
function supportedFloors(p:ProjectDocument) { validateFloorSupports(projectFloors(p));return p; }
export function activeFloor(p: ProjectDocument) { const b = buildingOf(p); return b.floors.find(f => f.id === b.activeFloorId)!; }
export function projectElectricalAttachments(p: ProjectDocument) {
  const items = projectFloors(p).flatMap(f=>f.content.electricalLayout?.documentation.attachments ?? []);
  return [...new Map(items.map(a=>[a.attachmentId,a])).values()];
}
export function validateFloorStack(b: BuildingDocument) {
  if (new Set(b.floors.map(f => f.id)).size !== b.floors.length || !b.floors.some(f => f.id === b.activeFloorId)) throw new Error("Floor IDs must be unique and the selected floor must exist.");
  for (let i = 0; i < b.floors.length; i++) {
    const f = b.floors[i], next = b.floors[i + 1];
    if (f.id === b.activeFloorId ? f.content !== undefined : !f.content || typeof f.content !== "object") throw new Error("Only inactive floors store a content payload.");
    if(f.content && (!Object.hasOwn(f.content,"rooms")||!Object.hasOwn(f.content,"floorplan")||!Object.hasOwn(f.content,"assetInstances")||Object.keys(f.content).some(k=>!["rooms","floorplan","assetInstances","electricalLayout","heatingLayout","energyLayout"].includes(k))))throw new Error("Invalid inactive floor contents.");
    if (next && Math.abs(next.elevationMm - f.elevationMm - f.heightMm) > .001) throw new Error("Floor elevations must form a contiguous stack; split levels are not supported.");
    if (f.heightMm - (next?.slabThicknessMm ?? f.slabThicknessMm) < 1800) throw new Error("Floor/slab heights must leave at least 1800 mm clear headroom.");
    if (new Set(f.openings.map(o => o.id)).size !== f.openings.length) throw new Error("Duplicate floor-opening ID.");
    if (i === 0 && f.openings.length) throw new Error("Slab openings are available only above the lowest floor.");
  }
}
/** Selecting a floor is a reversible projection, not a copy or coordinate transform. */
export function selectFloor(p: ProjectDocument, floorId: string): ProjectDocument {
  const b = buildingOf(p); if (b.activeFloorId === floorId) return p;
  const target = b.floors.find(f => f.id === floorId); if (!target?.content) throw new Error("Floor not found.");
  return { ...p, ...floorContent(target.content),electricalLayout:target.content.electricalLayout,heatingLayout:target.content.heatingLayout,energyLayout:target.content.energyLayout, building: { ...b, activeFloorId: floorId, floors: b.floors.map(f => f.id === b.activeFloorId ? { ...f, content: floorContent(p) } : f.id === floorId ? { ...f, content: undefined } : f) } };
}
function copyContent(content: FloorContent, includeAssets: boolean): FloorContent {
  const copy = structuredClone(content), ids = new Map<string, string>();
  const identity = new Set(["id", "instanceId", "radiatorId", "pipeId", "circuitId", "zoneId", "manifoldId", "exclusionId", "scenarioId", "assemblyId", "layerId"]);
  const collect = (v: unknown) => { if (!v || typeof v !== "object") return; for (const [k, x] of Object.entries(v)) { if (identity.has(k) && typeof x === "string") ids.set(x, crypto.randomUUID()); else collect(x); } };
  collect(copy);
  const remapString = (s: string) => ids.get(s) ?? [...ids].reduce((v, [old, next]) => v.startsWith(old + "|") || v.startsWith(old + ":") ? next + v.slice(old.length) : v, s);
  const reference=(key:string)=>identity.has(key)||/Ids?$/.test(key)||key==="obstacle_id"||key==="source_floorplan_room_id"||key==="hiddenDimensions";
  const records=new Set(["dimensionOffsets","roomFinishes","labelPositions","roomIndicatorPositions"]);
  const remap = (v: unknown,key=""): unknown => typeof v === "string" ? reference(key)?remapString(v):v : Array.isArray(v) ? v.map(x=>remap(x,key)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k,x]) => [records.has(key)?remapString(k):k, remap(x,k)])) : v;
  const next = remap(copy) as FloorContent;
  if (!includeAssets) { next.rooms = next.rooms.map(r => ({ ...r, obstacles: [], person_mockup: null })); next.assetInstances = []; next.electricalLayout = undefined; next.heatingLayout = undefined; next.energyLayout = undefined; }
  return next;
}
/** Add a blank top floor. Duplication has one explicit, separate workflow. */
export function addFloor(p: ProjectDocument): ProjectDocument {
  const b = buildingOf(p); if (b.floors.length >= 20) throw new Error("A project supports up to 20 floors.");
  const below = projectFloors(p).at(-1)!, id = crypto.randomUUID();
  const content = { rooms: [], floorplan: null, assetInstances: [] };
  const name = b.floors.length === 1 ? "First Floor" : b.floors.length === 2 ? "Second Floor" : `Floor ${b.floors.length}`;
  const f: FloorLevel = { id, name, elevationMm: below.elevationMm + below.heightMm, heightMm: below.heightMm, slabThicknessMm: below.slabThicknessMm, openings: [], content };
  return supportedFloors(selectFloor({ ...p, building: { ...b, floors: [...b.floors, f] } }, id));
}
export function duplicateFloor(p: ProjectDocument, floorId: string, includeAssets = true): ProjectDocument {
  const b=buildingOf(p),at=b.floors.findIndex(f=>f.id===floorId),source=projectFloors(p)[at];
  if(!source)throw new Error("Floor not found.");
  if(b.floors.length>=20)throw new Error("A project supports up to 20 floors.");
  let name="",suffix=1;
  do {const tail=` copy${suffix===1?"":` ${suffix}`}`;name=source.name.slice(0,100-tail.length)+tail;suffix++;}while(b.floors.some(f=>f.name===name));
  const copy:FloorLevel={...source,id:crypto.randomUUID(),name,content:copyContent(source.content,includeAssets),openings:source.openings.map(o=>({...structuredClone(o),id:crypto.randomUUID()}))};
  const floors=[...b.floors];floors.splice(at+1,0,copy);
  const next=selectFloor({...p,building:{...b,floors:reflow(floors,b.floors[0].elevationMm)}},copy.id);
  validateFloorStack(buildingOf(next));return supportedFloors(next);
}
function reflow(floors: FloorLevel[], base: number) { let elevation = base; return floors.map(f => { const next = { ...f, elevationMm: elevation }; elevation += f.heightMm; return next; }); }
export function updateFloor(p: ProjectDocument, floorId: string, patch: Partial<Pick<FloorLevel, "name" | "heightMm" | "slabThicknessMm" | "elevationMm" | "openings">>): ProjectDocument {
  const b = buildingOf(p); let floors = b.floors.map(f => f.id === floorId ? { ...f, ...patch } : f);
  const at = floors.findIndex(f => f.id === floorId); if (at < 0) throw new Error("Floor not found.");
  if (patch.elevationMm !== undefined && at !== 0) { const previous = floors[at - 1]; floors = floors.map((f, i) => i === at - 1 ? { ...f, heightMm: patch.elevationMm! - previous.elevationMm } : f); }
  floors = reflow(floors, floors[0].elevationMm);
  const building = buildingSchema.parse({ ...b, floors }) as BuildingDocument; validateFloorStack(building);
  return { ...p, building };
}
export function reorderFloor(p: ProjectDocument, floorId: string, direction: -1 | 1): ProjectDocument {
  const b=buildingOf(p),at=b.floors.findIndex(f=>f.id===floorId);
  return moveFloor(p,floorId,at+direction);
}
/** One atomic reorder; intermediate drag positions never alter stored geometry. */
export function moveFloor(p:ProjectDocument,floorId:string,to:number):ProjectDocument {
  const b=buildingOf(p),floors=[...b.floors],at=floors.findIndex(f=>f.id===floorId);
  if(at<0)throw new Error("Floor not found.");
  if(!Number.isInteger(to)||to<0||to>=floors.length||at===to)return p;
  const [moved]=floors.splice(at,1);floors.splice(to,0,moved);
  if (floors[0].openings.length) throw new Error("Remove this floor's slab openings before moving it to the lowest position.");
  const building = { ...b, floors: reflow(floors,b.floors[0].elevationMm) }; validateFloorStack(building); return supportedFloors({ ...p, building });
}
/** Explicit New outline starts a fresh ground-floor drawing, not an upper edit. */
export function resetBuildingOutline(p:ProjectDocument,points:readonly {x:number;y:number}[]|null):ProjectDocument {
  const ground=buildingOf(p).floors[0],old=projectFloors(p)[0].content.floorplan;
  const clear=ground.heightMm-ground.slabThicknessMm;
  const vertices=points?.map(v=>({...v}))??[];
  if(vertices.length&& (vertices[0].x!==vertices.at(-1)!.x||vertices[0].y!==vertices.at(-1)!.y))vertices.push({...vertices[0]});
  const floorplan:NonNullable<ProjectDocument["floorplan"]>={
    walls:vertices.length?[{id:crypto.randomUUID(),points:vertices}]:[],rooms:[],openings:[],measurements:[],annotations:[],dimensionOffsets:{},hiddenDimensions:[],selectedRoomId:null,
    canvasSize:old?.canvasSize??{width:1100,height:700},wallHeight:clear,wallThickness:old?.wallThickness??100,
    squaredWalls:old?.squaredWalls??true,snapEnabled:old?.snapEnabled??false,snapSize:old?.snapSize??100,
  };
  const next={...p,rooms:[],floorplan,assetInstances:[],electricalLayout:undefined,heatingLayout:undefined,energyLayout:undefined};
  return {...next,building:{...defaultBuilding(next),activeFloorId:ground.id,floors:[{...ground,content:undefined,openings:[]}]}};
}
export function deleteFloor(p: ProjectDocument, floorId: string): ProjectDocument {
  let b = buildingOf(p); if (b.floors.length === 1) throw new Error("The last floor cannot be deleted.");
  const index = b.floors.findIndex(f => f.id === floorId); if (index < 0) throw new Error("Floor not found.");
  if (b.activeFloorId === floorId) { p = selectFloor(p, b.floors[index ? index-1 : 1].id); b = buildingOf(p); }
  // A newly lowest floor has no inter-storey slab: its former voids are removed.
  const floors = reflow(b.floors.filter(f => f.id !== floorId), b.floors[0].elevationMm).map((f,i) => i ? f : { ...f, openings: [] });
  return supportedFloors({ ...p, building: { ...b, floors } });
}
