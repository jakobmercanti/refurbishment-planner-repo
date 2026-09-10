"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Canvas } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import { ParametricFixture } from "@/components/ParametricFixture";
import { DoorFixture } from "@/components/DoorFixture";
import type { Obstacle } from "@/lib/types";

// Reproducible product photography for the catalogue asset generation script.
function Studio() {
  const params = useSearchParams();
  const key = params.get("key") ?? "toilet-close-coupled";
  const width = Math.max(1, Number(params.get("width")) || 380) / 1000;
  const depth = Math.max(1, Number(params.get("depth")) || 650) / 1000;
  const height = Math.max(1, Number(params.get("height")) || 800) / 1000;
  const extent = Math.max(width, depth, height);
  const joinery = key.startsWith("door-") || key.startsWith("window-");
  const obstacle = { name: key, representation_key: key, color_hex: "#F4F3EE" } as Obstacle;
  return <div style={{position:"fixed",inset:0,background:"#eef0ed"}}>
    <Canvas shadows orthographic dpr={1} gl={{antialias:true,preserveDrawingBuffer:true}} camera={{position:[extent*1.6,extent*1.5,extent*2.4],zoom:440/extent,near:.001,far:100}} onCreated={({camera}) => camera.lookAt(0,height*.47,0)}>
      <color attach="background" args={["#eef0ed"]} />
      <hemisphereLight args={["#ffffff","#a5aaa3",joinery ? .8 : 2]} />
      <directionalLight position={[2,4,3]} intensity={3.2} castShadow shadow-mapSize={[2048,2048]} shadow-bias={-.0001} shadow-normalBias={.002} />
      <directionalLight position={[-3,2,-1]} intensity={joinery ? .55 : 1.8} />
      {key.startsWith("door-") && params.get("frame") === "1" ? <DoorFixture representation={key} width={width} depth={depth} height={height} colour={obstacle.color_hex} frame /> : <ParametricFixture obstacle={obstacle} width={width} depth={depth} height={height} />}
      <ContactShadows position={[0,-.002,0]} opacity={.35} scale={extent*4} blur={2.5} far={extent*2} resolution={512} />
    </Canvas>
  </div>;
}

export default function FixtureStudio() { return <Suspense><Studio /></Suspense>; }
