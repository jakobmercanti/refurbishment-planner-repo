"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { Obstacle } from "@/lib/types";

export function StlFixture({ obstacle, width, depth, height, colour, fallback }: { obstacle: Obstacle; width: number; depth: number; height: number; colour: string; fallback: ReactNode }) {
  const geometry = useMemo(() => {
    if (!obstacle.stl_base64) return null;
    let parsed: THREE.BufferGeometry | null = null;
    try {
      const source = obstacle.stl_base64.trim();
      const encoded = source.includes(",") ? source.slice(source.indexOf(",") + 1) : source;
      const normalized = encoded.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(normalized.length + (4 - normalized.length % 4) % 4, "=");
      const binary = window.atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      parsed = new STLLoader().parse(bytes.buffer);
      parsed.computeVertexNormals();
      parsed.computeBoundingBox();
      let box = parsed.boundingBox;
      if (!box) return null;
      const originalSize = box.getSize(new THREE.Vector3());
      if (originalSize.z > originalSize.y * 1.15 && height > Math.max(width, depth) * 1.1) {
        parsed.rotateX(-Math.PI / 2);
        parsed.computeBoundingBox();
        box = parsed.boundingBox;
        if (!box) return null;
      }
      const size = box.getSize(new THREE.Vector3());
      if (![size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 1e-6)) return null;
      const centre = box.getCenter(new THREE.Vector3());
      parsed.translate(-centre.x, -box.min.y, -centre.z);
      parsed.scale(width / size.x, height / size.y, depth / size.z);
      parsed.computeBoundingSphere();
      const result = parsed;
      parsed = null;
      return result;
    } catch {
      return null;
    } finally {
      parsed?.dispose();
    }
  }, [depth, height, obstacle.stl_base64, width]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return fallback;
  return <mesh geometry={geometry} castShadow receiveShadow><meshStandardMaterial color={colour} roughness={0.56} metalness={0.04} /></mesh>;
}
