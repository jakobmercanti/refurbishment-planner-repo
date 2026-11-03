"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Html } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { useHvac } from "./HvacContext";
import { previewScene, ventCenter } from "@/lib/climoptixPreview";
import { ventUVAtPoint } from "@/lib/ventPlacement";
import type { CFDHost } from "@/lib/climoptix";
import type { VentDevice } from "@/lib/hvacDocument";

// Match the visible service overlay's hit order, including walls drawn in front
// of it. This affects editor picking only, never measured geometry or fit.
function markerRaycast(this: THREE.Mesh, raycaster: THREE.Raycaster, intersections: THREE.Intersection[]) {
  const start = intersections.length;
  THREE.Mesh.prototype.raycast.call(this, raycaster, intersections);
  for (let i = start; i < intersections.length; i++) intersections[i].distance = 0;
}

function VentMarker({ device, host, onDragging }: { device: VentDevice; host: CFDHost; onDragging: (active: boolean) => void }) {
  const ctx = useHvac()!;
  const [draft, setDraft] = useState<[number, number] | null>(null), [error, setError] = useState("");
  const drag = useRef<{ baseline: string; u: number; v: number; pointer: number; plane: THREE.Plane } | null>(null);
  const cancel = () => { drag.current = null; setDraft(null); onDragging(false); };
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape" && drag.current) { drag.current = null; setDraft(null); onDragging(false); } };
    window.addEventListener("keydown", escape); return () => { window.removeEventListener("keydown", escape); if (drag.current) onDragging(false); };
  }, [onDragging]);
  const direction = (axis: number[]) => new THREE.Vector3(axis[0], axis[2], -axis[1]);
  const quaternion = useMemo(() => {
    const u = direction(host.uAxis), v = direction(host.vAxis), normal = new THREE.Vector3().crossVectors(u, v);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, normal));
  }, [host]);
  const center = ventCenter(device.vent, host, draft?.[0], draft?.[1]);
  const position = previewScene(center.map((n, i) => n - host.normal[i] * 3) as [number, number, number]);
  function move(e: ThreeEvent<PointerEvent>) {
    const active = drag.current; if (!active || active.pointer !== e.pointerId) return;
    e.stopPropagation(); const point = e.ray.intersectPlane(active.plane, new THREE.Vector3()); if (!point) return;
    const uv = ventUVAtPoint(device.vent, host, [point.x * 1000, -point.z * 1000, point.y * 1000]);
    if (uv) { [active.u, active.v] = uv; setDraft(uv); }
  }
  return <group position={position} quaternion={quaternion} userData={{ editorOnly: true }}>
    <mesh rotation={[0, 0, device.vent.rotationDeg * Math.PI / 180]} renderOrder={1000} raycast={markerRaycast}
      onDoubleClick={e => { e.stopPropagation(); ctx.editVent(device.vent.id); }}
      onPointerDown={e => {
        if (e.button !== 0) return; e.stopPropagation(); ctx.selectVent(device.vent.id); onDragging(true);
        drag.current = { baseline: JSON.stringify([ctx.geometryKey, device.vent]), u: device.vent.host.u, v: device.vent.host.v, pointer: e.pointerId, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(direction(host.normal), new THREE.Vector3(...previewScene(center))) };
        (e.target as Element).setPointerCapture(e.pointerId);
      }} onPointerMove={move} onPointerCancel={cancel} onLostPointerCapture={() => { if (drag.current) cancel(); }}
      onPointerUp={e => {
        const active = drag.current; if (!active || active.pointer !== e.pointerId) return; e.stopPropagation(); move(e); cancel();
        try { if (active.u !== device.vent.host.u || active.v !== device.vent.host.v) ctx.moveVent(device.vent.id, active.u, active.v, active.baseline); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Vent move failed."); }
        (e.target as Element).releasePointerCapture(e.pointerId);
      }}>
      {device.vent.shape === "circle" ? <circleGeometry args={[device.vent.diameterMm / 2000, 32]} /> : <planeGeometry args={[device.vent.widthMm / 1000, device.vent.heightMm / 1000]} />}
      <meshBasicMaterial color={ctx.selectedVentId === device.vent.id ? "#ff7900" : device.vent.role === "supply" ? "#277ab5" : "#ae5a26"} side={THREE.DoubleSide} depthTest={false} transparent opacity={device.enabled ? .95 : .4} />
    </mesh>
    <Html center position={[0, .04, .01]} zIndexRange={[10, 0]} style={{ pointerEvents: "none", whiteSpace: "nowrap", fontSize: 11, background: "#fff", color: "#10233c", padding: "2px 4px", borderRadius: 3 }}><span data-hvac-scene-vent={device.vent.id}>{device.vent.name}</span>{error && <span role="alert">{error}</span>}</Html>
  </group>;
}

export function HvacSceneMarkers({ floorIds, roomIds, whole, onDragging }: { floorIds: string[]; roomIds: string[]; whole: boolean; onDragging: (active: boolean) => void }) {
  const ctx = useHvac(); if (!ctx?.project.hvac) return null;
  return <group>{ctx.project.hvac.devices.filter(d => floorIds.includes(d.floorId) && (whole || roomIds.includes(d.roomId))).map(device => {
    const host = ctx.geometryPatches.find(p => p.id === device.vent.host.patchId)?.host ?? ctx.geometryReport?.patches.find(p => p.id === device.vent.host.patchId)?.host;
    return host ? <VentMarker key={device.vent.id} device={device} host={host} onDragging={onDragging} /> : null;
  })}</group>;
}
