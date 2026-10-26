"use client";

import { useEffect, useRef, useState } from "react";
import { downloadCFD } from "@/lib/climoptix";
import { probeNumber } from "@/lib/cfdPointProbe";
import { inPlaneAxes, slicePlotQuantity, type SliceData, type defaultLegend } from "@/lib/cfdSlices";

export interface SliceView {zoom:number;x:number;y:number}
export const resetSliceView:SliceView={zoom:1,x:.5,y:.5};
export function sliceColour(value:number,low:number,high:number,palette:string,bands=0):[number,number,number] {
  let f=high>low?Math.max(0,Math.min(1,(value-low)/(high-low))):.5;
  // Diverging palette places neutral at physical zero, including asymmetric scales.
  if(palette==="coolwarm"&&low<0&&high>0)f=value<=0?.5*(value-low)/-low:.5+.5*value/high;
  f=Math.max(0,Math.min(1,f));if(bands>1)f=Math.round(f*(bands-1))/(bands-1);
  const stops=palette==="grey"?[[40,45,50],[150,155,160],[245,245,245]]:palette==="viridis"?[[68,1,84],[33,145,140],[253,231,37]]:[[45,95,185],[240,240,235],[190,50,45]];
  f=Math.max(0,Math.min(1,f));const step=f<=.5?0:1,t=f<=.5?f*2:(f-.5)*2;
  return stops[step].map((v,i)=>Math.round(v+(stops[step+1][i]-v)*t)) as [number,number,number];
}

export function CFDSlicePlot({title,kind,axis,physicalCoordinate,data,values,legend,limits,view,onView,point,probing,hover,onPick,onFocus,focus}:{title:string;kind:string;axis:"X"|"Y"|"Z";physicalCoordinate?:number;data:SliceData|null;values?:(number|null)[]|null;legend:typeof defaultLegend;limits:[number,number];view:SliceView;onView:(v:SliceView)=>void;point:[number,number,number]|null;probing:boolean;hover:boolean;onPick:(p:[number,number,number])=>void;onFocus:()=>void;focus:boolean}) {
  const canvas=useRef<HTMLCanvasElement>(null),gesture=useRef<{id:number;x:number;y:number;view:SliceView}|null>(null);
  const hasValues=values?.some(value=>value!==null)??false;
  // The manifest also supplies this for older workers without option coordinates.
  const coordinate=physicalCoordinate??(kind==="option"?data?.option?.coordinate:data?.coordinate);
  const [dimensions,setDimensions]=useState({width:640,height:420}),[theme,setTheme]=useState(0);
  const [a,b]=inPlaneAxes(axis),[lowX,lowY,highX,highY]=data?.bounds??[0,0,1,1],size=data?.size??1;
  const width=dimensions.width,height=dimensions.height;
  const usableWidth=Math.max(1,width-72),usableHeight=Math.max(1,height-132),plotTop=42;
  const factor=Math.min(usableWidth/(highX-lowX),usableHeight/(highY-lowY))*view.zoom;
  const imageWidth=(highX-lowX)*factor,imageHeight=(highY-lowY)*factor;
  const imageX=52+usableWidth/2-view.x*imageWidth,imageY=plotTop+usableHeight/2-(1-view.y)*imageHeight;
  useEffect(()=>{const node=canvas.current;if(!node)return;const observer=new ResizeObserver(entries=>{const b=entries[0].contentRect;setDimensions({width:Math.max(1,b.width),height:Math.max(1,b.height)});});observer.observe(node);return()=>observer.disconnect();},[]);
  useEffect(()=>{const observer=new MutationObserver(()=>setTheme(n=>n+1));observer.observe(document.documentElement,{attributes:true,attributeFilter:["class","style","data-theme"]});return()=>observer.disconnect();},[]);
  useEffect(()=>{const node=canvas.current;if(!node)return;const wheel=(event:WheelEvent)=>{if(document.activeElement!==node)return;event.preventDefault();onView({...view,zoom:Math.max(.5,Math.min(12,view.zoom*Math.exp(-event.deltaY*.001)))});};node.addEventListener("wheel",wheel,{passive:false});return()=>node.removeEventListener("wheel",wheel);},[view,onView]);
  useEffect(()=>{
    const node=canvas.current,ctx=node?.getContext("2d");if(!node||!ctx)return;
    const scale=Math.min(window.devicePixelRatio||1,2);node.width=Math.round(width*scale);node.height=Math.round(height*scale);ctx.scale(scale,scale);
    const style=getComputedStyle(node),ink=style.color,background=style.getPropertyValue("--paper").trim()||"#fff";
    ctx.fillStyle=background;ctx.fillRect(0,0,width,height);ctx.fillStyle=ink;ctx.font="600 12px sans-serif";
    const quantity=slicePlotQuantity(data,kind);
    ctx.fillText(`${kind==="delta"?data?.definition??"Option − Baseline":kind} · ${quantity}`,12,16,width-24);
    const run=kind==="option"?data?.option:data?.baseline;
    ctx.font="10px sans-serif";ctx.fillText(`${axis} = ${coordinate===undefined?"—":probeNumber(coordinate)} m · output ${run?.time??"—"} · run ${run?.run.slice(0,8)??"—"}`,12,31,width-24);
    ctx.save();ctx.beginPath();ctx.rect(52,plotTop,usableWidth,usableHeight);ctx.clip();
    ctx.fillStyle="#89929a";ctx.globalAlpha=.18;ctx.fillRect(52,plotTop,usableWidth,usableHeight);ctx.globalAlpha=1;
    if(values&&data?.size){
      const off=document.createElement("canvas");off.width=off.height=size;const oc=off.getContext("2d")!,pixels=oc.createImageData(size,size);
      values.forEach((v,i)=>{const x=i%size,y=size-1-Math.floor(i/size),at=(x+y*size)*4;if(v===null)return;const rgb=sliceColour(v,limits[0],limits[1],legend.palette,legend.bands);pixels.data.set([...rgb,255],at);});
      oc.putImageData(pixels,0,0);ctx.imageSmoothingEnabled=false;ctx.drawImage(off,imageX,imageY,imageWidth,imageHeight);
    }
    if(point&&coordinate!==undefined&&Math.abs(point["XYZ".indexOf(axis)]-coordinate)<1e-7){const x=imageX+(point[a]-lowX)*factor,y=imageY+imageHeight-(point[b]-lowY)*factor;ctx.strokeStyle="#ff7900";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x-9,y);ctx.lineTo(x+9,y);ctx.moveTo(x,y-9);ctx.lineTo(x,y+9);ctx.stroke();ctx.strokeRect(x-4,y-4,8,8);}
    ctx.restore();ctx.fillStyle=ink;ctx.font="11px sans-serif";
    const fmt=(v:number)=>v&&Math.abs(v)<10**-legend.precision?v.toExponential(legend.precision):v.toFixed(legend.precision);
    ctx.fillText(`${"XYZ"[a]} → [m]`,width/2-30,height-61);ctx.save();ctx.translate(12,height/2);ctx.rotate(-Math.PI/2);ctx.fillText(`${"XYZ"[b]} → [m]`,0,0);ctx.restore();
    ctx.fillText(fmt(lowX+(52-imageX)/factor),50,height-77);ctx.textAlign="right";ctx.fillText(fmt(lowX+(52+usableWidth-imageX)/factor),width-20,height-77);ctx.textAlign="left";
    ctx.textAlign="right";ctx.fillText(fmt(lowY+(imageY+imageHeight-plotTop)/factor),46,plotTop+11);ctx.fillText(fmt(lowY+(imageY+imageHeight-(plotTop+usableHeight))/factor),46,plotTop+usableHeight);ctx.textAlign="left";
    if(hasValues){for(let x=0;x<usableWidth;x++){ctx.fillStyle=`rgb(${sliceColour(limits[0]+x/usableWidth*(limits[1]-limits[0]),...limits,legend.palette,legend.bands).join(",")})`;ctx.fillRect(52+x,height-48,1,10);}
    ctx.fillStyle=ink;if(limits[0]===limits[1]){ctx.textAlign="center";ctx.fillText(`${fmt(limits[0])} (constant)`,52+usableWidth/2,height-24);}else for(let i=0;i<legend.ticks;i++){const f=i/(legend.ticks-1);ctx.textAlign=i===0?"left":i===legend.ticks-1?"right":"center";ctx.fillText(fmt(limits[0]+f*(limits[1]-limits[0])),52+f*usableWidth,height-24);}}else{ctx.fillStyle=ink;ctx.fillText("No finite numeric samples",52,height-30);}
    ctx.textAlign="left";ctx.fillText(`${kind==="delta"?data?.deltaUnit??"":data?.unit??""} · grey = no valid sample`,52,height-7);
  },[data,values,hasValues,title,kind,axis,coordinate,legend,limits,point,width,height,a,b,lowX,lowY,factor,imageX,imageY,imageWidth,imageHeight,usableWidth,usableHeight,size,theme,plotTop]);
  const physical=(x:number,y:number):[number,number,number]=>{const p:[number,number,number]=[coordinate??0,coordinate??0,coordinate??0];p[a]=lowX+(x-imageX)/factor;p[b]=lowY+(imageY+imageHeight-y)/factor;return p;};
  const insidePlot=(x:number,y:number)=>x>=52&&x<=52+usableWidth&&y>=plotTop&&y<=plotTop+usableHeight;
  return <section className="cfx-slice-pane" aria-label={title} data-slice-pane={kind} data-coordinate={coordinate}>
    <header><strong title={title}>{title}</strong><button type="button" onClick={onFocus}>{focus?"Show all panes":`Focus ${kind}`}</button></header>
    <canvas ref={canvas} tabIndex={0} aria-label={`${title} physical slice, horizontal ${"XYZ"[a]}, vertical ${"XYZ"[b]} in metres`} data-slice-view={JSON.stringify(view)} data-limits={JSON.stringify(limits)} data-probing={probing||undefined}
      onPointerDown={e=>{const b=e.currentTarget.getBoundingClientRect();if(e.button!==0||!e.isPrimary||!insidePlot(e.clientX-b.left,e.clientY-b.top))return;e.currentTarget.focus({preventScroll:true});e.currentTarget.setPointerCapture(e.pointerId);gesture.current={id:e.pointerId,x:e.clientX,y:e.clientY,view};}}
      onPointerMove={e=>{if(!e.isPrimary)return;const start=gesture.current,b=e.currentTarget.getBoundingClientRect();if(start&&start.id===e.pointerId){if(Math.hypot(e.clientX-start.x,e.clientY-start.y)>4)onView({...start.view,x:start.view.x-(e.clientX-start.x)/imageWidth,y:start.view.y+(e.clientY-start.y)/imageHeight});}else if(probing&&hover&&insidePlot(e.clientX-b.left,e.clientY-b.top))onPick(physical(e.clientX-b.left,e.clientY-b.top));}}
      onPointerUp={e=>{const start=gesture.current;if(!start||start.id!==e.pointerId)return;gesture.current=null;if(e.button===0&&Math.hypot(e.clientX-start.x,e.clientY-start.y)<=4&&probing){const b=e.currentTarget.getBoundingClientRect();onPick(physical(e.clientX-b.left,e.clientY-b.top));}}}
      onPointerCancel={e=>{if(gesture.current?.id===e.pointerId)gesture.current=null;}} onLostPointerCapture={e=>{if(gesture.current?.id===e.pointerId)gesture.current=null;}}/>
    {!hasValues&&<p className="cfx-caption">{data?"No comparable numeric samples in this pane.":"Choose a ready numeric plane. Loading never reuses an earlier selection's contours."}</p>}
    <footer><button type="button" onClick={()=>onView({...view,zoom:Math.min(12,view.zoom*1.4)})}>Zoom in {kind}</button><button type="button" onClick={()=>onView({...view,zoom:Math.max(.5,view.zoom/1.4)})}>Zoom out {kind}</button><button type="button" disabled={!hasValues} onClick={()=>{canvas.current?.toBlob(blob=>{if(blob)downloadCFD(blob,`cfd-${kind}.png`);});}}>Download {kind} PNG</button></footer>
  </section>;
}
