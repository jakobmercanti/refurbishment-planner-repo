import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  centreRenderCameraOnRooms,
  hideEditorOnlySceneObjects,
  normalizeRenderCameraState,
  renderCameraCoordinatesFromScene,
  renderCameraFrameSize,
  renderCameraFromNavigation,
  renderCameraFromSceneRotation,
  renderCameraFromScenePose,
  renderCameraForRoom,
  withEditorOnlySceneObjectsHidden,
} from "../lib/renderCamera.ts";

test("camera reference frame sizes preserve all supported aspect ratios", () => {
  for (const aspect of ["1:1", "4:3", "3:2", "16:9", "9:16"] as const) {
    for (const quality of ["standard", "high"] as const) {
      const size = renderCameraFrameSize(aspect, quality);
      const [width, height] = aspect.split(":").map(Number);
      assert.equal(size.width / size.height, width / height);
      assert.ok(Math.max(size.width, size.height) <= (quality === "high" ? 1536 : 1024));
    }
  }
  assert.deepEqual(renderCameraFrameSize("16:9", "standard"), { width: 1024, height: 576 });
  assert.deepEqual(renderCameraFrameSize("3:2", "high"), { width: 1536, height: 1024 });
});

test("camera state normalization rejects degenerate coordinates and repairs optional framing data", () => {
  const camera = renderCameraForRoom([]);
  assert.equal(normalizeRenderCameraState({ ...camera, positionMm: camera.targetMm }), null);
  const repaired = normalizeRenderCameraState({ ...camera, fovDeg: 120, aspectRatio: "9:16", referenceWidth: 1000, referenceHeight: 1000 });
  assert.ok(repaired);
  assert.equal(repaired.fovDeg, 90);
  assert.equal(repaired.referenceWidth / repaired.referenceHeight, 9 / 16);
  assert.equal(normalizeRenderCameraState({ ...camera, positionMm: [Number.NaN, 0, 0] }), null);
});

test("Use current view converts navigation coordinates to millimetres without sharing state", () => {
  const camera = renderCameraFromNavigation({ position: [1, 2, 3], target: [0, 0, 0], up: [0, 2, 0], fov: 38 }, []);
  assert.deepEqual(camera.positionMm, [1000, 2000, 3000]);
  assert.deepEqual(camera.targetMm, [0, 0, 0]);
  assert.deepEqual(camera.up, [0, 1, 0]);
  assert.equal(camera.fovDeg, 38);
  const parallelView = renderCameraFromNavigation({ position: [0, 0, 10], target: [0, 0, 0], up: [0, 1, 0], fov: null, distance: 10, viewHeight: 7 }, []);
  const frameHeight = 2 * parallelView.positionMm[2] / 1000 * Math.tan(THREE.MathUtils.degToRad(parallelView.fovDeg / 2));
  assert.ok(Math.abs(frameHeight - 7) < 1e-9);
});

test("parallel navigation at a distant position keeps its framing instead of making a tiny preview", () => {
  const camera = renderCameraFromNavigation({ position: [40, 16, 30], target: [5, 1, 0], up: [0, 1, 0], fov: null, viewHeight: 6 }, []);
  const offset = new THREE.Vector3(...camera.positionMm).sub(new THREE.Vector3(...camera.targetMm)).multiplyScalar(0.001);
  assert.ok(offset.length() < 10);
  assert.ok(Math.abs(2 * offset.length() * Math.tan(THREE.MathUtils.degToRad(camera.fovDeg / 2)) - 6) < 1e-9);
  assert.ok(offset.normalize().distanceTo(new THREE.Vector3(35, 15, 30).normalize()) < 1e-9);
});

test("Use current view respects perspective zoom while keeping FOV within useful limits", () => {
  const camera = renderCameraFromNavigation({ position: [0, 0, 10], target: [0, 0, 0], up: [0, 1, 0], fov: 50, viewHeight: 2 }, []);
  assert.equal(camera.fovDeg, 30);
  assert.ok(Math.abs(2 * camera.positionMm[2] / 1000 * Math.tan(Math.PI / 12) - 2) < 1e-9);
});

test("dragging and turning the camera applies its whole pose without leaving the target behind", () => {
  const camera = { ...renderCameraForRoom([]), positionMm: [0, 1500, 4000] as [number, number, number], targetMm: [0, 1500, 0] as [number, number, number] };
  const moved = renderCameraFromScenePose(camera, [2, 2, 5], new THREE.Quaternion());
  assert.deepEqual(moved.positionMm, [2000, 2000, 5000]);
  assert.deepEqual(moved.targetMm, [2000, 2000, 1000]);
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0.7, 0.2));
  const turned = renderCameraFromScenePose(camera, [2, 2, 5], rotation);
  const direction = new THREE.Vector3(...turned.targetMm).sub(new THREE.Vector3(...turned.positionMm));
  assert.ok(Math.abs(direction.length() - 4000) < 1e-9);
  assert.ok(direction.normalize().distanceTo(new THREE.Vector3(0, 0, -1).applyQuaternion(rotation)) < 1e-9);
  assert.ok(new THREE.Vector3(...turned.up).distanceTo(new THREE.Vector3(0, 1, 0).applyQuaternion(rotation)) < 1e-9);
  assert.deepEqual(camera.targetMm, [0, 1500, 0]);
});

test("centering a render camera translates position and target together", () => {
  const original = renderCameraForRoom([]);
  const offset = { ...original, positionMm: [4000, 4000, 4000] as [number, number, number], targetMm: [2500, 2000, 2500] as [number, number, number] };
  const centered = centreRenderCameraOnRooms(offset, []);
  assert.deepEqual(centered.positionMm.map((value, index) => value - centered.targetMm[index]), [1500, 2000, 1500]);
  assert.deepEqual(centered.targetMm, original.targetMm);
});

test("interactive camera and target coordinates round-trip through the main scene axes", () => {
  const original = renderCameraForRoom([]);
  const bodyMoved = normalizeRenderCameraState({
    ...original,
    positionMm: renderCameraCoordinatesFromScene([2.25, 1.62, -4.75]),
  });
  assert.ok(bodyMoved);
  assert.deepEqual(bodyMoved.positionMm, [2250, 1620, -4750]);
  assert.deepEqual(bodyMoved.targetMm, original.targetMm);

  const targetMoved = normalizeRenderCameraState({
    ...bodyMoved,
    targetMm: renderCameraCoordinatesFromScene([-0.4, 1.1, -2.3]),
  });
  assert.ok(targetMoved);
  assert.deepEqual(targetMoved.targetMm, [-400, 1100, -2300]);
  assert.deepEqual(targetMoved.positionMm, bodyMoved.positionMm);
});

test("rotating the render camera changes its target and up vector while preserving focal distance", () => {
  const camera = renderCameraForRoom([]);
  const sceneCamera = new THREE.PerspectiveCamera();
  sceneCamera.position.fromArray(camera.positionMm.map((value) => value / 1000));
  sceneCamera.up.fromArray(camera.up);
  sceneCamera.lookAt(...camera.targetMm.map((value) => value / 1000) as [number, number, number]);
  const rotation = new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 5)
    .multiply(sceneCamera.quaternion);

  const rotated = renderCameraFromSceneRotation(camera, rotation);
  const distance = (state: typeof camera) => Math.hypot(...state.targetMm.map((value, index) => value - state.positionMm[index]));

  assert.deepEqual(rotated.positionMm, camera.positionMm);
  assert.notDeepEqual(rotated.targetMm, camera.targetMm);
  assert.ok(Math.abs(distance(rotated) - distance(camera)) < 0.1);
  assert.ok(Math.abs(Math.hypot(...rotated.up) - 1) < 1e-9);
});

test("editor-only camera helpers stay out of clean renders and restore even after errors", () => {
  const scene = new THREE.Scene();
  const cameraRig = new THREE.Group();
  cameraRig.userData.editorOnly = true;
  const cameraBody = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  cameraRig.add(cameraBody);
  const room = new THREE.Group();
  scene.add(cameraRig, room);

  const restore = hideEditorOnlySceneObjects(scene);
  assert.equal(cameraRig.visible, false);
  assert.equal(room.visible, true);
  restore();
  assert.equal(cameraRig.visible, true);

  assert.throws(() => withEditorOnlySceneObjectsHidden(scene, () => {
    assert.equal(cameraRig.visible, false);
    throw new Error("render failed");
  }), /render failed/);
  assert.equal(cameraRig.visible, true);
});
