import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EnergyLayoutPanel } from "../components/EnergyLayoutPanel";
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
  assert.match(html, /Define layers/);
  assert.doesNotMatch(html, /Layer 1 material|Layer 1 thickness mm|Find minimum additional insulation/);
  assert.match(html, /<details[^>]*><summary>Planning assumptions &amp; limitations/);
  assert.match(html, /<details><summary>Layer key &amp; preview guidance/);
});
test("undefined walls show a visible preview without claiming a calculated U-value", () => {
  const html = panel();
  assert.match(html, /Wall composition preview/); assert.match(html, /U Not set/);
  assert.match(html, /No layers defined yet/); assert.match(html, /Heating Layout assumption/);
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
