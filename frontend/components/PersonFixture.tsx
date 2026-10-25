"use client";

import { useEffect, useMemo } from "react";
import { LatheGeometry, Quaternion, Vector2, Vector3 } from "three";
import { personDimensions, personSpec } from "@/lib/people";
import type { Obstacle } from "@/lib/types";

type Point = [number, number, number];
function Ellipsoid({ position, size, colour, roughness = .8 }: { position: Point; size: Point; colour: string; roughness?: number }) {
  return <mesh position={position} scale={size.map(v => v / 2) as Point} castShadow receiveShadow><sphereGeometry args={[1, 24, 16]} /><meshStandardMaterial color={colour} roughness={roughness} /></mesh>;
}
function Limb({ a, b, radius, colour }: { a: Point; b: Point; radius: number; colour: string }) {
  const start = new Vector3(...a), end = new Vector3(...b), direction = end.clone().sub(start);
  return <mesh position={start.add(end).multiplyScalar(.5)} quaternion={new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize())} castShadow receiveShadow>
    <capsuleGeometry args={[radius, Math.max(.001, direction.length() - 2 * radius), 6, 12]} /><meshStandardMaterial color={colour} roughness={.86} />
  </mesh>;
}

function Torso({ stature, position, colour }: { stature: number; position: Point; colour: string }) {
  const geometry = useMemo(() => new LatheGeometry([
    [0, 0], [.085, 0], [.092, .025], [.094, .08], [.108, .20],
    [.12, .27], [.112, .295], [.068, .32], [0, .32],
  ].map(([radius, y]) => new Vector2(radius, y)), 32), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} position={position} scale={[stature, stature, stature * .575]} castShadow receiveShadow><meshStandardMaterial color={colour} roughness={.86} /></mesh>;
}

/** Detailed illustration only. Inputs stay in mm until this rendering boundary. */
export function PersonFixture({ obstacle, width, depth, height, colours }: { obstacle: Obstacle; width: number; depth: number; height: number; colours: Record<string, string> }) {
  const spec = personSpec(obstacle);
  if (!spec) return null;
  const stature = spec.stature_mm, size = personDimensions(spec), seated = spec.posture === "SEATED", lying = spec.posture === "LYING";
  const mannequin = spec.style === "MANNEQUIN", smart = spec.style === "SMART";
  const skin = mannequin ? "#B8C4C7" : colours.skin ?? "#B98260", hair = colours.hair ?? "#302925";
  const top = mannequin ? skin : colours.top ?? obstacle.color_hex ?? "#426A83";
  const trousers = mannequin ? skin : colours.trousers ?? (smart ? "#353B45" : "#334F65");
  const shoes = mannequin ? skin : colours.shoes ?? "#30383D";
  const p = (x: number, y: number, z: number): Point => [x * stature, y * stature, z * stature];
  const seat = seated ? spec.seat_height_mm / stature : 0, back = seated ? -.16 : 0;
  const hips = seated ? seat + .065 : .49, shoulder = seated ? seat + .38 : .79;
  const head = seated ? seat + .445 : .925;
  const footBase = seated ? Math.max(0, seat - .245) : 0;
  const headGroup = <group position={p(0, head, back)} name="person-detailed-head">
    <Ellipsoid position={[0, 0, 0]} size={p(.125, .14, .123)} colour={skin} roughness={.72} />
    {!mannequin && <>
      <mesh position={p(0, .002, -.002)} scale={p(.065, .073, .064)} castShadow><sphereGeometry args={[1, 24, 16, 0, Math.PI * 2, 0, 1.25]} /><meshStandardMaterial color={hair} roughness={.95} /></mesh>
      {[-1, 1].map(side => <group key={side}>
        <Ellipsoid position={p(side * .062, -.003, 0)} size={p(.016, .031, .022)} colour={skin} />
        <Ellipsoid position={p(side * .023, .006, .056)} size={p(.019, .010, .010)} colour="#EEECE7" />
        <Ellipsoid position={p(side * .023, .006, .061)} size={p(.006, .007, .004)} colour="#373B38" />
        <Limb a={p(side * .014, .019, .057)} b={p(side * .033, .020, .053)} radius={stature * .002} colour={hair} />
      </group>)}
      <Ellipsoid position={p(0, -.008, .063)} size={p(.014, .029, .019)} colour={skin} />
      <Ellipsoid position={p(0, -.031, .056)} size={p(.026, .004, .005)} colour="#865649" />
    </>}
  </group>;
  const body = <group name="person-detailed-body">
    <Torso stature={stature} position={p(0, seated ? seat + .10 : .50, back)} colour={top} />
    <Ellipsoid position={p(0, hips, back)} size={p(.20, .13, .14)} colour={trousers} />
    <Limb a={p(0, shoulder + .015, back)} b={p(0, head - .045, back)} radius={.035 * stature} colour={skin} />
    {headGroup}
    {[-1, 1].map(side => {
      const hip = p(side * .055, hips, back), knee = p(side * .055, seated ? seat + .045 : .265, seated ? .14 : .005);
      const ankle = p(side * .055, footBase + .055, seated ? .16 : 0);
      const upper = p(side * .105, shoulder, back), elbow = p(side * .12, seated ? seat + .20 : .64, seated ? -.08 : 0);
      const wrist = p(side * (seated ? .08 : .12), seated ? seat + .105 : .49, seated ? .08 : .012);
      return <group key={side}>
        <Limb a={hip} b={knee} radius={.039 * stature} colour={trousers} />
        <Limb a={knee} b={ankle} radius={.029 * stature} colour={trousers} />
        <Ellipsoid position={knee} size={p(.060, .065, .063)} colour={trousers} />
        <Ellipsoid position={p(side * .055, footBase + .0275, seated ? .18 : .025)} size={p(.082, .055, .14)} colour={shoes} />
        {!mannequin && !smart && <Ellipsoid position={p(side * .055, footBase + .009, seated ? .18 : .025)} size={p(.085, .018, .14)} colour="#D8DCE0" />}
        <Limb a={upper} b={elbow} radius={.025 * stature} colour={top} />
        <Limb a={elbow} b={wrist} radius={.021 * stature} colour={smart ? top : skin} />
        <Ellipsoid position={elbow} size={p(.043, .047, .045)} colour={smart ? top : skin} />
        <Ellipsoid position={wrist} size={p(.041, .067, .031)} colour={skin} />
      </group>;
    })}
    {smart && !mannequin && <>
      {[.16, .22, .28, .34].map(offset => <Ellipsoid key={offset} position={p(0, (seated ? seat : .40) + offset, back + .067)} size={p(.005, .005, .005)} colour="#E1E5E9" />)}
      {[-1, 1].map(side => <mesh key={side} position={p(side * .027, shoulder + .002, back + .045)} rotation={[0, 0, side * .45]}><boxGeometry args={p(.034, .041, .007)} /><meshStandardMaterial color={top} roughness={.8} /></mesh>)}
    </>}
  </group>;
  return <group name={`catalogue-person-${spec.posture.toLowerCase()}`} scale={[width / size.width, height / size.height, depth / size.depth]}>
    {lying ? <group position={p(0, .07, .5)} rotation={[-Math.PI / 2, 0, 0]}>{body}</group> : body}
  </group>;
}
