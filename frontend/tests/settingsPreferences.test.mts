import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_APP_PREFERENCES, SettingsDialog } from "../components/SettingsDialog.tsx";
import { windowHelpSteps } from "../lib/windowHelp";

test("comfortable density is the default preference", () => {
  assert.deepEqual(DEFAULT_APP_PREFERENCES, {
    theme: "SYSTEM",
    density: "COMFORTABLE",
    navigation: "STANDARD",
    confirmBeforeOpen: true,
    units: "MM",
    currency: "GBP",
  });
});

test("preferences expose every supported display unit and explain millimetre authority", () => {
  const markup = renderToStaticMarkup(createElement(SettingsDialog, {
    open: true,
    preferences: { theme: "DARK", density: "COMFORTABLE", confirmBeforeOpen: true, units: "CM" },
    onChange: () => {},
    onClose: () => {},
  }));

  for (const label of ["Millimetres", "Centimetres", "Inches", "Feet", "Metres"]) {
    assert.match(markup, new RegExp(label));
  }
  assert.match(markup, /aria-label="Display units"/);
  const help = windowHelpSteps("Preferences").map(step => step.text).join(" ");
  assert.match(help, /dimensions are still stored and calculated in millimetres/i);
  assert.match(markup, /Centimetres<\/button>/);
  assert.match(help, /Comfortable increases text and spacing/);
  assert.doesNotMatch(markup, /Comfortable makes text larger and easier to read/);
  assert.match(markup, /<h3 id="settings-appearance-title">Appearance<\/h3>/);
  assert.match(markup, /aria-label="Theme"/);
  const themeControl = markup.match(/<div class="settings-choice settings-theme-choice"[^>]*>(.*?)<\/div>/)?.[1] ?? "";
  assert.deepEqual([...themeControl.matchAll(/>(System|Light|Dark)<\/button>/g)].map((match) => match[1]), ["System", "Light", "Dark"]);
  assert.match(themeControl, /aria-pressed="true"[^>]*>Dark/);
});
