"use client";

import { useEffect, useMemo, useState } from "react";
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Mesh } from "three";
import type vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData";
import { readResultData, type ResultField } from "@/lib/cfdResultData";
import { resultProbeMesh, sampleResultPoint, type ProbeMesh, type ResultPointValue } from "@/lib/cfdPointProbe";

export interface SceneResultMetadata { fields:{key:string;name:string;range:[number,number]}[];error:string }
export interface CFDSceneResultProps { file:File;field:string;onMetadata:(value:SceneResultMetadata)=>void;probing?:boolean;onProbe?:(value:ResultPointValue|null)=>void }

/** Native worker files are in metres. Convert only at the Three rendering boundary. */
export function CFDSceneResult({file,field,onMetadata,probing=false,onProbe}:CFDSceneResultProps) {
  const [surface,setSurface]=useState<{file:File;positions:number[];mesh:ProbeMesh;fields:ResultField[];arrays:Map<string,ArrayLike<number>>}|null>(null);
  useEffect(()=>{
    let cancelled=false;
    void(async()=>{
      const loaded=await readResultData(file);
      try {
        if(cancelled)return;
        if(loaded.volume)throw new Error("Use the independent inspector to slice structured volumes before exporting a surface to the building viewer.");
        const data=loaded.data as vtkPolyData;
        const source=data.getPoints().getData(),positions:number[]=[];
        const mesh=resultProbeMesh(source,data.getPolys().getData(),data.getNumberOfVerts()+data.getNumberOfLines(),data.getStrips().getData());
        for(const id of mesh.triangles)positions.push(source[id*3],source[id*3+2],-source[id*3+1]);
        const arrays=new Map<string,ArrayLike<number>>();
        for(const item of loaded.fields){const array=(item.cell?data.getCellData():data.getPointData()).getArrayByName(item.name);if(array)arrays.set(item.key,array.getData());}
        if(!positions.length)throw new Error("The building overlay needs polygon surface data. Inspect this file in the independent viewer instead.");
        if(!cancelled){setSurface({file,positions,mesh,fields:loaded.fields,arrays});onMetadata({fields:loaded.fields.map(item=>({key:item.key,name:item.name,range:item.range})),error:""});}
      } finally {loaded.dispose();}
    })().catch(error=>{if(!cancelled){setSurface(null);onMetadata({fields:[],error:error instanceof Error?error.message:"Result overlay could not be loaded."});}});
    return()=>{cancelled=true;};
  },[file,onMetadata]);
  const data=surface?.file===file?surface:null;
  const selected=data?.fields.find(item=>item.key===field)??data?.fields[0],values=selected?data?.arrays.get(selected.key):undefined;
  const geometry=useMemo(()=>{
    if(!data)return null;
    const colour=new Color(),colours:number[]=[],low=selected?.range[0]??0,high=selected?.range[1]??1;
    for(let vertex=0;vertex<data.mesh.triangles.length;vertex++){
      const tuple=selected?.cell?data.mesh.cells[Math.floor(vertex/3)]:data.mesh.triangles[vertex];
      const value=selected&&values?(selected.components>1?Math.hypot(...Array.from({length:selected.components},(_,i)=>values[tuple*selected.components+i])):values[tuple]):low;
      const fraction=high>low?Math.max(0,Math.min(1,(value-low)/(high-low))):.5;
      colour.setHSL((1-fraction)*.66,.8,.5);colours.push(colour.r,colour.g,colour.b);
    }
    const value=new BufferGeometry();value.setAttribute("position",new Float32BufferAttribute(data.positions,3));value.setAttribute("color",new Float32BufferAttribute(colours,3));return value;
  },[data,selected,values]);
  useEffect(()=>()=>geometry?.dispose(),[geometry]);
  return geometry?<mesh name="verified-cfd-result" geometry={geometry} raycast={probing?Mesh.prototype.raycast:()=>{}} renderOrder={3} onClick={event=>{
    if(!probing||event.button!==0||event.delta>4)return;
    event.stopPropagation();
    if(!data||!selected||!values||event.faceIndex==null){onProbe?.(null);return;}
    onProbe?.(sampleResultPoint(data.mesh,event.faceIndex,[event.point.x,-event.point.z,event.point.y],selected,values));
  }}><meshBasicMaterial vertexColors side={DoubleSide} polygonOffset polygonOffsetFactor={-1}/></mesh>:null;
}
