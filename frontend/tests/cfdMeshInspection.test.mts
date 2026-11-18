import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readMeshGeometry } from "../lib/cfdMeshInspection";
import { ClimoptixStudies } from "../components/ClimoptixStudies";
import { workerInput } from "../lib/climoptixJobs";
import { cfdProject } from "./climoptixFixtures";
import { PerspectiveCamera, Vector3 } from "three";
import { meshScenePositions, preserveMeshCamera } from "../components/CFDMeshScene";

const meshId = "a".repeat(64);
test("mesh scene transform and camera restoration preserve global coordinates and the previous view", () => {
  assert.deepEqual([...meshScenePositions(new Float64Array([1000, 2000, 3000]))], [1, 3, -2]);
  const camera = new PerspectiveCamera(42, 1.5, .2, 800);
  camera.position.set(7, 9, 13); camera.up.set(0, 0, 1); camera.zoom = 2;
  camera.lookAt(1, 2, 3); camera.updateProjectionMatrix();
  const orbit = {target: new Vector3(1, 2, 3), minDistance: .2, maxDistance: 1000, update() {}};
  const before = {position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), up: camera.up.toArray(),
    target: orbit.target.toArray(), projection: camera.projectionMatrix.toArray()};
  const restore = preserveMeshCamera(camera, orbit);
  camera.position.set(100, 200, 300); camera.up.set(0, 1, 0); camera.zoom = 1; camera.near = .001; camera.far = 5000;
  camera.lookAt(20, 40, 60); orbit.target.set(20, 40, 60); orbit.minDistance = .001; orbit.maxDistance = 50000; restore();
  assert.deepEqual({position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), up: camera.up.toArray(),
    target: orbit.target.toArray(), projection: camera.projectionMatrix.toArray()}, before);
  assert.equal(orbit.minDistance,.2); assert.equal(orbit.maxDistance,1000);
});
function packet(overrides = {}) {
  const fields = {schemaVersion: 1, meshId, units: "mm", points: 3, triangles: 1, edges: 1,
    sectionCells: 1, axis: "Z", coordinateMm: 3000, ...overrides};
  const json = JSON.stringify(fields), size = Math.ceil(json.length / 8) * 8;
  const bytes = new Uint8Array(8 + size + 72 + 12 + 8), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("CMI1")); view.setUint32(4, size, true);
  bytes.set(new TextEncoder().encode(json.padEnd(size, " ")), 8);
  new Float64Array(bytes.buffer, 8 + size, 9).set([1000, 2000, 3000, 2000, 2000, 3000, 1000, 3000, 3000]);
  new Uint32Array(bytes.buffer, 8 + size + 72, 3).set([0, 1, 2]);
  new Uint32Array(bytes.buffer, 8 + size + 84, 2).set([0, 1]);
  return bytes;
}

test("mesh binary adapter preserves authoritative mm and rejects stale or damaged buffers", () => {
  const data = readMeshGeometry(packet(), meshId, {axis: "Z", coordinateMm: 3000});
  assert.equal(data.sectionCells, 1); assert.deepEqual([...data.pointsMm.slice(0, 3)], [1000, 2000, 3000]);
  assert.throws(() => readMeshGeometry(packet(), "b".repeat(64), {axis: "Z", coordinateMm: 3000}), /revision/);
  assert.throws(() => readMeshGeometry(packet(), meshId, {axis: "X", coordinateMm: 3000}), /revision/);
  assert.throws(() => readMeshGeometry(packet().slice(0, -1), meshId, {axis: "Z", coordinateMm: 3000}), /Truncated/);
  assert.throws(() => readMeshGeometry(packet({points: 9999999}), meshId), /large|maximum|Too big/);
  const damaged = packet(), view = new DataView(damaged.buffer), offset = 8 + view.getUint32(4, true);
  view.setUint32(offset + 72, 3, true);
  assert.throws(() => readMeshGeometry(damaged, meshId, {axis: "Z", coordinateMm: 3000}), /unavailable point/);
  view.setUint32(offset + 72, 0, true); view.setFloat64(offset, NaN, true);
  assert.throws(() => readMeshGeometry(damaged, meshId, {axis: "Z", coordinateMm: 3000}), /Non-finite/);
});

test("Mesh status is an independent accessible link only when checked, including a queued solver run", () => {
  const project = cfdProject(false), scenario = project.cfdScenarios![0];
  const props: ComponentProps<typeof ClimoptixStudies> = {
    project, scenarios: [scenario], scenario, showArchived: false, onShowArchived() {}, onSelect() {}, onChange() {},
    onOrder() {}, onAdd() {}, onDelete() {}, onClear() {}, onReset() {}, resetting: false, onImport() {},
    entries: {}, worker: null, onSubmit() {}, onOpenResults() {}, onOpenMesh() {}, onUndo() {}, onRedo() {}, canUndo: false, canRedo: false,
  };
  const html = () => renderToStaticMarkup(createElement(ClimoptixStudies, props));
  assert.match(html(), /aria-label="Mesh: pending[^>]*disabled=""/);
  props.entries = {[scenario.id]: {input: workerInput(project, scenario), meshChecked: true, operation: "run",
    job: {id: "job", studyId: scenario.id, clientRevision: "a".repeat(64), phase: "Queued", operation: "run", progress: 0, message: "Queued"}}};
  const ready = html();
  assert.match(ready, /<button[^>]*data-state="completed"[^>]*aria-label="Mesh: completed[^>]*>Mesh<\/button>/);
  assert.doesNotMatch(ready, /aria-label="Mesh: completed[^>]*disabled/);
  assert.doesNotMatch(ready, /<button[^>]*class="cfx-study-name"/); // no nested interactive controls
  props.entries[scenario.id].meshChecked = false;
  assert.match(html(), /aria-label="Mesh: running[^>]*disabled=""/);
});
