"use client";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { ParametricFixture } from "@/components/ParametricFixture";
import type { Obstacle } from "@/lib/types";

export function FixturePreview({ obstacle }: { obstacle: Obstacle }) {
  const { width, depth, height } = obstacle.dimensions;
  const largest = Math.max(width.value, depth.value, height.value);
  return <div className="fixture-preview" style={{ height: 180, background: "#eef1ed", borderRadius: 12 }} aria-label="Live element preview">
    <Canvas camera={{ position: [1.7, 1.6, 2.2], fov: 36 }}>
      <ambientLight intensity={1.8} /><directionalLight position={[3, 5, 4]} intensity={3} />
      <group position={[0, -.45, 0]}><ParametricFixture obstacle={obstacle} width={width.value / largest} depth={depth.value / largest} height={height.value / largest} /></group>
      <OrbitControls enablePan={false} enableZoom={false} target={[0, 0, 0]} />
    </Canvas>
  </div>;
}
