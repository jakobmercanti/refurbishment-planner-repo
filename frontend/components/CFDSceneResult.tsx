"use client";

import { useEffect, useMemo, useState } from "react";
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute } from "three";
import type vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData";
import { readResultData } from "@/lib/cfdResultData";

export interface SceneResultMetadata { fields:{key:string;name:string;range:[number,number]}[];error:string }

/** Native worker files are in metres. Convert only at the Three rendering boundary. */
export function CFDSceneResult({file,field,onMetadata}:{file:File;field:string;onMetadata:(value:SceneResultMetadata)=>void}) {
  const [surface,setSurface]=useState<{positions:number[];colours:number[]}|null>(null);
  useEffect(()=>{
    let cancelled=false;
    void(async()=>{
      const loaded=await readResultData(file);
      try {
        if(cancelled)return;
        if(loaded.volume)throw new Error("Use the independent inspector to slice structured volumes before exporting a surface to the building viewer.");
        const data=loaded.data as vtkPolyData, selected=loaded.fields.find(item=>item.key===field)??loaded.fields[0];
        const array=selected?(selected.cell?data.getCellData():data.getPointData()).getArrayByName(selected.name):null;
        const source=data.getPoints().getData(),cells=data.getPolys().getData(),positions:number[]=[],colours:number[]=[];
        const low=selected?.range[0]??0,high=selected?.range[1]??1;
        const colour=new Color();let cell=data.getNumberOfVerts()+data.getNumberOfLines();
        for(let at=0;at<cells.length;cell++) {
          const count=cells[at++],ids=Array.from(cells.slice(at,at+count));at+=count;
          for(let t=1;t<count-1;t++)for(const id of [ids[0],ids[t],ids[t+1]]) {
            positions.push(source[id*3],source[id*3+2],-source[id*3+1]);
            const tuple=selected?.cell?cell:id;
            const value=array?(selected!.components>1?Math.hypot(...Array.from({length:selected!.components},(_,i)=>array.getComponent(tuple,i))):array.getComponent(tuple,0)):low;
            const fraction=high>low?Math.max(0,Math.min(1,(value-low)/(high-low))):.5;
            colour.setHSL((1-fraction)*.66,.8,.5);colours.push(colour.r,colour.g,colour.b);
          }
        }
        if(!positions.length)throw new Error("The building overlay needs polygon surface data. Inspect this file in the independent viewer instead.");
        if(!cancelled){setSurface({positions,colours});onMetadata({fields:loaded.fields.map(item=>({key:item.key,name:item.name,range:item.range})),error:""});}
      } finally {loaded.dispose();}
    })().catch(error=>{if(!cancelled){setSurface(null);onMetadata({fields:[],error:error instanceof Error?error.message:"Result overlay could not be loaded."});}});
    return()=>{cancelled=true;};
  },[file,field,onMetadata]);
  const geometry=useMemo(()=>{
    if(!surface)return null;
    const value=new BufferGeometry();value.setAttribute("position",new Float32BufferAttribute(surface.positions,3));value.setAttribute("color",new Float32BufferAttribute(surface.colours,3));return value;
  },[surface]);
  useEffect(()=>()=>geometry?.dispose(),[geometry]);
  return geometry?<mesh name="verified-cfd-result" geometry={geometry} raycast={()=>{}} renderOrder={3}><meshBasicMaterial vertexColors side={DoubleSide} polygonOffset polygonOffsetFactor={-1}/></mesh>:null;
}
