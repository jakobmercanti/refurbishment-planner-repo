"use client";
import { OpeningFinishMaterial } from "@/components/OpeningFinishMaterial";
import { useMemo } from "react";
import { Path, Shape } from "three";

function section(width: number, height: number, border: number) {
  const shape = new Shape(); shape.moveTo(-width / 2, 0); shape.lineTo(width / 2, 0); shape.lineTo(width / 2, height); shape.lineTo(-width / 2, height); shape.closePath();
  const hole = new Path(); hole.moveTo(-width / 2 + border, border); hole.lineTo(-width / 2 + border, height - border); hole.lineTo(width / 2 - border, height - border); hole.lineTo(width / 2 - border, border); hole.closePath(); shape.holes.push(hole); return shape;
}

export function CasementWindow({ representation, width: w, depth: d, height: h, colour: frameColour = "#F4F3EE" }: { colour?: string; representation: string; width: number; depth: number; height: number }) {
  const count = representation.includes("triple") ? 3 : representation.includes("double") || representation === "window-casement" ? 2 : 1;
  const unit = h / 1200, border = Math.min(w * .045, 45 * unit), gap = 3 * unit;
  const sashWidth = (w - 2 * border - (count - 1) * border * .55) / count - gap * 2, sashHeight = h - 2 * border - gap * 2;
  const rail = Math.min(sashWidth * .1, 36 * unit), frameDepth = Math.min(d * .75, 80 * unit);
  const outer = useMemo(() => section(w, h, border), [w, h, border]);
  const sash = useMemo(() => section(sashWidth, sashHeight, rail), [sashWidth, sashHeight, rail]);
  const gasket = useMemo(() => section(sashWidth - rail * 1.6, sashHeight - rail * 1.6, 3 * unit), [sashWidth, sashHeight, rail, unit]);
  const bead = useMemo(() => section(sashWidth - rail * 1.9, sashHeight - rail * 1.9, 6 * unit), [sashWidth, sashHeight, rail, unit]);
  function box(x: number, y: number, z: number, width: number, height: number, depth: number, colour = frameColour, metal = false) {
    return <mesh position={[x, y, z]} castShadow receiveShadow><boxGeometry args={[width, height, depth]} />{metal ? <meshStandardMaterial color={colour} roughness={.24} metalness={.8} /> : <OpeningFinishMaterial colour={colour} />}</mesh>;
  }
  return <group>
    <mesh position={[0, 0, -frameDepth / 2]} castShadow receiveShadow><extrudeGeometry args={[outer, { depth: frameDepth, bevelEnabled: false }]} /><OpeningFinishMaterial colour={frameColour} /></mesh>
    {Array.from({ length: count }, (_, i) => {
      const x = -w / 2 + border + gap + sashWidth / 2 + i * (sashWidth + gap * 2 + border * .55), side = i === count - 1 && count > 1 ? -1 : 1;
      return <group key={i} position={[x, border + gap, frameDepth * .18]}>
        <mesh position={[0, 0, -frameDepth * .26]} castShadow receiveShadow><extrudeGeometry args={[sash, { depth: frameDepth * .54, bevelEnabled: true, bevelSize: 1.2 * unit, bevelThickness: 1.2 * unit, bevelSegments: 2 }]} /><OpeningFinishMaterial colour={frameColour} /></mesh>
        <mesh position={[0, rail * .8, frameDepth * .04]}><extrudeGeometry args={[gasket, { depth: 2 * unit, bevelEnabled: false }]} /><meshStandardMaterial color="#414747" roughness={.8} /></mesh>
        <mesh position={[0, rail * .95, frameDepth * .08]}><extrudeGeometry args={[bead, { depth: 5 * unit, bevelEnabled: true, bevelSize: unit, bevelThickness: unit, bevelSegments: 2 }]} /><OpeningFinishMaterial colour={frameColour} /></mesh>
        {[-1, 1].map(face => <mesh key={face} position={[0, sashHeight / 2, face * 7 * unit]}><boxGeometry args={[sashWidth - 2 * rail, sashHeight - 2 * rail, 4 * unit]} /><meshPhysicalMaterial color="#b8d0d7" transparent opacity={.19} roughness={.025} metalness={.05} depthWrite={false} /></mesh>)}
        {box(side * (sashWidth / 2 - rail * .5), sashHeight * .46, frameDepth * .43, rail * .35, 45 * unit, 8 * unit, "#aab0ad", true)}
        {box(side * (sashWidth / 2 - rail * .5), sashHeight * .46 - 27 * unit, frameDepth * .62, 9 * unit, 66 * unit, 12 * unit, "#cad0cd", true)}
        {[.16, .84].map(y => <group key={y}>{box(-side * sashWidth / 2, sashHeight * y, frameDepth * .05, 9 * unit, 62 * unit, 10 * unit, "#b4b9b6", true)}</group>)}
        {i < count - 1 && box(sashWidth / 2 + gap + border * .275, sashHeight / 2, -frameDepth * .18, border * .55, sashHeight + 2 * gap, frameDepth)}
      </group>;
    })}
    {box(0, border / 2, frameDepth * .32, w, border * .34, Math.min(d, frameDepth * 1.65))}
    {box(0, h - border * .45, frameDepth * .51, w * .28, 5 * unit, 2 * unit, "#747c79")}
  </group>;
}
