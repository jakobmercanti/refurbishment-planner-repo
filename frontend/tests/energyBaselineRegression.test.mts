import test from "node:test";
import assert from "node:assert/strict";
import { newAssembly, newEnergyProject, parseEnergyProject } from "../lib/energyDocument";
import { addInsulation, calculateAssemblyUValue, energyElements, energyResults, scenarioAssignments, withEnergyFabric } from "../lib/energyCalculations";
import { assemblyThickness, createElementAssemblyDraft, resizeAssembly, setWallAssembly } from "../lib/energyWallConstruction";
import { newHeatingProject } from "../lib/heatingDocument";
import { calculateRoomHeatLoss } from "../lib/heatingCalculations";
import type { Room } from "../lib/types";
const m = (value: number) => ({ value, uncertainty_mm: 0, verified: true, source_type: "USER_MEASURED" });
const room: Room = { id: "room", name: "Room 2", version: 1, vertices: [{ x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 7500 }, { x: 0, y: 7500 }], wall_height: m(2500), wall_thickness: m(50), openings: [], obstacles: [] };
const near = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const heating = newHeatingProject();
const first = (data: ReturnType<typeof newEnergyProject>) => energyElements([room], heating, data).find(e => e.elementId === "room|wall:3")!;
const pir = (index: number, thicknessMm = 25) => ({ layerId: `pir-${index}`, materialId: "pir-tw55", thicknessMm, resistanceOverride: null, position: "Inside" as const, upgrade: true });
test("reported 50 mm wall keeps U 0.30 on opening and reduces U monotonically after two 25 mm PIR layers", () => {
  const data = newEnergyProject(); data.scenarios = [{ scenarioId: "proposal", name: "Proposed Upgrade 1", assignments: [] }]; data.activeScenarioId = "proposal";
  const untouched = structuredClone(data), element = first(data), draft = createElementAssemblyDraft(data, element, 50);
  near(element.uValue, .3); near(calculateAssemblyUValue(draft.assembly, draft.data.materials).uValue, .3);
  assert.equal(draft.assembly.layers[0].resistanceSource, "HEATING_ESTIMATE"); assert.equal(assemblyThickness(draft.assembly), 50);
  let previousU = .3, proposal = draft.data;
  for (let i = 1; i <= 2; i++) {
    draft.assembly.layers.push(pir(i));
    const calculated = calculateAssemblyUValue(draft.assembly, draft.data.materials);
    const expected = 1 / (1 / .3 + i * .025 / .022); near(calculated.uValue, expected); assert.ok(calculated.uValue! < previousU); previousU = calculated.uValue!;
    proposal = parseEnergyProject(setWallAssembly(draft.data, element, draft.assembly));
    const after = first(proposal); near(after.uValue, expected); near(after.heatLossW, element.heatLossW * expected / .3);
    assert.ok(after.heatLossW < element.heatLossW); assert.ok(after.warnings.some(w => /estimated.*baseline|estimated Heating|verify this baseline/.test(w)));
    near(energyElements([room], heating, proposal, null).find(e => e.elementId === element.elementId)!.uValue, .3);
    assert.equal(energyResults([room], heating, proposal).verified, false);
    assert.ok(calculateRoomHeatLoss(room, [room], withEnergyFabric(heating, proposal, [room])).designW < calculateRoomHeatLoss(room, [room], heating).designW);
  }
  assert.deepEqual(data, untouched); assert.equal(assemblyThickness(draft.assembly), 100);
  const restored = parseEnergyProject(JSON.parse(JSON.stringify(proposal))); near(first(restored).uValue, previousU);
  near(calculateAssemblyUValue(createElementAssemblyDraft(restored, first(restored), 100).assembly, restored.materials).uValue, previousU);
});
test("entered assignment U takes precedence over an unrelated underlying layer calculation", () => {
  const data = newEnergyProject(), assembly = newAssembly({ name: "Concrete", category: "wall", materials: [["custom-0", 50]] });
  data.assemblies = [assembly]; data.existingAssignments = [{ elementId: "room|wall:3", assemblyId: assembly.assemblyId, uValue: .3 }];
  const draft = createElementAssemblyDraft(data, first(data), 50); near(calculateAssemblyUValue(draft.assembly, draft.data.materials).uValue, .3);
  assert.equal(draft.assembly.layers[0].resistanceSource, "ENTERED_U");
  draft.assembly.layers.push(pir(1)); near(calculateAssemblyUValue(draft.assembly, draft.data.materials).uValue, 1 / (1 / .3 + .025 / .022));
});
test("whole-assembly entered U is retained with surface resistance counted exactly once", () => {
  const data = newEnergyProject(), assembly = newAssembly(); assembly.directUValue = .5; data.assemblies = [assembly]; data.existingAssignments = [{ elementId: "room|wall:3", assemblyId: assembly.assemblyId, uValue: null }];
  const draft = createElementAssemblyDraft(data, first(data), 50); draft.assembly.layers.push(pir(1, 50));
  near(calculateAssemblyUValue(draft.assembly, draft.data.materials).uValue, 1 / (1 / .5 + .05 / .022));
  assert.equal(draft.assembly.rsi + draft.assembly.rse, 0); assert.equal(calculateAssemblyUValue(draft.assembly, draft.data.materials).estimated, false);
});
test("known layers and genuinely missing material inputs are not replaced with a guessed baseline", () => {
  for (const missing of [false, true]) {
    const data = newEnergyProject(), assembly = newAssembly(); if (missing) data.materials.find(m => m.materialId === assembly.layers[0].materialId)!.lambda = null;
    data.assemblies = [assembly]; data.existingAssignments = [{ elementId: "room|wall:3", assemblyId: assembly.assemblyId, uValue: null }];
    const draft = createElementAssemblyDraft(data, first(data), 50); assert.deepEqual(draft.assembly, assembly); draft.assembly.layers.push(pir(1));
    if (missing) assert.equal(calculateAssemblyUValue(draft.assembly, data.materials).uValue, null);
    else assert.ok(calculateAssemblyUValue(draft.assembly, data.materials).uValue! < calculateAssemblyUValue(assembly, data.materials).uValue!);
  }
});
test("equivalent baseline R is fixed when only unknown physical thickness is resized", () => {
  const data = newEnergyProject(), draft = createElementAssemblyDraft(data, first(data), 50), resized = resizeAssembly(draft.assembly, 300);
  near(calculateAssemblyUValue(resized, draft.data.materials).uValue, .3); assert.equal(assemblyThickness(resized), 300);
});
test("programmatic insulation also respects assignment U over visual layers", () => {
  const data = newEnergyProject(), assembly = newAssembly(); data.assemblies = [assembly]; data.existingAssignments = [{ elementId: "room|wall:3", assemblyId: assembly.assemblyId, uValue: .3 }]; data.scenarios = [{ scenarioId: "p", name: "Proposal", assignments: [] }]; data.activeScenarioId = "p";
  const next = addInsulation(data, [first(data)], "pir-tw55", 50, "Inside"); near(first(next).uValue, 1 / (1 / .3 + .05 / .022)); assert.notEqual(scenarioAssignments(next)[0].assemblyId, assembly.assemblyId);
});
test("all wall/floor/roof baselines and positive insulation depths reduce U without changing measured geometry", () => {
  const geometry = structuredClone(room);
  for (const category of ["wall", "floor", "roof"] as const) for (const baseline of [.005, .18, .3, 1.5, 4.667]) for (const depth of [1, 25, 50, 100, 250]) {
    const data = newEnergyProject();
    const id = `room|${category === "wall" ? "wall:3" : category}`;
    data.existingAssignments = [{ elementId: id, assemblyId: null, uValue: baseline }];
    const element = energyElements([room], heating, data).find(e => e.elementId === id)!;
    const draft = createElementAssemblyDraft(data, element, 50);
    draft.assembly.layers.push(pir(1, depth));
    const next = parseEnergyProject(setWallAssembly(draft.data, element, draft.assembly));
    const after = energyElements([room], heating, next).find(e => e.elementId === id)!;
    near(after.uValue, 1 / (1 / baseline + depth / 1000 / .022));
    assert.ok(after.uValue < baseline); assert.ok(after.heatLossW < element.heatLossW);
  }
  assert.deepEqual(room, geometry);
});
test("explicit U still permits an upgrade when underlying material data is missing", () => {
  const data = newEnergyProject(), assembly = newAssembly();
  data.materials.find(m => m.materialId === assembly.layers[0].materialId)!.lambda = null;
  data.assemblies = [assembly]; data.existingAssignments = [{ elementId: "room|wall:3", assemblyId: assembly.assemblyId, uValue: .3 }];
  data.scenarios = [{ scenarioId: "p", name: "Proposal", assignments: [] }]; data.activeScenarioId = "p";
  near(first(parseEnergyProject(addInsulation(data, [first(data)], "pir-tw55", 50, "Inside"))).uValue, 1 / (1 / .3 + .05 / .022));
});
test("stale wall mappings do not resurrect an obsolete high-U assembly when adding insulation", () => {
  const data = newEnergyProject(), assembly = newAssembly(); assembly.directUValue = 4;
  data.assemblies = [assembly]; data.existingAssignments = [{ elementId: "room|wall:3", assemblyId: assembly.assemblyId, uValue: null, geometrySignature: JSON.stringify([{ x: 1, y: 1 }, { x: 2, y: 2 }]) }];
  const element = first(data); near(element.uValue, .3);
  const draft = createElementAssemblyDraft(data, element, 50); draft.assembly.layers.push(pir(1));
  near(calculateAssemblyUValue(draft.assembly, draft.data.materials).uValue, 1 / (1 / .3 + .025 / .022));
  assert.equal(draft.assembly.layers[0].resistanceSource, "HEATING_ESTIMATE");
  data.scenarios = [{ scenarioId: "p", name: "Proposal", assignments: [] }]; data.activeScenarioId = "p";
  near(first(addInsulation(data, [element], "pir-tw55", 25, "Inside")).uValue, 1 / (1 / .3 + .025 / .022));
});
