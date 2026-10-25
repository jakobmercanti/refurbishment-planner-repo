"use client";
import { useEffect, useMemo } from "react";
import { BufferGeometry, Float32BufferAttribute, DoubleSide, Shape } from "three";
import { passageTopPoints } from "@/lib/passageOpenings";
import type { PassageProfile, WallViewMode } from "@/lib/types";

function polygon(points: { x:number; y:number }[]) {
  const shape = new Shape(); points.forEach((p,i)=>i?shape.lineTo(p.x,p.y):shape.moveTo(p.x,p.y));shape.closePath();return shape;
}

/** Transparent picking surface follows the real aperture, not its rectangular bounds. */
export function PassageHitArea({profile,width,height}:{profile:PassageProfile;width:number;height:number}) {
  const shape=useMemo(()=>polygon([{x:-width/2,y:0},{x:width/2,y:0},...passageTopPoints(profile,width,height).reverse().map(p=>({x:p.x-width/2,y:p.y}))]),[profile,width,height]);
  return <mesh name="doorless-passage"><shapeGeometry args={[shape]}/><meshBasicMaterial side={DoubleSide} transparent opacity={0} depthWrite={false}/></mesh>;
}

/** Finish only: the jambs/intrados remain exactly on the authoritative cut boundary. */
export function PassageReveal({profile,width,height,depth,colour,from=0,to=width,transparent=false}:{profile:PassageProfile;width:number;height:number;depth:number;colour:string;from?:number;to?:number;transparent?:boolean}) {
  const geometry=useMemo(()=>{
    const top=passageTopPoints(profile,width,height,from,to),points=[...(from<=1e-8?[{x:0,y:0}]:[]),...top,...(to>=width-1e-8?[{x:width,y:0}]:[])],positions:number[]=[];
    points.slice(1).forEach((b,i)=>{const a=points[i],ax=a.x-width/2,bx=b.x-width/2;positions.push(ax,a.y,0,bx,b.y,0,bx,b.y,depth,ax,a.y,0,bx,b.y,depth,ax,a.y,depth);});
    const result=new BufferGeometry();result.setAttribute("position",new Float32BufferAttribute(positions,3));result.computeVertexNormals();return result;
  },[profile,width,height,depth,from,to]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  return <mesh name="passage-reveal" geometry={geometry} receiveShadow><meshStandardMaterial color={colour} roughness={.86} side={DoubleSide} transparent={transparent} opacity={transparent?.2:1} depthWrite={!transparent}/></mesh>;
}

/** Catalogue/asset preview: an open-bottom wall section, never a hidden door leaf. */
export function PassageWallPreview({profile,width,height,depth,colour="#e7e2d8"}:{profile:PassageProfile;width:number;height:number;depth:number;colour?:string}) {
  const shape=useMemo(()=>{
    const side=Math.max(width*.22,height*.14),top=height*.14;
    return polygon([{x:-width/2-side,y:0},{x:-width/2-side,y:height+top},{x:width/2+side,y:height+top},{x:width/2+side,y:0},{x:width/2,y:0},...passageTopPoints(profile,width,height).reverse().map(p=>({x:p.x-width/2,y:p.y})),{x:-width/2,y:0}]);
  },[profile,width,height]);
  return <group name="doorless-opening-preview" userData={{passageProfile:profile}}>
    <mesh position={[0,0,-depth/2]} castShadow receiveShadow><extrudeGeometry args={[shape,{depth,bevelEnabled:false}]} /><meshStandardMaterial color={colour} roughness={.85} side={DoubleSide}/></mesh>
    <mesh position={[0,-height*.012,0]} receiveShadow><boxGeometry args={[width*1.8,height*.024,Math.max(width*.55,depth*3)]}/><meshStandardMaterial color="#d3d1c9" roughness={.95}/></mesh>
  </group>;
}

/** Fills the shoulders above a shaped opening inside the wall's rectangular cut. */
export function PassageSpandrel({profile,widthMm,heightMm,fromMm=0,toMm=widthMm,depthMm,colour,solidColour,wallMode,paintOnly=false,selected=false,onSelect}:{profile:PassageProfile;widthMm:number;heightMm:number;fromMm?:number;toMm?:number;depthMm:number;colour:string;solidColour:string;wallMode:WallViewMode;paintOnly?:boolean;selected?:boolean;onSelect?:(additive:boolean)=>void}) {
  const shape=useMemo(()=>polygon([{x:fromMm/1000,y:heightMm/1000},{x:toMm/1000,y:heightMm/1000},...passageTopPoints(profile,widthMm,heightMm,fromMm,toMm).reverse().map(p=>({x:p.x/1000,y:p.y/1000}))]),[profile,widthMm,heightMm,fromMm,toMm]);
  if(profile==="RECTANGULAR"||wallMode==="INVISIBLE"||toMm<=fromMm)return null;
  const transparent=wallMode==="TRANSPARENT";
  return <group name="passage-spandrel" userData={{passageProfile:profile}} onPointerDown={onSelect?event=>{event.stopPropagation();onSelect(event.ctrlKey||event.metaKey);}:undefined}>
    {!paintOnly&&wallMode!=="CUTAWAY_2D"&&<mesh castShadow={!transparent} receiveShadow><extrudeGeometry args={[shape,{depth:depthMm/1000,bevelEnabled:false}]}/><meshStandardMaterial color={solidColour} roughness={.86} side={DoubleSide} transparent={transparent} opacity={transparent?.2:1} depthWrite={!transparent}/></mesh>}
    <mesh position={[0,0,-.0015]}><shapeGeometry args={[shape]}/><meshStandardMaterial color={colour} emissive={selected?"#b76d16":"#000000"} emissiveIntensity={selected?.12:0} roughness={.88} side={DoubleSide} transparent={transparent} opacity={transparent?.28:1} depthWrite={!transparent}/></mesh>
  </group>;
}
