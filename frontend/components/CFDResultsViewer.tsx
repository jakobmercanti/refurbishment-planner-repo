"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type vtkActor from "@kitware/vtk.js/Rendering/Core/Actor";
import type vtkMapper from "@kitware/vtk.js/Rendering/Core/Mapper";
import type vtkColorTransferFunction from "@kitware/vtk.js/Rendering/Core/ColorTransferFunction";
import type vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData";
import type vtkImageData from "@kitware/vtk.js/Common/DataModel/ImageData";
import { readResultData, volumeSlice, type ResultData, type ResultField } from "@/lib/cfdResultData";
import { downloadCFD } from "@/lib/climoptix";
import { CFDNumber } from "./CFDFields";

const EMPTY_FILES:File[]=[];
interface Options { visible:boolean; opacity:number; wire:boolean; field:string; component:number; low:number; high:number; palette:string; mode:"slice"|"iso"; axis:number; index:number; iso:number }
interface Layer { id:string; name:string; fields:ResultField[]; volume:boolean; dims:number[]; options:Options; status:string }
export interface ResultContext { id:string; name:string; points:number[] }
interface View { apply:(id:string,options:Options)=>Promise<void>; visibility:(id:string,visible:boolean)=>void; fit:()=>void; zoom:(factor:number)=>void; direction:(axis:number)=>void }
const palettes:Record<string,number[][]>={coolwarm:[[.15,.3,.75],[.1,.8,.65],[.9,.25,.1]],viridis:[[.267,.005,.329],[.128,.567,.551],[.993,.906,.144]],grey:[[.1,.1,.1],[.5,.5,.5],[.95,.95,.95]]};

export function CFDResultsViewer({file,additionalFiles=EMPTY_FILES,context,provenance,onClose}:{file:File;additionalFiles?:File[];context?:ResultContext[];provenance?:string;onClose:()=>void}){
  const host=useRef<HTMLDivElement>(null), view=useRef<View|null>(null);
  const [layers,setLayers]=useState<Layer[]>([]),[active,setActive]=useState("0"),[error,setError]=useState(""),[warnings,setWarnings]=useState<string[]>([]),[loading,setLoading]=useState(true);
  const [contextVisible,setContextVisible]=useState<Record<string,boolean>>({});
  const files=useMemo(()=>[file,...additionalFiles],[file,additionalFiles]);
  const prior=useRef<{file:File;position:number[];target:number[];up:number[]}|null>(null);
  useEffect(()=>{
    let cancelled=false;const owned:{delete:()=>void}[]=[], cleanup:(()=>void)[]=[];
    const runtimes=new Map<string,{loaded:ResultData;actor:vtkActor;mapper:vtkMapper;colours:vtkColorTransferFunction;temporary?:vtkPolyData;generation:number}>();
    const release=()=>{view.current=null;cleanup.splice(0).reverse().forEach(fn=>fn());owned.splice(0).reverse().forEach(item=>item.delete());};
    void(async()=>{
      if(files.length>8||files.reduce((size,item)=>size+item.size,0)>64*1024**2)throw new Error("Load at most 8 result layers totalling 64 MB.");
      const [windowModule,mapperModule,actorModule,colourModule,polyModule]=await Promise.all([
        import("@kitware/vtk.js/Rendering/Misc/GenericRenderWindow"),import("@kitware/vtk.js/Rendering/Core/Mapper"),import("@kitware/vtk.js/Rendering/Core/Actor"),
        import("@kitware/vtk.js/Rendering/Core/ColorTransferFunction"),import("@kitware/vtk.js/Common/DataModel/PolyData"),import("@kitware/vtk.js/Rendering/Profiles/Geometry")]);
      if(cancelled||!host.current)return;
      setLoading(true);setError("");setWarnings([]);setLayers([]);setActive("0");setContextVisible({});
      const win=windowModule.default.newInstance({listenWindowResize:false}), container=host.current;
      owned.push(win.getRenderWindow(),win.getRenderer(),win.getInteractor(),win);win.setContainer(container);
      const renderer=win.getRenderer(),camera=renderer.getActiveCamera(), render=()=>win.getRenderWindow().render();
      camera.setViewUp(0,0,1);camera.setPosition(1,-1,1);
      const colourBackground=()=>{const rgb=getComputedStyle(container).backgroundColor.match(/[\d.]+/g)?.slice(0,3).map(Number)??[235,240,237];renderer.setBackground(rgb[0]/255,rgb[1]/255,rgb[2]/255);};
      colourBackground();
      const resize=new ResizeObserver(()=>win.resize());resize.observe(container);cleanup.push(()=>resize.disconnect());
      const theme=new MutationObserver(()=>{colourBackground();render();});theme.observe(document.documentElement,{attributes:true,attributeFilter:["data-theme","class","style"]});cleanup.push(()=>theme.disconnect());
      const apply:View["apply"]=async(id,options)=>{
        const runtime=runtimes.get(id);if(!runtime||cancelled)return;const generation=++runtime.generation;
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
      view.current={apply,visibility:(id,visible)=>{contextActors.get(id)?.setVisibility(visible);render();},fit:()=>{renderer.resetCamera();render();},zoom:factor=>{camera.zoom(factor);render();},direction:axis=>{
        const target=camera.getFocalPoint(),position=camera.getPosition(),distance=Math.hypot(...position.map((value,i)=>value-target[i]));
        const next=[...target];next[axis]+=Math.max(distance,1);camera.setPosition(next[0],next[1],next[2]);camera.setViewUp(...(axis===2?[0,1,0]:[0,0,1]) as [number,number,number]);render();
      }};
      renderer.resetCamera();if(prior.current?.file===file){camera.setPosition(...prior.current.position as [number,number,number]);camera.setFocalPoint(...prior.current.target as [number,number,number]);camera.setViewUp(...prior.current.up as [number,number,number]);}
      cleanup.push(()=>{prior.current={file,position:[...camera.getPosition()],target:[...camera.getFocalPoint()],up:[...camera.getViewUp()]};});
      win.resize();render();setLayers(next);setWarnings(notices);setLoading(false);
    })().catch(cause=>{release();if(!cancelled){setError(cause instanceof Error?cause.message:"Cannot inspect these result files.");setLoading(false);}});
    return()=>{cancelled=true;release();};
  },[files,context,file]);
  const layer=layers.find(item=>item.id===active),field=layer?.fields.find(item=>item.key===layer.options.field);
  const update=(patch:Partial<Options>)=>{
    if(!layer)return;const options={...layer.options,...patch};setLayers(current=>current.map(item=>item.id===layer.id?{...item,options}:item));setError("");
    const currentView=view.current;
    void currentView?.apply(layer.id,options).catch(cause=>{if(view.current===currentView)setError(cause instanceof Error?cause.message:"Viewer update failed.");});
  };
  const selectField=(key:string)=>{const selected=layer?.fields.find(item=>item.key===key),low=selected?.range[0]??0,high=selected?.range[1]??1;update({field:key,component:-1,low,high:high>low?high:low+Math.max(1,Math.abs(low))*1e-6,iso:(low+high)/2,mode:"slice"});};
  return <section className="cfx-viewer cfx-vtk-viewer" aria-label="VTK results viewer">
    <header><strong>VTK · {layer?.name??file.name}</strong><button onClick={onClose}>Back to geometry</button></header>
    <p className="cfx-stale">{provenance||"External file · simulation provenance and physical units unverified"}</p>
    <div className="cfx-results-sidebar">
    <details open><summary>Result layers &amp; display controls</summary>
      <div className="cfx-vtk-controls cfx-grid">
        <label>Active result layer<select aria-label="Active result layer" value={active} onChange={event=>setActive(event.target.value)}>{layers.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Result field<select aria-label="VTK result field" value={layer?.options.field??""} onChange={event=>selectField(event.target.value)}><option value="">Geometry only</option>{layer?.fields.map(item=><option key={item.key} value={item.key}>{item.name}{item.components>1?" · magnitude":""} · {item.cell?"cell":"point"}</option>)}</select></label>
        {field&&field.components>1&&<label>Vector component<select aria-label="Vector component" value={layer?.options.component??-1} onChange={event=>{const component=Number(event.target.value),range=component<0?field.range:field.componentRanges[component];update({component,low:range[0],high:range[1]>range[0]?range[1]:range[0]+Math.max(1,Math.abs(range[0]))*1e-6});}}><option value={-1}>Magnitude</option>{Array.from({length:field.components},(_,i)=><option key={i} value={i}>{["X","Y","Z"][i]??i+1}</option>)}</select></label>}
        <label>Colour legend<select aria-label="Colour legend" value={layer?.options.palette??"coolwarm"} onChange={event=>update({palette:event.target.value})}><option value="coolwarm">Blue–green–red</option><option value="viridis">Viridis</option><option value="grey">Greyscale</option></select></label>
        {layer&&<><CFDNumber convert={false} label="Legend minimum" value={layer.options.low} onChange={low=>update({low})}/><CFDNumber convert={false} label="Legend maximum" value={layer.options.high} onChange={high=>update({high})}/>
          <CFDNumber convert={false} label="Layer opacity (0–1)" value={layer.options.opacity} min={0} max={1} onChange={opacity=>update({opacity:Math.max(0,Math.min(1,opacity))})}/>
          <label className="cfx-check"><input type="checkbox" checked={layer.options.wire} onChange={event=>update({wire:event.target.checked})}/>Wireframe</label></>}
      </div>
      <div className="cfx-actions">{layers.map(item=><label className="cfx-check" key={item.id}><input type="checkbox" aria-label={`Show result ${item.name}`} checked={item.options.visible} onChange={event=>{const options={...item.options,visible:event.target.checked};setLayers(current=>current.map(old=>old.id===item.id?{...old,options}:old));void view.current?.apply(item.id,options).catch(cause=>setError(String(cause)));}}/>{item.name}</label>)}</div>
      <div className="cfx-actions"><button aria-label="Zoom VTK out" onClick={()=>view.current?.zoom(1/1.2)}>−</button><button aria-label="Zoom VTK in" onClick={()=>view.current?.zoom(1.2)}>+</button><button onClick={()=>view.current?.fit()}>Fit</button>{["X","Y","Z"].map((axis,i)=><button key={axis} onClick={()=>view.current?.direction(i)}>View {axis}</button>)}</div>
    </details>
    <details><summary>Planes &amp; passive scalar isosurfaces</summary>
      {layer?.volume?<><label>Volume display<select aria-label="Volume display" value={layer.options.mode} onChange={event=>update({mode:event.target.value as Options["mode"]})}><option value="slice">Grid slice</option><option value="iso" disabled={!field||field.cell||field.components!==1}>Scalar isosurface</option></select></label>
        {layer.options.mode==="slice"?<><label>Slice normal<select aria-label="Slice normal" value={layer.options.axis} onChange={event=>{const axis=Number(event.target.value);update({axis,index:Math.floor((layer.dims[axis]-1)/2)});}}>{["X","Y","Z"].map((axis,i)=><option key={axis} value={i}>{axis}</option>)}</select></label>
          <label>Slice grid index<input aria-label="Slice grid index" type="range" min={0} max={layer.dims[layer.options.axis]-1} value={layer.options.index} onChange={event=>update({index:Number(event.target.value)})}/>{layer.options.index}</label></>:<CFDNumber convert={false} label="Scalar isovalue (file units)" value={layer.options.iso} onChange={iso=>update({iso})}/>}</>:
        <p>Select downloaded plane layers above, or load a real ASCII .vti volume to move X/Y/Z slices and extract scalar isosurfaces. A surface-only .vtk/.vtp file cannot define a volume isosurface. This worker currently solves U and p, not passive scalar transport.</p>}
    </details>
    {!!context?.length&&<details><summary>Building &amp; object visibility</summary><p className="cfx-caption">Measured geometry in metres for context only; it is not solved field data.</p>{context.map(object=><label className="cfx-check" key={object.id}><input type="checkbox" checked={!!contextVisible[object.id]} onChange={event=>{setContextVisible(current=>({...current,[object.id]:event.target.checked}));view.current?.visibility(object.id,event.target.checked);}}/>{object.name}</label>)}</details>}
    {error&&<p role="alert" className="cfx-error">{error}</p>}
    {!!warnings.length&&<div className="cfx-notice" role="status" aria-label="VTK field warnings">Some arrays were not displayed: {warnings.join("; ")}. The original download is unchanged.</div>}
    </div>
    <div ref={host} className="cfx-vtk-canvas" aria-label="Interactive VTK 3D field"/>
    <footer><span role="status">{loading?"Loading result layers…":layer?.status??"File not loaded"}</span>{field&&<span>{layer?.volume&&layer.options.mode==="iso"?<><i style={{background:"#ff7900"}}/>{field.name} = {layer.options.iso} · file units</>:<><i className="cfx-colour-scale" style={{background:`linear-gradient(to right, ${(palettes[layer?.options.palette??"coolwarm"]??palettes.coolwarm).map(rgb=>`rgb(${rgb.map(value=>Math.round(value*255)).join(",")})`).join(", ")})`}}/>{field.name}: {layer?.options.low.toPrecision(5)} → {layer?.options.high.toPrecision(5)} · file units</>}</span>}
      <button onClick={()=>downloadCFD(files[Number(active)]??file,(files[Number(active)]??file).name)}>Download full original data</button></footer>
  </section>;
}
