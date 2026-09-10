"use client";
import { useEffect, useMemo } from "react";
import { CatmullRomCurve3, LatheGeometry, Path, Shape, Vector2, Vector3 } from "three";

/** Hollow sanitary shell with a rolled rim, inner basin, waste and tap hardware. */
export function BathFixture({ representation, width, depth, height, colour = "#F4F3EE", interiorColour = "#FFFFFF", hardwareColour = "#b6bec1" }: { representation: string; width: number; depth: number; height: number; colour?: string; interiorColour?: string; hardwareColour?: string }) {
  const slipper = representation.endsWith("slipper"), inset = representation.endsWith("alcove"), corner = representation.endsWith("corner");
  const shell = useMemo(() => {
    const outerProfile = [[0, .07], [.28, .07], [.34, .1], [.40, .25], [.46, .62], [.49, .87], [.49, .91], [.48, .94], [.46, .95], [.44, .93]];
    const innerProfile = [[.44, .93], [.43, .89], [.42, .7], [.37, .38], [.29, .2], [.24, .18], [0, .18]];
    return [outerProfile, innerProfile].map(profile => {
      const curve = new CatmullRomCurve3(profile.map(([r, y]) => new Vector3(r, y, 0)));
      const geometry = new LatheGeometry(curve.getPoints(64).map(p => new Vector2(Math.max(0, p.x), p.y)), 96);
      if (slipper) {
        const positions = geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
          const y = positions.getY(i), highEnd = Math.max(0, positions.getX(i) * 2);
          positions.setY(i, y * .78 + Math.max(0, y - .45) * highEnd * .4);
        }
        geometry.computeVertexNormals();
      }
      return geometry;
    });
  }, [slipper]);
  useEffect(() => () => shell.forEach(geometry => geometry.dispose()), [shell]);
  const deck = useMemo(() => {
    const shape = new Shape();
    shape.moveTo(-.5, -.5); shape.lineTo(.5, -.5); shape.lineTo(.5, corner ? -.1 : .5);
    if (corner) shape.quadraticCurveTo(.5, .5, -.1, .5); else shape.lineTo(-.5, .5);
    shape.lineTo(-.5, .5); shape.closePath();
    const hole = new Path(); hole.absellipse(0, 0, .44, .43, 0, Math.PI * 2, true); shape.holes.push(hole);
    return shape;
  }, [corner]);
  const apron = useMemo(() => {
    const shape = new Shape(); shape.moveTo(.5, -.1); shape.quadraticCurveTo(.5, .5, -.1, .5);
    shape.lineTo(-.1, .475); shape.quadraticCurveTo(.475, .475, .475, -.1); shape.closePath(); return shape;
  }, []);
  const tap = useMemo(() => new CatmullRomCurve3([new Vector3(0, .70, -.43), new Vector3(0, .98, -.43), new Vector3(0, .995, -.32), new Vector3(0, .93, -.28)]), []);
  const lift = slipper ? .12 : 0, bodyScale = slipper ? .86 : .91;
  return <group scale={[width, height, depth]}>
    <group position={[0, lift, 0]} scale={[.96, bodyScale, .96]}>
      <mesh geometry={shell[0]} castShadow receiveShadow><meshPhysicalMaterial color={colour} roughness={.22} clearcoat={.7} clearcoatRoughness={.18} /></mesh>
      <mesh geometry={shell[1]} castShadow receiveShadow><meshPhysicalMaterial color={interiorColour} roughness={.16} clearcoat={.9} clearcoatRoughness={.1} /></mesh>
    </group>
    {(inset || corner) && <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .84, 0]} castShadow receiveShadow><extrudeGeometry args={[deck, { depth: .035, bevelEnabled: false, curveSegments: 64 }]} /><meshPhysicalMaterial color={interiorColour} roughness={.2} clearcoat={.65} /></mesh>
      {(corner ? [-1] : [-1, 1]).map(side => <group key={side}>
        <mesh position={[0, .42, (corner ? 1 : side) * .48]} castShadow><boxGeometry args={[.96, .8, .025]} /><meshStandardMaterial color={colour} roughness={.35} /></mesh>
        <mesh position={[side * .48, .42, 0]} castShadow><boxGeometry args={[.025, .8, .96]} /><meshStandardMaterial color={colour} roughness={.35} /></mesh>
      </group>)}
      {corner && <>
        <mesh position={[.48, .42, .3]} castShadow><boxGeometry args={[.025, .8, .4]} /><meshStandardMaterial color={colour} roughness={.3} /></mesh>
        <mesh position={[-.3, .42, -.48]} castShadow><boxGeometry args={[.4, .8, .025]} /><meshStandardMaterial color={colour} roughness={.3} /></mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .02, 0]} castShadow><extrudeGeometry args={[apron, { depth: .82, bevelEnabled: false, curveSegments: 64 }]} /><meshStandardMaterial color={colour} roughness={.3} /></mesh></>}
    </>}
    {slipper && [-1, 1].flatMap(x => [-1, 1].map(z => <group key={`${x}-${z}`} position={[x * .29, .07, z * .28]}>
      <mesh castShadow rotation={[z * .15, 0, -x * .2]}><cylinderGeometry args={[.025, .045, .14, 20]} /><meshStandardMaterial color={hardwareColour} metalness={.85} roughness={.22} /></mesh>
      <mesh position={[x * .015, -.045, z * .015]} scale={[1.6, .5, 1]} castShadow><sphereGeometry args={[.035, 20, 12]} /><meshStandardMaterial color={hardwareColour} metalness={.85} roughness={.22} /></mesh>
    </group>))}
    <mesh position={[0, lift + .18 * (slipper ? .78 : 1) * bodyScale + .003, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[.025, 32]} /><meshStandardMaterial color={hardwareColour} metalness={.9} roughness={.18} /></mesh>
    <mesh castShadow><tubeGeometry args={[tap, 40, .012, 12, false]} /><meshStandardMaterial color={hardwareColour} metalness={.9} roughness={.18} /></mesh>
    {[-.06, .06].map(x => <mesh key={x} position={[x, .9, -.43]} castShadow><cylinderGeometry args={[.018, .022, .035, 20]} /><meshStandardMaterial color={hardwareColour} metalness={.9} roughness={.18} /></mesh>)}
  </group>;
}
