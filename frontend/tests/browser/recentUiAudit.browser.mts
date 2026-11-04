import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { hvacProject } from "../hvacFixtures";
import { createRoomUFH } from "../../lib/heatingDesign";
import { newEnergyProject } from "../../lib/energyDocument";
import { startBrowserHarness, menu, cfdWindow } from "./harness.mjs";

let harness, palettes;
before(async () => {
  harness = await startBrowserHarness({ climoptixEnabled: true });
  palettes = JSON.parse(await readFile(new URL("../../../data/ui_theme_defaults.json", import.meta.url), "utf8")).themes;
  await mkdir("../.local-logs/ui-nov04-qa", { recursive: true });
});
after(async () => { await harness?.close(); });
const profiles = [
  { width: 1440, density: "comfortable", theme: "light", style: "default" },
  { width: 1440, density: "compact", theme: "dark", style: "modern" },
  { width: 768, density: "comfortable", theme: "dark", style: "default" },
  { width: 390, density: "compact", theme: "light", style: "modern" },
];
function fixture() {
  const p = hvacProject(); p.heatingLayout = createRoomUFH(p.rooms[0], p.heatingLayout!).heating; p.energyLayout = newEnergyProject(); return p;
}
async function profile(page, p) {
  await page.setViewportSize({ width: p.width, height: 1000 });
  await page.evaluate(({ profile, palette }) => {
    document.documentElement.dataset.density = profile.density; document.documentElement.dataset.theme = profile.theme; document.body.dataset.uiStyle = profile.style;
    for (const [key, value] of Object.entries(palette.colours)) document.documentElement.style.setProperty("--configured-" + key, value);
    for (const [key, value] of Object.entries(palette.buttons)) document.documentElement.style.setProperty("--configured-ui-button-" + key, value);
    for (const [key, value] of Object.entries(palette.windows)) document.documentElement.style.setProperty("--configured-ui-window-" + key, value);
    document.documentElement.style.setProperty("--font-sans", palette.typography.sans); document.documentElement.style.setProperty("--font-mono", palette.typography.controls);
  }, { profile: p, palette: palettes[p.style.toUpperCase()] });
}
async function inspect(panel, label) {
  const report = await panel.evaluate(root => {
    const owner = e => e.closest(".floating-toolbar,dialog,[role=dialog]");
    const visible = e => e.checkVisibility() && owner(e) === root;
    const size = e => { const r = e.getBoundingClientRect(); return [r.width, r.height]; };
    const chrome = [...root.querySelectorAll(".window-header-actions>button")].filter(visible).map(size);
    const actionGroups = [...root.querySelectorAll('[class*="_actionGrid"],[class*="_zoneActions"],[class*="_roomSettingsActions"],[class*="_hvacToolbar"],.cfx-device-actions,.cfx-adjoint-actions')];
    const unequal = actionGroups.map(group => [...group.querySelectorAll(":scope > button")].filter(visible)).filter(nodes => nodes.length > 1 && Math.max(...nodes.map(e => e.getBoundingClientRect().height)) - Math.min(...nodes.map(e => e.getBoundingClientRect().height)) > 1).map(nodes => nodes.map(e => e.textContent));
    const actions = actionGroups.flatMap(group => [...group.querySelectorAll(":scope > button")]).filter(visible);
    return { unequal, help: [...root.querySelectorAll(".window-help-button")].filter(visible).length, chrome, clipped: actions.filter(e => e.scrollWidth > e.clientWidth + 2 || e.scrollHeight > e.clientHeight + 2).map(e => e.textContent), overflow: root.scrollWidth > root.clientWidth + 2 };
  });
  assert.equal(report.help, 1, `${label}: one main help button`);
  assert.ok(report.chrome.length >= 3 && report.chrome.every(([w, h]) => Math.abs(w - report.chrome[0][0]) < 1 && Math.abs(h - report.chrome[0][1]) < 1 && Math.abs(w - h) < 1), `${label}: ${JSON.stringify(report.chrome)}`);
  assert.deepEqual(report.unequal, [], `${label}: equal action heights`); assert.deepEqual(report.clipped, [], label); assert.equal(report.overflow, false, label);
}

test("Heating, Ventilation, Energy and Electrical share one guide and consistent controls across styles and densities", async t => {
  const s = await harness.session(fixture()); t.after(() => s.close()); const { page } = s;
  for (const [entry, selector] of [["Heating Layout", ".heating-layout-window"], ["Energy & Insulation", ".energy-layout-window"], ["Full Electrical Layout module…", ".electrical-layout-window"]]) {
    await profile(page, profiles[0]); await menu(page, "Tools", entry); const panel = page.locator(selector);
    for (const p of profiles) {
      await profile(page, p);
      const tabs = entry === "Heating Layout" ? ["Room setup", "Heating elements", "Underfloor", "System", "Results", "Ventilation"] : [null];
      for (const tab of tabs) {
        if (tab) {
          if (tab !== "Ventilation") await panel.getByRole("tab", { name: "Heating", exact: true }).click();
          await panel.getByRole("tab", { name: tab, exact: true }).click();
        }
        await panel.evaluate(root => root.querySelectorAll("details").forEach(d => { d.open = true; }));
        await inspect(panel, `${entry}/${tab}/${p.width}/${p.density}`);
        if (entry === "Heating Layout" && tab === "Ventilation" && p.width === 1440) {
          const add = panel.getByRole("button", { name: "Add supply inlet", exact: true });
          const size = await add.evaluate(e => [e.getBoundingClientRect().height, parseFloat(getComputedStyle(e).getPropertyValue("--density-control-min-height"))]);
          assert.ok(Math.abs(size[0] - size[1]) < 1, JSON.stringify(size));
        }
      }
    }
    await panel.locator(".floating-toolbar-content").evaluate(e => e.scrollTo(0, 0));
    await page.screenshot({ path: `../.local-logs/ui-nov04-qa/${entry.split(" ")[0].toLowerCase()}-phone.png` });
    await panel.locator(".floating-toolbar-close").click();
  }
});

test("every CFD phase has uniform header controls and a complete main guide before other phases mount", async t => {
  const s = await harness.session(fixture()); t.after(() => s.close()); const { page } = s;
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("CLIMOPTIX"); const ui = page.locator(".cfx-workspace");
  await cfdWindow(ui, "Simulations"); const panel = page.locator(".cfx-setup-window");
  await panel.getByRole("button", { name: "Help for Climoptix CFD", exact: true }).click();
  const help = page.locator(".window-help-host");
  await help.getByRole("heading", { name: "Films and handoff", exact: true }).waitFor();
  await help.getByRole("heading", { name: "Vent-position preparation", exact: true }).waitFor(); await page.keyboard.press("Escape");
  for (const p of profiles) {
    await profile(page, p);
    for (const phase of ["Simulations", "Domain", "Equipment", "Boundaries", "Physics", "Solver", "Optimisation", "Review & export", "Imported results"]) {
      await cfdWindow(ui, phase); await inspect(panel, `CFD/${phase}/${p.width}/${p.density}`);
      if (phase === "Boundaries") {
        await ui.getByRole("tab", { name: "Thermal", exact: true }).click(); await inspect(panel, `Thermal/${p.width}/${p.density}`);
        const minimums = await panel.locator(".thermal-footer button").evaluateAll(nodes => nodes.filter(e => e.checkVisibility()).map(e => [parseFloat(getComputedStyle(e).minHeight), parseFloat(getComputedStyle(e).getPropertyValue("--density-control-min-height"))]));
        assert.ok(minimums.length && minimums.every(([a, b]) => Math.abs(a - b) < 1), JSON.stringify(minimums));
      }
    }
  }
  await page.screenshot({ path: "../.local-logs/ui-nov04-qa/cfd-phone.png" });
});

test("Preferences uses the reclaimed help column and real room-target guidance remains accessible after changing tabs", async t => {
  const s = await harness.session(fixture()); t.after(() => s.close()); const { page } = s;
  await menu(page, "Settings", "Preferences…"); const settings = page.getByRole("dialog", { name: "Preferences", exact: true });
  for (const p of profiles) {
    await profile(page, p); await inspect(settings, `Preferences/${p.width}`);
    const widths = await settings.locator(".settings-select-control select").evaluateAll(nodes => nodes.map(e => [e.getBoundingClientRect().width, e.parentElement.getBoundingClientRect().width]));
    assert.ok(widths.every(([a, b]) => Math.abs(a - b) < 1), JSON.stringify(widths));
  }
  await settings.getByRole("button", { name: "Done", exact: true }).click(); await profile(page, profiles[0]);
  await menu(page, "Tools", "Heating Layout"); const panel = page.locator(".heating-layout-window");
  await panel.getByRole("tab", { name: "Results", exact: true }).click(); await panel.getByRole("button", { name: "Help for Heating Layout", exact: true }).click();
  const body = await page.locator(".window-help-host").innerText(); assert.match(body, /room-type default/); assert.doesNotMatch(body, /\ntrue\n/);
});
