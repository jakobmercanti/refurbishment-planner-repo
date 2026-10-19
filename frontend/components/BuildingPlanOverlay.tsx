"use client";
import { forwardRef, useEffect, useEffectEvent, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Point2D } from "@/lib/types";
import type { FloorContent, FloorOpening, RoofConfiguration } from "@/lib/buildingDocument";
import { structuralFloorFootprint, roofFrame, validateFloorOpening } from "@/lib/buildingGeometry";
import { formatLength, type DisplayUnits } from "@/lib/units";
import { closeOpeningDraft, moveOpeningVertex, openingDraftPoint } from "@/lib/floorOpeningDraft";
import type { FloorOpeningTool } from "./BuildingControls";
export interface BuildingPlanHandle { down:(e:ReactPointerEvent<SVGSVGElement>)=>void; move:(e:ReactPointerEvent<SVGSVGElement>)=>void }
const rectangle=(a:Point2D,b:Point2D)=>[{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y)},{x:Math.max(a.x,b.x),y:Math.min(a.y,b.y)},{x:Math.max(a.x,b.x),y:Math.max(a.y,b.y)},{x:Math.min(a.x,b.x),y:Math.max(a.y,b.y)}];
export const BuildingPlanOverlay=forwardRef<BuildingPlanHandle,{
  content:FloorContent;openings:FloorOpening[];tool:FloorOpeningTool;onTool:(tool:FloorOpeningTool)=>void;selected:string|null;onSelect:(id:string|null)=>void;
  onChange:(openings:FloorOpening[])=>void;onError:(message:string)=>void;toScreen:(p:Point2D)=>Point2D;fromClient:(x:number,y:number,svg:SVGSVGElement)=>Point2D;units:DisplayUnits;finishRequest:number;roof?:RoofConfiguration;interactive?:boolean;keepSquare?:boolean;
}>(function BuildingPlanOverlay({content,openings,tool,onTool,selected,onSelect,onChange,onError,toScreen,fromClient,units,finishRequest,roof,interactive=true,keepSquare=true},ref){
  const [draft,setDraft]=useState<Point2D[]>([]),[cursor,setCursor]=useState<Point2D|null>(null),[preview,setPreview]=useState<{id:string;vertices:Point2D[]}|null>(null);
  const drag=useRef<{opening:FloorOpening;start:Point2D;vertex?:number;vertices:Point2D[]}|null>(null),previousFinish=useRef(finishRequest);
  const commit=(vertices:Point2D[],shape:FloorOpening["shape"])=>{
    const o:FloorOpening={id:crypto.randomUUID(),name:`Floor opening ${openings.length+1}`,shape,vertices};
    try{validateFloorOpening(content,o,openings);onError("");onChange([...openings,o]);onSelect(o.id);onTool(null);setDraft([]);}catch(e){onError(e instanceof Error?e.message:"Invalid floor opening.");}
  };
  const finish=useEffectEvent(()=>{if(tool==="POLYGON")commit(closeOpeningDraft(draft,keepSquare),"POLYGON");});
  useEffect(()=>{if(previousFinish.current!==finishRequest){previousFinish.current=finishRequest;finish();}},[finishRequest]);
  const [lastTool,setLastTool]=useState(tool);
  if(lastTool!==tool){setLastTool(tool);setDraft([]);setCursor(null);}
  const keyboard=useEffectEvent((e:KeyboardEvent)=>{
    if(!interactive&&!tool)return;
    if(e.target instanceof Element&&e.target.closest("input,select,textarea,[contenteditable],button,.floating-toolbar,[role=dialog],dialog"))return;
    if(tool&&e.key==="Escape"){e.preventDefault();e.stopImmediatePropagation();onTool(null);setDraft([]);onError("");}
    if(tool==="POLYGON"&&(e.key==="Enter"||e.key==="Return")){e.preventDefault();e.stopImmediatePropagation();finish();}
    if(tool==="POLYGON"&&(e.key==="Backspace"||e.key==="Delete")){e.preventDefault();e.stopImmediatePropagation();setDraft(points=>points.slice(0,-1));setCursor(null);onError("");}
    if(!tool&&selected&&(e.key==="Delete"||e.key==="Backspace")){e.preventDefault();e.stopImmediatePropagation();onChange(openings.filter(o=>o.id!==selected));onSelect(null);}
  });
  useEffect(()=>{const handler=(e:KeyboardEvent)=>keyboard(e);window.addEventListener("keydown",handler,true);return()=>window.removeEventListener("keydown",handler,true);},[]);
  useImperativeHandle(ref,()=>({
    down(e){if(e.button!==0)return;e.preventDefault();e.stopPropagation();e.currentTarget.setAttribute("tabindex","-1");e.currentTarget.focus({preventScroll:true});const raw=fromClient(e.clientX,e.clientY,e.currentTarget),p=tool==="POLYGON"?openingDraftPoint(draft,raw,keepSquare):raw;
      if(tool==="RECTANGLE"&&draft.length){commit(rectangle(draft[0],p),"RECTANGLE");return;}
      if(tool==="POLYGON"&&draft.length>=3){const a=toScreen(draft[0]),b=toScreen(raw);if(Math.hypot(a.x-b.x,a.y-b.y)<10){commit(closeOpeningDraft(draft,keepSquare),"POLYGON");return;}}
      if(draft.length<200)setDraft([...draft,p]);setCursor(p);
    },
    move(e){const p=fromClient(e.clientX,e.clientY,e.currentTarget);setCursor(tool==="POLYGON"?openingDraftPoint(draft,p,keepSquare):p);}
  }));
  const path=(points:Point2D[])=>points.map(p=>{const s=toScreen(p);return `${s.x},${s.y}`;}).join(" ");
  const begin=(e:ReactPointerEvent<SVGElement>,opening:FloorOpening,vertex?:number)=>{
    if(e.button!==0||tool||!interactive)return;e.preventDefault();e.stopPropagation();onSelect(opening.id);
    drag.current={opening,start:fromClient(e.clientX,e.clientY,e.currentTarget.ownerSVGElement!),vertex,vertices:opening.vertices};
    e.currentTarget.closest<SVGGElement>("[data-floor-openings]")?.setPointerCapture(e.pointerId);
  };
  const outline=tool==="RECTANGLE"&&draft[0]&&cursor?rectangle(draft[0],cursor):[...draft,...(cursor?[cursor]:[])];
  return <g data-floor-openings="true" data-floor-opening-interactive={interactive||tool?"true":undefined} pointerEvents={interactive||tool?"auto":"none"} opacity={interactive||tool?1:.42} onPointerMove={e=>{
    const d=drag.current;if(!d)return;e.preventDefault();e.stopPropagation();const p=fromClient(e.clientX,e.clientY,e.currentTarget.ownerSVGElement!);
    if(d.vertex===undefined)d.vertices=d.opening.vertices.map(v=>({x:v.x+p.x-d.start.x,y:v.y+p.y-d.start.y}));
    else if(d.opening.shape==="RECTANGLE")d.vertices=rectangle(p,d.opening.vertices[(d.vertex+2)%4]);
    else d.vertices=moveOpeningVertex(d.opening.vertices,d.vertex,p,keepSquare);
    setPreview({id:d.opening.id,vertices:d.vertices});
  }} onPointerUp={e=>{
    const d=drag.current;if(!d)return;e.preventDefault();e.stopPropagation();try{const updated={...d.opening,vertices:d.vertices};validateFloorOpening(content,updated,openings);onError("");onChange(openings.map(o=>o.id===updated.id?updated:o));}catch(error){onError(error instanceof Error?error.message:"Cannot move this opening.");}drag.current=null;setPreview(null);
  }} onPointerCancel={()=>{drag.current=null;setPreview(null);}}>
    {openings.map(o=>{const vertices=preview?.id===o.id?preview.vertices:o.vertices,centre=vertices.reduce((s,p)=>({x:s.x+p.x/vertices.length,y:s.y+p.y/vertices.length}),{x:0,y:0}),label=toScreen(centre);return <g key={o.id} data-floor-opening-id={o.id} role="button" tabIndex={interactive?0:-1} aria-disabled={!interactive} aria-label={`Floor opening: ${o.name}`} onKeyDown={e=>{if(interactive&&(e.key==="Enter"||e.key===" ")){e.preventDefault();e.stopPropagation();onSelect(o.id);}}}>
      <polygon points={path(vertices)} className={selected===o.id?"floor-opening-contour selected":"floor-opening-contour"} onPointerDown={e=>begin(e,o)}/><text className="floor-opening-name" x={label.x} y={label.y} textAnchor="middle" pointerEvents="none">{o.name} · VOID</text>
      {interactive&&selected===o.id&&vertices.map((v,i)=>{const s=toScreen(v);return <circle key={i} role="button" aria-label={`Move opening vertex ${i+1}`} cx={s.x} cy={s.y} r="5" className="floor-opening-handle" onPointerDown={e=>begin(e,o,i)}/>;})}
    </g>;})}
    {tool&&outline.length>0&&<g pointerEvents="none"><polygon points={path(outline)} className="floor-opening-draft"/>{outline.map((p,i)=>{const s=toScreen(p);return <circle key={i} cx={s.x} cy={s.y} r="3" fill="var(--accent)"/>;})}{cursor&&<text className="floor-opening-name" x={toScreen(cursor).x+8} y={toScreen(cursor).y-10}>{tool==="RECTANGLE"&&draft[0]?`${formatLength(Math.abs(cursor.x-draft[0].x),units)} × ${formatLength(Math.abs(cursor.y-draft[0].y),units)}`:`${draft.length} vertices · Enter to finish`}</text>}</g>}
    {roof&&<RoofPlanIndicator content={content} roof={roof} toScreen={toScreen}/>}
  </g>;
});
function RoofPlanIndicator({content,roof,toScreen}:{content:FloorContent;roof:RoofConfiguration;toScreen:(p:Point2D)=>Point2D}) {
  const footprint=structuralFloorFootprint(content);if(!footprint.length||roof.enabled===false||roof.type==="FLAT")return null;
  const f=roofFrame(footprint,roof),u=roof.type==="STEPPED"?f.min+(f.max-f.min)*roof.splitFraction:(f.min+f.max)/2,v=(f.vmin+f.vmax)/2;
  const at=(u:number,v:number)=>toScreen({x:u*f.ux-v*f.uy,y:u*f.uy+v*f.ux});
  const a=roof.type==="MONO"?at(f.min,v):at(u,f.vmin),b=roof.type==="MONO"?at(f.max,v):at(u,f.vmax);
  return <g className="roof-plan-indicator" pointerEvents="none" data-roof-profile={roof.type}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y}/><circle cx={b.x} cy={b.y} r="3"/><text x={(a.x+b.x)/2+6} y={(a.y+b.y)/2-8}>{roof.type==="GABLE"?"Roof ridge":roof.type==="STEPPED"?"Roof step":"Roof slope →"}</text></g>;
}
