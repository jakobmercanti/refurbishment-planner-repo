import * as THREE from "three";
import type { Room } from "./types";

export const RENDER_CAMERA_ASPECTS = ["1:1", "4:3", "3:2", "16:9", "9:16"] as const;
export type RenderCameraAspect = (typeof RENDER_CAMERA_ASPECTS)[number];
export type RenderCameraQuality = "standard" | "high";
export type CameraVectorMm = [number, number, number];
export type RenderCameraSceneVector = [number, number, number];

/** Convert the viewer's scene coordinates to its serialised millimetre axes. */
export function renderCameraCoordinatesFromScene(position: RenderCameraSceneVector): CameraVectorMm {
  return [position[0] * 1000, position[1] * 1000, position[2] * 1000];
}

/** Rotate the render camera in the scene while keeping its focal distance. */
export function renderCameraFromSceneRotation(cameraState: RenderCameraState, rotation: THREE.Quaternion): RenderCameraState {
  return renderCameraFromScenePose(cameraState, cameraState.positionMm.map((value) => value / 1000) as RenderCameraSceneVector, rotation);
}

/** Apply a gizmo pose without orbiting an old target when the body is moved. */
export function renderCameraFromScenePose(cameraState: RenderCameraState, nextPosition: RenderCameraSceneVector, rotation: THREE.Quaternion): RenderCameraState {
  const position = cameraState.positionMm.map((value) => value / 1000) as RenderCameraSceneVector;
  const target = cameraState.targetMm.map((value) => value / 1000) as RenderCameraSceneVector;
  const distance = Math.hypot(target[0] - position[0], target[1] - position[1], target[2] - position[2]);
  const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(rotation).normalize();
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation).normalize();
  const targetMm = renderCameraCoordinatesFromScene([
    nextPosition[0] + direction.x * distance,
    nextPosition[1] + direction.y * distance,
    nextPosition[2] + direction.z * distance,
  ]);
  return normalizeRenderCameraState({ ...cameraState, positionMm: renderCameraCoordinatesFromScene(nextPosition), targetMm, up: [up.x, up.y, up.z] }) ?? cameraState;
}

export interface RenderCameraState {
  /** Stable identity leaves room for a future collection of named cameras. */
  cameraId: string;
  name: string;
  /** Scene-space axes, expressed in the project's authoritative millimetres. */
  positionMm: CameraVectorMm;
  targetMm: CameraVectorMm;
  /** Unitless camera-up vector. */
  up: CameraVectorMm;
  fovDeg: number;
  aspectRatio: RenderCameraAspect;
  referenceWidth: number;
  referenceHeight: number;
  /** Marks that the in-room default or a deliberate placement has been stored. */
  placementInitialized: boolean;
}

export interface RenderCameraFrameSize {
  width: number;
  height: number;
}

const MAX_COORDINATE_MM = 100_000_000;
const DEFAULT_FOV_DEG = 50;
const PREVIEW_BACKGROUND = "#edf0eb";
const ASPECT_PARTS: Record<RenderCameraAspect, [number, number]> = {
  "1:1": [1, 1],
  "4:3": [4, 3],
  "3:2": [3, 2],
  "16:9": [16, 9],
  "9:16": [9, 16],
};

/** Keep exact ratios while using a practical long-edge size for local references. */
export function renderCameraFrameSize(aspectRatio: RenderCameraAspect, quality: RenderCameraQuality): RenderCameraFrameSize {
  const [ratioWidth, ratioHeight] = ASPECT_PARTS[aspectRatio];
  const longEdge = quality === "high" ? 1536 : 1024;
  const scale = Math.max(1, Math.floor(longEdge / Math.max(ratioWidth, ratioHeight)));
  return { width: ratioWidth * scale, height: ratioHeight * scale };
}

export function renderCameraQuality(state: Pick<RenderCameraState, "referenceWidth" | "referenceHeight">): RenderCameraQuality {
  return Math.max(state.referenceWidth, state.referenceHeight) > 1024 ? "high" : "standard";
}

function finiteVector(value: unknown): CameraVectorMm | null {
  if (!Array.isArray(value) || value.length !== 3 || value.some((part) => typeof part !== "number" || !Number.isFinite(part) || Math.abs(part) > MAX_COORDINATE_MM)) return null;
  return [value[0], value[1], value[2]];
}

function normalizeUp(value: unknown): CameraVectorMm | null {
  const vector = finiteVector(value);
  if (!vector) return null;
  const length = Math.hypot(...vector);
  if (length < 1e-6) return null;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

/**
 * Validate untrusted project data without making an invalid optional camera
 * invalidate the rest of a recoverable project.
 */
export function normalizeRenderCameraState(value: unknown): RenderCameraState | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const positionMm = finiteVector(input.positionMm);
  const targetMm = finiteVector(input.targetMm);
  let up = normalizeUp(input.up);
  if (!positionMm || !targetMm || !up) return null;
  const direction = targetMm.map((part, index) => part - positionMm[index]) as CameraVectorMm;
  if (Math.hypot(...direction) < 1) return null;
  const upCrossDirection = [up[1] * direction[2] - up[2] * direction[1], up[2] * direction[0] - up[0] * direction[2], up[0] * direction[1] - up[1] * direction[0]];
  if (Math.hypot(...upCrossDirection) < 1e-6) up = Math.abs(direction[1]) < Math.hypot(...direction) * 0.9 ? [0, 1, 0] : [1, 0, 0];

  const aspectRatio = RENDER_CAMERA_ASPECTS.includes(input.aspectRatio as RenderCameraAspect)
    ? input.aspectRatio as RenderCameraAspect
    : "16:9";
  const requestedWidth = input.referenceWidth;
  const requestedHeight = input.referenceHeight;
  const dimensionsAreValid = Number.isInteger(requestedWidth) && Number.isInteger(requestedHeight)
    && Number(requestedWidth) >= 1 && Number(requestedHeight) >= 1
    && Number(requestedWidth) <= 4096 && Number(requestedHeight) <= 4096
    && Number(requestedWidth) * Number(requestedHeight) <= 16_777_216;
  const [aspectWidth, aspectHeight] = ASPECT_PARTS[aspectRatio];
  const dimensionsMatchAspect = dimensionsAreValid && Math.abs(Number(requestedWidth) / Number(requestedHeight) - aspectWidth / aspectHeight) < 1e-6;
  const quality: RenderCameraQuality = dimensionsAreValid && Math.max(Number(requestedWidth), Number(requestedHeight)) > 1024 ? "high" : "standard";
  const defaults = renderCameraFrameSize(aspectRatio, quality);
  const referenceWidth = dimensionsMatchAspect ? Number(requestedWidth) : defaults.width;
  const referenceHeight = dimensionsMatchAspect ? Number(requestedHeight) : defaults.height;
  const rawId = input.cameraId;
  const cameraId = typeof rawId === "string" && /^[\w:-]{1,150}$/.test(rawId) ? rawId : "render-camera-1";
  const rawName = input.name;
  const name = typeof rawName === "string" && rawName.trim().length > 0 ? rawName.trim().slice(0, 100) : "Camera 1";
  const rawFov = input.fovDeg;
  const fovDeg = typeof rawFov === "number" && Number.isFinite(rawFov)
    ? THREE.MathUtils.clamp(rawFov, 30, 90)
    : DEFAULT_FOV_DEG;
  return { cameraId, name, positionMm, targetMm, up, fovDeg, aspectRatio, referenceWidth, referenceHeight, placementInitialized: input.placementInitialized === true };
}

export function renderCameraForRoom(rooms: Room[]): RenderCameraState {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let wallHeight = 0;
  for (const room of rooms) {
    wallHeight = Math.max(wallHeight, room.wall_height.value);
    for (const point of room.vertices) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    minX = 0; maxX = 3000; minY = 0; maxY = 3000;
  }
  wallHeight = wallHeight || 2400;
  const roomCentreX = (minX + maxX) / 2;
  const roomCentreY = (minY + maxY) / 2;
  const cameraHeight = wallHeight * 0.62;
  const positionMm: CameraVectorMm = [roomCentreX, cameraHeight, -roomCentreY];
  const targetMm: CameraVectorMm = [roomCentreX, wallHeight * 0.25, -roomCentreY - Math.min(Math.max((maxY - minY) * 0.55, 900), 2500)];
  const frame = renderCameraFrameSize("16:9", "standard");
  return { cameraId: "render-camera-1", name: "Camera 1", positionMm, targetMm, up: [0, 1, 0], fovDeg: DEFAULT_FOV_DEG, aspectRatio: "16:9", referenceWidth: frame.width, referenceHeight: frame.height, placementInitialized: true };
}

/** Place a saved camera in the active room while retaining its output framing. */
export function placeRenderCameraAtRoomCentre(state: RenderCameraState, rooms: Room[]): RenderCameraState {
  const centre = renderCameraForRoom(rooms);
  return {
    ...state,
    positionMm: centre.positionMm,
    targetMm: centre.targetMm,
    up: centre.up,
    placementInitialized: true,
  };
}

export function renderCameraFromNavigation(
  view: { position: [number, number, number]; target: [number, number, number]; up: [number, number, number]; fov?: number | null; distance?: number; viewHeight?: number } | null,
  rooms: Room[],
): RenderCameraState {
  if (!view) return renderCameraForRoom(rooms);
  const fallback = renderCameraForRoom(rooms);
  const position = new THREE.Vector3(...view.position);
  const target = new THREE.Vector3(...view.target);
  const offset = position.clone().sub(target);
  const distance = offset.length();
  const hasFrame = Number.isFinite(view.viewHeight) && (view.viewHeight ?? 0) > 0 && distance > 0;
  const perspective = typeof view.fov === "number" && Number.isFinite(view.fov);
  const effectiveFov = perspective && hasFrame
    ? THREE.MathUtils.radToDeg(2 * Math.atan(view.viewHeight! / (2 * distance)))
    : perspective ? view.fov! : fallback.fovDeg;
  const fov = THREE.MathUtils.clamp(effectiveFov, 30, 90);
  // Parallel navigation distance is arbitrary. Preserve target-plane framing,
  // not that distance; also account for perspective zoom and bounded FOV.
  if (hasFrame) {
    const framedDistance = view.viewHeight! / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
    position.copy(target).addScaledVector(offset.normalize(), framedDistance);
  }
  return normalizeRenderCameraState({
    ...fallback,
    positionMm: position.toArray().map((value) => value * 1000),
    targetMm: view.target.map((value) => value * 1000),
    up: view.up,
    fovDeg: fov,
  }) ?? fallback;
}

export function centreRenderCameraOnRooms(state: RenderCameraState, rooms: Room[]): RenderCameraState {
  const next = renderCameraForRoom(rooms);
  const delta = next.targetMm.map((value, index) => value - state.targetMm[index]) as CameraVectorMm;
  return { ...state, positionMm: state.positionMm.map((value, index) => value + delta[index]) as CameraVectorMm, targetMm: next.targetMm };
}

/** Hide transient editor helpers while a scene-only image is being rendered. */
export function hideEditorOnlySceneObjects(scene: THREE.Scene): () => void {
  const hidden: Array<[THREE.Object3D, boolean]> = [];
  scene.traverse((object) => {
    if (object.userData.editorOnly === true && object.visible) {
      hidden.push([object, object.visible]);
      object.visible = false;
    }
  });
  return () => {
    for (const [object, visible] of hidden.reverse()) object.visible = visible;
  };
}

/** Render work that must not include editor helpers, restoring the scene even on failure. */
export function withEditorOnlySceneObjectsHidden<T>(scene: THREE.Scene, render: () => T): T {
  const restore = hideEditorOnlySceneObjects(scene);
  try {
    return render();
  } finally {
    restore();
  }
}

function suppressEditorOnlySceneState(scene: THREE.Scene, cleanScene: boolean): () => void {
  if (!cleanScene) return () => undefined;
  const restoreEditorOnly = hideEditorOnlySceneObjects(scene);
  const restoreMaterials: Array<() => void> = [];
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material.userData.editorSelectionHighlight === true) {
        if (material instanceof THREE.MeshStandardMaterial) {
          const emissive = material.emissive.clone();
          const emissiveIntensity = material.emissiveIntensity;
          material.emissive.set(0x000000);
          material.emissiveIntensity = 0;
          restoreMaterials.push(() => { material.emissive.copy(emissive); material.emissiveIntensity = emissiveIntensity; });
        }
        const selectedAmount = material instanceof THREE.ShaderMaterial ? material.uniforms.selectedAmount : undefined;
        if (selectedAmount && typeof selectedAmount.value === "number") {
          const previousAmount = selectedAmount.value;
          selectedAmount.value = 0;
          restoreMaterials.push(() => { selectedAmount.value = previousAmount; });
        }
      }
      if (material instanceof THREE.MeshStandardMaterial && typeof material.userData.editorReferenceColor === "string") {
        const previousColour = material.color.clone();
        material.color.set(material.userData.editorReferenceColor);
        restoreMaterials.push(() => material.color.copy(previousColour));
      }
    }
  });
  return () => {
    for (const restore of restoreMaterials.reverse()) restore();
    restoreEditorOnly();
  };
}

/** Render the current shared scene into a low-resolution or capture render target. */
export function renderReferencePixels(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  target: THREE.WebGLRenderTarget,
  cleanScene = true,
): Uint8ClampedArray<ArrayBuffer> {
  if (renderer.getContext().isContextLost()) throw new Error("The 3D graphics context is unavailable. Reopen the 3D view and try again.");
  const previousTarget = renderer.getRenderTarget();
  const previousViewport = renderer.getViewport(new THREE.Vector4());
  const previousScissor = renderer.getScissor(new THREE.Vector4());
  const previousScissorTest = renderer.getScissorTest();
  const previousClearColour = renderer.getClearColor(new THREE.Color());
  const previousClearAlpha = renderer.getClearAlpha();
  const previousAutoClear = renderer.autoClear;
  const restoreCleanScene = suppressEditorOnlySceneState(scene, cleanScene);
  try {
    renderer.setRenderTarget(target);
    renderer.setViewport(0, 0, target.width, target.height);
    renderer.setScissorTest(false);
    renderer.setClearColor(PREVIEW_BACKGROUND, 1);
    renderer.autoClear = false;
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    const bytes = new Uint8Array(target.width * target.height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, bytes);
    const pixels = new Uint8ClampedArray(new ArrayBuffer(bytes.length));
    const rowBytes = target.width * 4;
    for (let row = 0; row < target.height; row += 1) {
      const sourceOffset = (target.height - row - 1) * rowBytes;
      pixels.set(bytes.subarray(sourceOffset, sourceOffset + rowBytes), row * rowBytes);
    }
    return pixels;
  } finally {
    restoreCleanScene();
    renderer.setRenderTarget(previousTarget);
    renderer.setViewport(previousViewport);
    renderer.setScissor(previousScissor);
    renderer.setScissorTest(previousScissorTest);
    renderer.setClearColor(previousClearColour, previousClearAlpha);
    renderer.autoClear = previousAutoClear;
  }
}

export interface ReferenceImageCapture {
  cameraId: string;
  width: number;
  height: number;
  mimeType: "image/png";
  blob: Blob;
}

export interface CaptureReferenceImageOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cameraId: string;
  width: number;
  height: number;
  cleanScene?: boolean;
}

/** Provider-independent, clean scene capture for later reference-image workflows. */
export async function captureReferenceImage(options: CaptureReferenceImageOptions): Promise<ReferenceImageCapture> {
  const { renderer, scene, camera, cameraId, width, height, cleanScene = true } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 16_777_216) {
    throw new Error("Reference image dimensions are outside the supported range.");
  }
  if (typeof document === "undefined") throw new Error("Reference image capture is only available in the browser.");
  const target = new THREE.WebGLRenderTarget(width, height, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: true, stencilBuffer: false, samples: 0 });
  target.texture.colorSpace = renderer.outputColorSpace;
  target.texture.colorSpace = renderer.outputColorSpace;
  const previousAspect = camera.aspect;
  try {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const pixels = renderReferencePixels(renderer, scene, camera, target, cleanScene);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The browser could not create a reference image canvas.");
    context.putImageData(new ImageData(pixels, width, height), 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("The reference image could not be encoded.")), "image/png"));
    return { cameraId, width, height, mimeType: "image/png", blob };
  } finally {
    camera.aspect = previousAspect;
    camera.updateProjectionMatrix();
    target.dispose();
  }
}
