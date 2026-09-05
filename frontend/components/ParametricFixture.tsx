"use client";
import { RoundedBox } from "@react-three/drei";
import { Vector2, DoubleSide } from "three";
import { fixtureRepresentation } from "@/components/FixturePlanSymbol";
import type { Obstacle } from "@/lib/types";

const bowlProfile = [[0.07, 0], [0.12, 0.025], [0.27, 0.07], [0.39, 0.19], [0.48, 0.36], [0.5, 0.43], [0.48, 0.46], [0.44, 0.44], [0.40, 0.30], [0.31, 0.16], [0.16, 0.10], [0.07, 0.09]].map(([x, y]) => new Vector2(x, y));
function Bowl({ x = 0, y, z = 0, width, depth, height }: { x?: number; y: number; z?: number; width: number; depth: number; height: number }) {
  return <group position={[x, y, z]}>
    <mesh scale={[width, height / .46, depth]} castShadow receiveShadow><latheGeometry args={[bowlProfile, 64]} /><meshStandardMaterial color="#fafaf7" roughness={.16} side={DoubleSide} /></mesh>
    <mesh position={[0, height * .21, 0]}><cylinderGeometry args={[width * .04, width * .04, .005, 20]} /><meshStandardMaterial color="#89928f" metalness={.8} roughness={.18} /></mesh>
  </group>;
}
function Block({ position, size, colour = "#f4f3ef" }: { position: [number, number, number]; size: [number, number, number]; colour?: string }) {
  return <RoundedBox args={size} radius={Math.min(...size) * .18} smoothness={4} position={position} castShadow receiveShadow><meshStandardMaterial color={colour} roughness={.25} /></RoundedBox>;
}

/** Normalised render-only geometry: world millimetres are converted by the caller. */
export function ParametricFixture({ obstacle, width, depth, height }: { obstacle: Obstacle; width: number; depth: number; height: number }) {
  const key = fixtureRepresentation(obstacle);
  const kind = obstacle.fixture_kind ?? key.split("-")[0].toUpperCase();
  const chrome = <meshStandardMaterial color="#bac4c3" metalness={.92} roughness={.16} />;
  const glass = <meshPhysicalMaterial color="#d5e8e8" transparent opacity={.25} roughness={.06} metalness={.05} depthWrite={false} side={DoubleSide} />;
  return <group scale={[width, height, depth]}>
    {kind === "TOILET" && (() => {
      const cistern = key.includes("close-coupled");
      const hung = key.includes("wall-mounted");
      const top = cistern ? .52 : .94;
      return <>
        {!hung && <Block position={[0, top * .29, .06]} size={[.55, top * .58, .56]} />}
        {hung && <Block position={[0, .56, -.30]} size={[.66, .50, .38]} />}
        <Bowl y={top * .38} z={.10} width={.96} depth={.76} height={top * .60} />
        <mesh position={[0, top, .10]} rotation={[-Math.PI / 2, 0, 0]} scale={[.88, .70, .4]}><torusGeometry args={[.45, .042, 16, 64]} /><meshStandardMaterial color="#fffefa" roughness={.2} /></mesh>
        {cistern && <><Block position={[0, .63, -.35]} size={[.92, .70, .29]} /><Block position={[0, .98, -.35]} size={[.94, .035, .31]} /><mesh position={[0, 1, -.35]}>{chrome}<cylinderGeometry args={[.06, .06, .008, 24]} /></mesh></>}
      </>;
    })()}
    {kind === "BASIN" && (() => {
      const vanity = key.includes("vanity") || key.includes("undermount");
      const double = key.includes("double");
      return <>
        {vanity && <><Block position={[0, .33, 0]} size={[.94, .62, .94]} colour={obstacle.color_hex === "#F4F3EE" ? "#a78d70" : obstacle.color_hex ?? "#a78d70"} />{[-.24, .24].map(x => <group key={x}><Block position={[x, .33, .475]} size={[.455, .57, .03]} colour="#b7a187" /><Block position={[x, .57, .496]} size={[.20, .012, .008]} colour="#76827c" /></group>)}<Block position={[0, .68, 0]} size={[1, .04, 1]} /></>}
        {key.includes("pedestal") && <mesh position={[0, .36, -.04]} castShadow><cylinderGeometry args={[.18, .26, .72, 48]} /><meshStandardMaterial color="#f4f3ef" roughness={.2} /></mesh>}
        {key.includes("countertop") && <Block position={[0, .69, 0]} size={[1, .06, 1]} colour="#a78d70" />}
        {!vanity && !key.includes("countertop") && <Block position={[0, .76, -.34]} size={[.94, .14, .27]} />}
        {(double ? [-.25, .25] : [0]).map(x => <group key={x}>
          <Bowl x={x} y={.71} z={.07} width={double ? .44 : .98} depth={.83} height={.20} />
          <mesh position={[x, .86, -.38]}>{chrome}<cylinderGeometry args={[.024, .026, .24, 20]} /></mesh>
          <Block position={[x, .974, -.29]} size={[.05, .045, .23]} colour="#aebbb9" />
        </group>)}
      </>;
    })()}
    {kind === "SHOWER" && <>
      <Block position={[0, .017, 0]} size={[1, .034, 1]} />
      <Block position={[0, .036, .10]} size={[.15, .004, .09]} colour="#737f7c" />
      {key.includes("quadrant") ? <mesh position={[-.45, .515, -.45]}><cylinderGeometry args={[.91, .91, .96, 48, 1, true, 0, Math.PI / 2]} />{glass}</mesh> : <>
        {!key.includes("wet-room") && <mesh position={[-.492, .515, 0]}><boxGeometry args={[.012, .96, 1]} />{glass}</mesh>}
        {!key.includes("walk-in") && !key.includes("wet-room") && <mesh position={[.492, .515, 0]}><boxGeometry args={[.012, .96, 1]} />{glass}</mesh>}
        <mesh position={[key.includes("walk-in") ? -.15 : 0, .515, .492]}><boxGeometry args={[key.includes("walk-in") || key.includes("wet-room") ? .66 : 1, .96, .012]} />{glass}</mesh>
      </>}
      {key.includes("freestanding") && <mesh position={[0, .515, -.492]}><boxGeometry args={[1, .96, .012]} />{glass}</mesh>}
      <mesh position={[0, .58, -.46]}>{chrome}<cylinderGeometry args={[.014, .014, .66, 16]} /></mesh>
      <Block position={[0, .91, -.34]} size={[.025, .012, .24]} colour="#b0bbba" />
      <mesh position={[0, .905, -.23]}>{chrome}<cylinderGeometry args={[.12, .12, .015, 40]} /></mesh>
      <Block position={[0, .44, -.45]} size={[.20, .035, .06]} colour="#b0bbba" />
    </>}
  </group>;
}
