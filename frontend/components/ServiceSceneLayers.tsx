"use client";

import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Room } from "@/lib/types";
import { energyElements, isInsulationSelectable } from "@/lib/energyCalculations";
import { FLOOR_PLAN_CANVAS_HEIGHT as HEIGHT, FLOOR_PLAN_CANVAS_WIDTH as WIDTH } from "./FloorPlanCanvas";
import { useServiceView } from "./ServiceViewContext";
import { useEnergyLayout } from "./EnergyLayoutContext";
import { useHeatingLayout } from "./HeatingLayoutContext";

/** The existing SVG editors sit on the measured floor, not on a screenshot of it.
 * Pointer coordinates are ray/plane intersections in mm, also in perspective.
 */
export function ServiceFloorLayer({ elevationMm }: { elevationMm: number }) {
  const view = useServiceView(), { camera, events, scene } = useThree();
  const [svg, setSvg] = useState<SVGSVGElement | null>(null);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const height = elevationMm / 1000 + .012;
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -height), [height]);
  const lastPoint = useRef({ x: 0, y: 0 });
  const cast = useCallback((x: number, y: number) => {
    const bounds = events.connected!.getBoundingClientRect();
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
    return !raycaster.intersectObjects(scene.children, true).some(hit => hit.distance < distance - .002 && hit.object.userData.serviceOccluder);
  }, [cast, raycaster, scene]);
  const setScene = view?.setScene;
  useEffect(() => {
    if (!svg || !setScene) return;
    setScene({ svg, fromClient, canPick });
    return () => setScene(null);
  }, [svg, fromClient, canPick, setScene]);
  if (!view?.frame || !view.floorActive) return null;
  const frame = view.frame;
  const x = frame.minX + (WIDTH / 2 - frame.offsetX) / frame.scale;
  const y = frame.maxY - (HEIGHT / 2 - frame.offsetY) / frame.scale;
  return <Html transform occlude="blending" geometry={<planeGeometry args={[WIDTH / frame.scale / 1000, HEIGHT / frame.scale / 1000]} />} position={[x / 1000, height, -y / 1000]} rotation={[-Math.PI / 2, 0, 0]} distanceFactor={.4 / frame.scale} zIndexRange={[8, 0]} style={{ pointerEvents: "none" }}>
    <svg ref={setSvg} data-service-scene="true" aria-label="3D service layout" width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ display: "block", overflow: "visible", pointerEvents: "none" }} />
  </Html>;
}

function FabricFace({ room, start, end, floor, heightMm, colour, selected, label, showLabel, onSelect }: {
  room: Room; start?: { x: number; y: number }; end?: { x: number; y: number }; floor: boolean; heightMm: number;
  colour: string; selected: boolean; label: string; showLabel: boolean; onSelect?: (additive: boolean) => void;
}) {
  const { geometry, centre } = useMemo(() => {
    if (start && end) {
      const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
      const area = room.vertices.reduce((sum, p, i, vertices) => { const next = vertices[(i + 1) % vertices.length]; return sum + p.x * next.y - next.x * p.y; }, 0);
      const sign = area >= 0 ? 1 : -1;
      const ox = -dy / length * 5 * sign, oy = dx / length * 5 * sign;
      const a = [start.x + ox, start.y + oy], b = [end.x + ox, end.y + oy];
      const points = [a[0], 0, -a[1], b[0], 0, -b[1], b[0], heightMm, -b[1], a[0], heightMm, -a[1]].map(n => n / 1000);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3)); g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
      return { geometry: g, centre: [(a[0] + b[0]) / 2000 + ox / 1000, heightMm / 2000, -(a[1] + b[1]) / 2000 - oy / 1000] as [number, number, number] };
    }
    const shape = new THREE.Shape(room.vertices.map(p => new THREE.Vector2(p.x / 1000, p.y / 1000)));
    const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2); g.translate(0, floor ? .006 : heightMm / 1000 - .006, 0);
    return { geometry: g, centre: [room.vertices.reduce((s, p) => s + p.x, 0) / room.vertices.length / 1000, floor ? .024 : heightMm / 1000 - .024, -room.vertices.reduce((s, p) => s + p.y, 0) / room.vertices.length / 1000] as [number, number, number] };
  }, [room, start, end, floor, heightMm]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <group userData={{ editorOnly: true }}>
    <mesh geometry={geometry} onPointerDown={onSelect ? e => { if (e.button !== 0) return; e.stopPropagation(); onSelect(e.shiftKey); } : undefined}>
      <meshBasicMaterial color={selected ? "#1b81ef" : colour} side={THREE.DoubleSide} transparent opacity={selected ? .65 : .38} depthWrite={false} />
    </mesh>
    {showLabel && <Html center occlude position={centre} zIndexRange={[9, 0]} style={{ pointerEvents: onSelect ? "auto" : "none", whiteSpace: "nowrap" }}>
      <button type="button" className="service-fabric-label" data-energy-scene-label={label} onPointerDown={e => { e.stopPropagation(); if (e.button === 0) onSelect?.(e.shiftKey); }} style={{ borderColor: selected ? "#1b81ef" : colour }}>{label}</button>
    </Html>}
  </group>;
}

/** Same U values, heat losses, colours and selection as the insulation plan. */
export function ServiceFabricLayer({ rooms, displayRooms, elevationMm, showRoof }: { rooms: Room[]; displayRooms: Room[]; elevationMm: number; showRoof: boolean }) {
  const view = useServiceView(), energy = useEnergyLayout(), heating = useHeatingLayout();
  const data = energy.data, readOnly = !energy.windowOpen;
  const elements = useMemo(() => energyElements(rooms, heating.data, data), [rooms, heating.data, data]);
  if (!view || !energy.windowOpen && !(heating.windowOpen && view.heatingFabricVisible)) return null;
  return <group position={[0, elevationMm / 1000, 0]}>{elements.filter(e => (e.category !== "roof" || showRoof) && isInsulationSelectable(e, rooms) && (readOnly || (e.category === "wall" ? data.display.walls : e.category === "floor" ? data.display.floors : e.category === "roof" ? data.display.roofs : false))).map(e => {
    const room = rooms.find(r => r.id === e.roomId), displayRoom = displayRooms.find(r => r.id === e.roomId); if (!room || !displayRoom) return null;
    const colour = `hsl(${135 - Math.min(1, e.uValue / 2) * 130},60%,42%)`;
    const selected = !readOnly && view.energySelection.includes(e.elementId);
    return <FabricFace key={e.elementId} room={room} start={e.startMm} end={e.endMm} floor={e.category === "floor"} heightMm={displayRoom.wall_height.value} colour={colour} selected={selected} showLabel={readOnly || data.display.labels} label={`${e.label} · U ${e.uValue.toFixed(2)}${data.display.heatLoss || readOnly ? ` · ${Math.round(e.heatLossW)} W` : ""}`} onSelect={readOnly ? undefined : additive => view.setEnergySelection(ids => additive ? ids.includes(e.elementId) ? ids.filter(id => id !== e.elementId) : [...ids, e.elementId] : [e.elementId])} />;
  })}</group>;
}
