"use client";
import { useEffect, useState } from "react";
import type { ProjectDocument } from "@/lib/projectDocument";
import { activeFloor, buildingOf, floorOpeningSchema, floorSettingsSchema, minimumRoofHeight, roofSchema, sharedRoofProfile, withRoofProfile, type FloorContent, type FloorOpening, type FloorSettings, type RoofConfiguration } from "@/lib/buildingDocument";
import { BALUSTRADE_STYLES, defaultBalustrade } from "@/lib/balustrades";
import { validateRoofGuardClearance, type PlanPolygons } from "@/lib/buildingGeometry";
import { resolvedRoofFinish, ROOF_MATERIALS, ROOF_ORIENTATIONS } from "@/lib/roofAppearance";
import { formatLength, UNIT_LABEL, type DisplayUnits } from "@/lib/units";
import { DisplayNumberInput } from "./DisplayNumberInput";
import { WindowHelpButton } from "./WindowHelpButton";
import { RoofPreview } from "./RoofPreview";
import styles from "./HeatingLayoutPanel.module.css";

export function FloorProperties({project,floorId,units,adding=false,onCommit,onCancel}:{project:ProjectDocument;floorId?:string;units:DisplayUnits;adding?:boolean;onCommit:(settings:FloorSettings)=>void;onCancel:()=>void}) {
  const b=buildingOf(project),f=b.floors.find(f=>f.id===floorId)??activeFloor(project),top=b.floors.at(-1)!;
  // Keep only explicit edits in the draft. Unedited metadata follows reordering
  // or duplication in the independent manager instead of restoring stale levels.
  const [edits,setEdits]=useState<Partial<FloorSettings>>({});
  const draft:FloorSettings={...(adding?{name:b.floors.length===1?"First Floor":b.floors.length===2?"Second Floor":`Floor ${b.floors.length}`,elevationMm:top.elevationMm+top.heightMm,heightMm:top.heightMm,slabThicknessMm:top.slabThicknessMm}:{name:f.name,elevationMm:f.elevationMm,heightMm:f.heightMm,slabThicknessMm:f.slabThicknessMm}),...edits};
  const result=floorSettingsSchema.safeParse(draft),index=b.floors.findIndex(x=>x.id===f.id),nextSlab=adding?draft.slabThicknessMm:b.floors[index+1]?.slabThicknessMm??draft.slabThicknessMm;
  const number=(label:string,key:"elevationMm"|"heightMm"|"slabThicknessMm")=><label>{label} ({UNIT_LABEL[units]})<DisplayNumberInput units={units} aria-label={label} valueMm={draft[key]} onMmChange={v=>setEdits(current=>({...current,[key]:v}))}/></label>;
  return <div className={styles.panel}>
    <label>Floor name<input aria-label="Floor name" maxLength={100} value={draft.name} onChange={e=>{const name=e.target.value;setEdits(current=>({...current,name}));}}/></label>
    <div className={styles.grid}>{number("Floor elevation","elevationMm")}{number("Floor-to-floor height","heightMm")}{number("Floor slab thickness","slabThicknessMm")}<div className="building-clear-height">Clear height below slab<strong>{formatLength(draft.heightMm-nextSlab,units)}</strong></div></div>
    {!result.success&&<p role="alert" className={styles.warning}>{result.error.issues.map(i=>i.message).join(" ")}</p>}
    <div className="building-editor-footer"><button onClick={onCancel}>Cancel</button><button className={`${styles.primary} primary`} disabled={!result.success} onClick={()=>{if(result.success)onCommit(result.data);}}>{adding?"Add floor":"Apply floor properties"}</button></div>
  </div>;
}

export function OpeningProperties({opening,units,onCommit,onDelete}:{opening:FloorOpening;units:DisplayUnits;onCommit:(o:FloorOpening)=>void;onDelete:()=>void}) {
  const [draft,setDraft]=useState(structuredClone(opening));
  const [rectangle,setRectangle]=useState(()=>{const xs=opening.vertices.map(p=>p.x),ys=opening.vertices.map(p=>p.y);return{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),depth:Math.max(...ys)-Math.min(...ys)};});
  const invalidRectangle=draft.shape==="RECTANGLE"&&(rectangle.width<100||rectangle.depth<100);
  const validation=floorOpeningSchema.safeParse(draft);
  const changeRectangle=(key:keyof typeof rectangle,value:number)=>{const next={...rectangle,[key]:value},{x,y,width,depth}=next;setRectangle(next);setDraft({...draft,vertices:[{x,y},{x:x+width,y},{x:x+width,y:y+depth},{x,y:y+depth}]});};
  return <section className="building-opening-properties" aria-label="Floor opening properties">
    <label>Opening name<input maxLength={100} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
    {draft.shape==="RECTANGLE"?<div className={styles.grid}>{(["x","y","width","depth"] as const).map(key=>{const label=key==="x"?"X":key==="y"?"Y":key==="width"?"Width":"Depth";return <label key={key}>{label} ({UNIT_LABEL[units]})<DisplayNumberInput units={units} aria-label={`Opening ${label}`} minMm={key==="width"||key==="depth"?100:undefined} valueMm={rectangle[key]} onMmChange={v=>changeRectangle(key,v)}/></label>;})}</div>:<div className="building-vertices">
      {draft.vertices.map((p,i)=><div className={styles.grid} key={i}>
        {(["x","y"]as const).map(axis=><label key={axis}>Vertex {i+1} {axis.toUpperCase()} ({UNIT_LABEL[units]})<DisplayNumberInput units={units} valueMm={p[axis]} onMmChange={v=>setDraft({...draft,vertices:draft.vertices.map((point,j)=>j===i?{...point,[axis]:v}:point)})}/></label>)}
        <div className={styles.actions}><button disabled={draft.vertices.length<=3} onClick={()=>setDraft({...draft,vertices:draft.vertices.filter((_,j)=>j!==i)})}>Remove vertex {i+1}</button><button disabled={draft.vertices.length>=200} onClick={()=>{const next=draft.vertices[(i+1)%draft.vertices.length],vertices=[...draft.vertices];vertices.splice(i+1,0,{x:(p.x+next.x)/2,y:(p.y+next.y)/2});setDraft({...draft,vertices});}}>Insert after vertex {i+1}</button></div>
      </div>)}
    </div>}
    <section className="building-roof-finish" aria-label="Opening balustrade"><div className="building-roof-section-heading"><label className="building-checkbox"><input type="checkbox" checked={draft.balustrade?.enabled??false} onChange={e=>setDraft({...draft,balustrade:{...(draft.balustrade??defaultBalustrade()),enabled:e.target.checked}})}/>Add balustrade</label><WindowHelpButton title="Opening balustrade"/></div>
      {draft.balustrade?.enabled&&<><label>Balustrade style<select className="workspace-mode-select" aria-label="Balustrade style" value={draft.balustrade.style} onChange={e=>{const style=BALUSTRADE_STYLES.find(item=>item.id===e.target.value)!;setDraft({...draft,balustrade:{...draft.balustrade!,style:style.id as typeof draft.balustrade.style,colour:style.colour}});}}>{BALUSTRADE_STYLES.map(style=><option key={style.id} value={style.id}>{style.name}</option>)}</select></label><div className={styles.grid}><label>Guard height ({UNIT_LABEL[units]})<DisplayNumberInput units={units} aria-label="Balustrade height" minMm={600} maxMm={2000} valueMm={draft.balustrade.heightMm} onMmChange={v=>setDraft({...draft,balustrade:{...draft.balustrade!,heightMm:v}})}/></label><label>Balustrade colour<input type="color" aria-label="Balustrade colour" value={draft.balustrade.colour} onChange={e=>setDraft({...draft,balustrade:{...draft.balustrade!,colour:e.target.value}})}/></label></div><small>Posts sit 25 mm back from the void. Generic visual guarding, not a certified safety design. CFD sections are available in Library → Object catalogue → Balustrades.</small></>}
    </section>
    {invalidRectangle&&<p role="alert" className={styles.warning}>Opening width and depth must each be at least 100 mm.</p>}
    {!validation.success&&draft.balustrade?.enabled&&<p role="alert" className={styles.warning}>Enter a guard height from 600 to 2000 mm and a valid colour.</p>}
    <div className={styles.actions}><button disabled={invalidRectangle||!validation.success} onClick={()=>onCommit(draft)}>Apply opening</button><button onClick={onDelete}>Delete opening</button></div>
  </section>;
}

export function RoofProperties({roof,units,footprint,content,openings=[],onPreview,onCommit,onCancel}:{roof:RoofConfiguration;units:DisplayUnits;footprint:PlanPolygons;content?:FloorContent;openings?:FloorOpening[];onPreview:(r:RoofConfiguration|null)=>void;onCommit:(r:RoofConfiguration)=>void;onCancel:()=>void}) {
  const [document,setDocument]=useState<RoofConfiguration>(()=>({...roof,enabled:true}));
  const [scope,setScope]=useState("");
  const rooms=content?.rooms??[],selected=scope?document.roomOverrides?.find(item=>item.roomId===scope):undefined;
  const profile=selected?.roof??sharedRoofProfile(document),draft={...profile,finish:resolvedRoofFinish(profile)};
  const setDraft=(value:typeof draft|((current:typeof draft)=>typeof draft))=>{
    const next=typeof value==="function"?value(draft):value;
    setDocument(current=>scope?{...current,roomOverrides:[...(current.roomOverrides??[]).filter(item=>item.roomId!==scope),{roomId:scope,roof:next}]}:{...current,...next});
  };
  const [customOrientation,setCustomOrientation]=useState(()=>!ROOF_ORIENTATIONS.some(angle=>angle===roof.orientationDeg));
  const [angleEntry,setAngleEntry]=useState(()=>String(roof.orientationDeg));
  const material=ROOF_MATERIALS.find(preset=>preset.id===draft.finish.material)!;
  const angleInvalid=draft.type!=="FLAT"&&customOrientation&&(angleEntry.trim()===""||!Number.isFinite(Number(angleEntry))||Number(angleEntry)<0||Number(angleEntry)>360);
  const result=roofSchema.safeParse(document);let guardError="";
  try{if(content&&result.success)validateRoofGuardClearance(content,openings,result.data);}catch(error){guardError=error instanceof Error?error.message:"Guard height exceeds the roof clearance.";}
  const valid=result.success&&!angleInvalid&&!guardError;
  useEffect(()=>{onPreview(valid?document:null);return()=>onPreview(null);},[document,onPreview,valid]);
  const chooseScope=(id:string)=>{const next=id?document.roomOverrides?.find(item=>item.roomId===id)?.roof??document:document;setScope(id);setCustomOrientation(!ROOF_ORIENTATIONS.some(angle=>angle===next.orientationDeg));setAngleEntry(String(next.orientationDeg));};
  const number=(label:string,key:"lowHeightMm"|"highHeightMm"|"thicknessMm"|"ceilingHeightMm")=><label>{label} ({UNIT_LABEL[units]})<DisplayNumberInput units={units} aria-label={label} valueMm={draft[key]} onMmChange={v=>setDraft({...draft,[key]:v})}/></label>;
  return <div className="building-roof-editor-grid"><div className={`${styles.panel} building-roof-form`}><div className={`${styles.panel} building-roof-fields`}>
    <section className="building-roof-finish" aria-label="Room roof definitions"><div className="building-roof-section-heading"><label className="building-checkbox"><input type="checkbox" checked={document.roomRoofsEnabled??false} onChange={e=>{setDocument({...document,roomRoofsEnabled:e.target.checked});chooseScope("");}}/>Different roofs by room</label><WindowHelpButton title="Room roof definitions"/></div>
      {document.roomRoofsEnabled?<><label>Edit roof for<select className="workspace-mode-select" aria-label="Roof room" value={scope} onChange={e=>chooseScope(e.target.value)}><option value="">Shared roof · default</option>{rooms.map(room=><option key={room.id} value={room.id}>{room.name}{document.roomOverrides?.some(item=>item.roomId===room.id)?" · custom":" · shared"}</option>)}</select></label>{scope&&<label className="building-checkbox"><input type="checkbox" checked={Boolean(selected)} onChange={e=>{if(e.target.checked)setDocument({...document,roomOverrides:[...(document.roomOverrides??[]),{roomId:scope,roof:{...sharedRoofProfile(document),enabled:true}}]});else{setDocument({...document,roomOverrides:document.roomOverrides?.filter(item=>item.roomId!==scope)});setCustomOrientation(!ROOF_ORIENTATIONS.some(angle=>angle===document.orientationDeg));setAngleEntry(String(document.orientationDeg));}}}/>Use a different roof for this room</label>}<small>Applies to rooms on the highest floor. Unassigned rooms keep the shared roof. Switch this option off to use one roof without losing the saved room settings.</small></>:<small>Use one continuous roof, or enable room definitions to combine profiles, heights and finishes.</small>}
    </section>
    <fieldset className="building-roof-profile-fields" disabled={Boolean(scope&&!selected)}><legend>{scope?rooms.find(room=>room.id===scope)?.name??"Room roof":"Shared roof"}</legend>
    <label className="building-roof-select"><span>Roof profile</span><WindowHelpButton title="Roof profile"/><select className="workspace-mode-select" aria-label="Roof profile" value={draft.type} onChange={e=>{const type=e.target.value as RoofConfiguration["type"];setDraft(current=>({...current,...withRoofProfile(current,type)}));}}><option value="FLAT">Flat</option><option value="MONO">Single slope / mono-pitch</option><option value="GABLE">Gabled</option><option value="STEPPED">Stepped · two zones</option></select></label>
    <div className="building-roof-dimensions" data-profile={draft.type}>{number(draft.type==="MONO"?"Low height":draft.type==="STEPPED"?"Zone 1 height":"Eaves height","lowHeightMm")}{draft.type!=="FLAT"&&number(draft.type==="GABLE"?"Ridge height":draft.type==="STEPPED"?"Zone 2 height":"High height","highHeightMm")}{number("Thickness","thicknessMm")}</div>
    {draft.type!=="FLAT"&&<>
      <label className="building-roof-select"><span>{draft.type==="GABLE"?"Ridge direction":"Profile direction"}</span><WindowHelpButton title="Roof direction"/><select className="workspace-mode-select" aria-label="Roof orientation" value={customOrientation?"CUSTOM":draft.orientationDeg} onChange={e=>{const custom=e.target.value==="CUSTOM";setCustomOrientation(custom);if(!custom){const angle=Number(e.target.value);setAngleEntry(String(angle));setDraft({...draft,orientationDeg:angle});}}}>{ROOF_ORIENTATIONS.map(v=><option key={v} value={v}>{v}°{v===0?" · +X":v===90?" · +Y":v===180?" · −X":" · −Y"}</option>)}<option value="CUSTOM">Custom angle…</option></select></label>
      {customOrientation&&<label>Custom angle (°)<input type="number" aria-label="Custom roof angle" aria-invalid={angleInvalid} min="0" max="360" step="any" value={angleEntry} onChange={e=>{const value=e.target.value,angle=Number(value);setAngleEntry(value);if(value.trim()!==""&&Number.isFinite(angle)&&angle>=0&&angle<=360)setDraft({...draft,orientationDeg:angle});}}/><small>0–360°, from the plan’s +X axis towards +Y.</small></label>}
    </>}
    {draft.type==="STEPPED"&&<label>Dividing line · {Math.round(draft.splitFraction*100)}% across<input aria-label="Roof dividing line" type="range" min="5" max="95" value={draft.splitFraction*100} onChange={e=>setDraft({...draft,splitFraction:Number(e.target.value)/100})}/></label>}
    <section className="building-roof-finish" aria-label="Roof appearance"><div className="building-roof-section-heading"><h3>Roof appearance</h3><WindowHelpButton title="Roof materials & colour"/></div>
      <label className="building-roof-select"><span>Roof material</span><WindowHelpButton title="Roof material"/><select className="workspace-mode-select" aria-label="Roof material" value={draft.finish.material} onChange={e=>{const preset=ROOF_MATERIALS.find(m=>m.id===e.target.value)!;setDraft({...draft,finish:{...draft.finish,material:preset.id,colour:preset.colour}});}}>{ROOF_MATERIALS.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <label>Roof colour<input type="color" aria-label="Roof colour" value={draft.finish.colour} onChange={e=>setDraft({...draft,finish:{...draft.finish,colour:e.target.value}})}/></label>
      {material.repeat!=="none"&&<div className={styles.grid}>{(["tileWidthMm","tileHeightMm"]as const).map((key,i)=><label key={key}>{material.repeat==="panels"?(i?"Panel length":"Panel width"):(i?"Row height":material.repeat==="shingles"?"Shingle width":"Tile width")} ({UNIT_LABEL[units]})<DisplayNumberInput units={units} aria-label={i?"Roof repeat height":"Roof repeat width"} valueMm={draft.finish[key]} onMmChange={v=>setDraft({...draft,finish:{...draft.finish,[key]:v}})}/></label>)}</div>}
    </section>
    <label className="building-roof-select"><span>Interior ceiling</span><WindowHelpButton title="Interior ceiling"/><select className="workspace-mode-select" aria-label="Interior ceiling" value={draft.ceilingMode} onChange={e=>setDraft({...draft,ceilingMode:e.target.value as RoofConfiguration["ceilingMode"],ceilingHeightMm:Math.min(draft.ceilingHeightMm,minimumRoofHeight(draft))})}><option value="FOLLOWS_ROOF">Follows roof underside</option><option value="FLAT">Independent flat ceiling</option></select></label>{draft.ceilingMode==="FLAT"&&number("Ceiling height","ceilingHeightMm")}
    {angleInvalid&&<p role="alert" className={styles.warning}>Enter a roof angle from 0° to 360°.</p>}
    {!result.success&&<p role="alert" className={styles.warning}>{result.error.issues.map(i=>i.message).join(" ")}</p>}
    </fieldset>
    {guardError&&<p role="alert" className={styles.warning}>{guardError}</p>}
    {!footprint.length&&<p role="status">Draw an enclosed room on the top floor to preview the roof.</p>}
    </div><div className="building-editor-footer"><button onClick={onCancel}>Cancel</button><button className={`${styles.primary} primary`} disabled={!valid} onClick={()=>{if(valid&&result.success)onCommit(result.data);}}>Apply roof & ceiling</button></div>
  </div><RoofPreview roof={valid&&result.success?result.data:null} footprint={footprint} content={content}/></div>;
}
