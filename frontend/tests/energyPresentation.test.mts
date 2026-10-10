import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EnergyLayoutPanel } from "../components/EnergyLayoutPanel";
import { EnergyLayoutOverlay } from "../components/EnergyLayoutOverlay";
import { WallLayersPreview } from "../components/WallLayersPreview";
import { newAssembly, newEnergyProject } from "../lib/energyDocument";
import { newHeatingProject } from "../lib/heatingDocument";
import { energyElements } from "../lib/energyCalculations";
import { setWallAssembly } from "../lib/energyWallConstruction";
import { windowHelpSteps } from "../lib/windowHelp";
import type { Room } from "../lib/types";

const measured = (value: number) => ({ value, uncertainty_mm: 0, verified: true, source_type: "USER_MEASURED" });
const room: Room = { id: "room", name: "Living room", version: 1, vertices: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { x: 0, y: 4000 }], wall_height: measured(2500), wall_thickness: measured(150), openings: [], obstacles: [] };
const heating = newHeatingProject(), energy = newEnergyProject();
const element = energyElements([room], heating, energy)[0];
const assembly = newAssembly({ name: "Test wall", category: "wall", materials: [["brick-english-red", 100], ["pir-tw55", 50]] });
function panel(data = energy) {
  return renderToStaticMarkup(createElement(EnergyLayoutPanel, { rooms: [room], data, heating, selectedIds: [element.elementId], onChange() {}, onHeatingChange() {}, onSelect() {}, onUndo() {}, onRedo() {}, canUndo: false, canRedo: false, projectName: "Test" }));
}
test("main energy preview precedes expandable thickness guidance without inline layer controls", () => {
  const html = panel(setWallAssembly(energy, element, assembly));
  assert.match(html, /Energy &amp; Insulation controls/);
  assert.ok(html.indexOf("Wall composition preview") < html.indexOf("Wall thickness &amp; shared heating calculation"));
  assert.match(html, /Define wall layers/);
  assert.doesNotMatch(html, /Layer 1 material|Layer 1 thickness mm|Find minimum additional insulation/);
  assert.match(html, /<details[^>]*><summary>Planning assumptions &amp; limitations/);
  assert.match(html, /<details><summary>Layer key &amp; preview guidance/);
});
test("undefined walls show a visible preview without claiming a calculated U-value", () => {
  const html = panel();
  assert.match(html, /Wall composition preview/); assert.match(html, /U Not set/);
  assert.doesNotMatch(html, /No layers defined yet/); assert.match(html, /Heating Layout assumption/);
});

test("floor and roof insulation use independently assigned construction and distinct plan controls", () => {
  let data = newEnergyProject();
  for (const category of ["floor", "roof"] as const) {
    const e = energyElements([room], heating, data).find(e => e.category === category)!;
    data = setWallAssembly(data, e, newAssembly({ name: category, category, materials: [["pir-tw55", category === "floor" ? 100 : 150]] }));
    const html = renderToStaticMarkup(createElement(EnergyLayoutPanel, { rooms: [room], data, heating, selectedIds: [e.elementId], onChange() {}, onHeatingChange() {}, onSelect() {}, onUndo() {}, onRedo() {}, canUndo: false, canRedo: false, projectName: "Test" }));
    assert.match(html, new RegExp(`Define ${category} layers`));
    assert.match(html, /Construction scenarios/);
    assert.doesNotMatch(html, /<details[^>]* open=""[^>]*><summary>Construction scenarios/);
  }
  const floor = energyElements([room], heating, data).find(e => e.category === "floor")!;
  const roof = energyElements([room], heating, data).find(e => e.category === "roof")!;
  assert.ok(roof.uValue < floor.uValue);
  assert.equal(data.existingAssignments.length, 2);
  const html = renderToStaticMarkup(createElement(EnergyLayoutOverlay, { rooms: [room], heating, data, selectedIds: [], onSelect() {}, toScreen: p => ({ x: p.x / 10, y: p.y / 10 }), fromClient: (x, y) => ({ x, y }), onChange() {} }));
  assert.match(html, /data-energy-category="floor"/); assert.match(html, /data-energy-category="roof"/);
  assert.match(html, /Floor insulation/); assert.match(html, /Roof insulation/);
});
test("dedicated preview uses the exact fittings viewer zoom/Fit shell, not compact expansion", () => {
  const html = renderToStaticMarkup(createElement(WallLayersPreview, { assembly, materials: energy.materials, appearanceControls: true }));
  assert.match(html, /Preview zoom controls/); assert.match(html, />Fit<\/button>/);
  assert.doesNotMatch(html, /Click to enlarge|fixture-preview-compact/);
});
test("wall editor help explains independent draft confirmation and material controls", () => {
  const text = windowHelpSteps("Define wall layers").map(s => s.text).join(" ");
  assert.match(text, /Controls are on the left/); assert.match(text, /Cancel or Close discards/);
  assert.match(text, /Thermal parameters/); assert.match(text, /not regulatory limits/);
});
