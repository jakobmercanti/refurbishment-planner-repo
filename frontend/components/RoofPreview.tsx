"use client";

import { useEffect, useState } from "react";
import { Bounds, Center, OrbitControls, useBounds } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import type { FloorContent, RoofConfiguration } from "@/lib/buildingDocument";
import type { PlanPolygons } from "@/lib/buildingGeometry";
import { minimumRoofHeight } from "@/lib/buildingDocument";
import { BuildingRoof, CombinedBuildingRoof } from "./BuildingSurfaces";
import { StableCanvas } from "./StableCanvas";

function PreviewFrame({geometryKey,fitRequest,zoom}:{geometryKey:string;fitRequest:number;zoom:number}) {
  const bounds=useBounds(),{camera}=useThree();
  useEffect(()=>{
    const frame=requestAnimationFrame(()=>{bounds.refresh().fit().clip();camera.zoom=zoom;camera.updateProjectionMatrix();});
    return()=>cancelAnimationFrame(frame);
  },[bounds,camera,geometryKey,fitRequest,zoom]);
  return null;
}

/** Reuses the actual building roof surfaces; never feeds fit/thermal decisions. */
export function RoofPreview({roof,footprint,content}:{roof:RoofConfiguration|null;footprint:PlanPolygons;content?:FloorContent}) {
  const [zoom,setZoom]=useState(1),[fitRequest,setFitRequest]=useState(0);
  const geometryKey=roof?JSON.stringify([footprint,roof,content?.rooms.map(room=>[room.id,room.vertices])]):"invalid";
  return <section className="building-roof-preview" aria-label="Live roof preview">
    <div className="appearance-preview-heading"><strong>Live preview</strong><span>Updates as you edit</span></div>
    <div className="building-roof-preview-canvas">
      {roof&&footprint.length>0?<StableCanvas frameloop="demand" dpr={[1,1.5]} camera={{position:[7,6,8],fov:40}} gl={{preserveDrawingBuffer:true}}>
        <ambientLight intensity={1.6}/><directionalLight position={[4,7,5]} intensity={2.7}/><directionalLight position={[-4,2,-3]} intensity={.8}/>
        <Bounds fit clip observe margin={1.25} maxDuration={.25}>
          <PreviewFrame geometryKey={geometryKey} fitRequest={fitRequest} zoom={zoom}/>
          <Center cacheKey={geometryKey}>{content?<CombinedBuildingRoof content={content} roof={roof}/>:<BuildingRoof footprint={footprint} roof={roof} wallTop={minimumRoofHeight(roof)}/>}</Center>
        </Bounds>
        <OrbitControls makeDefault enablePan={false} enableZoom={false}/>
      </StableCanvas>:<p role="status">{footprint.length?"Enter valid roof dimensions to update the preview.":"Draw an enclosed room on the top floor to preview the roof."}</p>}
      <div className="fixture-preview-zoom-controls" aria-label="Roof preview controls">
        <input className="fixture-preview-zoom-slider" type="range" min=".6" max="2.4" step=".05" value={zoom} aria-label="Roof preview zoom" onChange={e=>setZoom(Number(e.target.value))}/>
        <button type="button" className="fixture-preview-fit-button" onClick={()=>{setZoom(1);setFitRequest(n=>n+1);}}>Fit</button>
      </div>
    </div>
    <small>Drag to orbit · use the slider to zoom · Fit resets the framing</small>
  </section>;
}
