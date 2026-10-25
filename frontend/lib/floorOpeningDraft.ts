import type { Point2D } from "./types";

/** Orthogonal drafting affects only the new void, never the measured walls. */
export function openingDraftPoint(points:readonly Point2D[],point:Point2D,square:boolean):Point2D {
  const last=points.at(-1);
  if(!square||!last)return point;
  return Math.abs(point.x-last.x)>=Math.abs(point.y-last.y)?{x:point.x,y:last.y}:{x:last.x,y:point.y};
}

export function closeOpeningDraft(points:readonly Point2D[],square:boolean):Point2D[] {
  const vertices=points.filter((p,i)=>!i||p.x!==points[i-1].x||p.y!==points[i-1].y).map(p=>({...p}));
  if(vertices.length>1&&vertices[0].x===vertices.at(-1)!.x&&vertices[0].y===vertices.at(-1)!.y)vertices.pop();
  if(square&&vertices.length>=3){
    const first=vertices[0],last=vertices.at(-1)!,previous=vertices.at(-2)!;
    if(first.x!==last.x&&first.y!==last.y)vertices.push(previous.y===last.y?{x:last.x,y:first.y}:{x:first.x,y:last.y});
  }
  return vertices;
}

export function moveOpeningVertex(vertices:readonly Point2D[],index:number,point:Point2D,square:boolean):Point2D[] {
  const next=vertices.map(p=>({...p})),old=vertices[index];next[index]=point;
  if(square)for(const at of [(index+vertices.length-1)%vertices.length,(index+1)%vertices.length]){
    const neighbour=vertices[at];
    if(neighbour.x===old.x)next[at].x=point.x;
    if(neighbour.y===old.y)next[at].y=point.y;
  }
  return next;
}
