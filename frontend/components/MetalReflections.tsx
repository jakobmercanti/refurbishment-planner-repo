"use client";
import { Environment, Lightformer } from "@react-three/drei";

/** Local studio panels give polished metal something to reflect; no remote HDRI. */
export function MetalReflections({ intensity = .6 }: { intensity?: number }) {
  return <Environment resolution={128} frames={1} environmentIntensity={intensity}>
    <color attach="background" args={["#6E767F"]} />
    <Lightformer form="rect" intensity={2} position={[4, 3, 3]} target={[0, 0, 0]} scale={[4, 6]} />
    <Lightformer form="rect" intensity={1.5} position={[-4, 2, 1]} target={[0, 0, 0]} scale={[2, 6]} />
    <Lightformer form="rect" intensity={2} position={[0, 5, -2]} target={[0, 0, 0]} scale={[6, 4]} />
  </Environment>;
}
