import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { fitCameraZoomForBounds } from "../lib/viewerCameraFraming.ts";

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
