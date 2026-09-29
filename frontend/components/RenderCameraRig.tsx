"use client";

import { Billboard, Line, PivotControls, RoundedBox } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { renderCameraCoordinatesFromScene, renderCameraFromScenePose, type RenderCameraState } from "@/lib/renderCamera";

export type RenderCameraRigHandle = "position" | "target";
type CaptureTarget = { setPointerCapture: (id: number) => void; releasePointerCapture: (id: number) => void };
type DirectDrag = {
  state: RenderCameraState;
  plane: THREE.Plane;
  start: THREE.Vector3;
  handle: RenderCameraRigHandle;
  pointerId: number;
  capture: CaptureTarget;
  clientX: number;
  lens: boolean;
};

/** The gizmo and body drive the same serialisable state as the panel and preview. */
export default function RenderCameraRig({ cameraState, selectedHandle, onSelectHandle, onCameraChange, onOpenProperties }: {
  cameraState: RenderCameraState;
  selectedHandle: RenderCameraRigHandle | null;
  onSelectHandle: (handle: RenderCameraRigHandle | null) => void;
  onCameraChange: (camera: RenderCameraState) => void;
  onOpenProperties: (clientX: number, clientY: number, eventTarget: EventTarget | null) => void;
}) {
  const get = useThree((state) => state.get);
  const glyph = useRef<THREE.Group>(null);
  const cone = useRef<THREE.Group>(null);
  const objective = useRef<THREE.Group>(null);
  const directDrag = useRef<DirectDrag | null>(null);
  const [directDragging, setDirectDragging] = useState(false);
  const gizmoStart = useRef<RenderCameraState | null>(null);
  const rotating = useRef(false);
  const navigationLock = useRef<{ controls: { enabled: boolean }; enabled: boolean } | null>(null);
  const position = useMemo(() => new THREE.Vector3(...cameraState.positionMm).multiplyScalar(0.001), [cameraState.positionMm]);
  const target = useMemo(() => new THREE.Vector3(...cameraState.targetMm).multiplyScalar(0.001), [cameraState.targetMm]);
  const pose = useMemo(() => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.copy(position);
    camera.up.fromArray(cameraState.up);
    camera.lookAt(target);
    camera.updateMatrix();
    return camera.matrix.clone();
  }, [position, target, cameraState.up]);
  const targetPose = useMemo(() => new THREE.Matrix4().makeTranslation(target.x, target.y, target.z), [target]);
  const frustum = useMemo(() => {
    // Scale this illustrative cone with the camera body, so it cannot disappear
    // inside the enlarged glyph when the navigation view is zoomed out.
    const lens = new THREE.Vector3(0, 0, -0.3);
    const depth = 1.2;
    const [w, h] = cameraState.aspectRatio.split(":").map(Number);
    const y = depth * Math.tan(THREE.MathUtils.degToRad(cameraState.fovDeg / 2));
    const x = y * w / h;
    const corners = [new THREE.Vector3(-x, -y, -depth), new THREE.Vector3(x, -y, -depth), new THREE.Vector3(x, y, -depth), new THREE.Vector3(-x, y, -depth)].map((corner) => corner.add(lens));
    const points: THREE.Vector3[] = [];
    corners.forEach((corner, index) => points.push(lens, corner, corner, corners[(index + 1) % 4]));
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [cameraState.aspectRatio, cameraState.fovDeg]);
  useEffect(() => () => frustum.dispose(), [frustum]);

  const lockNavigation = useCallback(() => {
    const controls = get().controls as unknown as { enabled: boolean } | null;
    if (controls && !navigationLock.current) {
      navigationLock.current = { controls, enabled: controls.enabled };
      controls.enabled = false;
    }
  }, [get]);
  const finishDrag = useCallback(() => {
    const drag = directDrag.current;
    directDrag.current = null;
    setDirectDragging(false);
    gizmoStart.current = null;
    rotating.current = false;
    if (drag) {
      try { drag.capture.releasePointerCapture(drag.pointerId); } catch { /* Already released on cancellation. */ }
    }
    const lock = navigationLock.current;
    navigationLock.current = null;
    if (lock) lock.controls.enabled = lock.enabled;
  }, []);
  const deselect = useEffectEvent(() => onSelectHandle(null));
  const cancelDrag = useEffectEvent(() => {
    if (!directDrag.current && !gizmoStart.current) return;
    finishDrag();
    onSelectHandle(null);
  });
  useEffect(() => {
    const canvas = get().gl.domElement;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { finishDrag(); deselect(); }
    };
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", cancelDrag);
    window.addEventListener("blur", cancelDrag);
    window.addEventListener("keydown", escape);
    canvas.addEventListener("lostpointercapture", cancelDrag);
    return () => {
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", cancelDrag);
      window.removeEventListener("blur", cancelDrag);
      window.removeEventListener("keydown", escape);
      canvas.removeEventListener("lostpointercapture", cancelDrag);
      finishDrag();
    };
  }, [finishDrag, get]);

  useFrame((state) => {
    if (!glyph.current) return;
    // Keep the body comfortably pickable as the navigation view zooms.
    const view = state.viewport.getCurrentViewport(state.camera, position);
    const scale = THREE.MathUtils.clamp(view.width / Math.max(1, state.size.width) * 96, 0.35, 8);
    glyph.current.scale.setScalar(scale);
    cone.current?.scale.setScalar(scale);
    const targetView = state.viewport.getCurrentViewport(state.camera, target);
    objective.current?.scale.setScalar(THREE.MathUtils.clamp(targetView.width / Math.max(1, state.size.width) * 80, 0.35, 8));
  });

  const startDrag = (event: ThreeEvent<PointerEvent>, lens = false, handle: RenderCameraRigHandle = "position") => {
    if (event.button !== 0 || directDrag.current) return;
    event.stopPropagation();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(get().camera.getWorldDirection(new THREE.Vector3()), handle === "target" ? target : position);
    const start = event.ray.intersectPlane(plane, new THREE.Vector3());
    if (!start) return;
    onSelectHandle(handle);
    const capture = event.target as unknown as CaptureTarget;
    directDrag.current = {
      state: cameraState, plane, start, handle,
      pointerId: event.pointerId, capture, clientX: event.clientX, lens,
    };
    capture.setPointerCapture(event.pointerId);
    setDirectDragging(true);
    lockNavigation();
  };
  const moveDrag = (event: ThreeEvent<PointerEvent>) => {
    const drag = directDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (drag.lens) {
      onCameraChange({ ...drag.state, fovDeg: Math.round(THREE.MathUtils.clamp(drag.state.fovDeg - (event.clientX - drag.clientX) * 0.25, 30, 90)) });
      return;
    }
    const hit = event.ray.intersectPlane(drag.plane, new THREE.Vector3());
    if (!hit) return;
    const field = drag.handle === "target" ? "targetMm" : "positionMm";
    const next = new THREE.Vector3(...drag.state[field]).multiplyScalar(0.001).add(hit.sub(drag.start));
    onCameraChange({ ...drag.state, [field]: renderCameraCoordinatesFromScene(next.toArray()) });
  };
  const endDrag = (event: ThreeEvent<PointerEvent>) => {
    if (!directDrag.current) return;
    event.stopPropagation();
    finishDrag();
  };
  const openProperties = (event: ThreeEvent<MouseEvent>) => {
    if (event.button !== 2) return;
    event.nativeEvent.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopPropagation();
    onOpenProperties(event.clientX, event.clientY, event.nativeEvent.target);
  };

  return <group userData={{ editorOnly: true }} onContextMenu={openProperties}>
    <PivotControls matrix={pose} autoTransform={false} fixed scale={100} lineWidth={3}
      enabled={selectedHandle === "position" && !directDragging} visible={selectedHandle === "position" && !directDragging} disableSliders disableScaling depthTest={false}
      onDragStart={({ component }) => { gizmoStart.current = cameraState; rotating.current = component === "Rotator"; lockNavigation(); onSelectHandle("position"); }}
      onDrag={(matrix) => {
        const nextPosition = new THREE.Vector3();
        const rotation = new THREE.Quaternion();
        matrix.decompose(nextPosition, rotation, new THREE.Vector3());
        const start = gizmoStart.current ?? cameraState;
        onCameraChange(rotating.current
          ? renderCameraFromScenePose(start, nextPosition.toArray(), rotation)
          : { ...start, positionMm: renderCameraCoordinatesFromScene(nextPosition.toArray()) });
      }}
      onDragEnd={finishDrag}>
      <group ref={glyph}
        onPointerDown={(event) => startDrag(event)} onPointerMove={moveDrag} onPointerUp={endDrag}
        onClick={(event) => { event.stopPropagation(); onSelectHandle("position"); }}>
        <RoundedBox args={[0.5, 0.35, 0.26]} radius={0.055} smoothness={3}>
          <meshStandardMaterial color={selectedHandle === "position" ? "#d7eaff" : "#e9eff4"} roughness={0.42} metalness={0.28} />
        </RoundedBox>
        <group onPointerDown={(event) => startDrag(event, true)} onPointerMove={moveDrag} onPointerUp={endDrag}>
          <mesh position={[0, 0, -0.2]} rotation={[-Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.14, 0.14, 0.18, 28]} />
            <meshStandardMaterial color="#263c51" roughness={0.24} metalness={0.58} />
          </mesh>
          <mesh position={[0, 0, -0.295]} rotation={[-Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.11, 0.11, 0.012, 28]} />
            <meshStandardMaterial color="#3987ad" roughness={0.2} metalness={0.35} />
          </mesh>
        </group>
      </group>
    </PivotControls>
    <group matrix={pose} matrixAutoUpdate={false}>
      <group ref={cone}>
        <lineSegments geometry={frustum} raycast={() => undefined} renderOrder={20}>
          <lineBasicMaterial color="#52748f" transparent opacity={0.55} depthTest={false} depthWrite={false} />
        </lineSegments>
      </group>
    </group>
    <Line points={[position, target]} color="#65798c" lineWidth={1.25} transparent opacity={0.45} depthTest={false} depthWrite={false} renderOrder={19} raycast={() => undefined} />
    <PivotControls matrix={targetPose} autoTransform={false} fixed scale={90} lineWidth={3}
      enabled={selectedHandle === "target" && !directDragging} visible={selectedHandle === "target" && !directDragging}
      disableRotations disableScaling depthTest={false}
      onDragStart={() => { gizmoStart.current = cameraState; lockNavigation(); }}
      onDrag={(matrix) => {
        const next = new THREE.Vector3().setFromMatrixPosition(matrix);
        onCameraChange({ ...(gizmoStart.current ?? cameraState), targetMm: renderCameraCoordinatesFromScene(next.toArray()) });
      }} onDragEnd={finishDrag}>
      <group ref={objective}
        onPointerDown={(event) => startDrag(event, false, "target")} onPointerMove={moveDrag} onPointerUp={endDrag}
        onClick={(event) => { event.stopPropagation(); onSelectHandle("target"); }}>
        <Billboard>
          <mesh renderOrder={22}>
            <ringGeometry args={[0.12, 0.15, 32]} />
            <meshBasicMaterial color="#1682df" depthTest={false} depthWrite={false} />
          </mesh>
          <mesh renderOrder={22}>
            <circleGeometry args={[0.045, 16]} />
            <meshBasicMaterial color="#1682df" depthTest={false} depthWrite={false} />
          </mesh>
        </Billboard>
        <mesh>
          <sphereGeometry args={[0.2, 12, 8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
    </PivotControls>
  </group>;
}
