"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BufferGeometry, Color, DataTexture, DoubleSide, EdgesGeometry, Float32BufferAttribute, LinearFilter, Mesh, Vector2, Vector3 } from "three";
import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import type vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData";
import { readResultData, type ResultField } from "@/lib/cfdResultData";
import { probeNumber, resultProbeMesh, sampleResultPoint, type ProbeMesh, type ResultPointValue } from "@/lib/cfdPointProbe";

export interface SceneResultMetadata { fields:{key:string;name:string;range:[number,number]}[];error:string;meshSection?:boolean }
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
export interface CFDSceneResultProps { file:File;field:string;onMetadata:(value:SceneResultMetadata)=>void;probing?:boolean;onProbe?:(value:ResultPointValue|null)=>void;onContextMenu?:(x:number,y:number)=>void;onSelect?:()=>void;selected?:boolean;palette?:ResultPalette;range?:[number,number];appearance?:ResultAppearance;visible?:boolean;showMesh?:boolean }

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

const paletteTextures = new Map<ResultPalette, DataTexture>();
function paletteTexture(palette: ResultPalette) {
  const cached = paletteTextures.get(palette);
  if (cached) return cached;
  const pixels = new Uint8Array(256 * 4), colour = new Color();
  for (let i = 0; i < 256; i++) {
    paintResult(colour, i / 255, palette);
    pixels.set([Math.round(255 * colour.r), Math.round(255 * colour.g), Math.round(255 * colour.b), 255], i * 4);
  }
  const texture = new DataTexture(pixels, 256, 1);
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  paletteTextures.set(palette, texture);
  return texture;
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
  return /^(U|U[xyz])$/.test(field) ? "m/s" : ({ p: "m²/s²", T: "K" } as Record<string, string>)[field] ?? "file units";
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
      <sphereGeometry args={[.045,16,12]} />
      <meshBasicMaterial color="#000000" depthTest={false} depthWrite={false}/>
    </mesh>
    <Html style={{pointerEvents:"none"}} zIndexRange={[8,0]}>
      <output className="cfx-building-probe" aria-label="Picked result value" data-probe-value={sample.value} data-probe-position={JSON.stringify(sample.position)}>
        {sample.field}{sample.component ? ` ${sample.component}` : ""} = {probeNumber(sample.value)} {nativeUnit(sample.field)}
      </output>
    </Html>
  </group>;
}

/** Native worker files are in metres. Convert only at the Three rendering boundary. */
export function CFDSceneResult({file,field,onMetadata,probing=false,onProbe,onContextMenu,onSelect,selected:active,palette="spectrum",range,appearance=DEFAULT_RESULT_APPEARANCE,visible=true,showMesh=false}:CFDSceneResultProps) {
  const invalidate = useThree(state => state.invalidate);
  const [surface,setSurface]=useState<{file:File;positions:number[];mesh:ProbeMesh;fields:ResultField[];
    arrays:Map<string,ArrayLike<number>>;section:number[]|null}|null>(null);
  const [failure, setFailure] = useState<{file:File;error:string}>();
  useEffect(()=>{
    let cancelled=false;
    void(async()=>{
      const loaded=await readResultData(file);
      try {
        if(cancelled)return;
        if(loaded.volume)throw new Error("Use the independent inspector to slice structured volumes before exporting a surface to the building viewer.");
        const data=loaded.data as vtkPolyData;
        const source=data.getPoints().getData(),positions:number[]=[],polygons=data.getPolys().getData();
        const mesh=resultProbeMesh(source,polygons,data.getNumberOfVerts()+data.getNumberOfLines(),data.getStrips().getData());
        for(const id of mesh.triangles)positions.push(source[id*3],source[id*3+2],-source[id*3+1]);
        const arrays=new Map<string,ArrayLike<number>>(),fields=[...loaded.fields];
        for (const item of loaded.fields) {
          const array = (item.cell ? data.getCellData() : data.getPointData()).getArrayByName(item.name);
          if (!array) continue;
          const values = array.getData();
          arrays.set(item.key, values);
          if (item.name !== "U" || item.components !== 3) continue;
          ["Ux", "Uy", "Uz"].forEach((name, axis) => {
            const key = `${item.cell ? "cell" : "point"}:${name}`;
            if (fields.some(candidate => candidate.key === key)) return;
            const component = Float32Array.from({length: values.length / 3}, (_, i) => values[i * 3 + axis]);
            const range = item.componentRanges[axis];
            arrays.set(key, component);
            fields.push({key,name,cell:item.cell,components:1,range,componentRanges:[range]});
          });
        }
        // These polygons are the native post-processing cell cuts, before display triangulation.
        const section = loaded.meshSection ? [] as number[] : null;
        const edges = new Set<number>();
        if (section) for (let at = 0; at < polygons.length;) {
          const count = polygons[at++];
          for (let i = 0; i < count; i++) {
            const a = polygons[at + i] * 3, b = polygons[at + (i + 1) % count] * 3;
            const key = Math.min(a,b) * source.length + Math.max(a,b);
            if (a === b || edges.has(key)) continue;
            edges.add(key);
            section.push(source[a],source[a+2],-source[a+1],source[b],source[b+2],-source[b+1]);
          }
          at += count;
        }
        if(!positions.length)throw new Error("The building overlay needs polygon surface data. Inspect this file in the independent viewer instead.");
        if(!cancelled)setSurface({file,positions,mesh,fields,arrays,section});
      } finally {loaded.dispose();}
    })().catch(error=>{if(!cancelled)setFailure({file,error:error instanceof Error?error.message:"Result overlay could not be loaded."});});
    return()=>{cancelled=true;};
  },[file]);
  const data=surface?.file===file?surface:null;
  useEffect(() => {
    if (data) onMetadata({fields:data.fields.map(({key,name,range})=>({key,name,range})),error:"",meshSection:!!data.section?.length});
    else if (failure?.file === file) onMetadata({fields:[],error:failure.error});
  }, [data, failure, file, onMetadata]);
  const selected=data?.fields.find(item=>item.key===field)??data?.fields[0],values=selected?data?.arrays.get(selected.key):undefined;
  const low=range?.[0]??selected?.range[0]??0,high=range?.[1]??selected?.range[1]??1;
  const geometry=useMemo(()=>{
    if(!data)return null;
    const scalars=new Float32Array(data.mesh.triangles.length);
    for(let vertex=0;vertex<data.mesh.triangles.length;vertex++){
      const tuple=selected?.cell?data.mesh.cells[Math.floor(vertex/3)]:data.mesh.triangles[vertex];
      const value=selected&&values?(selected.components>1?Math.hypot(...Array.from({length:selected.components},(_,i)=>values[tuple*selected.components+i])):values[tuple]):0;
      scalars[vertex] = Number.isFinite(value) ? value : 0;
    }
    const value=new BufferGeometry();value.setAttribute("position",new Float32BufferAttribute(data.positions,3));value.setAttribute("cfdScalar",new Float32BufferAttribute(scalars,1));return value;
  },[data,selected,values]);
  const outline = useMemo(() => geometry ? new EdgesGeometry(geometry) : null, [geometry]);
  const meshSection = useMemo(() => {
    if (!data?.section?.length) return null;
    return new BufferGeometry().setAttribute("position", new Float32BufferAttribute(data.section, 3));
  }, [data]);
  const tint = useMemo(() => {
    const light = data ? planeLighting(data.positions, appearance.shading) : 1;
    return new Color().setRGB(light, light, light);
  }, [data, appearance.shading]);
  useEffect(()=>()=>geometry?.dispose(),[geometry]);
  useEffect(()=>()=>outline?.dispose(),[outline]);
  useEffect(()=>()=>meshSection?.dispose(),[meshSection]);
  const uniforms = useRef({
    cfdRange: {value:new Vector2()},
    cfdPalette: {value:null as DataTexture | null},
  });
  useLayoutEffect(() => {
    uniforms.current.cfdRange.value.set(low, high);
    uniforms.current.cfdPalette.value = paletteTexture(palette);
    invalidate();
  }, [high, low, palette, uniforms, invalidate]);
  return geometry?<mesh name={visible ? RESULT_PLANE_MESH : "buffered-cfd-result"} geometry={geometry} renderOrder={3} visible={visible}
    raycast={visible ? Mesh.prototype.raycast : () => {}} onPointerDown={event=>{
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
    <meshBasicMaterial color={tint} toneMapped={false} side={DoubleSide} onBeforeCompile={shader => {
      Object.assign(shader.uniforms, uniforms.current);
      shader.vertexShader = "attribute float cfdScalar; varying float vCfdScalar;\n" + shader.vertexShader
        .replace("#include <color_vertex>", "#include <color_vertex>\n vCfdScalar = cfdScalar;");
      shader.fragmentShader = "uniform vec2 cfdRange; uniform sampler2D cfdPalette; varying float vCfdScalar;\n" + shader.fragmentShader
        .replace("#include <color_fragment>", `#include <color_fragment>
          float spanCfd = cfdRange.y - cfdRange.x;
          float tCfd = spanCfd > 0.0 ? clamp((vCfdScalar - cfdRange.x) / spanCfd, 0.0, 1.0) : 0.5;
          diffuseColor.rgb *= texture2D(cfdPalette, vec2((tCfd * 255.0 + 0.5) / 256.0, 0.5)).rgb;`);
    }}/>
    {meshSection&&<lineSegments geometry={meshSection} visible={showMesh} renderOrder={4} raycast={()=>{}}>
      <lineBasicMaterial color="#172537" transparent opacity={.58} depthWrite={false} toneMapped={false}/>
    </lineSegments>}
    {outline&&<lineSegments geometry={outline} renderOrder={4} raycast={()=>{}}>
      <lineBasicMaterial visible={!!active || appearance.edges} color={active ? "#ffc080" : "#233954"} depthTest={!active} depthWrite={false}
        toneMapped={false} transparent={!active} opacity={active ? 1 : appearance.edgeOpacity / 100}/>
    </lineSegments>}
  </mesh>:null;
}
