import test from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { DEFAULT_ELECTRICAL_CIRCUIT, DEFAULT_ELECTRICAL_DOCUMENTATION } from "../lib/electricalLayout.ts";
import { readElectricalLayoutPackage } from "../lib/electricalLayoutPackage.ts";

const manifest = (overrides: Record<string, unknown> = {}) => ({
  packageType: "freefloorplan3d-electrical-layout",
  schemaVersion: 1,
  projectName: "Electrical sample",
  exportedAt: "2026-09-27T00:00:00.000Z",
  items: [],
  assets: [],
  assetInstances: [],
  electricalLayout: { connections: [], circuits: [], documentation: structuredClone(DEFAULT_ELECTRICAL_DOCUMENTATION) },
  ...overrides,
});

function archive(entries: Record<string, string>): File {
  return new File([zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)])))], "layout.electricallayout");
}

test("reads an empty versioned electrical-layout ZIP package", async () => {
  const result = await readElectricalLayoutPackage(archive({ "electrical-layout.json": JSON.stringify(manifest()) }));
  assert.equal(result.data.schemaVersion, 1);
  assert.equal(result.data.projectName, "Electrical sample");
  assert.equal(result.data.electricalLayout.forceOrthogonalRouting, true);
  assert.deepEqual(result.data.electricalLayout.circuits, [DEFAULT_ELECTRICAL_CIRCUIT]);
  assert.deepEqual(result.data.items, []);
  assert.deepEqual(result.attachmentBlobs, new Map());
  assert.deepEqual(result.assetBlobs, new Map());
});

test("rejects unsupported package versions before import", async () => {
  await assert.rejects(
    readElectricalLayoutPackage(archive({ "electrical-layout.json": JSON.stringify(manifest({ schemaVersion: 99 })) })),
    /unsupported version/i,
  );
});

test("rejects package entries outside the attachment and model allowlist", async () => {
  await assert.rejects(
    readElectricalLayoutPackage(archive({ "electrical-layout.json": JSON.stringify(manifest()), "../../project.json": "{}" })),
    /unsafe file path/i,
  );
});
