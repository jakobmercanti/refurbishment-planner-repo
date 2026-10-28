"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type vtkActor from "@kitware/vtk.js/Rendering/Core/Actor";
import type vtkMapper from "@kitware/vtk.js/Rendering/Core/Mapper";
import type vtkColorTransferFunction from "@kitware/vtk.js/Rendering/Core/ColorTransferFunction";
import type vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData";
import type vtkImageData from "@kitware/vtk.js/Common/DataModel/ImageData";
import { readResultData, volumeSlice, type ResultData, type ResultField } from "@/lib/cfdResultData";
import { downloadCFD } from "@/lib/climoptix";
import { CFDNumber } from "./CFDFields";
import { CFDPointProbeControls, CFDPointProbeValue, useCFDPointProbe } from "./CFDPointProbeControls";
import { useViewerContextMenu } from "@/lib/viewerNavigation";
import type { ReactNode } from "react";
import { CFDFloatingControls } from "./CFDFloatingControls";
import { CFDViewerFrame } from "./CFDViewerFrame";
import { CFDPlaneContextMenu, type PlaneMenu } from "./CFDPlaneContextMenu";
import { intersectResultPlane, resultProbeMesh, sampleResultPoint, type ProbeMesh, type ProbePosition, type ResultPointValue } from "@/lib/cfdPointProbe";

const EMPTY_FILES:File[]=[];
interface Options { visible:boolean; opacity:number; wire:boolean; field:string; component:number; low:number; high:number; palette:string; mode:"slice"|"iso"; axis:number; index:number; iso:number }
interface Layer { id:string; name:string; fields:ResultField[]; volume:boolean; dims:number[]; options:Options; status:string }
export interface ResultContext { id:string; name:string; points:number[] }
interface View { project:(point:ProbePosition)=>{x:number;y:number}|null; hit:(x:number,y:number)=>string|null; apply:(id:string,options:Options)=>Promise<void>; visibility:(id:string,visible:boolean)=>void; fit:()=>void; zoom:(factor:number)=>void; direction:(axis:number)=>void;
  pick:(id:string,x:number,y:number,field:string,component:number)=>ResultPointValue|null }
const palettes:Record<string,number[][]>={coolwarm:[[.15,.3,.75],[.1,.8,.65],[.9,.25,.1]],viridis:[[.267,.005,.329],[.128,.567,.551],[.993,.906,.144]],grey:[[.1,.1,.1],[.5,.5,.5],[.95,.95,.95]]};

export function CFDResultsViewer({file,additionalFiles=EMPTY_FILES,context,provenance,onClose,onRemoveFile,probeRequest=0,viewMode="3d",compact=false,embedded=false,toolbar,onPlaneStep,previousPlane,nextPlane}:{compact?:boolean;embedded?:boolean;toolbar?:ReactNode;onPlaneStep?:(direction:-1|1)=>void;previousPlane?:boolean;nextPlane?:boolean;file:File;additionalFiles?:File[];context?:ResultContext[];provenance?:string;onClose:()=>void;onRemoveFile?:(file:File)=>void;probeRequest?:number;viewMode?:"2d"|"3d"}){
  const host=useRef<HTMLDivElement>(null), view=useRef<View|null>(null);
  const [layers,setLayers]=useState<Layer[]>([]),[error,setError]=useState(""),[warnings,setWarnings]=useState<string[]>([]),[loading,setLoading]=useState(true);
  const active="0"; // The Results plane dropdown owns the inspected/loaded plane.
  const [planeMenu,setPlaneMenu]=useState<PlaneMenu|null>(null);
  const files=useMemo(()=>[file,...additionalFiles],[file,additionalFiles]);
  const planeContext=useViewerContextMenu(target=>!!target.closest(".cfx-vtk-canvas"),({x,y})=>{
    if(!onRemoveFile)return;
    const id=view.current?.hit(x,y),picked=id!=null?files[Number(id)]:undefined;
    if(picked)setPlaneMenu({file:picked,x,y});
  },()=>setPlaneMenu(null));
  const [contextVisible,setContextVisible]=useState<Record<string,boolean>>({});
  const prior=useRef<{file:File;position:number[];target:number[];up:number[]}|null>(null);
  useEffect(()=>{
    let cancelled=false;const owned:{delete:()=>void}[]=[], cleanup:(()=>void)[]=[];
    const runtimes=new Map<string,{loaded:ResultData;actor:vtkActor;mapper:vtkMapper;colours:vtkColorTransferFunction;temporary?:vtkPolyData;generation:number}>();
    const probeMeshes=new WeakMap<vtkPolyData,ProbeMesh>();
    const release=()=>{view.current=null;cleanup.splice(0).reverse().forEach(fn=>fn());owned.splice(0).reverse().forEach(item=>item.delete());};
    void(async()=>{
      if(files.length>8||files.reduce((size,item)=>size+item.size,0)>64*1024**2)throw new Error("Load at most 8 result layers totalling 64 MB.");
      const [windowModule,mapperModule,actorModule,colourModule,polyModule]=await Promise.all([
        import("@kitware/vtk.js/Rendering/Misc/GenericRenderWindow"),import("@kitware/vtk.js/Rendering/Core/Mapper"),import("@kitware/vtk.js/Rendering/Core/Actor"),
        import("@kitware/vtk.js/Rendering/Core/ColorTransferFunction"),import("@kitware/vtk.js/Common/DataModel/PolyData"),import("@kitware/vtk.js/Rendering/Profiles/Geometry")]);
      if(cancelled||!host.current)return;
      setLoading(true);setError("");setWarnings([]);setLayers([]);setContextVisible({});
      const win=windowModule.default.newInstance({listenWindowResize:false}), container=host.current;
      owned.push(win.getRenderWindow(),win.getRenderer(),win.getInteractor(),win);win.setContainer(container);
      const renderer=win.getRenderer(),camera=renderer.getActiveCamera(), render=()=>win.getRenderWindow().render();
      if(viewMode==="2d"){
        const [styleModule,panModule,zoomModule]=await Promise.all([import("@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator"),import("@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballPanManipulator"),import("@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomManipulator")]);
        if(cancelled)return;
        const style=styleModule.default.newInstance(),pan=panModule.default.newInstance({button:1}),zoom=zoomModule.default.newInstance({button:3,scrollEnabled:true});
        owned.push(style,pan,zoom);style.addMouseManipulator(pan);style.addMouseManipulator(zoom);win.getInteractor().setInteractorStyle(style);
      }
      camera.setViewUp(0,0,1);camera.setPosition(1,-1,1);
      const colourBackground=()=>{const rgb=getComputedStyle(container.parentElement??container).backgroundColor.match(/[\d.]+/g)?.slice(0,3).map(Number)??[235,240,237];renderer.setBackground(rgb[0]/255,rgb[1]/255,rgb[2]/255);};
      colourBackground();
      const resize=new ResizeObserver(()=>win.resize());resize.observe(container);cleanup.push(()=>resize.disconnect());
      const theme=new MutationObserver(()=>{colourBackground();render();});theme.observe(document.documentElement,{attributes:true,attributeFilter:["data-theme","class","style"]});cleanup.push(()=>theme.disconnect());
      const apply:View["apply"]=async(id,options)=>{
        const runtime=runtimes.get(id);if(!runtime||cancelled)return;const generation=++runtime.generation;
        setLayers(current=>current.map(item=>item.id===id?{...item,status:"Updating display…"}:item));
        const {loaded,actor,mapper,colours}=runtime, field=loaded.fields.find(item=>item.key===options.field);
        let data: vtkPolyData;
        if(loaded.volume){
          const image=loaded.data as vtkImageData;
          if(options.mode==="iso"){
            if(!field||field.cell||field.components!==1)throw new Error("Isosurfaces need a scalar point field in a real .vti volume.");
            if(image.getNumberOfCells()>50000)throw new Error("For interactive isosurfaces, export a volume of at most 50,000 cells. Grid slices remain available.");
            const contourModule=await import("@kitware/vtk.js/Filters/General/ImageMarchingCubes");if(cancelled||generation!==runtime.generation)return;
            const scalars=image.getPointData().getArrayByName(field.name);if(!scalars)throw new Error("Scalar field is unavailable in this volume.");image.getPointData().setScalars(scalars);
            const filter=contourModule.default.newInstance({contourValue:options.iso,mergePoints:true,computeNormals:true});
            try{filter.setInputData(image);filter.update();data=filter.getOutputData();}finally{filter.delete();}
          }else data=await volumeSlice(image,options.axis,options.index);
          if(cancelled||generation!==runtime.generation){data.delete();return;}
          const previous=runtime.temporary;runtime.temporary=data;mapper.setInputData(data);previous?.delete();
        }else{data=loaded.data as vtkPolyData;mapper.setInputData(data);}
        actor.setVisibility(options.visible);actor.getProperty().setOpacity(options.opacity);
        if(options.wire)actor.getProperty().setRepresentationToWireframe();else actor.getProperty().setRepresentationToSurface();
        actor.getProperty().setLighting(!field||options.mode==="iso");
        if(!field||(loaded.volume&&options.mode==="iso")){mapper.setScalarVisibility(false);actor.getProperty().setColor(1,.48,.05);}
        else{
          if(!Number.isFinite(options.low)||!Number.isFinite(options.high)||options.low>=options.high)throw new Error("Legend minimum must be smaller than maximum.");
          colours.removeAllPoints();const coloursAt=palettes[options.palette]??palettes.coolwarm;
          coloursAt.forEach((rgb,i)=>colours.addRGBPoint(options.low+(options.high-options.low)*i/2,rgb[0],rgb[1],rgb[2]));
          if(options.component<0)colours.setVectorModeToMagnitude();else{colours.setVectorModeToComponent();colours.setVectorComponent(options.component);}
          mapper.setLookupTable(colours);mapper.setColorByArrayName(field.name);if(field.cell)mapper.setScalarModeToUseCellFieldData();else mapper.setScalarModeToUsePointFieldData();
          mapper.setScalarRange(options.low,options.high);mapper.setColorModeToMapScalars();mapper.setScalarVisibility(true);
        }
        render();if(!cancelled)setLayers(current=>current.map(item=>item.id===id?{...item,status:`${data.getNumberOfPoints().toLocaleString()} points · ${data.getNumberOfCells().toLocaleString()} ${data.getNumberOfCells()===1?"cell":"cells"}`}:item));
      };
      const next:Layer[]=[], notices:string[]=[];
      for(let index=0;index<files.length;index++){
        const loaded=await readResultData(files[index]);if(cancelled){loaded.dispose();return;}
        cleanup.push(loaded.dispose);notices.push(...loaded.warnings.map(warning=>`${files[index].name}: ${warning}`));
        const actor=actorModule.default.newInstance(),mapper=mapperModule.default.newInstance(),colours=colourModule.default.newInstance();owned.push(mapper,actor,colours);actor.setMapper(mapper);renderer.addActor(actor);cleanup.push(()=>renderer.removeActor(actor));
        const id=String(index), dims=loaded.volume?(loaded.data as vtkImageData).getDimensions():[0,0,0],field=loaded.fields.find(item=>!item.cell)??loaded.fields[0];
        const low=field?.range[0]??0, high=field?.range[1]??1;
        const options:Options={visible:true,opacity:1,wire:false,field:field?.key??"",component:-1,low,high:high>low?high:low+Math.max(1,Math.abs(low))*1e-6,palette:"coolwarm",mode:"slice",axis:2,index:Math.floor((dims[2]-1)/2),iso:(low+high)/2};
        runtimes.set(id,{loaded,actor,mapper,colours,generation:0});cleanup.push(()=>runtimes.get(id)?.temporary?.delete());
        next.push({id,name:files[index].name,fields:loaded.fields,volume:loaded.volume,dims,options,status:`${loaded.data.getNumberOfPoints()} points · ${loaded.data.getNumberOfCells()} ${loaded.data.getNumberOfCells()===1?"cell":"cells"}`});
        await apply(id,options);if(cancelled)return;
        const displayed=runtimes.get(id)?.temporary??loaded.data;
        next[next.length-1].status=`${displayed.getNumberOfPoints()} points · ${displayed.getNumberOfCells()} ${displayed.getNumberOfCells()===1?"cell":"cells"}`;
      }
      const contextActors=new Map<string,vtkActor>();
      for(const object of context?.slice(0,100)??[]){
        const poly=polyModule.default.newInstance(),mapper=mapperModule.default.newInstance(),actor=actorModule.default.newInstance();owned.push(poly,mapper,actor);
        poly.getPoints().setData(Float32Array.from(object.points),3);const cells:number[]=[];for(let i=0;i<object.points.length/3;i+=3)cells.push(3,i,i+1,i+2);poly.getPolys().setData(Uint32Array.from(cells));
        mapper.setInputData(poly);mapper.setScalarVisibility(false);actor.setMapper(mapper);actor.getProperty().setColor(.6,.67,.72);actor.getProperty().setOpacity(.15);actor.setVisibility(false);renderer.addActor(actor);contextActors.set(object.id,actor);cleanup.push(()=>renderer.removeActor(actor));
      }
      view.current={apply,project:point=>{
        const bounds=container.getBoundingClientRect(),p=renderer.worldToNormalizedDisplay(point[0],point[1],point[2],bounds.width/Math.max(1,bounds.height));
        return p[0]>=0&&p[0]<=1&&p[1]>=0&&p[1]<=1?{x:p[0]*bounds.width,y:(1-p[1])*bounds.height}:null;
      },hit:(x,y)=>{
        const bounds=container.getBoundingClientRect();if(!bounds.width||!bounds.height)return null;
        const px=(x-bounds.left)/bounds.width,py=(bounds.bottom-y)/bounds.height,aspect=bounds.width/bounds.height;
        const near=renderer.normalizedDisplayToWorld(px,py,0,aspect) as ProbePosition,far=renderer.normalizedDisplayToWorld(px,py,1,aspect) as ProbePosition;
        let closest=Infinity,selected:string|null=null;
        for(const [id,runtime] of runtimes){
          if(!runtime.actor.getVisibility()||!runtime.actor.getProperty().getOpacity())continue;
          const data=(runtime.temporary??runtime.loaded.data) as vtkPolyData;if(!data.isA("vtkPolyData"))continue;
          let mesh=probeMeshes.get(data);if(!mesh){mesh=resultProbeMesh(data.getPoints().getData(),data.getPolys().getData(),data.getNumberOfVerts()+data.getNumberOfLines(),data.getStrips().getData());probeMeshes.set(data,mesh);}
          const hit=intersectResultPlane(mesh,near,far);if(!hit)continue;
          const distance=hit.position.reduce((sum,value,i)=>sum+(value-near[i])**2,0);if(distance<closest){closest=distance;selected=id;}
        }
        return selected;
      },pick:(id,x,y,key,component)=>{
        const runtime=runtimes.get(id), field=runtime?.loaded.fields.find(item=>item.key===key);
        if(!runtime||!field||!runtime.actor.getVisibility()||!runtime.actor.getProperty().getOpacity())return null;
        const data=(runtime.temporary??runtime.loaded.data) as vtkPolyData;
        if(!data.isA("vtkPolyData"))return null;
        const array=(field.cell?data.getCellData():data.getPointData()).getArrayByName(field.name);
        if(!array)return null;
        let mesh=probeMeshes.get(data);
        if(!mesh){mesh=resultProbeMesh(data.getPoints().getData(),data.getPolys().getData(),data.getNumberOfVerts()+data.getNumberOfLines(),data.getStrips().getData());probeMeshes.set(data,mesh);}
        const bounds=container.getBoundingClientRect();
        if(!bounds.width||!bounds.height)return null;
        const px=(x-bounds.left)/bounds.width,py=(bounds.bottom-y)/bounds.height,aspect=bounds.width/bounds.height;
        const near=renderer.normalizedDisplayToWorld(px,py,0,aspect) as ProbePosition,far=renderer.normalizedDisplayToWorld(px,py,1,aspect) as ProbePosition;
        const hit=intersectResultPlane(mesh,near,far);
        return hit?sampleResultPoint(mesh,hit.triangle,hit.position,field,array.getData(),component):null;
      },visibility:(id,visible)=>{contextActors.get(id)?.setVisibility(visible);render();},fit:()=>{renderer.resetCamera();render();},zoom:factor=>{camera.zoom(factor);render();},direction:axis=>{
        const target=camera.getFocalPoint(),position=camera.getPosition(),distance=Math.hypot(...position.map((value,i)=>value-target[i]));
        const next=[...target];next[axis]+=(viewMode==="2d"&&axis===1?-1:1)*Math.max(distance,1);camera.setPosition(next[0],next[1],next[2]);camera.setViewUp(...(axis===2?[0,1,0]:[0,0,1]) as [number,number,number]);render();
      }};
      if(viewMode==="2d"){
        const runtime=runtimes.get("0"),bounds=(runtime?.temporary??runtime?.loaded.data)?.getBounds();
        const axis=bounds?[0,1,2].reduce((best,i)=>bounds[i*2+1]-bounds[i*2]<bounds[best*2+1]-bounds[best*2]?i:best,0):2;
        camera.setParallelProjection(true);view.current.direction(axis);
      }
      renderer.resetCamera();if(prior.current?.file===file&&viewMode==="3d"){camera.setPosition(...prior.current.position as [number,number,number]);camera.setFocalPoint(...prior.current.target as [number,number,number]);camera.setViewUp(...prior.current.up as [number,number,number]);}
      cleanup.push(()=>{prior.current={file,position:[...camera.getPosition()],target:[...camera.getFocalPoint()],up:[...camera.getViewUp()]};});
      win.resize();render();setLayers(next);setWarnings(notices);setLoading(false);
    })().catch(cause=>{release();if(!cancelled){setError(cause instanceof Error?cause.message:"Cannot inspect these result files.");setLoading(false);}});
    return()=>{cancelled=true;release();};
  },[files,context,file,viewMode]);
  const layer=layers.find(item=>item.id===active),field=layer?.fields.find(item=>item.key===layer.options.field);
  const probeKey=[...files,active,layer?.options.field,layer?.options.component,layer?.options.axis,layer?.options.index,layer?.options.mode,layer?.options.visible];
  const probe=useCFDPointProbe(!loading&&!!field&&!!layer?.options.visible&&!!layer.options.opacity&&layer.options.mode!=="iso"&&layer.options.mode==="slice"&&layer.status!=="Updating display…",probeKey,probeRequest);
  const {mode:probing,pick:recordProbe}=probe;
  const [anchor,setAnchor]=useState<{x:number;y:number}|null>(null);
  const project=useCallback((point:ProbePosition)=>view.current?.project(point)??null,[]);
  useEffect(()=>{
    const point=probe.reading?.sample?.position;if(!point)return;
    let raf=0;const update=()=>{const next=project(point);setAnchor(old=>old?.x===next?.x&&old?.y===next?.y?old:next);raf=requestAnimationFrame(update);};update();
    return()=>cancelAnimationFrame(raf);
  },[probe.reading?.sample,project]);
  useEffect(()=>{
    const container=host.current;
    if(!container||!probing||!layer)return;
    let press:{x:number;y:number;id:number}|null=null;
    const down=(event:PointerEvent)=>{if(event.button===0&&event.isPrimary)press={x:event.clientX,y:event.clientY,id:event.pointerId};};
    const up=(event:PointerEvent)=>{
      const start=press;press=null;
      if(!start||start.id!==event.pointerId||Math.hypot(event.clientX-start.x,event.clientY-start.y)>4)return;
      try{recordProbe(view.current?.pick(layer.id,event.clientX,event.clientY,layer.options.field,layer.options.component)??null);}
      catch(cause){recordProbe(null,cause instanceof Error?cause.message:"This plane could not be probed.");}
    };
    const cancel=()=>{press=null;};
    container.addEventListener("pointerdown",down,true);container.addEventListener("pointerup",up,true);container.addEventListener("pointercancel",cancel,true);
    return()=>{container.removeEventListener("pointerdown",down,true);container.removeEventListener("pointerup",up,true);container.removeEventListener("pointercancel",cancel,true);};
  },[layer,probing,recordProbe]);
  const update=(patch:Partial<Options>)=>{
    if(!layer)return;const options={...layer.options,...patch};setLayers(current=>current.map(item=>item.id===layer.id?{...item,options}:item));setError("");
    const currentView=view.current;
    void currentView?.apply(layer.id,options).then(()=>{if(view.current===currentView&&viewMode==="2d"&&patch.axis!==undefined){currentView.direction(options.axis);currentView.fit();}}).catch(cause=>{if(view.current===currentView)setError(cause instanceof Error?cause.message:"Viewer update failed.");});
  };
  const selectField=(key:string)=>{const selected=layer?.fields.find(item=>item.key===key),low=selected?.range[0]??0,high=selected?.range[1]??1;update({field:key,component:-1,low,high:high>low?high:low+Math.max(1,Math.abs(low))*1e-6,iso:(low+high)/2,mode:"slice"});};
  return <section className={`cfx-viewer cfx-vtk-viewer${probe.mode?" cfx-point-probing":""}`} aria-label="VTK results viewer" data-cfx-probe-scope onKeyDown={event=>{
    if(!onPlaneStep||event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.target instanceof Element&&event.target.closest("input,select,textarea,[contenteditable=true]"))return;
    if(event.key==="ArrowUp"||event.key==="ArrowDown"){event.preventDefault();onPlaneStep(event.key==="ArrowUp"?1:-1);}
  }}>
    {!compact&&<header><strong>{viewMode==="2d"?"2D plane":"VTK"} · {layer?.name??file.name}</strong></header>}
    <CFDViewerFrame label={`${viewMode.toUpperCase()} plane viewer`} embedded={embedded}>
    <div tabIndex={0} data-cfx-probe-surface className={`cfx-vtk-canvas${probe.mode?" cfx-probing":""}`} aria-label={`Interactive VTK ${viewMode==="2d"?"2D":"3D"} field`} onPointerDownCapture={planeContext.onPointerDownCapture} onPointerMoveCapture={planeContext.onPointerMoveCapture} onPointerUpCapture={planeContext.onPointerUpCapture} onPointerCancelCapture={planeContext.onPointerCancelCapture} onContextMenuCapture={event=>{if(onRemoveFile){planeContext.onContextMenu(event);event.stopPropagation();}}}>
      <div ref={host} className="cfx-vtk-surface"/>
      <CFDPointProbeValue probe={probe} anchor={anchor} native={!!provenance?.startsWith("Authenticated worker job")}/>
    </div>
    <CFDFloatingControls label="Plane controls">
    {toolbar}
    {onPlaneStep&&<div className="cfx-inline-toolbar"><button disabled={!previousPlane} onClick={()=>onPlaneStep(-1)}>Previous plane</button><button disabled={!nextPlane} onClick={()=>onPlaneStep(1)}>Next plane</button></div>}
    <div className="cfx-viewer-bottom-actions"><CFDPointProbeControls probe={probe}/><button onClick={onClose}>Hide plane viewer</button></div>
    <div className="cfx-results-controls">
    <details open><summary>Result layers &amp; display controls</summary>
      <div className="cfx-vtk-controls cfx-grid">
        <label>Result field<select aria-label="VTK result field" value={layer?.options.field??""} onChange={event=>selectField(event.target.value)}><option value="">Geometry only</option>{layer?.fields.map(item=><option key={item.key} value={item.key}>{item.name}{item.components>1?" · magnitude":""} · {item.cell?"cell":"point"}</option>)}</select></label>
        {field&&field.components>1&&<label>Vector component<select aria-label="Vector component" value={layer?.options.component??-1} onChange={event=>{const component=Number(event.target.value),range=component<0?field.range:field.componentRanges[component];update({component,low:range[0],high:range[1]>range[0]?range[1]:range[0]+Math.max(1,Math.abs(range[0]))*1e-6});}}><option value={-1}>Magnitude</option>{Array.from({length:field.components},(_,i)=><option key={i} value={i}>{["X","Y","Z"][i]??i+1}</option>)}</select></label>}
        <label>Colour legend<select aria-label="Colour legend" value={layer?.options.palette??"coolwarm"} onChange={event=>update({palette:event.target.value})}><option value="coolwarm">Blue–green–red</option><option value="viridis">Viridis</option><option value="grey">Greyscale</option></select></label>
        {layer&&<><CFDNumber convert={false} label="Legend minimum" value={layer.options.low} onChange={low=>update({low})}/><CFDNumber convert={false} label="Legend maximum" value={layer.options.high} onChange={high=>update({high})}/>
          <CFDNumber convert={false} label="Layer opacity (0–1)" value={layer.options.opacity} min={0} max={1} onChange={opacity=>update({opacity:Math.max(0,Math.min(1,opacity))})}/>
          <label className="cfx-check"><input type="checkbox" checked={layer.options.wire} onChange={event=>update({wire:event.target.checked})}/>Wireframe</label></>}
      </div>
      <div className="cfx-actions">{layers.map(item=><label className="cfx-check" key={item.id}><input type="checkbox" aria-label={`Show result ${item.name}`} checked={item.options.visible} onChange={event=>{const options={...item.options,visible:event.target.checked};setLayers(current=>current.map(old=>old.id===item.id?{...old,options}:old));void view.current?.apply(item.id,options).catch(cause=>setError(String(cause)));}}/>{item.name}</label>)}</div>
      <div className="cfx-actions"><button aria-label="Zoom VTK out" onClick={()=>view.current?.zoom(1/1.2)}>−</button><button aria-label="Zoom VTK in" onClick={()=>view.current?.zoom(1.2)}>+</button><button onClick={()=>view.current?.fit()}>Fit</button>{viewMode==="3d"&&["X","Y","Z"].map((axis,i)=><button key={axis} onClick={()=>view.current?.direction(i)}>View {axis}</button>)}</div>
    </details>
    <details><summary>Planes &amp; passive scalar isosurfaces</summary>
      {layer?.volume?<><label>Volume display<select aria-label="Volume display" value={layer.options.mode} onChange={event=>update({mode:event.target.value as Options["mode"]})}><option value="slice">Grid slice</option>{viewMode==="3d"&&<option value="iso" disabled={!field||field.cell||field.components!==1}>Scalar isosurface</option>}</select></label>
        {layer.options.mode==="slice"?<><label>Slice normal<select aria-label="Slice normal" value={layer.options.axis} onChange={event=>{const axis=Number(event.target.value);update({axis,index:Math.floor((layer.dims[axis]-1)/2)});}}>{["X","Y","Z"].map((axis,i)=><option key={axis} value={i}>{axis}</option>)}</select></label>
          <label>Slice grid index<input aria-label="Slice grid index" type="range" min={0} max={layer.dims[layer.options.axis]-1} value={layer.options.index} onChange={event=>update({index:Number(event.target.value)})}/>{layer.options.index}</label></>:<CFDNumber convert={false} label="Scalar isovalue (file units)" value={layer.options.iso} onChange={iso=>update({iso})}/>}</>:
        <p>Select downloaded plane layers above, or load a real ASCII .vti volume to move X/Y/Z slices and extract scalar isosurfaces. A surface-only .vtk/.vtp file cannot define a volume isosurface. This worker currently solves U and p, not passive scalar transport.</p>}
    </details>
    {!!context?.length&&<details><summary>Building &amp; object visibility</summary><p className="cfx-caption">Measured geometry in metres for context only; it is not solved field data.</p>{context.map(object=><label className="cfx-check" key={object.id}><input type="checkbox" checked={!!contextVisible[object.id]} onChange={event=>{setContextVisible(current=>({...current,[object.id]:event.target.checked}));view.current?.visibility(object.id,event.target.checked);}}/>{object.name}</label>)}</details>}
    <details open><summary>Provenance &amp; diagnostics</summary>
    <p className="cfx-stale">{provenance||"External file · simulation provenance and physical units unverified"}</p>
    {error&&<p role="alert" className="cfx-error">{error}</p>}
    {!!warnings.length&&<div className="cfx-notice" role="status" aria-label="VTK field warnings">Some arrays were not displayed: {warnings.join("; ")}. The original download is unchanged.</div>}
    </details></div>
    <footer><span role="status">{loading?"Loading result layers…":layer?.status??"File not loaded"}</span>{field&&<span>{layer?.volume&&layer.options.mode==="iso"?<><i style={{background:"#ff7900"}}/>{field.name} = {layer.options.iso} · file units</>:<><i className="cfx-colour-scale" style={{background:`linear-gradient(to right, ${(palettes[layer?.options.palette??"coolwarm"]??palettes.coolwarm).map(rgb=>`rgb(${rgb.map(value=>Math.round(value*255)).join(",")})`).join(", ")})`}}/>{field.name}: {layer?.options.low.toPrecision(5)} → {layer?.options.high.toPrecision(5)} · file units</>}</span>}
      <button onClick={()=>downloadCFD(files[Number(active)]??file,(files[Number(active)]??file).name)}>Download full original data</button></footer>
    </CFDFloatingControls>
    <CFDPlaneContextMenu menu={planeMenu} onClose={()=>setPlaneMenu(null)} onDelete={picked=>onRemoveFile?.(picked)}/>
    </CFDViewerFrame>
  </section>;
}
