"use client";
import { Canvas } from "@react-three/fiber";
import { Bounds, OrbitControls } from "@react-three/drei";
import { useState } from "react";
import { ParametricFixture } from "@/components/ParametricFixture";
import type { Obstacle } from "@/lib/types";

export function FixturePreview({ obstacle, compact = false }: { obstacle: Obstacle; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { width, depth, height } = obstacle.dimensions;
  const largest = Math.max(width.value, depth.value, height.value);
  const isExpanded = compact ? expanded : true;
  return <div className={`fixture-preview ${compact ? "fixture-preview-compact" : ""} ${isExpanded ? "expanded" : ""}`} style={{ height: compact ? (isExpanded ? 230 : 106) : 180, background: "#eef1ed", borderRadius: 12 }} aria-label="Live element preview" role={compact ? "button" : undefined} tabIndex={compact ? 0 : undefined} aria-expanded={compact ? isExpanded : undefined} onClick={compact ? () => setExpanded(value => !value) : undefined} onKeyDown={compact ? event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setExpanded(value => !value); } } : undefined}>
    <Canvas camera={{ position: [1.7, 1.6, 2.2], fov: 36 }}>
      <ambientLight intensity={1.8} /><directionalLight position={[3, 5, 4]} intensity={3} />
      <Bounds fit clip observe margin={1.08}>
        <group position={[0, -.45, 0]}><ParametricFixture obstacle={obstacle} width={width.value / largest} depth={depth.value / largest} height={height.value / largest} /></group>
      </Bounds>
      <OrbitControls enablePan={false} enableZoom={false} />
    </Canvas>
    {compact && <span className="fixture-preview-hint" aria-hidden>{isExpanded ? "Click to collapse" : "Click to enlarge"}</span>}
  </div>;
}
