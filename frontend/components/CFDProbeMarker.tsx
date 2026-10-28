"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { Plane, Raycaster, Vector2, Vector3 } from "three";
import type { Vec3 } from "@/lib/climoptix";
import { previewScene, CFD_SELECTION_COLOUR } from "@/lib/climoptixPreview";

export function CFDProbeMarker({point,index,selected,onSelect,onMove}:{point:Vec3;index:number;selected:boolean;onSelect:()=>void;onMove:(point:Vec3)=>void}) {
  const {camera,gl,get,invalidate}=useThree();
  const [preview,setPreview]=useState<Vec3|null>(null);
  const drag=useRef<{id:number;plane:Plane;offset:Vector3;point:Vec3;controls:{enabled:boolean}|null;enabled:boolean}|null>(null);
  const finish=(commit:boolean)=>{
    const current=drag.current;if(!current)return;
    drag.current=null;if(current.controls)current.controls.enabled=current.enabled;
    setPreview(null);invalidate();if(commit&&current.point.some((value,i)=>Math.abs(value-point[i])>1e-6))onMove(current.point);
  };
  const finishRef=useRef(finish);useEffect(()=>{finishRef.current=finish;});
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{if(event.key==="Escape"&&drag.current){event.preventDefault();event.stopImmediatePropagation();finishRef.current(false);}};
    window.addEventListener("keydown",key,true);return()=>{window.removeEventListener("keydown",key,true);const current=drag.current;if(current?.controls)current.controls.enabled=current.enabled;};
  },[]);
  const hit=(event:ReactPointerEvent,plane:Plane)=>{
    const box=gl.domElement.getBoundingClientRect(),ray=new Raycaster();
    ray.setFromCamera(new Vector2((event.clientX-box.left)/box.width*2-1,-(event.clientY-box.top)/box.height*2+1),camera);
    return ray.ray.intersectPlane(plane,new Vector3());
  };
  return <mesh name={`probe:${index}`} position={previewScene(preview??point)} onPointerDown={event=>{if(event.button===0){event.stopPropagation();onSelect();}}}>
    <sphereGeometry args={[selected ? .045 : .03,12,8]}/><meshBasicMaterial color={selected?CFD_SELECTION_COLOUR:"#246ccb"} depthTest={false}/>
    <Html center zIndexRange={[8,0]}><button className="cfx-probe-marker" aria-label={`Select probe ${index+1} in 3D`} aria-pressed={selected} title="Drag to move · arrows: X/Y · Page Up/Down: Z · Esc cancels" style={{background:selected?CFD_SELECTION_COLOUR:"#246ccb"}}
      onPointerDown={event=>{
        event.stopPropagation();if(event.button!==0||!event.isPrimary)return;
        onSelect();const position=new Vector3(...previewScene(point)),plane=new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()),position),picked=hit(event,plane);
        if(!picked)return;
        const orbit=get().controls as unknown as {enabled:boolean}|null;
        drag.current={id:event.pointerId,plane,offset:position.sub(picked),point,controls:orbit,enabled:orbit?.enabled??false};
        if(orbit)orbit.enabled=false;event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={event=>{
        const current=drag.current;if(!current||current.id!==event.pointerId)return;event.stopPropagation();const picked=hit(event,current.plane);if(!picked)return;picked.add(current.offset);
        const next:Vec3=[picked.x*1000,-picked.z*1000,picked.y*1000];
        if(next.every(value=>Number.isFinite(value)&&Math.abs(value)<=1e7)){current.point=next;setPreview(next);invalidate();}
      }} onPointerUp={event=>{event.stopPropagation();if(drag.current?.id===event.pointerId)finish(true);}} onPointerCancel={()=>finish(false)} onLostPointerCapture={()=>finish(false)}
      onClick={event=>{event.stopPropagation();onSelect();}} onKeyDown={event=>{
        const axis=({ArrowLeft:0,ArrowRight:0,ArrowDown:1,ArrowUp:1,PageDown:2,PageUp:2} as Record<string,number>)[event.key];
        if(axis===undefined)return;event.preventDefault();event.stopPropagation();const next=[...point] as Vec3;
        next[axis]+=(event.altKey?1:event.shiftKey?100:10)*(["ArrowLeft","ArrowDown","PageDown"].includes(event.key)?-1:1);onSelect();onMove(next);
      }}>P{index+1}</button></Html>
  </mesh>;
}
