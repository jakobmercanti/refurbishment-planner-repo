"use client";

import { useEffect, useMemo } from "react";
import { BufferGeometry, Float32BufferAttribute } from "three";
import type { CfdMesh } from "@/lib/cfd";

/** The backend's mm surface is transformed only at this rendering boundary. */
export function CfdProxyMesh({ mesh }: { mesh: CfdMesh }) {
  const { geometry, originGuide } = useMemo(() => {
    const [width, depth, height] = mesh.dimensions_mm, largest = Math.max(width, depth, height);
    const result = new BufferGeometry();
    result.setAttribute("position", new Float32BufferAttribute(mesh.vertices_mm.flatMap(([x, y, z]) => [
      (x - width / 2) / largest, z / largest, (y - depth / 2) / largest,
    ]), 3));
    // The (x,y,z) -> (x,z,y) render transform reverses handedness.
    result.setIndex(mesh.triangles.flatMap(([a, b, c]) => [a, c, b]));
    result.computeVertexNormals(); result.computeBoundingSphere();
    // A render-only footprint at local z=0 makes wall-mounted clearances visible.
    // It is not an obstruction, a room floor or part of the exported STL.
    const x = width / (2 * largest), z = depth / (2 * largest);
    const guide = new BufferGeometry();
    guide.setAttribute("position", new Float32BufferAttribute([
      -x, 0, -z, x, 0, -z, x, 0, -z, x, 0, z,
      x, 0, z, -x, 0, z, -x, 0, z, -x, 0, -z,
    ], 3));
    return { geometry: result, originGuide: guide };
  }, [mesh]);
  useEffect(() => () => { geometry.dispose(); originGuide.dispose(); }, [geometry, originGuide]);
  return <group>
    <mesh name="catalogue-cfd-proxy" geometry={geometry}><meshStandardMaterial color="#679baf" roughness={.82} flatShading /></mesh>
    <lineSegments name="cfd-origin-guide" userData={{ editorOnly: true }} geometry={originGuide}><lineBasicMaterial color="#596e79" /></lineSegments>
  </group>;
}
