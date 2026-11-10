import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { hvacProject } from "../hvacFixtures";
import { cfdWindow, eventually, menu, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => { harness = await startBrowserHarness({ climoptixEnabled: true }); });
after(async () => { await harness?.close(); });

const exactButton = (scope, name: string) => scope.getByRole("button", { name, exact: true });
async function sectionHelp(page, window, section: string) {
  await exactButton(window, `Help for ${section}`).click();
  const guide = page.getByRole("article", { name: `Help for ${section}`, exact: true });
  await guide.waitFor();
  return guide;
}

test("pass one: closed workbench sections expose their numeric, text, select, toggle and action help", async t => {
  const s = await harness.session(hvacProject());
  t.after(() => s.close());
  const { page } = s;
  await menu(page, "Tools", "Heating & ventilation");
  const heating = page.locator(".heating-layout-window");
  await heating.getByRole("tab", { name: "Ventilation", exact: true }).click();
  const title = "Room air & design conditions";
  assert.equal(await heating.getByRole("textbox", { name: "Scenario name", exact: true }).isVisible(), false);
  const ventilation = await sectionHelp(page, heating, title);
  const headings = await ventilation.getByRole("heading").allTextContents();
  for (const field of ["Scenario name", "New editable starting point", "Room setpoint", "Outdoor dry bulb",
    "Required-flow supply temperature", "Infiltration", "Occupants", "Sensible heat per person", "Equipment & lighting",
    "Transmitted solar gain", "Target total ACH", "Outdoor design rate (L/s/person)", "Outdoor design rate (L/s/m²)",
    "Include enabled Heating devices once", "Reset scenario overrides"]) {
    assert.ok(headings.some(heading => heading === field || heading.startsWith(field + " (")), field);
  }
  assert.match(await ventilation.innerText(), /target ACH × room volume ÷ 3,600/);
  assert.equal(headings.includes("Air density (kg/m³)"), false);
  await page.keyboard.press("Escape");
  await heating.getByRole("tab", { name: "Heating", exact: true }).click();
  await heating.getByRole("tab", { name: "System", exact: true }).click();
  const system = await sectionHelp(page, heating, "Heating system temperatures");
  assert.match(await system.innerText(), /System flow temperature|System return temperature/);
  await page.keyboard.press("Escape");
  await exactButton(heating, "Hide Heating Layout").click();

  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("CLIMOPTIX");
  const cfd = page.locator(".cfx-workspace");
  await cfdWindow(cfd, "Domain");
  const mesh = await sectionHelp(page, cfd, "Mesh settings");
  assert.ok(await mesh.getByRole("heading", { name: "Maximum cell budget", exact: true }).count());
  assert.match(await mesh.innerText(), /worker's allowed limit/);
  await page.keyboard.press("Escape");
});

test("pass two: Compact shrinks the UI and typing spaces works in both HVAC and CFD", async t => {
  const s = await harness.session(hvacProject());
  t.after(() => s.close());
  const { page } = s;
  await menu(page, "Settings", "Preferences…");
  const preferences = page.getByRole("dialog", { name: "Preferences", exact: true });
  const measure = () => preferences.evaluate(root => {
    const box = root.getBoundingClientRect();
    const button = root.querySelector(".settings-done");
    return { width: box.width, padding: parseFloat(getComputedStyle(root).paddingLeft),
      height: button.getBoundingClientRect().height, font: parseFloat(getComputedStyle(button).fontSize) };
  });
  const comfortable = await measure();
  await exactButton(preferences, "Compact").click();
  const compact = await measure();
  assert.ok(compact.width >= 570 && compact.padding >= 20 && compact.width < comfortable.width);
  assert.ok(compact.height < comfortable.height && compact.font < comfortable.font);
  await exactButton(preferences, "Done").click();
  await menu(page, "Tools", "Heating & ventilation");
  const heating = page.locator(".heating-layout-window");
  const canvas = page.getByLabel("Interactive complete building floorplan", { exact: true });
  assert.equal(await canvas.evaluate(node => node.classList.contains("heating-plan-active")), true);
  assert.equal(await canvas.locator(".plan-wall-fabric .wall-body").first().evaluate(node => getComputedStyle(node).stroke), "rgb(156, 84, 38)");
  assert.equal(await canvas.locator(".opening-symbol .opening-gap").first().evaluate(node => getComputedStyle(node).stroke), "rgb(220, 238, 252)");
  assert.ok(await canvas.locator(".heating-emitter-symbol").first().isVisible());
  assert.match(await heating.innerText(), /Heat available/);
  const roomName = canvas.locator(".room-name-editor input").first();
  const originalName = await roomName.inputValue();
  await roomName.focus();
  await roomName.press("End");
  await roomName.press("Space");
  assert.equal(await roomName.inputValue(), originalName + " ");
  await roomName.fill(originalName);
  await heating.getByRole("tab", { name: "Ventilation", exact: true }).click();
  assert.equal(await canvas.evaluate(node => node.classList.contains("heating-plan-active")), false);
  await heating.locator("summary").filter({ hasText: "Room air & design conditions" }).click();
  const scenario = heating.getByRole("textbox", { name: "Scenario name", exact: true });
  await scenario.fill("");
  await scenario.pressSequentially("Winter morning office");
  assert.equal(await scenario.inputValue(), "Winter morning office");
  await scenario.press("Enter");
  await eventually(s.saved, p => p.hvac.scenarios[0].name === "Winter morning office");
  const gap = await heating.getByRole("checkbox", { name: "Include enabled Heating devices once", exact: true }).evaluate(node => {
    const label = node.closest("label");
    const grid = label.previousElementSibling.getBoundingClientRect();
    const toggle = label.getBoundingClientRect();
    return [toggle.top - grid.bottom, label.nextElementSibling.getBoundingClientRect().top - toggle.bottom];
  });
  assert.ok(gap.every(distance => distance >= 8), JSON.stringify(gap));
  await exactButton(heating, "Hide Heating Layout").click();
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("CLIMOPTIX");
  const cfd = page.locator(".cfx-workspace");
  await cfdWindow(cfd, "Equipment");
  await exactButton(cfd, "+ Supply").click();
  const name = cfd.getByRole("textbox", { name: "Vent name", exact: true });
  await name.fill("");
  await name.pressSequentially("North supply grille");
  assert.equal(await name.inputValue(), "North supply grille");
  await name.press("Enter");
  await eventually(s.saved, p => p.hvac.devices.some(d => d.vent.name === "North supply grille"));
});

test("main guides include actions and tabs outside disclosures", async t => {
  const s = await harness.session(hvacProject());
  t.after(() => s.close());
  const { page } = s;
  await menu(page, "Settings", "Preferences…");
  const preferences = page.getByRole("dialog", { name: "Preferences", exact: true });
  const preferencesHelp = await sectionHelp(page, preferences, "Preferences");
  for (const name of ["System", "Light", "Dark", "Compact", "Comfortable", "Millimetres",
    "3D navigation", "Default currency", "Temperature units", "CFD volume flow units",
    "Confirm before opening another project", "Done"]) {
    assert.ok(await preferencesHelp.getByRole("heading", { name, exact: true }).count(), name);
  }
  await page.keyboard.press("Escape");
  await exactButton(preferences, "Done").click();

  await exactButton(page, "Export floorplan").click();
  const exportDialog = page.locator(".floorplan-export-dialog");
  const exportHelp = await sectionHelp(page, exportDialog, "Floorplan export");
  for (const name of ["Drawing style", "File format", "Save as PDF", "Cancel"]) {
    assert.ok(await exportHelp.getByRole("heading", { name, exact: true }).count(), name);
  }
  assert.equal(await exportHelp.getByRole("heading", { name: "3D navigation", exact: true }).count(), 0);
  await page.keyboard.press("Escape");
  await exactButton(exportDialog, "Cancel").click();

  await menu(page, "Tools", "Heating & ventilation");
  const heating = page.locator(".heating-layout-window");
  const heatingHelp = await sectionHelp(page, heating, "Heating Layout");
  for (const name of ["Heating", "Ventilation", "Heating elements", "Room setup", "Add element"]) {
    assert.ok(await heatingHelp.getByRole("heading", { name, exact: true }).count(), name);
  }
  await page.keyboard.press("Escape");
});

test("quote generation and closed simulation action menus have scoped help", async t => {
  const s = await harness.session(hvacProject());
  t.after(() => s.close());
  const { page } = s;
  const workspace = page.getByRole("combobox", { name: "Workspace", exact: true });
  await workspace.selectOption("PLANNERBUILD");
  await page.getByRole("combobox", { name: "PlannerBuild view", exact: true }).selectOption("QUOTE");
  const quote = page.getByRole("region", { name: "Quote Generator", exact: true });
  await exactButton(quote, "Generate from project").click();
  const generation = await sectionHelp(page, quote, "Quote — Generate from project");
  await generation.getByRole("heading", { name: "Cancel generation", exact: true }).waitFor();
  assert.equal(await generation.getByRole("heading", { name: "New quote", exact: true }).count(), 0);
  await page.keyboard.press("Escape");

  await workspace.selectOption("CLIMOPTIX");
  const cfd = page.locator(".cfx-workspace");
  await cfdWindow(cfd, "Simulations");
  const manage = await sectionHelp(page, cfd, "Manage simulations");
  for (const name of ["Rename", "Duplicate simulation", "Archive", /^Move .+ to group$/]) {
    assert.ok(await manage.getByRole("heading", { name, exact: typeof name === "string" }).count(), String(name));
  }
});

test("closed custom disclosures have complete local guides in 2D and 3D", async t => {
  const s = await harness.session(hvacProject());
  t.after(() => s.close());
  const { page } = s;
  const build = page.locator(".full-plan-build-toolbar");
  assert.equal(await exactButton(build, "Overall properties").getAttribute("aria-expanded"), "false");
  const overall = await sectionHelp(page, build, "Overall properties");
  for (const name of [/^Default thickness/, /^Grid size/, "Snap to grid", "Keep walls squared", "Edit measurements"]) {
    assert.ok(await overall.getByRole("heading", { name, exact: typeof name === "string" }).count(), String(name));
  }
  await page.keyboard.press("Escape");
  assert.equal(await exactButton(build, "Overall properties").getAttribute("aria-expanded"), "false");

  const openings = page.getByRole("combobox", { name: "Add to plan", exact: true });
  await openings.selectOption("WINDOW");
  const add = page.locator(".floating-toolbar").filter({ has: openings });
  const position = await sectionHelp(page, add, "Position");
  assert.ok(await position.getByRole("heading", { name: "Parent wall", exact: true }).count());
  assert.match(await position.innerText(), /Distance along the host wall from its start/);
  await page.keyboard.press("Escape");

  await exactButton(page, "3D").click();
  const view = page.locator(".floating-toolbar").filter({ has: exactButton(page, "Help for Lighting") });
  assert.equal(await exactButton(view, "Lighting").getAttribute("aria-expanded"), "false");
  const lighting = await sectionHelp(page, view, "Lighting");
  for (const name of ["Light intensity", "Shadow strength", "Light direction", "Light elevation", "Reset lighting"]) {
    assert.equal(await lighting.getByRole("heading", { name, exact: true }).count(), 1, name);
  }
  assert.equal(await lighting.getByRole("heading", { name: "Open selection in 3D", exact: true }).count(), 0);
  await page.keyboard.press("Escape");
  const rooms = await sectionHelp(page, view, "Room selector");
  assert.ok(await rooms.getByRole("heading", { name: "Room", exact: true }).count());
  assert.ok(await rooms.getByRole("heading", { name: "Open selection in 3D", exact: true }).count());
});
