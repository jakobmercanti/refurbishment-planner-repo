// Explicit extension also lets the geometry regression suite run directly in Node.
// @ts-expect-error TypeScript emits no files; Node executes this module directly in tests.
import { closedRooms } from "./roomDetection.ts";
import type { WallDragWall, WallDragPoint } from "./wallDragGeometry";

type Point = WallDragPoint;
export type SegmentRemap = { wallId: string; segmentIndex: number; from: number; to: number };
export type RoomRemovalResult = { walls: WallDragWall[]; segmentMap: Record<string, SegmentRemap[]>; pointMap: Record<string, { wallId: string; pointIndex: number } | null> };
const EPS = 0.001;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const at = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const along = (p: Point, a: Point, b: Point) => ((p.x-a.x)*(b.x-a.x)+(p.y-a.y)*(b.y-a.y)) / ((b.x-a.x)**2+(b.y-a.y)**2);
function on(p: Point, a: Point, b: Point): boolean { const t = along(p,a,b); return Number.isFinite(t) && t >= -EPS && t <= 1+EPS && distance(p,at(a,b,t)) <= EPS; }
const edges = (polygon: Point[]) => polygon.map((a,i) => ({ a, b: polygon[(i+1)%polygon.length] }));
const boundary = (p: Point, polygon: Point[]) => edges(polygon).some(({a,b}) => on(p,a,b));
function inside(p: Point, polygon: Point[]): boolean {
  let result = false;
  edges(polygon).forEach(({a,b}) => { if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) result = !result; });
  return result && !boundary(p,polygon);
}
function samePolygon(a: Point[], b: Point[]): boolean { return a.every(p => boundary(p,b)) && b.every(p => boundary(p,a)); }
function crosses(a: Point,b: Point,c: Point,d: Point): boolean {
  const cross = (p: Point,q: Point,r: Point) => (q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  return cross(a,b,c)*cross(a,b,d) < -EPS && cross(c,d,a)*cross(c,d,b) < -EPS;
}

/** Adds only the three exterior sides; the selected boundary is reused, never duplicated. */
export function addRoomOutsideWall(walls: WallDragWall[], selection: {wallId: string; segmentIndex: number}, newWallId: string, depthMm = 2000): {walls: WallDragWall[]; error?: string} {
  const fail = (error: string) => ({walls,error});
  const wall = walls.find(w => w.id === selection.wallId);
  const a = wall?.points[selection.segmentIndex], b = wall?.points[selection.segmentIndex+1];
  if (!a || !b || distance(a,b) < 200 || !Number.isFinite(depthMm) || depthMm < 200) return fail("Select a boundary wall at least 200 mm long.");
  if (walls.some(w => w.id === newWallId)) return fail("The new wall identifier already exists.");
  const rooms = closedRooms(walls);
  const adjacent = rooms.filter(r => boundary(at(a,b,.25),r.vertices) && boundary(at(a,b,.75),r.vertices));
  if (adjacent.length !== 1) return fail("Choose an exterior wall belonging to exactly one room.");
  const length = distance(a,b), normal = {x: -(b.y-a.y)/length,y:(b.x-a.x)/length};
  const mid = at(a,b,.5);
  const sign = inside({x:mid.x+normal.x,y:mid.y+normal.y}, adjacent[0].vertices) ? -1 : 1;
  const c = {x:a.x+normal.x*sign*depthMm,y:a.y+normal.y*sign*depthMm};
  const d = {x:b.x+normal.x*sign*depthMm,y:b.y+normal.y*sign*depthMm};
  const polygon = [a,c,d,b];
  const newEdges = [{a,b:c},{a:c,b:d},{a:d,b}];
  const oldEdges = walls.flatMap(w => w.points.slice(0,-1).map((p,i) => ({a:p,b:w.points[i+1]})));
  if(newEdges.some(n=>oldEdges.some(e=>{
    const t1=along(e.a,n.a,n.b),t2=along(e.b,n.a,n.b);
    return distance(e.a,at(n.a,n.b,t1))<EPS && distance(e.b,at(n.a,n.b,t2))<EPS && Math.min(1,Math.max(t1,t2))-Math.max(0,Math.min(t1,t2))>EPS;
  }))) return fail("The new room would overlap an existing wall.");
  // Reject overlaps and penetrations, including a room/wall entirely enclosed by the proposal.
  if (oldEdges.some(e => inside(e.a,polygon) || inside(e.b,polygon) || inside(at(e.a,e.b,.5),polygon) || newEdges.some(n => crosses(n.a,n.b,e.a,e.b))) || rooms.some(r => [c,d,at(c,d,.5)].some(p => inside(p,r.vertices)))) return fail("There is not enough free space outside this wall.");
  if (newEdges.some(n => oldEdges.some(e => {
    // Incidence at the reused corners is intentional; other contacts are not.
    if ([n.a,n.b].some(p => [a,b].some(q => distance(p,q)<EPS) && [e.a,e.b].some(q=>distance(p,q)<EPS))) return false;
    const pointDistance = (p:Point,u:Point,v:Point) => distance(p,at(u,v,Math.max(0,Math.min(1,along(p,u,v)))));
    return Math.min(pointDistance(n.a,e.a,e.b),pointDistance(n.b,e.a,e.b),pointDistance(e.a,n.a,n.b),pointDistance(e.b,n.a,n.b)) < 200-EPS;
  }))) return fail("The new room must keep 200 mm clearance from other walls.");
  return { walls: [...walls, { id:newWallId, points:[{...a},c,d,{...b}], attachments:{0:{...selection,along:0,hideCorner:true},3:{...selection,along:1,hideCorner:true}} }] };
}

/** Remove exclusive atomic boundary spans, retaining every neighbouring room boundary. */
export function removeRoomBoundary(walls: WallDragWall[], roomVertices: Point[]): RoomRemovalResult {
  const otherRooms = closedRooms(walls).filter(r => !samePolygon(r.vertices,roomVertices));
  const segmentMap: RoomRemovalResult["segmentMap"] = {}, pointMap: RoomRemovalResult["pointMap"] = {};
  const result: WallDragWall[] = [];
  const usedIds = new Set(walls.map(w=>w.id));
  walls.forEach(wall => {
    const pieces = wall.points.slice(0,-1).map((a,i) => {
      const b = wall.points[i+1];
      const cuts = [0,1,...[roomVertices,...otherRooms.map(r=>r.vertices)].flatMap(p=>p.filter(q=>on(q,a,b)).map(q=>Math.max(0,Math.min(1,along(q,a,b)))))] .sort((x,y)=>x-y).filter((t,j,ts)=>j===0||t-ts[j-1]>EPS);
      return cuts.slice(0,-1).map((from,j)=>({from,to:cuts[j+1]})).filter(({from,to})=>{
        const midpoint=at(a,b,(from+to)/2);
        return !boundary(midpoint,roomVertices)||otherRooms.some(r=>boundary(midpoint,r.vertices));
      });
    });
    const unchanged = pieces.every(ps=>ps.length===1&&ps[0].from===0&&ps[0].to===1);
    if (unchanged) {
      result.push(wall);
      pieces.forEach((_,i)=>segmentMap[`${wall.id}:${i}`]=[{wallId:wall.id,segmentIndex:i,from:0,to:1}]);
    } else {
      let number=0;
      pieces.forEach((ps,i)=>{
        segmentMap[`${wall.id}:${i}`]=ps.map(({from,to})=>{
          let id=wall.id;
          if(number++>0) { id=`${wall.id}-retained-${number}`; while(usedIds.has(id))id=`${wall.id}-retained-${++number}`; usedIds.add(id); }
          const points=[at(wall.points[i],wall.points[i+1],from),at(wall.points[i],wall.points[i+1],to)];
          const next:WallDragWall={id,points};
          if(wall.thicknessOverridesMm?.[i]!==undefined)next.thicknessOverridesMm={0:wall.thicknessOverridesMm[i]};
          if(wall.lengthOverridesMm?.[i]!==undefined)next.lengthOverridesMm={0:wall.lengthOverridesMm[i]*(to-from)};
          const numbers:Record<number,number>={};
          if(from===0&&wall.cornerNumbers?.[i]!==undefined)numbers[0]=wall.cornerNumbers[i];
          if(to===1&&wall.cornerNumbers?.[i+1]!==undefined)numbers[1]=wall.cornerNumbers[i+1];
          if(Object.keys(numbers).length)next.cornerNumbers=numbers;
          result.push(next);
          return {wallId:id,segmentIndex:0,from,to};
        });
      });
    }
    wall.points.forEach((p,i)=>{
      const ownIds = new Set(pieces.flatMap((_,j)=>segmentMap[`${wall.id}:${j}`]?.map(p=>p.wallId)??[]));
      const own=result.filter(w=>ownIds.has(w.id));
      const found=own.flatMap(w=>w.points.map((q,j)=>({q,wallId:w.id,pointIndex:j}))).find(({q})=>distance(p,q)<EPS);
      pointMap[`${wall.id}:${i}`]=found?{wallId:found.wallId,pointIndex:found.pointIndex}:null;
    });
  });
  // Reattach preserved endpoints only to valid retained host intervals.
  const copied=result.map(w=>({...w,attachments:undefined as WallDragWall["attachments"]}));
  walls.forEach(w=>Object.entries(w.attachments??{}).forEach(([i,attachment])=>{
    const point=pointMap[`${w.id}:${i}`];
    const host=segmentMap[`${attachment.wallId}:${attachment.segmentIndex}`]?.find(p=>attachment.along>=p.from-EPS&&attachment.along<=p.to+EPS);
    if(!point||!host)return;
    const target=copied.find(w=>w.id===point.wallId)!;
    target.attachments={...target.attachments,[point.pointIndex]:{...attachment,wallId:host.wallId,segmentIndex:host.segmentIndex,along:(attachment.along-host.from)/(host.to-host.from)}};
  }));
  return {walls:copied,segmentMap,pointMap};
}
