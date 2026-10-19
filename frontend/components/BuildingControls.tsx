"use client";
import { useState, type ReactNode, type DragEvent } from "react";
import { createPortal } from "react-dom";
import type { ProjectDocument } from "@/lib/projectDocument";
import { activeFloor, addFloor, buildingOf, deleteFloor, duplicateFloor, moveFloor, projectFloors, reorderFloor, selectFloor, updateFloor, type RoofConfiguration } from "@/lib/buildingDocument";
import { planArea, structuralFloorFootprint, validateFloorOpening } from "@/lib/buildingGeometry";
import { formatLength, type DisplayUnits } from "@/lib/units";
import { resolvedRoofFinish, ROOF_MATERIALS } from "@/lib/roofAppearance";
import { FloatingToolbar } from "./FloatingToolbar";
import { Popup } from "./Popup";
import { WindowHelpButton } from "./WindowHelpButton";
import { WindowIcon } from "./WindowIcon";
import { FloorProperties, OpeningProperties, RoofProperties } from "./BuildingPropertyEditors";
import styles from "./HeatingLayoutPanel.module.css";

export type FloorOpeningTool = "RECTANGLE"|"POLYGON"|null;
export type BuildingView = { whole:boolean; roof:boolean; reference:boolean; snap:boolean };
export function BuildingControls({project,onEdit,onUndo,onRedo,canUndo,canRedo,units,in3D,view,onView,tool,onTool,keepOpeningSquare,onKeepOpeningSquare,onFinish,selectedOpening,onSelectOpening,onRoofPreview,onPreviewExterior,error,onError}: {
  project:ProjectDocument;onEdit:(fn:(p:ProjectDocument)=>ProjectDocument)=>void;onUndo:()=>void;onRedo:()=>void;canUndo:boolean;canRedo:boolean;units:DisplayUnits;in3D:boolean;
  view:BuildingView;onView:(v:BuildingView)=>void;tool:FloorOpeningTool;onTool:(t:FloorOpeningTool)=>void;onFinish:()=>void;selectedOpening:string|null;onSelectOpening:(id:string|null)=>void;
  keepOpeningSquare:boolean;onKeepOpeningSquare:(square:boolean)=>void;
  onRoofPreview:(r:RoofConfiguration|null)=>void;onPreviewExterior?:()=>void;error:string;onError:(s:string)=>void;
}) {
  const b=buildingOf(project),current=activeFloor(project),floors=projectFloors(project),index=b.floors.findIndex(f=>f.id===current.id),top=floors.at(-1)!;
  const [windowOpen,setWindowOpen]=useState(false),[roofOpen,setRoofOpen]=useState(false);
  const [floorEditor,setFloorEditor]=useState<{kind:"add"}|{kind:"edit";id:string}|null>(null);
  const addOpen=floorEditor?.kind==="add",floorEditorId=floorEditor?.kind==="edit"?floorEditor.id:null;
  const [floorFocus,setFloorFocus]=useState(0),[roofFocus,setRoofFocus]=useState(0);
  const [deleteTarget,setDeleteTarget]=useState<string|null>(null),[duplicateTarget,setDuplicateTarget]=useState<string|null>(null),[include,setInclude]=useState(true),[deleteRoof,setDeleteRoof]=useState(false);
  const [dragging,setDragging]=useState<string|null>(null),[drop,setDrop]=useState<{id:string;before:boolean}|null>(null);
  const edit=(fn:(p:ProjectDocument)=>ProjectDocument)=>{try{onError("");onEdit(fn);return true;}catch(e){onError(e instanceof Error?e.message:"Could not update the building.");return false;}};
  const select=(id:string)=>{onTool(null);onSelectOpening(null);if(!view.whole&&id!==top.id&&view.roof)onView({...view,roof:false});return edit(p=>selectFloor(p,id));};
  const editFloor=(id:string)=>{setFloorEditor({kind:"edit",id});setFloorFocus(n=>n+1);};
  const editRoof=()=>{setRoofOpen(true);setRoofFocus(n=>n+1);};
  const closeRoof=()=>{setRoofOpen(false);onRoofPreview(null);};
  const editorFloor=floors.find(f=>f.id===floorEditorId),duplicate=floors.find(f=>f.id===duplicateTarget),deleting=floors.find(f=>f.id===deleteTarget);
  const finish=resolvedRoofFinish(b.roof),roofMaterial=ROOF_MATERIALS.find(m=>m.id===finish.material)!;
  const moveRelative=(source:string|null,id:string,before:boolean)=>{
    if(source&&source!==id&&b.floors.some(f=>f.id===source)) {
      const from=b.floors.findIndex(f=>f.id===source),target=b.floors.findIndex(f=>f.id===id);
      let to=target+(before?1:0);if(from<to)to--;
      edit(p=>moveFloor(p,source,to));
    }
    setDragging(null);setDrop(null);
  };
  const dropFloor=(event:DragEvent<HTMLLIElement>,id:string)=>{event.preventDefault();moveRelative(event.dataTransfer.getData("application/x-building-floor")||dragging,id,event.clientY<event.currentTarget.getBoundingClientRect().top+event.currentTarget.offsetHeight/2);};
  return <>
    <nav className="building-floor-bar" aria-label="Building floors">
      <label className="workspace-mode-control"><span className="workspace-mode-label">Floor</span><select className="workspace-mode-select" aria-label="Selected floor" value={in3D&&view.whole?"__whole-building__":current.id} onChange={e=>{const id=e.target.value;if(id==="__whole-building__")onView({...view,whole:true});else{select(id);if(in3D)onView({...view,whole:false,roof:id===top.id&&view.roof});}}}>{in3D&&<option value="__whole-building__">Whole building</option>}{b.floors.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      <button className="building-tools-button" aria-label="Manage floors and building" title="Floors & building" aria-expanded={windowOpen} onClick={()=>setWindowOpen(!windowOpen)}>+</button>
    </nav>
    {error&&<aside className="building-floor-feedback" role="alert"><p>{error}</p><button aria-label="Dismiss building message" onClick={()=>onError("")}>×</button></aside>}
    {tool&&<div className="building-drawing-status"><strong role="status">{tool==="RECTANGLE"?"Click two opposite corners":"Click polygon corners; Enter to finish"}</strong><label className="building-square-option"><input type="checkbox" checked={tool==="RECTANGLE"||keepOpeningSquare} disabled={tool==="RECTANGLE"} onChange={e=>onKeepOpeningSquare(e.target.checked)}/>Keep opening sides square</label>{tool==="POLYGON"&&<button onClick={onFinish}>Finish opening</button>}<button onClick={()=>onTool(null)}>Cancel drawing</button></div>}
    <div className="building-window-layer">
    {windowOpen&&<div className="building-window-host"><FloatingToolbar title="Floors & building" className="building-properties-window" defaultPosition={{x:24,y:60}} initialSize={{width:530}} maxHeight={720} bringToFront onClose={()=>setWindowOpen(false)}><div className={styles.panel}>
      <div className="building-manager-toolbar" role="group" aria-label="Building actions"><button disabled={floors.length>=20} onClick={()=>{setFloorEditor({kind:"add"});setFloorFocus(n=>n+1);}}>+ Floor</button><button disabled={!canUndo} aria-label="Undo project change" onClick={onUndo}>Undo</button><button disabled={!canRedo} aria-label="Redo project change" onClick={onRedo}>Redo</button></div>
      <ol className="building-level-list" aria-label="Building levels, highest first">
        <li className="building-level-item building-roof-entry" aria-label="Roof"><span className="building-level-icon"><WindowIcon title="Roof & ceiling"/></span><div className="building-level-description"><strong>Roof</strong><small>{b.roof.enabled===false?"Not added":`${({FLAT:"Flat",MONO:"Single slope",GABLE:"Gabled",STEPPED:"Stepped"})[b.roof.type]} · ${roofMaterial.name}`}</small></div><div className="building-level-actions"><button onClick={editRoof} aria-label="Edit roof">{b.roof.enabled===false?"Add roof":"Edit"}</button><button disabled={b.roof.enabled===false} onClick={()=>setDeleteRoof(true)} aria-label="Delete roof">Delete</button></div></li>
        {[...floors].reverse().map(f=>{
          const at=b.floors.findIndex(x=>x.id===f.id);
          return <li key={f.id} className="building-level-item" aria-label={f.name} data-floor-id={f.id} data-active={f.id===current.id} data-dragging={dragging===f.id} data-drop={drop?.id===f.id?(drop.before?"before":"after"):undefined} draggable
            onDragStart={e=>{if(e.target instanceof Element&&e.target.closest("button:not(.building-drag-handle)")){e.preventDefault();return;}setDragging(f.id);e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("application/x-building-floor",f.id);}}
            onDragEnd={()=>{setDragging(null);setDrop(null);}} onDragOver={e=>{if(dragging&&dragging!==f.id){e.preventDefault();e.dataTransfer.dropEffect="move";setDrop({id:f.id,before:e.clientY<e.currentTarget.getBoundingClientRect().top+e.currentTarget.offsetHeight/2});}}} onDrop={e=>dropFloor(e,f.id)}>
            <button className="building-drag-handle" title="Drag to reorder; arrow keys move a floor" aria-label={`Move ${f.name}`} draggable={false} onKeyDown={e=>{if(e.key==="ArrowUp"||e.key==="ArrowDown"){e.preventDefault();edit(p=>reorderFloor(p,f.id,e.key==="ArrowUp"?1:-1));}}}
              onPointerDown={e=>{if(e.button===0){e.preventDefault();e.currentTarget.focus({preventScroll:true});setDragging(f.id);e.currentTarget.setPointerCapture(e.pointerId);}}}
              onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId)){const target=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>("[data-floor-id]"),body=e.currentTarget.closest<HTMLElement>(".floating-toolbar-content");if(target&&target.dataset.floorId!==f.id)setDrop({id:target.dataset.floorId!,before:e.clientY<target.getBoundingClientRect().top+target.offsetHeight/2});if(body){const r=body.getBoundingClientRect();if(e.clientY<r.top+28)body.scrollTop-=12;else if(e.clientY>r.bottom-28)body.scrollTop+=12;}}}}
              onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId)){e.currentTarget.releasePointerCapture(e.pointerId);const target=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>("[data-floor-id]");if(target)moveRelative(f.id,target.dataset.floorId!,e.clientY<target.getBoundingClientRect().top+target.offsetHeight/2);else{setDragging(null);setDrop(null);}}}}
              onPointerCancel={()=>{setDragging(null);setDrop(null);}}>⠿</button>
            <button className="building-level-select building-level-description" aria-label={`Select ${f.name}`} aria-current={f.id===current.id?"true":undefined} onClick={()=>select(f.id)}><strong>{f.name}</strong><small>Level {at+1} · {formatLength(f.elevationMm,units)}{f.id===current.id?" · Selected":""}</small></button>
            <div className="building-level-actions"><button aria-label={`Edit ${f.name}`} onClick={()=>editFloor(f.id)}>Edit</button><button aria-label={`Duplicate ${f.name}`} disabled={floors.length>=20} onClick={()=>setDuplicateTarget(f.id)}>Duplicate</button><button aria-label={`Delete ${f.name}`} disabled={floors.length===1} onClick={()=>setDeleteTarget(f.id)}>Delete</button></div>
          </li>;
        })}
      </ol>
      {index>0&&<BuildingSection title="Reference floor"><div className="building-options"><label><input type="checkbox" checked={view.reference} onChange={e=>onView({...view,reference:e.target.checked})}/>Floor below</label><label><input type="checkbox" disabled={!view.reference} checked={view.snap} onChange={e=>onView({...view,snap:e.target.checked})}/>Snap to below</label></div></BuildingSection>}
    </div></FloatingToolbar></div>}
    {(addOpen||editorFloor)&&<div className="building-window-host"><FloatingToolbar title={addOpen?"Add floor":"Floor properties"} className="building-floor-editor-window" defaultPosition={{x:80,y:60}} initialSize={{width:500}} maxHeight={740} bringToFront focusRequest={floorFocus} onClose={()=>{setFloorEditor(null);}}><div className={styles.panel}>
      {!addOpen&&editorFloor&&<div className="building-level-heading"><strong>{editorFloor.name}</strong><span>Level {b.floors.findIndex(f=>f.id===editorFloor.id)+1}</span></div>}
      <FloorProperties key={addOpen?"add":editorFloor!.id} project={project} floorId={editorFloor?.id} units={units} adding={addOpen} onCancel={()=>{setFloorEditor(null);}} onCommit={settings=>{
        if(edit(p=>{if(addOpen){const next=addFloor(p);return updateFloor(next,activeFloor(next).id,settings);}return updateFloor(p,editorFloor!.id,settings);})){setFloorEditor(null);}
      }}/>
      {!addOpen&&editorFloor&&b.floors.findIndex(f=>f.id===editorFloor.id)>0&&<BuildingSection title="Slab openings" defaultOpen>
        <div className="building-opening-actions"><button disabled={in3D} onClick={()=>{select(editorFloor.id);onTool("RECTANGLE");setFloorEditor(null);setWindowOpen(false);}}>Rectangle opening</button><button disabled={in3D} onClick={()=>{select(editorFloor.id);onTool("POLYGON");setFloorEditor(null);setWindowOpen(false);}}>Polygon opening</button></div>
        <label className="building-square-option"><input type="checkbox" checked={keepOpeningSquare} onChange={e=>onKeepOpeningSquare(e.target.checked)}/>Keep opening sides square</label>
        {editorFloor.openings.length===0?<p>No floor openings on this level.</p>:editorFloor.openings.map(o=><button key={o.id} className={styles.listItem} aria-pressed={selectedOpening===o.id} onClick={()=>{if(current.id!==editorFloor.id)select(editorFloor.id);onSelectOpening(o.id);}}>{o.name} · {(planArea([[o.vertices.map(p=>[p.x,p.y])]])/1e6).toFixed(2)} m²</button>)}
        {editorFloor.openings.some(o=>o.id===selectedOpening)&&<OpeningProperties key={JSON.stringify(editorFloor.openings.find(o=>o.id===selectedOpening))} opening={editorFloor.openings.find(o=>o.id===selectedOpening)!} units={units} onCommit={opening=>edit(p=>{const floor=projectFloors(p).find(f=>f.id===editorFloor.id)!;validateFloorOpening(floor.content,opening,floor.openings);return updateFloor(p,floor.id,{openings:floor.openings.map(o=>o.id===opening.id?opening:o)});})} onDelete={()=>{edit(p=>updateFloor(p,editorFloor.id,{openings:editorFloor.openings.filter(o=>o.id!==selectedOpening)}));onSelectOpening(null);}}/>}
      </BuildingSection>}
    </div></FloatingToolbar></div>}
    {roofOpen&&<div className="building-window-host"><FloatingToolbar title="Roof & ceiling" className="building-roof-window" defaultPosition={{x:100,y:60}} initialSize={{width:1120,height:700}} maxHeight={840} bringToFront focusRequest={roofFocus} onClose={closeRoof}><div className="building-level-heading"><strong>Roof over {top.name}</strong><span>Level {floors.length}</span></div><RoofProperties key={JSON.stringify(b.roof)} roof={b.roof} units={units} footprint={structuralFloorFootprint(top.content)} onPreview={onRoofPreview} onPreviewExterior={()=>onPreviewExterior?.()} onCommit={roof=>{if(edit(p=>({...p,building:{...buildingOf(p),roof}})))closeRoof();}} onCancel={closeRoof}/></FloatingToolbar></div>}
    </div>
    {duplicate&&createPortal(<Popup open title="Duplicate floor" message="" confirmLabel="Duplicate floor" onCancel={()=>setDuplicateTarget(null)} onConfirm={()=>{if(edit(p=>duplicateFloor(p,duplicate.id,include)))setDuplicateTarget(null);}}><p>Create an independent copy directly above <strong>{duplicate.name}</strong>. Floors above move up automatically.</p><label className="building-checkbox"><input type="checkbox" checked={include} onChange={e=>setInclude(e.target.checked)}/>Include furniture/assets in copy</label></Popup>,document.body)}
    {deleting&&createPortal(<Popup open title="Delete floor?" message={`Delete ${deleting.name}, its rooms, objects and slab openings? Other floors are kept. If the lowest floor is deleted, the new lowest floor's slab voids are removed too. Undo can restore this change.`} confirmLabel="Delete floor" onCancel={()=>setDeleteTarget(null)} onConfirm={()=>{if(edit(p=>deleteFloor(p,deleting.id))){if(floorEditorId===deleting.id)setFloorEditor(null);onTool(null);onSelectOpening(null);setDeleteTarget(null);}}}/>,document.body)}
    {deleteRoof&&createPortal(<Popup open title="Delete roof?" message="Remove the building roof and ceiling? Floors, walls and their contents are kept. Undo can restore the roof." confirmLabel="Delete roof" onCancel={()=>setDeleteRoof(false)} onConfirm={()=>{if(edit(p=>({...p,building:{...buildingOf(p),roof:{...buildingOf(p).roof,enabled:false}}}))){closeRoof();onView({...view,roof:false});setDeleteRoof(false);}}}/>,document.body)}
  </>;
}

function BuildingSection({title,defaultOpen=false,children}:{title:string;defaultOpen?:boolean;children:ReactNode}) {
  return <details className="building-section" open={defaultOpen}><summary className="full-plan-overall-toggle"><strong>{title}</strong><WindowHelpButton title={`Floors & building — ${title}`}/><span className="building-section-toggle" aria-hidden="true"/></summary><div className="full-plan-overall-content">{children}</div></details>;
}
