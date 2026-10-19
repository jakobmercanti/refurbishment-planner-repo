"use client";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { buildRoofSurfaces, roofFrame, subtractVoids, type BuildingSurface, type PlanPolygons } from "@/lib/buildingGeometry";
import type { FloorOpening, RoofConfiguration, RoofFinish } from "@/lib/buildingDocument";
import { resolvedRoofFinish, ROOF_MATERIALS, roofTexturePixels } from "@/lib/roofAppearance";

export function shapesFromPolygons(polygons:PlanPolygons) {
  return polygons.map(poly=>{
    const shape=new THREE.Shape(poly[0].slice(0,-1).map(([x,y])=>new THREE.Vector2(x*.001,y*.001)));
    shape.holes=poly.slice(1).map(r=>new THREE.Path(r.slice(0,-1).map(([x,y])=>new THREE.Vector2(x*.001,y*.001))));
    return shape;
  });
}
function RoofMaterial({finish}:{finish:RoofFinish}) {
  const preset=ROOF_MATERIALS.find(m=>m.id===finish.material)!;
  const texture=useMemo(()=>{const t=new THREE.DataTexture(roofTexturePixels(finish.material),256,256,THREE.RGBAFormat);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.generateMipmaps=true;t.minFilter=THREE.LinearMipmapLinearFilter;t.anisotropy=8;t.needsUpdate=true;return t;},[finish.material]);
  useEffect(()=>()=>texture.dispose(),[texture]);
  return <meshStandardMaterial color={finish.colour} map={texture} bumpMap={texture} bumpScale={preset.bumpMm*.001} roughness={preset.roughness} metalness={preset.metalness} side={THREE.DoubleSide}/>;
}
function SurfaceMesh({surface,roof,frame}:{surface:BuildingSurface;roof:RoofConfiguration;frame:ReturnType<typeof roofFrame>}) {
  const finish=resolvedRoofFinish(roof);
  const geometry=useMemo(()=>{
    const g=new THREE.BufferGeometry(),v=surface.positionsMm,positions=[],uv=[];
    const rise=roof.highHeightMm-roof.lowHeightMm,run=(frame.max-frame.min)/(roof.type==="GABLE"?2:1),slope=(roof.type==="GABLE"||roof.type==="MONO")?Math.hypot(1,rise/run):1;
    for(let i=0;i<v.length;i+=3){positions.push(v[i]*.001,v[i+2]*.001,-v[i+1]*.001);uv.push((-v[i]*frame.uy+v[i+1]*frame.ux)/(finish.tileWidthMm*4),(v[i]*frame.ux+v[i+1]*frame.uy)*slope/(finish.tileHeightMm*4));}
    g.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));g.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));g.setIndex(surface.indices);g.computeVertexNormals();return g;
  },[surface,frame,roof.type,roof.highHeightMm,roof.lowHeightMm,finish.tileWidthMm,finish.tileHeightMm]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  return <mesh geometry={geometry} castShadow receiveShadow userData={{buildingSurface:surface.kind,roofMaterial:finish.material}}>{surface.kind==="ROOF"?<RoofMaterial finish={finish}/>:<meshStandardMaterial color={surface.kind==="FASCIA"||surface.kind==="STEP"?finish.colour:surface.kind==="CEILING"?"#f5f3ed":"#c8c3b9"} side={THREE.DoubleSide} roughness={.85}/>}</mesh>;
}
export function BuildingRoof({footprint,roof,wallTop}:{footprint:PlanPolygons;roof:RoofConfiguration;wallTop:number}) {
  const surfaces=useMemo(()=>buildRoofSurfaces(footprint,roof,wallTop),[footprint,roof,wallTop]);
  const frame=useMemo(()=>roofFrame(footprint,roof),[footprint,roof]);
  return <group name="Building roof and interior ceiling">{surfaces.map((s,i)=><SurfaceMesh key={i} surface={s} roof={roof} frame={frame}/>)}</group>;
}
export function BuildingSlab({footprint,openings,thicknessMm}:{footprint:PlanPolygons;openings:FloorOpening[];thicknessMm:number}) {
  const shapes=useMemo(()=>shapesFromPolygons(subtractVoids(footprint,openings)),[footprint,openings]);
  return <group name="Wall-aligned floor slab">{shapes.map((shape,i)=><mesh key={i} rotation={[-Math.PI/2,0,0]} position={[0,-thicknessMm*.001,0]} receiveShadow castShadow userData={{buildingSlab:true}}><extrudeGeometry args={[shape,{depth:thicknessMm*.001,bevelEnabled:false}]}/><meshStandardMaterial color="#b9b3a8" roughness={.88} side={THREE.DoubleSide}/></mesh>)}</group>;
}
export function TerraceCover({footprint,thickness}:{footprint:PlanPolygons;thickness:number}) {
  const shapes=useMemo(()=>shapesFromPolygons(footprint),[footprint]);
  return <group name="Automatic exposed lower-floor weather cover">{shapes.map((shape,i)=><mesh key={i} rotation={[-Math.PI/2,0,0]} position={[0,-thickness*.001,0]} receiveShadow castShadow><extrudeGeometry args={[shape,{depth:thickness*.001,bevelEnabled:false}]}/><meshStandardMaterial color="#9aa19c" side={THREE.DoubleSide} roughness={.9}/></mesh>)}</group>;
}
