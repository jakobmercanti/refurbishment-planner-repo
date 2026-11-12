"use client";

import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { FLOOR_PLAN_CANVAS_HEIGHT as HEIGHT, FLOOR_PLAN_CANVAS_WIDTH as WIDTH } from "./FloorPlanCanvas";
import { useServiceView } from "./ServiceViewContext";

export const SERVICE_CONTEXT_COLOUR = "#b8bdbf";
export const insulationColour = (uValue: number) => `hsl(${135 - Math.min(1, uValue / 2) * 130},60%,42%)`;

/** Presentation materials are local to this viewer and retain the model's
 * transparent panes, depth settings and pick geometry. */
function SyncMaterial({ update }: { update: { current: (() => void) | null } }) {
  useFrame(() => update.current?.());
  return null;
}

export function ServiceObjectTint({ colour, children, revision, dynamic = false }: { colour?: string; children: ReactNode; revision?: unknown; dynamic?: boolean }) {
  const root = useRef<THREE.Group>(null);
  const sync = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const group = root.current;
    if (!colour || !group) return;
    const originals = new Map<THREE.Mesh, { source: THREE.Material | THREE.Material[]; tint: THREE.Material | THREE.Material[] }>();
    const variants = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    const replace = (source: THREE.Material) => {
      const existing = variants.get(source);
      if (existing) return existing;
      const tint = new THREE.MeshStandardMaterial({
        color: colour, roughness: .85, side: source.side, transparent: source.transparent, opacity: source.opacity,
        depthTest: source.depthTest, depthWrite: source.depthWrite, polygonOffset: source.polygonOffset,
        polygonOffsetFactor: source.polygonOffsetFactor, polygonOffsetUnits: source.polygonOffsetUnits,
      });
      variants.set(source, tint);
      return tint;
    };
    const update = () => group.traverse(object => {
      if (!(object instanceof THREE.Mesh) || object.userData.editorOnly || object.material === originals.get(object)?.tint) return;
      const source = object.material;
      const tint = Array.isArray(source) ? source.map(replace) : replace(source);
      originals.set(object, { source, tint });
      object.material = tint;
    });
    update();
    if (dynamic) sync.current = update;
    return () => {
      sync.current = null;
      for (const [mesh, { source, tint }] of originals) if (mesh.material === tint) mesh.material = source;
      for (const material of variants.values()) material.dispose();
    };
  }, [colour, revision, dynamic]);
  return <group ref={root}>{children}{colour && dynamic && <SyncMaterial update={sync} />}</group>;
}

/** The existing SVG editors sit on the measured floor, not on a screenshot of it.
 * Pointer coordinates are ray/plane intersections in mm, also in perspective.
 */
export function ServiceFloorLayer({ elevationMm }: { elevationMm: number }) {
  const view = useServiceView(), { camera, events, scene, size } = useThree();
  const [svg, setSvg] = useState<SVGSVGElement | null>(null);
  const [labels, setLabels] = useState<SVGSVGElement | null>(null);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const height = elevationMm / 1000 + .012;
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -height), [height]);
  const lastPoint = useRef({ x: 0, y: 0 });
  const cast = useCallback((x: number, y: number) => {
    const bounds = events.connected?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return null;
    raycaster.setFromCamera(new THREE.Vector2((x - bounds.left) / bounds.width * 2 - 1, 1 - (y - bounds.top) / bounds.height * 2), camera);
    return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  }, [camera, events, raycaster, plane]);
  const fromClient = useCallback((x: number, y: number) => {
    const point = cast(x, y);
    if (point) lastPoint.current = { x: point.x * 1000, y: -point.z * 1000 };
    return lastPoint.current;
  }, [cast]);
  const canPick = useCallback((x: number, y: number) => {
    const point = cast(x, y); if (!point) return false;
    const distance = raycaster.ray.origin.distanceTo(point);
    return !raycaster.intersectObjects(scene.children, true).some(hit => {
      if (hit.distance >= distance - .002 || !hit.object.userData.serviceOccluder) return false;
      for (let node: THREE.Object3D | null = hit.object; node; node = node.parent) if (!node.visible) return false;
      return true;
    });
  }, [cast, raycaster, scene]);
  const setScene = view?.setScene;
  useEffect(() => {
    if (!svg || !labels || !setScene) return;
    setScene({ svg, labels, fromClient, canPick });
    return () => setScene(null);
  }, [svg, labels, fromClient, canPick, setScene]);
  useFrame(() => {
    const point = new THREE.Vector3();
    labels?.querySelectorAll<SVGGElement>("[data-service-anchor-x]").forEach(node => {
      point.set(Number(node.dataset.serviceAnchorX)/1000,height,-Number(node.dataset.serviceAnchorY)/1000).project(camera);
      node.style.visibility = Math.abs(point.z)>1 ? "hidden" : "visible";
      node.setAttribute("transform",`translate(${(point.x+1)*size.width/2} ${(1-point.y)*size.height/2})`);
    });
  });
  if (!view?.frame || !view.floorActive) return null;
  const frame = view.frame;
  const x = frame.minX + (WIDTH / 2 - frame.offsetX) / frame.scale;
  const y = frame.maxY - (HEIGHT / 2 - frame.offsetY) / frame.scale;
  return <><Html transform pointerEvents="none" position={[x / 1000, height, -y / 1000]} rotation={[-Math.PI / 2, 0, 0]} distanceFactor={.4 / frame.scale} zIndexRange={[8, 0]}>
    <svg ref={setSvg} data-service-scene="true" aria-label="3D service layout" width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ display: "block", overflow: "visible", pointerEvents: "none" }} />
  </Html><Html fullscreen calculatePosition={()=>[size.width/2,size.height/2]} zIndexRange={[14,13]} style={{pointerEvents:"none"}}><svg ref={setLabels} data-service-scene="true" aria-label="Service labels" width={size.width} height={size.height} style={{display:"block",pointerEvents:"none",overflow:"visible"}}/></Html></>;
}
