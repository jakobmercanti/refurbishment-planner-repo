"use client";
import { OpeningFinishMaterial } from "@/components/OpeningFinishMaterial";
import { CasementWindow } from "@/components/CasementWindow";
import { useEffect, useMemo } from "react";
import { DataTexture, RepeatWrapping, RGBAFormat, SRGBColorSpace, Shape, Vector3, Quaternion } from "three";
import { STAIRCASE_MODELS, windowPlanVertices } from "@/lib/architecturalModels";

function Bar({ a, b, radius = .012, colour = "#394449" }: { a: [number, number, number]; b: [number, number, number]; radius?: number; colour?: string }) {
  const start = new Vector3(...a), end = new Vector3(...b), delta = end.clone().sub(start);
  const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), delta.clone().normalize());
  return <mesh position={start.add(end).multiplyScalar(.5)} quaternion={rotation} castShadow><cylinderGeometry args={[radius, radius, delta.length(), 12]} /><meshStandardMaterial color={colour} roughness={.32} metalness={.65} /></mesh>;
}

function GlassRail({ a, b, guardA, guardB, unit }: { a: [number, number, number]; b: [number, number, number]; guardA: number; guardB: number; unit: number }) {
  const length = Math.hypot(b[0] - a[0], b[2] - a[2]), rise = b[1] - a[1];
  const shape = useMemo(() => {
    const panel = new Shape();
    panel.moveTo(0, 70 * unit); panel.lineTo(length, rise + 70 * unit);
    panel.lineTo(length, rise + guardB - 35 * unit); panel.lineTo(0, guardA - 35 * unit); panel.closePath();
    return panel;
  }, [length, rise, guardA, guardB, unit]);
  return <group position={a} rotation={[0, -Math.atan2(b[2] - a[2], b[0] - a[0]), 0]}>
    <mesh position={[0, 0, -6 * unit]} castShadow><extrudeGeometry args={[shape, { depth: 12 * unit, bevelEnabled: true, bevelSize: unit, bevelThickness: unit, bevelSegments: 2 }]} /><meshPhysicalMaterial color="#c2e0e3" transparent opacity={.3} transmission={.3} roughness={.08} metalness={.04} depthWrite={false} /></mesh>
    {[.15, .85].map(t => <mesh key={t} position={[length * t, rise * t + 80 * unit, 0]}><boxGeometry args={[Math.min(35 * unit, length * .18), 45 * unit, 24 * unit]} /><meshStandardMaterial color="#afb8bb" metalness={.85} roughness={.24} /></mesh>)}
  </group>;
}

export function StaircaseFixture({ representation, width, depth, height, colour, handrailColour = "#725236", wallColour = "#e5ded2", supportColour = "#465052" }: { representation: string; width: number; depth: number; height: number; colour?: string; handrailColour?: string; wallColour?: string; supportColour?: string }) {
  const model = STAIRCASE_MODELS[representation];
  const oak = useMemo(() => {
    const pixels = new Uint8Array(128 * 128 * 4);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const grain = Math.sin(y * 1.7 + Math.sin(x / 18) * .7) * 8 + Math.sin(y * .28 + x * .01) * 5;
      const index = (y * 128 + x) * 4;
      pixels.set([188 + grain, 149 + grain, 102 + grain, 255], index);
    }
    const texture = new DataTexture(pixels, 128, 128, RGBAFormat);
    texture.colorSpace = SRGBColorSpace; texture.wrapS = texture.wrapT = RepeatWrapping; texture.needsUpdate = true;
    return texture;
  }, []);
  useEffect(() => () => oak.dispose(), [oak]);
  const treads = useMemo(() => model?.steps.map(step => {
    const shape = new Shape();
    step.points.forEach(([x, z], i) => { const px = (x / model.width - .5) * width, py = -(z / model.depth - .5) * depth; if (i === 0) shape.moveTo(px, py); else shape.lineTo(px, py); });
    shape.closePath();
    return { shape, top: step.top / model.height * height };
  }) ?? [], [model, width, depth, height]);
  if (!model) return null;
  const sy = height / model.height, thickness = 40 * sy;
  const point = (p: number[], guard = 0): [number, number, number] => [(p[0] / model.width - .5) * width, (p[2] + guard) * sy, (p[1] / model.depth - .5) * depth];
  return <group>
    {treads.map(({ shape, top }, i) => <group key={i}>
      <mesh position={[0, top - thickness, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow><extrudeGeometry args={[shape, { depth: thickness, bevelEnabled: false }]} />{colour && colour.toUpperCase() !== "#F4F3EE" ? <OpeningFinishMaterial colour={colour} /> : <meshStandardMaterial map={oak} color="#ffffff" roughness={.48} />}</mesh>
      {!model.open && <mesh rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow><extrudeGeometry args={[shape, { depth: Math.max(thickness, top - thickness), bevelEnabled: false }]} /><meshStandardMaterial color={wallColour} roughness={.75} /></mesh>}
      {model.open && <mesh position={[0, top - thickness * 2, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow><extrudeGeometry args={[shape, { depth: thickness, bevelEnabled: false }]} /><meshStandardMaterial color={supportColour} roughness={.38} metalness={.65} /></mesh>}
    </group>)}
    {model.rails.map((rail, i) => <group key={i}>
      {model.glass ? <GlassRail a={point(rail.a)} b={point(rail.b)} guardA={rail.guard_a * sy} guardB={rail.guard_b * sy} unit={sy} /> : <>
        <Bar a={point(rail.a, rail.guard_a)} b={point(rail.b, rail.guard_b)} radius={20 * sy} colour={handrailColour} />
        <Bar a={point(rail.a, rail.guard_a - 440)} b={point(rail.b, rail.guard_b - 440)} radius={8 * sy} colour={handrailColour} />
        {rail.post && <Bar a={point(rail.a)} b={point(rail.a, rail.guard_a)} radius={12 * sy} colour={handrailColour} />}
      </>}
    </group>)}
    {model.open && !model.column && model.steps.slice(0, -1).map((step, i) => {
      const centre = (s: typeof step): [number, number, number] => [s.points.reduce((sum, p) => sum + (p[0] / model.width - .5) * width, 0) / s.points.length, (s.top - 90) * sy, s.points.reduce((sum, p) => sum + (p[1] / model.depth - .5) * depth, 0) / s.points.length];
      const next = model.steps.filter(candidate => candidate.top > step.top).sort((a, b) => {
        const origin = centre(step), ca = centre(a), cb = centre(b);
        return Math.hypot(ca[0] - origin[0], ca[2] - origin[2], ca[1] - origin[1]) - Math.hypot(cb[0] - origin[0], cb[2] - origin[2], cb[1] - origin[1]);
      })[0];
      return next ? <Bar key={i} a={centre(step)} b={centre(next)} radius={65 * sy} colour={supportColour} /> : null;
    })}
    {model.column && <mesh position={[0, height / 2, 0]} castShadow><cylinderGeometry args={[100 * width / model.width, 100 * width / model.width, height, 32]} /><meshStandardMaterial color={supportColour} metalness={.7} roughness={.3} /></mesh>}
  </group>;
}

export function WindowFixture({ representation, width, depth, height, colour = "#F4F3EE" }: { colour?: string; representation: string; width: number; depth: number; height: number }) {
  const vertices = windowPlanVertices(representation, width * .95, depth * .88);
  const sillShape = useMemo(() => {
    const shape = new Shape();
    windowPlanVertices(representation, width * .98, depth * .96).forEach(([x, z], i) => { if (i === 0) shape.moveTo(x, -z); else shape.lineTo(x, -z); });
    shape.closePath();
    return shape;
  }, [representation, width, depth]);
  if (["window-single-pane", "window-double-pane", "window-triple-pane", "window-casement"].includes(representation)) return <CasementWindow colour={colour} representation={representation} width={width} depth={depth} height={height} />;
  const frame = Math.min(width * .035, height * .035, depth * .28);
  const projected = representation === "window-bay" || representation === "window-bow";
  const count = representation.includes("triple") ? 3 : representation.includes("double") || representation === "window-casement" ? 2 : 1;
  function block(x: number, y: number, z: number, w: number, h: number, d: number) {
    return <mesh position={[x, y, z]} castShadow receiveShadow><boxGeometry args={[w, h, d]} /><OpeningFinishMaterial colour={colour} /></mesh>;
  }
  return <group>
    {vertices.slice(0, -1).map(([x, z], i) => {
      const [bx, bz] = vertices[i + 1], length = Math.hypot(bx - x, bz - z), sash = representation === "window-sash";
      return <group key={i} position={[(x + bx) / 2, 0, (z + bz) / 2]} rotation={[0, -Math.atan2(bz - z, bx - x), 0]}>
        {block(0, frame / 2, 0, length, frame, frame * 2)}
        {block(0, height - frame / 2, 0, length, frame, frame * 2)}
        {[-1, 1].map(side => <group key={side}>{block(side * (length - frame) / 2, height / 2, 0, frame, height, frame * 2)}</group>)}
        {Array.from({ length: sash ? 2 : projected ? 1 : count }, (_, pane) => {
          const panes = projected ? 1 : count, pw = (length - frame * 2) / panes, ph = sash ? (height - frame * 2) / 2 : height - frame * 2;
          const px = sash ? 0 : -length / 2 + frame + pw * (pane + .5), py = sash ? frame + ph * (pane + .5) : height / 2, pz = sash ? (pane ? -1 : 1) * frame * .35 : 0;
          return <group key={pane}>
            <mesh position={[px, py, pz]}><boxGeometry args={[sash ? length - frame * 2 : pw, ph, frame * .12]} /><meshPhysicalMaterial color="#a6cad7" transparent opacity={.36} roughness={.05} metalness={.08} depthWrite={false} /></mesh>
            {block(px, py, pz, sash ? length - frame * 2 : frame * .45, sash ? frame * .4 : ph, frame * .6)}
            {sash && block(0, py, pz, frame * .4, ph, frame * .6)}
            {sash && [-1, 1].map(side => <group key={side}>{block(0, py + side * ph / 2, pz, length - frame * 2, frame * .8, frame)}</group>)}
            {!sash && !projected && block(px + pw * .35, height * .48, frame, frame * .35, height * .055, frame * .6)}
          </group>;
        })}
        {!sash && !projected && count > 1 && block(0, height / 2, 0, frame, height - frame * 2, frame * 1.5)}
        {block(0, frame * .2, frame * .3, length + frame, frame * .4, frame * 3)}
      </group>;
    })}
    {projected && <mesh rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow><extrudeGeometry args={[sillShape, { depth: frame * .6, bevelEnabled: false }]} /><OpeningFinishMaterial colour={colour} /></mesh>}
  </group>;
}
