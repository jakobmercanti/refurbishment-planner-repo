import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

export function ProceduralFloorMaterial({ url, selected, roughness = .78 }: { url: string; selected: boolean; roughness?: number }) {
  const material = useRef<THREE.MeshStandardMaterial>(null);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    let active = true;
    const target = material.current;
    const texture = new THREE.TextureLoader().load(url, (loaded) => {
      if (!active || !target) { loaded.dispose(); return; }
      loaded.wrapS = loaded.wrapT = THREE.RepeatWrapping;
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.anisotropy = 4;
      target.map = loaded;
      target.needsUpdate = true;
      invalidate();
    });
    return () => { active = false; if (target) { target.map = null; target.needsUpdate = true; } texture.dispose(); };
  }, [url, invalidate]);
  return <meshStandardMaterial ref={material} color="#ffffff" roughness={roughness} side={THREE.DoubleSide} emissive={selected ? "#b76d16" : "#000000"} emissiveIntensity={selected ? .08 : 0} />;
}
