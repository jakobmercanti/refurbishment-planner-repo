"use client";

import { Component, useEffect, useLayoutEffect, useMemo, type ReactNode } from "react";
import { useThree } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, DoubleSide, PerspectiveCamera, Vector3 } from "three";
import type { MeshInspectionScene } from "@/lib/cfdMeshInspection";

type MeshOrbit = {target: Vector3; update: () => void; minDistance?: number; maxDistance?: number;
  dispatchEvent?: (event: {type: "start"}) => void};
export class CFDMeshGuard extends Component<{children: ReactNode; onError?: (message: string) => void}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  componentDidCatch(error: Error) { this.props.onError?.("Mesh rendering failed. " + error.message.slice(0, 200)); }
  render() { return this.state.failed ? null : this.props.children; }
}
export function preserveMeshCamera(camera: PerspectiveCamera, orbit: MeshOrbit) {
  const saved = {position: camera.position.clone(), quaternion: camera.quaternion.clone(), up: camera.up.clone(),
    zoom: camera.zoom, near: camera.near, far: camera.far, target: orbit.target.clone(),
    minDistance: orbit.minDistance, maxDistance: orbit.maxDistance};
  return () => {
    camera.position.copy(saved.position); camera.up.copy(saved.up);
    camera.zoom = saved.zoom; camera.near = saved.near; camera.far = saved.far;
    if (saved.minDistance !== undefined) orbit.minDistance = saved.minDistance;
    if (saved.maxDistance !== undefined) orbit.maxDistance = saved.maxDistance;
    orbit.target.copy(saved.target); orbit.update(); camera.quaternion.copy(saved.quaternion);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  };
}

/** This is the only conversion from authoritative mesh millimetres to scene metres. */
export function meshScenePositions(points: Float64Array) {
  const positions = new Float32Array(points.length);
  for (let i = 0; i < points.length; i += 3) {
    positions[i] = points[i] * .001;
    positions[i + 1] = points[i + 2] * .001;
    positions[i + 2] = -points[i + 1] * .001;
  }
  return positions;
}

function MeshCamera({metadata, fitRequest}: Pick<MeshInspectionScene, "metadata" | "fitRequest">) {
  const {get, controls, invalidate} = useThree();
  useLayoutEffect(() => {
    const camera = get().camera;
    const orbit = get().controls as unknown as MeshOrbit | null;
    if (!(camera instanceof PerspectiveCamera) || !orbit) return;
    const restore = preserveMeshCamera(camera, orbit);
    // Bounds listens to the normal orbit-start event to stop an in-flight fit.
    // A previous building fit must not continue moving the inspection camera.
    orbit.dispatchEvent?.({type: "start"});
    return () => { restore(); invalidate(); };
  }, [get, controls, invalidate]);
  const bounds = JSON.stringify(metadata.boundsMm);
  useLayoutEffect(() => {
    const camera = get().camera;
    const orbit = get().controls as unknown as MeshOrbit | null;
    if (!(camera instanceof PerspectiveCamera) || !orbit) return;
    const [min, max] = JSON.parse(bounds) as [number[], number[]];
    const center = new Vector3((min[0] + max[0]) * .0005, (min[2] + max[2]) * .0005, -(min[1] + max[1]) * .0005);
    const span = new Vector3(...max.map((value, i) => (value - min[i]) * .001)).length();
    const direction = camera.position.clone().sub(orbit.target).normalize();
    if (direction.lengthSq() === 0) direction.set(1, .8, 1).normalize();
    const fov = Math.min(camera.fov, camera.fov * camera.aspect) * Math.PI / 180;
    camera.position.copy(center).addScaledVector(direction, span * .65 / Math.tan(fov / 2));
    camera.zoom = 1; camera.near = Math.max(.0001, span / 10000); camera.far = Math.max(100, span * 100);
    if (orbit.minDistance !== undefined) orbit.minDistance = Math.max(.0001, span / 10000);
    if (orbit.maxDistance !== undefined) orbit.maxDistance = Math.max(1000, span * 100);
    orbit.target.copy(center); orbit.update(); camera.updateProjectionMatrix(); invalidate();
  }, [get, controls, invalidate, bounds, fitRequest]);
  return null;
}

export function CFDMeshScene({inspection}: {inspection: MeshInspectionScene}) {
  const {geometry, display, opacity} = inspection;
  const {invalidate} = useThree();
  const buffers = useMemo(() => {
    if (!geometry) return null;
    const position = new BufferAttribute(meshScenePositions(geometry.pointsMm), 3);
    const faces = new BufferGeometry(), edges = new BufferGeometry();
    faces.setAttribute("position", position); faces.setIndex(new BufferAttribute(geometry.triangles, 1));
    faces.computeVertexNormals(); faces.computeBoundingSphere();
    edges.setAttribute("position", position); edges.setIndex(new BufferAttribute(geometry.edges, 1)); edges.computeBoundingSphere();
    return {faces, edges};
  }, [geometry]);
  useEffect(() => { invalidate(); return () => { buffers?.faces.dispose(); buffers?.edges.dispose(); }; }, [buffers, invalidate]);
  return <group name="cfd-mesh-inspection">
    <MeshCamera metadata={inspection.metadata} fitRequest={inspection.fitRequest}/>
    {buffers && <>
      {display !== "wireframe" && <mesh geometry={buffers.faces} raycast={() => {}}>
        <meshStandardMaterial color="#b8c6d1" roughness={.85} side={DoubleSide} flatShading
          transparent={display === "transparent"} opacity={display === "transparent" ? opacity / 100 : 1}
          depthWrite={display !== "transparent"} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1}/>
      </mesh>}
      <lineSegments geometry={buffers.edges} raycast={() => {}} renderOrder={1}>
        <lineBasicMaterial color="#17334c" transparent={display === "transparent"} opacity={display === "transparent" ? .75 : 1}/>
      </lineSegments>
    </>}
  </group>;
}
