"use client";
import { useEffect, useState } from "react";
import { Box3, Group, Vector3 } from "three";
import { Html } from "@react-three/drei";
import { assetRepository, disposeModel, loadGlb } from "@/lib/assetRepository";
import type { AssetInstance } from "@/lib/projectDocument";

function LocalModel({ instance }: { instance: AssetInstance }) {
  const [scene, setScene] = useState<Group | null>(null); const [error, setError] = useState(false);
  useEffect(() => { let cancelled = false; let loaded: Group | null = null;
    void assetRepository.getAssetBlob(instance.assetId).then(b => b.arrayBuffer()).then(b => loadGlb(new Uint8Array(b))).then(model => {
      loaded = model.scene; if (cancelled) { disposeModel(loaded); return; }
      const box = new Box3().setFromObject(loaded), centre = box.getCenter(new Vector3()); loaded.position.set(-centre.x, -box.min.y, -centre.z); setScene(loaded);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; if (loaded) disposeModel(loaded); };
  }, [instance.assetId]);
  const p = instance.positionMm, r = instance.rotationDeg, s = instance.scale;
  return <group position={[p.x * .001, p.z * .001, -p.y * .001]} rotation={[r.x * Math.PI / 180, r.z * Math.PI / 180, r.y * Math.PI / 180]} scale={[s.x, s.z, s.y]}>{scene && <primitive object={scene} />}{error && <Html>Local model unavailable. Reopen your project backup.</Html>}</group>;
}
export function LocalAssetScene({ instances }: { instances: AssetInstance[] }) { return <>{instances.map(i => <LocalModel key={i.instanceId} instance={i} />)}</>; }
