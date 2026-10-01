import type { Obstacle, Opening, Point2D, Room } from "./types";

type Segment = { start: Point2D; end: Point2D; margin: number };
export type PlacementWall = {start: Point2D; end: Point2D; thickness: number};
export type OpeningDrop = { wallId: string; segmentIndex: number; offset: number; start: Point2D; end: Point2D; thickness: number };
export type PlacementCandidate = { obstacle: Obstacle; roomId?: string; opening?: OpeningDrop; openingModel?: {room: Room; opening: Opening} };
export type PlacementRequest = {
  id: string;
  obstacle: Obstacle;
  opening?: { kind: "DOOR" | "WINDOW"; doorType: "SINGLE" | "DOUBLE"; hingeSide: "START" | "END"; opensInward: boolean };
  resolve?: (point: Point2D) => PlacementCandidate | null;
  commit?: (candidate: PlacementCandidate) => boolean;
};
export type PlacementProps = {
  placementWalls?: PlacementWall[];
  onPlacementWallsChange?: (walls: PlacementWall[]) => void;
  placement?: PlacementRequest | null;
  onBeginPlacement?: (request: PlacementRequest) => void;
  onCancelPlacement?: () => void;
  onCommitPlacement?: (candidate: PlacementCandidate) => void;
  onTransferObstacle?: (obstacle: Obstacle, roomId: string) => void;
};

const EPS = .01;
/** Ordinary furniture/fittings should move freely unless the user opts into a wall lock. */
export const DEFAULT_OBSTACLE_WALL_LOCK = false;
const cross = (a: Point2D, b: Point2D, c: Point2D) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const distance = (a: Point2D, b: Point2D) => Math.hypot(a.x-b.x,a.y-b.y);
function projection(p: Point2D, a: Point2D, b: Point2D) {
  const dx=b.x-a.x, dy=b.y-a.y, squared=dx*dx+dy*dy;
  const t=squared ? Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/squared)) : 0;
  return {x:a.x+t*dx,y:a.y+t*dy};
}
export function containsPoint(point: Point2D, vertices: Point2D[]) {
  let inside=false;
  for (let i=0,j=vertices.length-1;i<vertices.length;j=i++) {
    const a=vertices[j],b=vertices[i];
    if (distance(point,projection(point,a,b))<EPS) return true;
    if ((a.y>point.y)!==(b.y>point.y) && point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}
export function obstacleFootprint(obstacle: Obstacle): Point2D[] {
  const a=obstacle.rotation_deg*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  const w=obstacle.dimensions.width.value/2,d=obstacle.dimensions.depth.value/2;
  return [[-w,-d],[w,-d],[w,d],[-w,d]].map(([x,y])=>({x:obstacle.center.x+x*c+y*s,y:obstacle.center.y+x*s-y*c}));
}
function boundaries(room: Room): Segment[] {
  const vertices=room.vertices;
  const area=vertices.reduce((sum,p,i)=>sum+p.x*vertices[(i+1)%vertices.length].y-vertices[(i+1)%vertices.length].x*p.y,0);
  return vertices.map((start,i)=>({start:area>=0?start:vertices[(i+1)%vertices.length],end:area>=0?vertices[(i+1)%vertices.length]:start,
    margin:Math.max(0,room.wall_thickness_overrides_mm?.[`wall-${String(i+1).padStart(3,"0")}`]??room.wall_thickness.value)/2+1}));
}
function segmentDistance(a: Point2D,b: Point2D,c: Point2D,d: Point2D) {
  if (cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0) return 0;
  return Math.min(distance(a,projection(a,c,d)),distance(b,projection(b,c,d)),distance(c,projection(c,a,b)),distance(d,projection(d,a,b)));
}

/** Editing guard, in mm. Conservative footprint containment does not replace engineering fit checks. */
export function obstacleFitsInRoom(obstacle: Obstacle, room: Room, walls: PlacementWall[] = []): boolean {
  if (room.vertices.length<3 || ![obstacle.center.x,obstacle.center.y,obstacle.rotation_deg,obstacle.dimensions.width.value,obstacle.dimensions.depth.value].every(Number.isFinite)
    || obstacle.dimensions.width.value<=0 || obstacle.dimensions.depth.value<=0) return false;
  const footprint=obstacleFootprint(obstacle);
  return footprint.every(p=>containsPoint(p,room.vertices)) && boundaries(room).every(({start,end,margin})=>
    footprint.every((p,i)=>segmentDistance(p,footprint[(i+1)%4],start,end)>=margin-EPS)) && walls.every(({start,end,thickness})=>
    !containsPoint(start,footprint) && !containsPoint(end,footprint) && footprint.every((p,i)=>segmentDistance(p,footprint[(i+1)%4],start,end)>=Math.max(0,thickness)/2+1-EPS));
}

export function constrainObstacleToRoom(obstacle: Obstacle, room: Room, requested=obstacle.center, walls: PlacementWall[] = []): Obstacle | null {
  const raw={...obstacle,center:requested};
  if (!obstacle.wall_lock && obstacleFitsInRoom(raw,room,walls)) return raw;
  // Internal wall runs may not enclose a room. Treat both faces as barriers too.
  const roomBounds={minX:Math.min(...room.vertices.map(p=>p.x)),maxX:Math.max(...room.vertices.map(p=>p.x)),minY:Math.min(...room.vertices.map(p=>p.y)),maxY:Math.max(...room.vertices.map(p=>p.y))};
  const nearby=walls.filter(wall=>Math.max(wall.start.x,wall.end.x)>=roomBounds.minX && Math.min(wall.start.x,wall.end.x)<=roomBounds.maxX && Math.max(wall.start.y,wall.end.y)>=roomBounds.minY && Math.min(wall.start.y,wall.end.y)<=roomBounds.maxY);
  const edges=[...boundaries(room),...nearby.flatMap(({start,end,thickness})=>[{start,end,margin:Math.max(0,thickness)/2+1},{start:end,end:start,margin:Math.max(0,thickness)/2+1}])].filter(edge=>distance(edge.start,edge.end)>EPS);
  const rotations=obstacle.wall_lock ? edges.map(({start,end})=>(Math.atan2(end.y-start.y,end.x-start.x)*180/Math.PI+540)%360) : [obstacle.rotation_deg];
  const candidates: Obstacle[]=[];
  for (const rotation_deg of [...new Set(rotations)]) {
    const rotated={...raw,rotation_deg}, corners=obstacleFootprint({...rotated,center:{x:0,y:0}});
    const lines=edges.map(({start,end,margin})=>{
      const length=distance(start,end), n={x:-(end.y-start.y)/length,y:(end.x-start.x)/length};
      const support=Math.max(...corners.map(p=>-p.x*n.x-p.y*n.y));
      return {n,c:start.x*n.x+start.y*n.y+support+margin,angle:(Math.atan2(end.y-start.y,end.x-start.x)*180/Math.PI+540)%360};
    }).filter((line,index,all)=>all.findIndex(other=>Math.abs(other.n.x-line.n.x)<1e-6 && Math.abs(other.n.y-line.n.y)<1e-6 && Math.abs(other.c-line.c)<EPS)===index);
    for (let i=0;i<lines.length;i++) {
      const angle=lines[i].angle;
      if (obstacle.wall_lock && Math.abs(angle-rotation_deg)>EPS) continue;
      const {n,c}=lines[i],delta=c-requested.x*n.x-requested.y*n.y;
      candidates.push({...rotated,center:{x:requested.x+n.x*delta,y:requested.y+n.y*delta}});
      for (let j=i+1;j<lines.length;j++) {
        const other=lines[j],det=n.x*other.n.y-n.y*other.n.x;
        if (Math.abs(det)<1e-6) continue;
        candidates.push({...rotated,center:{x:(c*other.n.y-n.y*other.c)/det,y:(n.x*other.c-c*other.n.x)/det}});
      }
    }
  }
  return candidates.filter(candidate=>obstacleFitsInRoom(candidate,room,walls)).sort((a,b)=>distance(a.center,requested)-distance(b.center,requested))[0]??null;
}

export function resolveObstaclePlacement(obstacle: Obstacle, point: Point2D, rooms: Room[], walls: PlacementWall[] = [], fallbackRoomId?: string): PlacementCandidate | null {
  const candidates=rooms.filter(room=>containsPoint(point,room.vertices)).flatMap(room=>{
    const positioned=constrainObstacleToRoom(obstacle,room,point,walls);
    return positioned ? [{obstacle:positioned,roomId:room.id}] : [];
  });
  const nearest=candidates.sort((a,b)=>distance(a.obstacle.center,point)-distance(b.obstacle.center,point))[0];
  if (nearest) return nearest;
  const fallback=rooms.find(room=>room.id===fallbackRoomId);
  const constrained=fallback ? constrainObstacleToRoom(obstacle,fallback,point,walls) : null;
  return fallback && constrained ? {obstacle:constrained,roomId:fallback.id} : null;
}
export function resolvePlacement(request: PlacementRequest, point: Point2D, rooms: Room[], walls: PlacementWall[] = []) {
  return request.resolve ? request.resolve(point) : resolveObstaclePlacement(request.obstacle,point,rooms,walls);
}

/** One state update removes the previous owner and inserts exactly once into the destination. */
export function transferObstacle(rooms: Room[], obstacle: Obstacle, roomId: string): Room[] {
  if (!rooms.some(room=>room.id===roomId && obstacleFitsInRoom(obstacle,room))) return rooms;
  return rooms.map(room=>{
    if (room.id!==roomId && !room.obstacles.some(item=>item.id===obstacle.id)) return room;
    const remaining=room.obstacles.filter(item=>item.id!==obstacle.id);
    return {...room,version:room.version+1,obstacles:room.id===roomId ? [...remaining,obstacle] : remaining};
  });
}
