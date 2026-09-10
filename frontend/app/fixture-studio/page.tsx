"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Canvas } from "@react-three/fiber";
import { Bounds, ContactShadows, Environment, Lightformer } from "@react-three/drei";
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
  const bath = key.startsWith("furniture-bath-");
  const cabinet = key.startsWith("furniture-kitchen-cabinet-");
  const obstacle = { name: key, representation_key: key, color_hex: "#F4F3EE" } as Obstacle;
  return <div style={{position:"fixed",inset:0,background:"#eef0ed"}}>
    <Canvas shadows orthographic dpr={2} gl={{antialias:true,preserveDrawingBuffer:true}} camera={{position:[extent*(cabinet ? 1.1 : 1.6),extent*(bath ? 1.65 : cabinet ? .9 : 1.5),extent*2.4],zoom:440/extent,near:.001,far:100}} onCreated={({camera}) => camera.lookAt(0,height*.47,0)}>
      <color attach="background" args={["#eef0ed"]} />
      <hemisphereLight args={["#ffffff","#a5aaa3",joinery || bath || cabinet ? .8 : 2]} />
      <directionalLight position={[2,4,3]} intensity={3.2} castShadow shadow-mapSize={[2048,2048]} shadow-bias={-.0001} shadow-normalBias={.002} />
      <directionalLight position={[-3,2,-1]} intensity={joinery || bath || cabinet ? .55 : 1.8} />
      {(bath || cabinet) && <Environment resolution={128}>
        <Lightformer position={[0, 4, 2]} rotation={[-Math.PI / 3, 0, 0]} scale={[6, 3, 1]} intensity={3} />
        <Lightformer position={[-3, 1, 2]} rotation={[0, Math.PI / 3, 0]} scale={[3, 4, 1]} intensity={2} />
        <Lightformer position={[4, 2, -2]} rotation={[0, -Math.PI / 2, 0]} scale={[3, 4, 1]} intensity={2} />
      </Environment>}
      {bath || cabinet ? <Bounds fit clip observe margin={1.25}><ParametricFixture obstacle={obstacle} width={width} depth={depth} height={height} /></Bounds> : key.startsWith("door-") && params.get("frame") === "1" ? <DoorFixture representation={key} width={width} depth={depth} height={height} colour={obstacle.color_hex} frame /> : <ParametricFixture obstacle={obstacle} width={width} depth={depth} height={height} />}
      <ContactShadows position={[0,-.002,0]} opacity={.35} scale={extent*4} blur={2.5} far={extent*2} resolution={512} />
    </Canvas>
  </div>;
}

export default function FixtureStudio() { return <Suspense><Studio /></Suspense>; }
