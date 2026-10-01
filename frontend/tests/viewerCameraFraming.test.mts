import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { fitCameraZoomForBounds, updateCameraClippingForBounds } from "../lib/viewerCameraFraming.ts";

test("parallel camera fit includes all corners of an oblique full-scene view", () => {
  const center: [number, number, number] = [7.4, 1.2, -3.1];
  const span: [number, number, number] = [8, 3, 6];

  for (const [width, height] of [[1280, 720], [720, 1280]]) {
    const aspect = width / height;
    const frustumHeight = 10;
    const camera = new THREE.OrthographicCamera(
      -frustumHeight * aspect / 2,
      frustumHeight * aspect / 2,
      frustumHeight / 2,
      -frustumHeight / 2,
      0.01,
      100,
    );
    camera.position.set(center[0] + 9, center[1] + 8, center[2] + 9);
    camera.lookAt(...center);
    camera.updateProjectionMatrix();

    camera.zoom = fitCameraZoomForBounds(camera, { width, height }, center, span);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    for (const xSign of [-1, 1]) {
      for (const ySign of [-1, 1]) {
        for (const zSign of [-1, 1]) {
          const corner = new THREE.Vector3(
            center[0] + xSign * span[0] / 2,
            center[1] + ySign * span[1] / 2,
            center[2] + zSign * span[2] / 2,
          ).project(camera);
          assert.ok(Math.abs(corner.x) < 1, `corner clipped horizontally at ${width}x${height}: ${corner.x}`);
          assert.ok(Math.abs(corner.y) < 1, `corner clipped vertically at ${width}x${height}: ${corner.y}`);
        }
      }
    }
  }
});

test("initial parallel view includes a large offset plan in all three clip dimensions", () => {
  const center: [number, number, number] = [50, 1.2, -30];
  const span: [number, number, number] = [60, 2.4, 40];
  for (const [width, height] of [[1440, 932], [390, 776]]) {
    const camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.01, 100);
    const fov = THREE.MathUtils.degToRad(50);
    const horizontalFov = 2 * Math.atan(Math.tan(fov / 2) * width / height);
    const distance = Math.hypot(...span) / 2 / Math.sin(Math.min(fov, horizontalFov) / 2) * 1.15;
    camera.position.set(center[0] + distance, center[1] + distance * 0.85, center[2] + distance);
    camera.lookAt(...center);
    camera.zoom = fitCameraZoomForBounds(camera, { width, height }, center, span);
    camera.updateProjectionMatrix();
    assert.ok(new THREE.Vector3(...center).project(camera).z > 1, "reproduce the old far-plane clipping");

    updateCameraClippingForBounds(camera, center, span);
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const corner = new THREE.Vector3(center[0] + x * span[0] / 2, center[1] + y * span[1] / 2, center[2] + z * span[2] / 2).project(camera);
      assert.ok(Math.abs(corner.x) < 1 && Math.abs(corner.y) < 1 && Math.abs(corner.z) < 1, `full scene remains visible at ${width}x${height}: ${corner.toArray()}`);
    }
  }
});

test("depth range follows navigation without changing the camera pose or zoom", () => {
  for (const camera of [new THREE.OrthographicCamera(-10, 10, 10, -10, 0.01, 100), new THREE.PerspectiveCamera(38, 1.5, 0.01, 100)]) {
    const center: [number, number, number] = [250, 1.2, -180];
    const span: [number, number, number] = [40, 2.4, 30];
    camera.zoom = 2;
    for (const distance of [300, 600, 50]) {
      camera.position.set(center[0] + distance, center[1] + distance, center[2] + distance);
      camera.lookAt(...center);
      camera.updateMatrixWorld(true);
      const before = { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), zoom: camera.zoom, near: camera.near };
      updateCameraClippingForBounds(camera, center, span);
      assert.ok(camera.far > camera.position.distanceTo(new THREE.Vector3(...center)) + Math.hypot(...span) / 2);
      assert.deepEqual({ position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), zoom: camera.zoom, near: camera.near }, before);
    }
    camera.position.set(...center).addScalar(5);
    updateCameraClippingForBounds(camera, center, span);
    assert.equal(camera.far, 100, "small views retain the existing depth precision");
  }
});
