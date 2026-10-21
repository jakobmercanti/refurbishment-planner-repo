import polygonClipping, { type MultiPolygon, type Polygon, type Pair } from "polygon-clipping";
import { ShapeUtils, Vector2 } from "three";
import type { Point2D } from "./types";
import { minimumRoofHeight, roofForRoom, type FloorContent, type FloorOpening, type RoofConfiguration, type RoofProfile } from "./buildingDocument";
import { balustradeFootprint } from "./balustrades";
import { buildIsolatedRoomWalls, buildRenderedWalls } from "./wallRendering";
import { wallEnvelope } from "./wallEnvelope";

export type PlanPolygons = MultiPolygon;
export const polygonAreaMm2 = (p: Point2D[]) => Math.abs(p.reduce((s,a,i) => { const b=p[(i+1)%p.length]; return s+a.x*b.y-b.x*a.y; },0)/2);
export const polygonOf = (vertices: Point2D[]): Polygon => [vertices.map(p => [p.x,p.y] as Pair)];
export function planArea(p: PlanPolygons) { return p.reduce((s,poly) => s+poly.reduce((area,ring,i) => area+(i ? -1 : 1)*polygonAreaMm2(ring.map(([x,y])=>({x,y}))),0),0); }
export function floorFootprint(c: FloorContent): PlanPolygons {
  const rooms = c.rooms.length ? c.rooms : c.floorplan?.rooms ?? [];
  const polys = rooms.filter(r => r.vertices.length>=3).map(r => polygonOf(r.vertices));
  return polys.length ? polygonClipping.union(polys[0],...polys.slice(1)) : [];
}
/** Physical slab/envelope, including the exact rendered exterior wall faces.
 * Room area, containment and thermal calculations still use measured outlines. */
export function structuralFloorFootprint(c:FloorContent):PlanPolygons {
  const interior=floorFootprint(c),walls=(c.rooms.length===1?buildIsolatedRoomWalls(c.rooms[0]):buildRenderedWalls(c.rooms)).filter(w=>!w.paintOnly);
  const quads=walls.map(w=>wallEnvelope(w)).filter(q=>q.length===4).map(polygonOf);
  const polygons=[...interior,...quads];return polygons.length?polygonClipping.union(polygons[0],...polygons.slice(1)):[];
}
export const subtractVoids = (footprint: PlanPolygons, openings: FloorOpening[]): PlanPolygons => footprint.length && openings.length ? polygonClipping.difference(footprint,...openings.map(o=>polygonOf(o.vertices))) : footprint;
export const exposedCover = (lower: PlanPolygons, upper: PlanPolygons): PlanPolygons => !lower.length ? [] : upper.length ? polygonClipping.difference(lower,upper) : lower;
export const FLOOR_SUPPORT_ERROR = "A floor bigger than the one below is not supported.";
/** Boundary-inclusive containment, including recesses and courtyard holes. */
function pointInFootprint(p:Point2D,footprint:PlanPolygons) {
  const ringState=(ring:Pair[])=>{
    let inside=false;
    for(let i=0;i<ring.length-1;i++) {
      const [ax,ay]=ring[i],[bx,by]=ring[i+1],dx=bx-ax,dy=by-ay,length=Math.hypot(dx,dy);
      if(length&&Math.abs(dx*(p.y-ay)-dy*(p.x-ax))/length<=1e-5&&p.x>=Math.min(ax,bx)-1e-5&&p.x<=Math.max(ax,bx)+1e-5&&p.y>=Math.min(ay,by)-1e-5&&p.y<=Math.max(ay,by)+1e-5)return 0;
      if((ay>p.y)!==(by>p.y)&&p.x<(bx-ax)*(p.y-ay)/(by-ay)+ax)inside=!inside;
    }
    return inside?1:-1;
  };
  return footprint.some(poly=>ringState(poly[0])>=0&&!poly.slice(1).some(r=>ringState(r)===1));
}
/** Check every interval cut by the polygon boundary, not just the endpoints. */
export function validateWallRunsOnFloor(walls:readonly {points:Point2D[]}[],below:FloorContent) {
  if(!walls.some(w=>w.points.length))return;
  const footprint=floorFootprint(below);
  if(!footprint.length)throw new Error(FLOOR_SUPPORT_ERROR+" Complete an enclosed floor below first.");
  const cross=(x:number,y:number,u:number,v:number)=>x*v-y*u;
  for(const wall of walls)for(let i=0;i<wall.points.length;i++) {
    const a=wall.points[i],b=wall.points[i+1];
    if(!Number.isFinite(a.x)||!Number.isFinite(a.y)||!pointInFootprint(a,footprint))throw new Error(FLOOR_SUPPORT_ERROR);
    if(!b)continue;
    const dx=b.x-a.x,dy=b.y-a.y,cuts=[0,1];
    for(const poly of footprint)for(const ring of poly)for(let j=0;j<ring.length-1;j++) {
      const [cx,cy]=ring[j],[ex,ey]=ring[j+1],ux=ex-cx,uy=ey-cy,den=cross(dx,dy,ux,uy);
      if(Math.abs(den)<1e-8)continue;
      const t=cross(cx-a.x,cy-a.y,ux,uy)/den,u=cross(cx-a.x,cy-a.y,dx,dy)/den;
      if(t>0&&t<1&&u>=-1e-9&&u<=1+1e-9)cuts.push(t);
    }
    cuts.sort((x,y)=>x-y);
    for(let j=1;j<cuts.length;j++){const t=(cuts[j-1]+cuts[j])/2;if(!pointInFootprint({x:a.x+dx*t,y:a.y+dy*t},footprint))throw new Error(FLOOR_SUPPORT_ERROR);}
  }
}
export function validateFloorOnBelow(upper:FloorContent,below:FloorContent) {
  const footprint=floorFootprint(upper),support=floorFootprint(below);
  if(footprint.length&&(!support.length||planArea(polygonClipping.difference(footprint,support))>.01))throw new Error(FLOOR_SUPPORT_ERROR);
  validateWallRunsOnFloor(upper.floorplan?.walls??upper.rooms.map(r=>({points:[...r.vertices,r.vertices[0]]})),below);
}
export function validateFloorSupports(floors:readonly {content:FloorContent}[]) {
  for(let i=1;i<floors.length;i++)validateFloorOnBelow(floors[i].content,floors[i-1].content);
}
export function validateSimplePolygon(p: Point2D[]) {
  if (p.length<3 || p.length>200 || p.some(a=>!Number.isFinite(a.x)||!Number.isFinite(a.y)||Math.abs(a.x)>1e7||Math.abs(a.y)>1e7)) throw new Error("Use 3–200 finite polygon vertices.");
  const cross=(a:Point2D,b:Point2D,c:Point2D)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const on=(a:Point2D,b:Point2D,c:Point2D)=>Math.abs(cross(a,b,c))<1e-6 && c.x>=Math.min(a.x,b.x)-1e-6 && c.x<=Math.max(a.x,b.x)+1e-6 && c.y>=Math.min(a.y,b.y)-1e-6 && c.y<=Math.max(a.y,b.y)+1e-6;
  for(let i=0;i<p.length;i++) {
    const a=p[i],b=p[(i+1)%p.length]; if(Math.hypot(a.x-b.x,a.y-b.y)<50) throw new Error("Each opening edge must be at least 50 mm long.");
    for(let j=i+1;j<p.length;j++) { if(j===i+1||i===0&&j===p.length-1)continue; const c=p[j],d=p[(j+1)%p.length];
      if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))throw new Error("The polygon crosses or touches itself. Move the highlighted vertices apart.");
    }
  }
  if(polygonAreaMm2(p)<10000)throw new Error("A floor opening must cover at least 0.01 m².");
}
export function validateFloorOpening(c: FloorContent, opening: FloorOpening, others: FloorOpening[]) {
  validateSimplePolygon(opening.vertices);
  const subject=[polygonOf(opening.vertices)], footprint=floorFootprint(c);
  if(!footprint.length || planArea(polygonClipping.difference(subject,footprint))>.01)throw new Error("Keep the complete opening inside the floor's enclosed slab footprint.");
  if(opening.shape==="RECTANGLE") {
    const p=opening.vertices;
    if(p.length!==4 || p.some((v,i)=>{const n=p[(i+1)%4];return Math.abs(v.x-n.x)>.001&&Math.abs(v.y-n.y)>.001;}))throw new Error("Rectangle openings must have four axis-aligned sides.");
    if(Math.max(...p.map(v=>v.x))-Math.min(...p.map(v=>v.x))<100 || Math.max(...p.map(v=>v.y))-Math.min(...p.map(v=>v.y))<100)throw new Error("Rectangle openings must be at least 100 × 100 mm.");
  }
  for(const other of others.filter(o=>o.id!==opening.id))if(planArea(polygonClipping.intersection(subject,polygonOf(other.vertices)))>.01)throw new Error("Openings cannot overlap. Resize or move the existing opening first.");
  const walls=c.floorplan?.walls.flatMap(w=>w.points.slice(0,-1).map((a,i)=>({a,b:w.points[i+1],t:w.thicknessOverridesMm?.[i]??c.floorplan?.wallThickness??100}))) ?? c.rooms.flatMap(r=>r.vertices.map((a,i)=>({a,b:r.vertices[(i+1)%r.vertices.length],t:r.wall_thickness.value})));
  const guard=opening.balustrade?.enabled?balustradeFootprint(opening.vertices,opening.balustrade):[];
  if(guard.length) {
    const slab=subtractVoids(footprint,others.filter(o=>o.id!==opening.id).concat(opening));
    if(planArea(polygonClipping.difference(guard,slab))>.01)throw new Error("The balustrade must sit completely on the slab, clear of every opening. Move or resize the opening, or turn the balustrade off.");
    for(const other of others.filter(o=>o.id!==opening.id&&o.balustrade?.enabled))if(planArea(polygonClipping.intersection(guard,balustradeFootprint(other.vertices,other.balustrade!)))>.01)throw new Error("Balustrades around neighbouring openings cannot overlap.");
  }
  for(const {a,b,t} of walls) {
    const length=Math.hypot(b.x-a.x,b.y-a.y); if(!length)continue;
    const dx=(b.x-a.x)/length*(t/2+10),dy=(b.y-a.y)/length*(t/2+10);
    const wall=polygonOf([{x:a.x-dy,y:a.y+dx},{x:b.x-dy,y:b.y+dx},{x:b.x+dy,y:b.y-dx},{x:a.x+dy,y:a.y-dx}]);
    if(planArea(polygonClipping.intersection(subject,wall))>.01)throw new Error("The opening crosses or touches a wall. Keep 10 mm clear of its face, or edit that wall first.");
    if(guard.length&&planArea(polygonClipping.intersection(guard,wall))>.01)throw new Error("The balustrade touches a wall. Leave space for its posts and a 25 mm setback from the void.");
  }
}

export type RoofZone={id:string;footprint:PlanPolygons;frameFootprint:PlanPolygons;roof:RoofProfile};
/** Partition the physical top-floor envelope once: no overlapping roofs or unroofed wall strips. */
export function buildingRoofZones(content:FloorContent,roof:RoofConfiguration):RoofZone[] {
  const footprint=structuralFloorFootprint(content);
  if(!footprint.length||roof.enabled===false)return [];
  const zones:RoofZone[]=[];let remaining=footprint;
  // Geometry, not random IDs or display names, determines shared-wall ownership.
  // A duplicated floor must retain exactly the same roof junctions.
  const ordered=[...content.rooms].sort((a,b)=>Math.min(...a.vertices.map(p=>p.x))-Math.min(...b.vertices.map(p=>p.x))||Math.min(...a.vertices.map(p=>p.y))-Math.min(...b.vertices.map(p=>p.y)));
  if(roof.roomRoofsEnabled)for(const room of ordered) {
    if(!roof.roomOverrides?.some(item=>item.roomId===room.id))continue;
    const roomFootprint=structuralFloorFootprint({...content,rooms:[room]}),part=polygonClipping.intersection(remaining,roomFootprint);
    if(!part.length)continue;
    const profile=roofForRoom(roof,room.id);
    // Disabled individual zones are not allowed: use the shared roof instead.
    zones.push({id:room.id,footprint:part,frameFootprint:roomFootprint,roof:profile});
    remaining=polygonClipping.difference(remaining,part);
  }
  if(remaining.length)zones.unshift({id:"shared",footprint:remaining,frameFootprint:footprint,roof});
  return zones;
}

/** Conservative headroom check: guards must fit below their zone's lowest ceiling. */
export function validateRoofGuardClearance(content:FloorContent,openings:FloorOpening[],roof:RoofConfiguration) {
  if(roof.enabled===false||!openings.some(opening=>opening.balustrade?.enabled))return;
  const zones=buildingRoofZones(content,roof);
  for(const opening of openings){
    if(!opening.balustrade?.enabled)continue;
    const guard=balustradeFootprint(opening.vertices,opening.balustrade);
    for(const zone of zones)if(planArea(polygonClipping.intersection(guard,zone.footprint))>.01){
      const clear=zone.roof.ceilingMode==="FLAT"?zone.roof.ceilingHeightMm:minimumRoofHeight(zone.roof);
      if(opening.balustrade.heightMm>clear)throw new Error(`Balustrade on ${opening.name} exceeds its roof zone's lowest clear ceiling height (${clear} mm).`);
    }
  }
}
export function snapToFloorReference(p: Point2D, content: FloorContent | undefined, toleranceMm: number): Point2D {
  if(!content)return p;
  const walls=content.floorplan?.walls.length?content.floorplan.walls:content.rooms.map(r=>({points:[...r.vertices,r.vertices[0]]}));
  let corner:Point2D|undefined,cornerDistance=toleranceMm;
  for(const wall of walls)for(const point of wall.points){const d=Math.hypot(p.x-point.x,p.y-point.y);if(d<=cornerDistance){corner={...point};cornerDistance=d;}}
  if(corner)return corner;
  let best=p, distance=toleranceMm;
  for(const wall of walls)for(let i=0;i<wall.points.length;i++) {
    const a=wall.points[i],b=wall.points[i+1];
    if(!b)continue; const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy;if(!l)continue;
    const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)), q={x:a.x+t*dx,y:a.y+t*dy}, dd=Math.hypot(p.x-q.x,p.y-q.y);
    if(dd<distance){best=q;distance=dd;}
  }
  return best;
}
export function roofFrame(footprint: PlanPolygons,r: RoofConfiguration) {
  const angle=(r.orientationDeg+(r.type==="GABLE"?90:0))*Math.PI/180, ux=Math.cos(angle),uy=Math.sin(angle);
  const points=footprint.flatMap(poly=>poly[0]),us=points.map(([x,y])=>x*ux+y*uy),vs=points.map(([x,y])=>-x*uy+y*ux);
  return {ux,uy,min:Math.min(...us),max:Math.max(...us),vmin:Math.min(...vs),vmax:Math.max(...vs)};
}
export function roofHeightAt(p: Point2D, r: RoofConfiguration, frame: ReturnType<typeof roofFrame>) {
  const span=frame.max-frame.min;if(!Number.isFinite(span)||span<1)throw new Error("The roof needs a non-degenerate enclosed footprint.");
  const t=Math.max(0,Math.min(1,(p.x*frame.ux+p.y*frame.uy-frame.min)/span));
  if(r.type==="FLAT")return r.lowHeightMm;
  if(r.type==="MONO")return r.lowHeightMm+(r.highHeightMm-r.lowHeightMm)*t;
  if(r.type==="GABLE")return r.lowHeightMm+(r.highHeightMm-r.lowHeightMm)*(1-Math.abs(2*t-1));
  return t<r.splitFraction?r.lowHeightMm:r.highHeightMm;
}
export type BuildingSurface = { kind:"ROOF"|"CEILING"|"CLOSURE"|"STEP"|"FASCIA"; positionsMm:number[]; indices:number[] };
function surface(polys:PlanPolygons,height:(p:Point2D)=>number,kind:BuildingSurface["kind"],reverse=false):BuildingSurface {
  const positionsMm:number[]=[],indices:number[]=[];
  for(const poly of polys) {
    const rings=poly.map(r=>r.slice(0,-1).map(([x,y])=>new Vector2(x,y))), contours=rings[0],holes=rings.slice(1);
    const points=[contours,...holes].flat(),triangles=ShapeUtils.triangulateShape(contours,holes),base=positionsMm.length/3;
    points.forEach(p=>positionsMm.push(p.x,p.y,height(p)));
    triangles.forEach(t=>{const [a,b,c]=t.map(i=>points[i]);if(Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))<.00001)return;indices.push(...(reverse?[t[2],t[1],t[0]]:t).map(i=>i+base));});
  }
  return {kind,positionsMm,indices};
}
function vertical(a:Pair,b:Pair,lowA:number,lowB:number,highA:number,highB:number,kind:BuildingSurface["kind"]):BuildingSurface {
  return {kind,positionsMm:[...a,lowA,...b,lowB,...b,highB,...a,highA],indices:[0,1,2,0,2,3]};
}
/** Millimetre source geometry. No scene-coordinate conversion and no stored meshes. */
export function buildRoofSurfaces(footprint:PlanPolygons,r:RoofConfiguration,wallTopMm:number,frameFootprint:PlanPolygons=footprint):BuildingSurface[] {
  if(!footprint.length||r.enabled===false)return [];
  const frame=roofFrame(frameFootprint,r),height=(p:Point2D)=>roofHeightAt(p,r,frame),split=frame.min+(frame.max-frame.min)*(r.type==="STEPPED"?r.splitFraction:.5);
  const clip=(u0:number,u1:number)=>{const pad=Math.max(frame.max-frame.min,frame.vmax-frame.vmin,1000)+1000;return polygonClipping.intersection(footprint,polygonOf([[u0,frame.vmin-pad],[u1,frame.vmin-pad],[u1,frame.vmax+pad],[u0,frame.vmax+pad]].map(([u,v])=>({x:u*frame.ux-v*frame.uy,y:u*frame.uy+v*frame.ux}))));};
  const regions=(r.type==="GABLE"||r.type==="STEPPED")?[clip(frame.min-1,split),clip(split,frame.max+1)]:[footprint];
  const out:BuildingSurface[]=[];
  regions.forEach((region,i)=>{
    const h=r.type==="STEPPED"?()=>i===0?r.lowHeightMm:r.highHeightMm:height;
    out.push(surface(region,p=>h(p)+r.thicknessMm,"ROOF"),surface(region,h,r.ceilingMode==="FOLLOWS_ROOF"?"CEILING":"ROOF",true));
    if(r.type==="STEPPED"&&i===0)for(const poly of region)for(const ring of poly)for(let j=0;j<ring.length-1;j++) {
      const a=ring[j],b=ring[j+1];if(Math.abs(a[0]*frame.ux+a[1]*frame.uy-split)<.01&&Math.abs(b[0]*frame.ux+b[1]*frame.uy-split)<.01)out.push(vertical(a,b,Math.min(r.lowHeightMm,r.highHeightMm),Math.min(r.lowHeightMm,r.highHeightMm),Math.max(r.lowHeightMm,r.highHeightMm)+r.thicknessMm,Math.max(r.lowHeightMm,r.highHeightMm)+r.thicknessMm,"STEP"));
    }
  });
  for(const poly of footprint)for(const ring of poly)for(let j=0;j<ring.length-1;j++) {
    const a=ring[j],b=ring[j+1],ua=a[0]*frame.ux+a[1]*frame.uy,ub=b[0]*frame.ux+b[1]*frame.uy,t=(split-ua)/(ub-ua);
    const segments=(r.type==="STEPPED"||r.type==="GABLE")&&t>1e-9&&t<1-1e-9?[[a,[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t] as Pair],[[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t] as Pair,b]]:[[a,b]];
    for(const [start,end]of segments) {
      const middle={x:(start[0]+end[0])/2,y:(start[1]+end[1])/2},ha=r.type==="STEPPED"?height(middle):height({x:start[0],y:start[1]}),hb=r.type==="STEPPED"?ha:height({x:end[0],y:end[1]});
      out.push(vertical(start as Pair,end as Pair,wallTopMm,wallTopMm,ha,hb,"CLOSURE"),vertical(start as Pair,end as Pair,ha,hb,ha+r.thicknessMm,hb+r.thicknessMm,"FASCIA"));
    }
  }
  if(r.ceilingMode==="FLAT")out.push(surface(footprint,()=>r.ceilingHeightMm,"CEILING",true));
  return out.filter(s=>s.indices.length&&s.positionsMm.every(Number.isFinite));
}
