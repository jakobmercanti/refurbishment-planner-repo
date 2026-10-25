import polygonClipping from "polygon-clipping";
import styles from "./balustradeStyles.json";
import type { BalustradeConfiguration } from "./buildingDocument";
import type { Point2D } from "./types";

export const BALUSTRADE_STYLES=styles;
export const defaultBalustrade=():BalustradeConfiguration=>({enabled:true,style:"VERTICAL",heightMm:1100,colour:styles[0].colour});
export function balustradeStyle(style:BalustradeConfiguration["style"]){return styles.find(item=>item.id===style)!;}

/** Offset onto the slab side of the void. Handles either winding and concave corners. */
export function balustradeRuns(vertices:readonly Point2D[],config:BalustradeConfiguration) {
  if(!config.enabled||vertices.length<3)return [];
  const area=vertices.reduce((sum,a,i)=>{const b=vertices[(i+1)%vertices.length];return sum+a.x*b.y-b.x*a.y;},0);
  const sign=area>=0?1:-1,depth=balustradeStyle(config.style).depthMm,offset=depth/2+25;
  const normals=vertices.map((a,i)=>{const b=vertices[(i+1)%vertices.length],length=Math.hypot(b.x-a.x,b.y-a.y);if(length<1)throw new Error("Balustrade edges must have a positive length.");return{x:sign*(b.y-a.y)/length,y:-sign*(b.x-a.x)/length};});
  const points=vertices.map((p,i)=>{
    const a=normals[(i+vertices.length-1)%vertices.length],b=normals[i],den=1+a.x*b.x+a.y*b.y;
    if(den<.125)throw new Error("This opening has a corner too sharp for a balustrade. Widen the corner or turn the balustrade off.");
    return{x:p.x+offset*(a.x+b.x)/den,y:p.y+offset*(a.y+b.y)/den};
  });
  return points.map((a,i)=>{const b=points[(i+1)%points.length],length=Math.hypot(b.x-a.x,b.y-a.y);if(length<1)throw new Error("The opening is too narrow at this corner for a balustrade.");return{a,b,length,depth,rotationDeg:Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI};});
}

/** Conservative footprint includes the full posts, rails and mitered corner joints. */
export function balustradeFootprint(vertices:readonly Point2D[],config:BalustradeConfiguration) {
  const polygons=balustradeRuns(vertices,config).map(({a,b,depth})=>{
    const length=Math.hypot(b.x-a.x,b.y-a.y),dx=(b.x-a.x)/length*depth/2,dy=(b.y-a.y)/length*depth/2;
    return [[...[{x:a.x-dx-dy,y:a.y-dy+dx},{x:b.x+dx-dy,y:b.y+dy+dx},{x:b.x+dx+dy,y:b.y+dy-dx},{x:a.x-dx+dy,y:a.y-dy-dx}].map(p=>[p.x,p.y] as [number,number])]];
  });
  return polygons.length?polygonClipping.union(polygons[0],...polygons.slice(1)):[];
}

/** Invalid transient drag geometry is rejected on commit, not allowed to crash the drawing. */
export function previewBalustradeFootprint(vertices:readonly Point2D[],config:BalustradeConfiguration) {
  try{return balustradeFootprint(vertices,config);}catch{return [];}
}
