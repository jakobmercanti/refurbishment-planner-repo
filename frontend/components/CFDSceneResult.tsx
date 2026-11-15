"use client";

import { useEffect, useMemo, useState } from "react";
import { BufferGeometry, Color, DoubleSide, EdgesGeometry, Float32BufferAttribute, Vector3 } from "three";
import { Html } from "@react-three/drei";
import type vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData";
import { readResultData, type ResultField } from "@/lib/cfdResultData";
import { probeNumber, resultProbeMesh, sampleResultPoint, type ProbeMesh, type ResultPointValue } from "@/lib/cfdPointProbe";

export interface SceneResultMetadata { fields:{key:string;name:string;range:[number,number]}[];error:string }
export const RESULT_PALETTES = {
  spectrum: "Spectrum",
  sequential: "Blue to yellow",
  viridis: "Viridis",
  inferno: "Inferno",
  diverging: "Blue–white–red",
} as const;
export type ResultPalette = keyof typeof RESULT_PALETTES;
export const DEFAULT_RESULT_APPEARANCE = { edges: true, edgeOpacity: 65, shading: 30 };
export type ResultAppearance = typeof DEFAULT_RESULT_APPEARANCE;
export const RESULT_PLANE_MESH = "verified-cfd-result";
export interface CFDSceneResultProps { file:File;field:string;onMetadata:(value:SceneResultMetadata)=>void;probing?:boolean;onProbe?:(value:ResultPointValue|null)=>void;onContextMenu?:(x:number,y:number)=>void;onSelect?:()=>void;selected?:boolean;palette?:ResultPalette;range?:[number,number];appearance?:ResultAppearance }

const paletteStops = {
  viridis: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"].map(value => new Color(value)),
  inferno: ["#000004", "#420a68", "#932667", "#dd513a", "#fca50a", "#fcffa4"].map(value => new Color(value)),
  diverging: ["#2166ac", "#f7f7f7", "#b2182b"].map(value => new Color(value)),
};

function paintResult(colour: Color, fraction: number, palette: ResultPalette) {
  if (palette === "spectrum") return colour.setHSL((1-fraction)*.66,.8,.5);
  if (palette === "sequential") return colour.setRGB(.02 + .98 * fraction, .08 + .71 * fraction, .65 - .60 * fraction);
  const stops = paletteStops[palette], offset = fraction * (stops.length - 1);
  const segment = Math.min(stops.length - 2, Math.floor(offset));
  return colour.lerpColors(stops[segment], stops[segment + 1], offset - segment);
}

const resultLight = new Vector3(.8, .55, .24).normalize();
function planeLighting(positions: number[], strength: number) {
  if (!strength) return 1;
  const first = new Vector3(), edgeA = new Vector3(), edgeB = new Vector3(), normal = new Vector3();
  for (let i = 0; i + 8 < positions.length; i += 9) {
    first.fromArray(positions, i);
    edgeA.fromArray(positions, i + 3).sub(first);
    edgeB.fromArray(positions, i + 6).sub(first);
    normal.crossVectors(edgeA, edgeB);
    if (normal.lengthSq() === 0) continue;
    const light = Math.abs(normal.normalize().dot(resultLight));
    return 1 - strength / 100 * (1 - light);
  }
  return 1;
}

function nativeUnit(field: string) {
  return ({ U: "m/s", p: "m²/s²", T: "K" } as Record<string, string>)[field] ?? "file units";
}

export function CFDResultLegend({name, range, palette, vertical}: {name:string;range:[number,number];palette:ResultPalette;vertical:boolean}) {
  const colour = new Color();
  const stops = Array.from({length:25}, (_, i) => paintResult(colour, i / 24, palette).getStyle());
  return <aside className="cfx-building-legend" aria-label="CFD result scale" data-vertical={vertical || undefined}>
    <strong>{name} · {nativeUnit(name)}</strong>
    <div className="cfx-building-scale">
      <span>{probeNumber(range[0])}</span>
      <i style={{background: `linear-gradient(${vertical ? "to top" : "to right"}, ${stops.join(",")})`}}/>
      <span>{probeNumber(range[1])}</span>
    </div>
  </aside>;
}

export function CFDSceneProbeReading({sample}: {sample:ResultPointValue}) {
  const [x,y,z] = sample.position;
  return <group position={[x,z,-y]}>
    <mesh renderOrder={5} raycast={()=>{}}>
      <sphereGeometry args={[.018,12,8]} />
      <meshBasicMaterial color="#ffa754" depthTest={false} depthWrite={false}/>
    </mesh>
    <Html style={{pointerEvents:"none"}} zIndexRange={[8,0]}>
      <output className="cfx-building-probe" aria-label="Picked result value" data-probe-value={sample.value} data-probe-position={JSON.stringify(sample.position)}>
        {sample.field}{sample.component ? ` ${sample.component}` : ""} = {probeNumber(sample.value)} {nativeUnit(sample.field)}
      </output>
    </Html>
  </group>;
}

/** Native worker files are in metres. Convert only at the Three rendering boundary. */
export function CFDSceneResult({file,field,onMetadata,probing=false,onProbe,onContextMenu,onSelect,selected:active,palette="spectrum",range,appearance=DEFAULT_RESULT_APPEARANCE}:CFDSceneResultProps) {
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
  const low=range?.[0]??selected?.range[0]??0,high=range?.[1]??selected?.range[1]??1;
  const geometry=useMemo(()=>{
    if(!data)return null;
    const colour=new Color(),colours:number[]=[];
    for(let vertex=0;vertex<data.mesh.triangles.length;vertex++){
      const tuple=selected?.cell?data.mesh.cells[Math.floor(vertex/3)]:data.mesh.triangles[vertex];
      const value=selected&&values?(selected.components>1?Math.hypot(...Array.from({length:selected.components},(_,i)=>values[tuple*selected.components+i])):values[tuple]):low;
      const scaled = (value - low) / (high - low);
      const fraction = high > low && Number.isFinite(scaled) ? Math.max(0, Math.min(1, scaled)) : .5;
      paintResult(colour,fraction,palette);colours.push(colour.r,colour.g,colour.b);
    }
    const value=new BufferGeometry();value.setAttribute("position",new Float32BufferAttribute(data.positions,3));value.setAttribute("color",new Float32BufferAttribute(colours,3));return value;
  },[data,selected,values,low,high,palette]);
  const showOutline = !!active || (appearance.edges && appearance.edgeOpacity > 0);
  const outline = useMemo(() => showOutline && geometry ? new EdgesGeometry(geometry) : null, [showOutline, geometry]);
  const tint = useMemo(() => {
    const light = data ? planeLighting(data.positions, appearance.shading) : 1;
    return new Color().setRGB(light, light, light);
  }, [data, appearance.shading]);
  useEffect(()=>()=>geometry?.dispose(),[geometry]);
  useEffect(()=>()=>outline?.dispose(),[outline]);
  return geometry?<mesh name={RESULT_PLANE_MESH} geometry={geometry} renderOrder={3} onPointerDown={event=>{
    if(event.button===0)event.stopPropagation();
  }} onContextMenu={event=>{
    if(!onContextMenu)return;event.stopPropagation();event.nativeEvent.preventDefault();event.nativeEvent.stopPropagation();
    if(event.button!==2)onContextMenu(event.clientX,event.clientY);
  }} onPointerUp={event=>{
    if(!onContextMenu||event.button!==2||event.delta>5)return;
    event.stopPropagation();event.nativeEvent.stopPropagation();onContextMenu(event.clientX,event.clientY);
  }} onClick={event=>{
    if(event.button!==0||event.delta>4)return;
    event.stopPropagation();onSelect?.();if(!probing)return;
    if(!data||!selected||!values||event.faceIndex==null){onProbe?.(null);return;}
    onProbe?.(sampleResultPoint(data.mesh,event.faceIndex,[event.point.x,-event.point.z,event.point.y],selected,values));
  }}>
    <meshBasicMaterial vertexColors color={tint} toneMapped={false} side={DoubleSide}/>
    {outline&&<lineSegments geometry={outline} renderOrder={4} raycast={()=>{}}>
      <lineBasicMaterial color={active ? "#ffc080" : "#233954"} depthTest={!active} depthWrite={false}
        toneMapped={false} transparent={!active} opacity={active ? 1 : appearance.edgeOpacity / 100}/>
    </lineSegments>}
  </mesh>:null;
}
