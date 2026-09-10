"use client";
import { RoundedBox } from "@react-three/drei";

/** Dimensions are scene units; the catalogue and obstacle remain in millimetres. */
export function RadiatorFixture({ representation, width: w, depth: d, height: h, colour = "#FFFFFF" }: { representation: string; width: number; depth: number; height: number; colour?: string }) {
  const bathroom = representation.includes("bathroom"), rows = representation.split("-")[3] === "2" ? 2 : 1;
  const unit = Math.min(w / 600, h / 600), radius = 12 * unit;
  const tube = (x: number, y: number, z: number, length: number, horizontal = false, chrome = false) => <mesh position={[x, y, z]} rotation={[0, 0, horizontal ? Math.PI / 2 : 0]} castShadow receiveShadow><cylinderGeometry args={[radius, radius, length, 16]} /><meshStandardMaterial color={chrome ? "#b6bfc2" : colour} roughness={chrome ? .2 : .32} metalness={chrome ? .85 : .12} /></mesh>;
  const columns = Math.max(4, Math.round(w / h * (bathroom ? 24 : 18)));
  return <group>
    {Array.from({ length: rows }, (_, row) => <group key={row} position={[0, 0, (row - (rows - 1) / 2) * d * .48]}>
      {bathroom ? <>
        {[-1, 1].map(side => <group key={side}>{tube(side * (w / 2 - radius * 2), h / 2, 0, h * .94)}</group>)}
        {Array.from({ length: 22 }, (_, i) => i % 8 !== 7 && <group key={i}>{tube(0, h * (.08 + i * .04), 0, w - radius * 4, true)}</group>)}
      </> : <>
        {[.08, .92].map(y => <group key={y}>{tube(0, h * y, 0, w * .93, true)}</group>)}
        {Array.from({ length: columns }, (_, i) => <RoundedBox key={i} position={[-w * .45 + i * w * .9 / (columns - 1), h / 2, 0]} args={[w * .78 / columns, h * .92, d * .32]} radius={Math.min(w * .12 / columns, d * .08)} smoothness={3} castShadow receiveShadow><meshStandardMaterial color={colour} roughness={.33} metalness={.12} /></RoundedBox>)}
      </>}
    </group>)}
    {[-1, 1].map(side => <group key={side}>
      {tube(side * w * .43, h * .045, d * .23, h * .09, false, true)}
      <mesh position={[side * w * .43, h * .025, d * .23]} castShadow><cylinderGeometry args={[radius * 1.7, radius * 1.7, radius * 2.5, 16]} /><meshStandardMaterial color="#eeeeeb" roughness={.38} /></mesh>
      {[.23, .77].map(y => <mesh key={y} position={[side * w * .32, h * y, -d * .42]} castShadow><boxGeometry args={[radius * 2, radius * 4, d * .15]} /><meshStandardMaterial color={colour} roughness={.4} /></mesh>)}
    </group>)}
  </group>;
}
