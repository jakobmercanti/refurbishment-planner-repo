import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { strToU8, zipSync } from 'fflate';
import { newProject, parseProject } from '../lib/projectDocument.ts';
import { renderCameraForRoom } from '../lib/renderCamera.ts';
import { LocalProjectRepository } from '../lib/projectRepository.ts';
import { exportProject, importProject, inspectPackage } from '../lib/projectPackage.ts';
import { inspectGlb } from '../lib/assetRepository.ts';
import { analytics, downloaded } from '../lib/analytics.ts';

test('schema roundtrip, future versions, corrupt data, and asset references', () => {
  const p = newProject(); assert.deepEqual(parseProject(JSON.parse(JSON.stringify(p))), p);
  assert.throws(() => parseProject({ ...p, schemaVersion: 2 }), /version/);
  assert.throws(() => parseProject({ ...p, units: 'm' }));
  assert.throws(() => parseProject({ ...p, assetInstances: [{ instanceId: 'i', assetId: 'missing', assetVersion: 1, positionMm: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }] }), /missing/);
  assert.throws(() => parseProject(JSON.parse(JSON.stringify(p).slice(0, -1) + ',"__proto__":{}}')), /Unsupported/);
});
test('optional render-camera state roundtrips while malformed camera data does not block an old project', () => {
  const p = newProject();
  assert.equal('renderCamera' in parseProject(p), false);
  const camera = renderCameraForRoom([]);
  assert.deepEqual(parseProject({ ...p, renderCamera: camera }).renderCamera, camera);
  const restored = parseProject({ ...p, renderCamera: { ...camera, positionMm: camera.targetMm } });
  assert.equal('renderCamera' in restored, false);
});
test('IndexedDB saves stable IDs, retains backup, duplicates, and deletes', async () => {
  const repo = new LocalProjectRepository(), p = { ...newProject(), renderCamera: renderCameraForRoom([]) }; await repo.createProject(p);
  await repo.saveProject({ ...p, name: 'Changed' }); assert.equal((await repo.getProject(p.projectId))?.name, 'Changed');
  assert.equal((await repo.getBackup(p.projectId))?.renderCamera?.cameraId, p.renderCamera.cameraId);
  const copy = await repo.duplicateProject(p.projectId); assert.notEqual(copy.projectId, p.projectId);
  assert((await repo.listProjects()).some(x => x.projectId === copy.projectId));
  await repo.deleteProject(copy.projectId); assert.equal(await repo.getProject(copy.projectId), null);
});
test('legacy marker variants and empty optional model fields remain saveable', () => {
  const p = newProject();
  p.floorplan = { walls: [], rooms: [], openings: [], measurements: [], annotations: [], dimensionOffsets: {}, hiddenDimensions: [], canvasSize: { width: 1000, height: 1000 }, selectedRoomId: null };
  for (const symbol of ['FILLED_CIRCLE', 'DIAMOND', 'EXCLAMATION', 'PLUS'] as const) {
    p.floorplan.annotations.push({ id: symbol, type: 'MARKER', position: { x: 0, y: 0 }, marker: { symbol, label: '', color: '#000000', size: 'MEDIUM' }, style: { lineStyle: 'SOLID', thickness: 1, textSize: 14 } });
  }
  assert.equal(parseProject(p).floorplan?.annotations.length, 4);
  assert.doesNotThrow(() => parseProject({ ...p, floorplan: { ...p.floorplan, stl_base64: undefined, stl_filename: null } }));
  assert.throws(() => parseProject({ ...p, floorplan: { ...p.floorplan, stl_base64: 'not portable' } }), /Unsupported/);
});
test('portable package roundtrip and unsafe archive rejection', async () => {
  const p = { ...newProject(), renderCamera: renderCameraForRoom([]) }, blob = await exportProject(p);
  const restored = await importProject(new File([blob], 'test.floorplan3d')); assert.deepEqual(restored, p);
  const manifest = strToU8(JSON.stringify({ packageVersion: 1, builtinCatalogueVersion: 1, project: p }));
  assert.throws(() => inspectPackage(zipSync({ 'manifest.json': manifest, '../escape.glb': new Uint8Array(20) })), /Unsafe/);
  assert.throws(() => inspectPackage(zipSync({ 'manifest.json': strToU8('{bad') })));
  assert.throws(() => inspectPackage(zipSync({ 'manifest.json': strToU8(JSON.stringify({ packageVersion: 9 })) })), /Unsupported/);
});
test('GLB rejects malformed binaries and external resources before parsing', () => {
  assert.throws(() => inspectGlb(new Uint8Array(21)), /Invalid/);
  const json = strToU8(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'https://example.com/private', byteLength: 4 }] }));
  const bytes = new Uint8Array(20 + json.length), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true); view.setUint32(12, json.length, true); view.setUint32(16, 0x4e4f534a, true); bytes.set(json, 20);
  assert.throws(() => inspectGlb(bytes), /embed resources/);
});
test('analytics failure cannot interrupt a completed download', () => {
  const original = analytics.capture; analytics.capture = () => { throw new Error('offline'); };
  assert.doesNotThrow(() => downloaded('floorplan3d')); analytics.capture = original;
});
