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
