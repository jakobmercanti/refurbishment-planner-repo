"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Html } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { useHvac, useHvacMarkersVisible } from "./HvacContext";
import { previewScene, ventCenter } from "@/lib/climoptixPreview";
import { ventUVAtPoint } from "@/lib/ventPlacement";
import type { CFDHost } from "@/lib/climoptix";
import type { VentDevice } from "@/lib/hvacDocument";

function VentMarker({ device, host, onDragging }: { device: VentDevice; host: CFDHost; onDragging: (active: boolean) => void }) {
  const ctx = useHvac()!;
  const [draft, setDraft] = useState<[number, number] | null>(null), [error, setError] = useState("");
  const drag = useRef<{ baseline: string; u: number; v: number; pointer: number; plane: THREE.Plane; start: [number, number]; offset: THREE.Vector3; moved: boolean } | null>(null);
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
    e.stopPropagation();
    if (!active.moved && Math.hypot(e.clientX - active.start[0], e.clientY - active.start[1]) < 4) return;
    const point = e.ray.intersectPlane(active.plane, new THREE.Vector3()); if (!point) return;
    active.moved = true; point.sub(active.offset);
    const uv = ventUVAtPoint(device.vent, host, [point.x * 1000, -point.z * 1000, point.y * 1000]);
    if (uv) { [active.u, active.v] = uv; setDraft(uv); }
  }
  const selected = ctx.selectedVentId === device.vent.id;
  const labelPosition = previewScene(center.map((n, i) => n - host.normal[i] * 7) as [number, number, number]);
  return <group userData={{ editorOnly: true }}>
    <group position={position} quaternion={quaternion}>
    <mesh name={`shared-vent:${device.vent.id}`} rotation={[0, 0, device.vent.rotationDeg * Math.PI / 180]}
      onDoubleClick={e => { e.stopPropagation(); ctx.editVent(device.vent.id); }}
      onPointerDown={e => {
        if (e.button !== 0) return; e.stopPropagation(); ctx.selectVent(device.vent.id); onDragging(true);
        const centre = new THREE.Vector3(...previewScene(center));
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(direction(host.normal), centre);
        const grab = e.ray.intersectPlane(plane, new THREE.Vector3()) ?? centre;
        drag.current = { baseline: JSON.stringify([ctx.geometryKey, device.vent]), u: device.vent.host.u, v: device.vent.host.v, pointer: e.pointerId, plane, start: [e.clientX, e.clientY], offset: grab.clone().sub(centre), moved: false };
        (e.target as Element).setPointerCapture(e.pointerId);
      }} onPointerMove={move} onPointerCancel={cancel} onLostPointerCapture={() => { if (drag.current) cancel(); }}
      onPointerUp={e => {
        const active = drag.current; if (!active || active.pointer !== e.pointerId) return; e.stopPropagation(); move(e); cancel();
        try { if (active.moved && (active.u !== device.vent.host.u || active.v !== device.vent.host.v)) ctx.moveVent(device.vent.id, active.u, active.v, active.baseline); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Vent move failed."); }
        (e.target as Element).releasePointerCapture(e.pointerId);
      }}>
      {device.vent.shape === "circle" ? <circleGeometry args={[device.vent.diameterMm / 2000, 32]} /> : <planeGeometry args={[device.vent.widthMm / 1000, device.vent.heightMm / 1000]} />}
      <meshBasicMaterial color={selected ? "#cf863c" : device.vent.role === "supply" ? "#6e97ad" : "#b59076"} side={THREE.DoubleSide} depthTest depthWrite={false} transparent opacity={device.enabled ? selected ? .65 : .32 : .14} />
    </mesh>
    </group>
    <Html center occlude position={labelPosition} zIndexRange={[10, 0]} style={{ pointerEvents: "none", userSelect: "none", whiteSpace: "nowrap", fontSize: 10, opacity: selected ? 1 : .7, background: "rgba(255,255,255,.85)", color: "#374d5c", padding: "2px 4px", borderRadius: 3 }}><span data-hvac-scene-vent={device.vent.id} data-selected={selected}>{device.vent.name}</span>{error && <span role="alert">{error}</span>}</Html>
  </group>;
}

export function HvacSceneMarkers({ floorIds, roomIds, whole, onDragging }: { floorIds: string[]; roomIds: string[]; whole: boolean; onDragging: (active: boolean) => void }) {
  const ctx = useHvac(), visible = useHvacMarkersVisible(); if (!visible || !ctx?.project.hvac) return null;
  return <group>{ctx.project.hvac.devices.filter(d => floorIds.includes(d.floorId) && (whole || roomIds.includes(d.roomId))).map(device => {
    const host = ctx.geometryPatches.find(p => p.id === device.vent.host.patchId)?.host ?? ctx.geometryReport?.patches.find(p => p.id === device.vent.host.patchId)?.host;
    return host ? <VentMarker key={device.vent.id} device={device} host={host} onDragging={onDragging} /> : null;
  })}</group>;
}
