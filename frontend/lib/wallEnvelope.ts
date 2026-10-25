import type { Point2D, Room } from "./types";
import type { RenderedWall } from "./wallRendering";

export const wallThicknessMm=(room:Room,index:number)=>room.wall_thickness_overrides_mm?.[`wall-${String(index+1).padStart(3,"0")}`]??room.wall_thickness.value;
export function exteriorWallCorner(vertices:Point2D[],index:number,incomingThickness:number,outgoingThickness:number):Point2D {
  const vertex=vertices[index],previous=vertices[(index-1+vertices.length)%vertices.length],next=vertices[(index+1)%vertices.length];
  const unit=(a:Point2D,b:Point2D)=>{const length=Math.hypot(b.x-a.x,b.y-a.y)||1;return{x:(b.x-a.x)/length,y:(b.y-a.y)/length};};
  const incoming=unit(previous,vertex),outgoing=unit(vertex,next);
  const a={x:vertex.x+incoming.y*incomingThickness,y:vertex.y-incoming.x*incomingThickness},b={x:vertex.x+outgoing.y*outgoingThickness,y:vertex.y-outgoing.x*outgoingThickness};
  const cross=(a:Point2D,b:Point2D)=>a.x*b.y-a.y*b.x,den=cross(incoming,outgoing),average={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
  if(Math.abs(den)<1e-9)return average;
  const t=cross({x:b.x-a.x,y:b.y-a.y},outgoing)/den,corner={x:a.x+incoming.x*t,y:a.y+incoming.y*t};
  return Math.hypot(corner.x-vertex.x,corner.y-vertex.y)>Math.max(incomingThickness,outgoingThickness)*4?average:corner;
}
/** Exact same millimetre wall polygon for walls, slab boundaries and roofs. */
export function wallEnvelope(w:Pick<RenderedWall,"room"|"index"|"start"|"end"|"capStart"|"capEnd">):Point2D[] {
  const {room,index,start,end,capStart,capEnd}=w,t=wallThicknessMm(room,index),length=Math.hypot(end.x-start.x,end.y-start.y);
  if(!length)return [];
  const offset=(p:Point2D)=>({x:p.x+(end.y-start.y)/length*t,y:p.y-(end.x-start.x)/length*t});
  const outerStart=capStart?offset(start):exteriorWallCorner(room.vertices,index,wallThicknessMm(room,(index-1+room.vertices.length)%room.vertices.length),t);
  const outerEnd=capEnd?offset(end):exteriorWallCorner(room.vertices,(index+1)%room.vertices.length,t,wallThicknessMm(room,(index+1)%room.vertices.length));
  return [start,end,outerEnd,outerStart];
}
