import assert from "node:assert/strict";
import test from "node:test";
import { cfdProject, realScene } from "./climoptixFixtures";
import { parseScene, sceneInput, scenePositions } from "../lib/climoptixScene";
import { selectFloor, duplicateFloor } from "../lib/buildingDocument";

test("read-only scene token excludes study, thermal, names and display settings but tracks measured geometry", () => {
  const p = cfdProject();
  const before = sceneInput(p);
  p.cfdScenarios![0].seed = { floorId: "elsewhere", roomId: "different" };
  p.cfdScenarios![0].mesh.preset = "Fine";
  p.cfdScenarios![0].name = "Renamed study";
  p.rooms[0].name = "Renamed room";
  assert.equal(sceneInput(p), before);
  p.rooms[0].vertices[0].x += 100;
  assert.notEqual(sceneInput(p), before);
});

test("scene input is invariant to the active source floor", () => {
  const p = cfdProject();
  const next = duplicateFloor(p, p.building!.floors[0].id);
  const before = sceneInput(next);
  assert.equal(
    sceneInput(selectFloor(next, next.building!.floors[0].id)),
    before,
  );
});

test("all-room scene retains exact mm coordinates until the renderer boundary", () => {
  const scene = realScene(cfdProject());
  const positions = scenePositions(scene);
  const triangle = scene.triangles[0];
  const first = scene.verticesMm[triangle[0]];
  assert.deepEqual(positions.get(scene.trianglePatches[0])!.slice(0, 3), [
    first[0] / 1000,
    first[2] / 1000,
    -first[1] / 1000,
  ]);
  assert.deepEqual(scene.airVolumes, [["room-0", "room-1"]]);
});

test("scene response rejects foreign rooms, duplicate membership, unknown patches and corrupt triangles", () => {
  const scene = realScene(cfdProject());
  for (const modify of [
    (s) => {
      s.airVolumes = [["room-0"], ["room-0"]];
    },
    (s) => {
      s.airVolumes = [["foreign-room", "room-1"]];
    },
    (s) => {
      s.triangles[0][0] = s.verticesMm.length;
    },
    (s) => {
      s.trianglePatches[0] = "unknown-patch";
    },
    (s) => {
      s.patches[0].roomId = "unknown-room";
    },
    (s) => {
      s.verticesMm[0][0] = Infinity;
    },
  ]) {
    const copy = structuredClone(scene);
    modify(copy);
    assert.throws(() => parseScene(copy));
  }
});
