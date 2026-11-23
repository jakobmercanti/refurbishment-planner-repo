"use client";

import { Component, useEffect, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useThree } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, PerspectiveCamera, Plane, Vector3 } from "three";
import type { MeshAxis, MeshDisplay, MeshGeometry, MeshInspectionScene } from "@/lib/cfdMeshInspection";
import { meshSectionContains } from "@/lib/cfdMeshInspection";

type MeshOrbit = {target: Vector3; update: () => void; minDistance?: number; maxDistance?: number;
  enableDamping?: boolean; autoRotate?: boolean; dispatchEvent?: (event: {type: "start"}) => void};

function settleMeshOrbit(orbit: MeshOrbit, apply: () => void) {
  const damping = orbit.enableDamping, autoRotate = orbit.autoRotate;
  if (damping !== undefined) orbit.enableDamping = false;
  if (autoRotate !== undefined) orbit.autoRotate = false;
  try {
    // Consume residual pan/rotation before applying the retained camera. An
    // update with damping still enabled would move the restored position.
    orbit.update(); apply(); orbit.update();
  } finally {
    if (damping !== undefined) orbit.enableDamping = damping;
    if (autoRotate !== undefined) orbit.autoRotate = autoRotate;
  }
}

const defaultMeshColours = JSON.stringify({face: "#b8c6d1", edge: "#17334c"});
function meshThemeSnapshot() {
  const styles = getComputedStyle(document.documentElement);
  return JSON.stringify({face: styles.getPropertyValue("--surface-muted").trim() || "#b8c6d1",
    edge: styles.getPropertyValue("--ink").trim() || "#17334c"});
}
function subscribeMeshTheme(notify: () => void) {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, {attributes: true, attributeFilter: ["data-theme", "class", "style"]});
  return () => observer.disconnect();
}
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
    settleMeshOrbit(orbit, () => {
      camera.position.copy(saved.position); camera.up.copy(saved.up);
      camera.zoom = saved.zoom; camera.near = saved.near; camera.far = saved.far;
      if (saved.minDistance !== undefined) orbit.minDistance = saved.minDistance;
      if (saved.maxDistance !== undefined) orbit.maxDistance = saved.maxDistance;
      orbit.target.copy(saved.target);
    });
    camera.quaternion.copy(saved.quaternion);
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
    settleMeshOrbit(orbit, () => {
      const direction = camera.position.clone().sub(orbit.target).normalize();
      if (direction.lengthSq() === 0) direction.set(1, .8, 1).normalize();
      const fov = Math.min(camera.fov, camera.fov * camera.aspect) * Math.PI / 180;
      camera.position.copy(center).addScaledVector(direction, span * .65 / Math.tan(fov / 2));
      camera.zoom = 1; camera.near = Math.max(.0001, span / 10000); camera.far = Math.max(100, span * 100);
      if (orbit.minDistance !== undefined) orbit.minDistance = Math.max(.0001, span / 10000);
      if (orbit.maxDistance !== undefined) orbit.maxDistance = Math.max(1000, span * 100);
      orbit.target.copy(center);
    });
    camera.updateProjectionMatrix(); invalidate();
  }, [get, controls, invalidate, bounds, fitRequest]);
  return null;
}

function MeshGeometryView({geometry, display, opacity, coordinateMm, colours, clippingPlanes}: {
  geometry: MeshGeometry; display: MeshDisplay; opacity: number; coordinateMm: number;
  colours: {face: string; edge: string}; clippingPlanes?: Plane[];
}) {
  const {invalidate} = useThree();
  const buffers = useMemo(() => {
    const position = new BufferAttribute(meshScenePositions(geometry.pointsMm), 3).setUsage(DynamicDrawUsage);
    const faces = new BufferGeometry(), edges = new BufferGeometry();
    faces.setAttribute("position", position); faces.setIndex(new BufferAttribute(geometry.triangles, 1));
    if (geometry.axis) {
      const normal = geometry.axis === "X" ? [1,0,0] : geometry.axis === "Y" ? [0,0,-1] : [0,1,0];
      const normals = new Float32Array(geometry.pointsMm.length);
      for (let i = 0; i < normals.length; i += 3) normals.set(normal, i);
      faces.setAttribute("normal", new BufferAttribute(normals, 3));
    } else faces.computeVertexNormals();
    edges.setAttribute("position", position); edges.setIndex(new BufferAttribute(geometry.edges, 1));
    return {faces, edges, update: (coordinate: number) => {
      if (!geometry.motion || geometry.coordinateMm === null) return;
      const delta = coordinate - geometry.coordinateMm;
      const points = geometry.pointsMm, slopes = geometry.motion.derivatives;
      for (let i = 0; i < points.length; i += 3) position.setXYZ(i / 3,
        (points[i] + slopes[i] * delta) * .001,
        (points[i + 2] + slopes[i + 2] * delta) * .001,
        -(points[i + 1] + slopes[i + 1] * delta) * .001);
      position.needsUpdate = true;
    }};
  }, [geometry]);
  useLayoutEffect(() => {
    buffers.update(coordinateMm);
    invalidate();
  }, [coordinateMm, buffers, invalidate]);
  useEffect(() => () => { buffers.faces.dispose(); buffers.edges.dispose(); }, [buffers]);
  return <>
      {display !== "wireframe" && <mesh geometry={buffers.faces} frustumCulled={false} raycast={() => {}}>
        <meshStandardMaterial color={colours.face} roughness={.85} side={DoubleSide} flatShading
          clippingPlanes={clippingPlanes}
          transparent={display === "transparent"} opacity={display === "transparent" ? opacity / 100 : 1}
          depthWrite={display !== "transparent"} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1}/>
      </mesh>}
      <lineSegments geometry={buffers.edges} frustumCulled={false} raycast={() => {}} renderOrder={1}>
        <lineBasicMaterial color={colours.edge} clippingPlanes={clippingPlanes} transparent={display === "transparent"} opacity={display === "transparent" ? .75 : 1}/>
      </lineSegments>
    </>;
}

function RearMesh({axis, coordinateMm, ...props}: Omit<Parameters<typeof MeshGeometryView>[0], "clippingPlanes"> & {axis: MeshAxis}) {
  const {get, invalidate} = useThree();
  const planes = useMemo(() => [new Plane()], []);
  const normal = useMemo(() => axis === "X" ? new Vector3(1,0,0) : axis === "Y" ? new Vector3(0,0,-1) : new Vector3(0,1,0), [axis]);
  useLayoutEffect(() => {
    const side = get().camera.position.dot(normal) - coordinateMm * .001;
    planes[0].normal.copy(normal).multiplyScalar(side >= 0 ? -1 : 1);
    // Retain this side while orbiting; changing position must not flip the cut.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normal, planes, get]);
  useLayoutEffect(() => {
    const plane = planes[0];
    plane.setComponents(plane.normal.x, plane.normal.y, plane.normal.z, -coordinateMm * .001 * plane.normal.dot(normal));
    invalidate();
  }, [coordinateMm, normal, planes, invalidate]);
  useLayoutEffect(() => {
    const gl = get().gl;
    const previous = gl.localClippingEnabled;
    gl.localClippingEnabled = true; invalidate(2);
    return () => { gl.localClippingEnabled = previous; invalidate(2); };
  }, [get, invalidate]);
  return <MeshGeometryView {...props} coordinateMm={coordinateMm} clippingPlanes={planes}/>;
}

export function CFDMeshScene({inspection}: {inspection: MeshInspectionScene}) {
  const {rearGeometry, display, opacity, section} = inspection;
  const local = useSyncExternalStore(inspection.live.subscribe, inspection.live.getSnapshot, inspection.live.getSnapshot);
  const geometry = section && local?.meshId === inspection.metadata.meshId && local?.axis === section.axis ? local : inspection.geometry;
  const fraction = useSyncExternalStore(inspection.position.subscribe, inspection.position.getSnapshot, inspection.position.getSnapshot);
  const desired = section ? section.min + (section.max - section.min) * fraction : inspection.coordinateMm;
  const coordinateMm = geometry && section && meshSectionContains(geometry, section.axis, desired) ? desired
    : geometry?.coordinateMm ?? desired;
  const theme = useSyncExternalStore(subscribeMeshTheme, meshThemeSnapshot, () => defaultMeshColours);
  const colours = useMemo(() => JSON.parse(theme) as {face: string; edge: string}, [theme]);
  return <group name="cfd-mesh-inspection">
    <MeshCamera metadata={inspection.metadata} fitRequest={inspection.fitRequest}/>
    {rearGeometry && section && <RearMesh geometry={rearGeometry} axis={section.axis} coordinateMm={desired} display={display} opacity={opacity} colours={colours}/>}
    {geometry && (!rearGeometry || !section || meshSectionContains(geometry, section.axis, desired)) &&
      <MeshGeometryView geometry={geometry} coordinateMm={coordinateMm} display={display} opacity={opacity} colours={colours}/>}
  </group>;
}
