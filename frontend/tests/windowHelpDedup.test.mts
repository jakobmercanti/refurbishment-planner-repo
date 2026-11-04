import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { helpContentKey, WindowHelpButton, WindowHelpScope } from "../components/WindowHelpButton.tsx";
import { windowHelpSteps } from "../lib/windowHelp.ts";
import { CFD_SETUP_HELP } from "../lib/climoptixHelp.ts";
import { mergeHelpSteps } from "../lib/windowHelpContent.ts";

test("nested help with the same body is removed even when its headings differ", () => {
  const steps = [{ heading: "Main", text: "The same guidance" }];
  const html = renderToStaticMarkup(createElement(WindowHelpScope, { title: "Parent", steps }, createElement(WindowHelpButton, { title: "Child", steps: [{ heading: "Different title", text: "The same guidance" }] })));
  assert.doesNotMatch(html, /<button/); assert.match(html, /The same guidance/);
});
test("different task guidance is retained for the parent guide", () => {
  const html = renderToStaticMarkup(createElement(WindowHelpScope, { title: "Parent", steps: [{ heading: "Main", text: "Overview" }] }, createElement(WindowHelpButton, { title: "Child", steps: [{ heading: "Child", text: "Specific guidance" }] })));
  assert.doesNotMatch(html, /<button/); assert.match(html, /Specific guidance/);
});

test("main guides contain real room-target guidance and inactive CFD phases", () => {
  const target = windowHelpSteps("Heating Layout").find(s => s.heading === "Room target temperature °C");
  assert.match(target!.text, /room-type default/); assert.match(target!.text, /flow\/return/);
  assert.notEqual(target!.text, "true");
  for (const heading of ["Vent-position preparation", "Films and handoff", "Convergence monitor", "Choose the simulation volume"]) assert.ok(CFD_SETUP_HELP.some(s => s.heading === heading), heading);
  const merged = mergeHelpSteps(CFD_SETUP_HELP, CFD_SETUP_HELP);
  assert.equal(new Set(merged.map(s => JSON.stringify([s.text, s.links ?? []]))).size, merged.length);
});

test("temperature, comparison and results guides stay distinct from each other and review feedback",()=>{
 const titles=['Heating Layout','Heating Layout — Heating system temperatures','Heating Layout — Compare system temperatures','Heating Layout — Heating results','Heating Layout — Items to review (1)'];
 const keys=titles.map(title=>helpContentKey(windowHelpSteps(title)));
 assert.equal(new Set(keys).size,titles.length);
 assert.match(windowHelpSteps(titles[1]).map(s=>s.text).join(' '),/Flow.*Return/);
 assert.match(windowHelpSteps(titles[2]).map(s=>s.text).join(' '),/read-only comparison/);
 assert.match(windowHelpSteps(titles[3]).map(s=>s.text).join(' '),/watts \(W\)/);
});

test("main Heating and manifold settings explain the symbol and used versus available loop connections",()=>{
 for(const title of ['Heating Layout','Underfloor heating setup','Heating Layout — Edit manifold']){
  const steps=windowHelpSteps(title);assert.ok(steps.some(s=>s.heading==='What is a manifold?'));
  const text=steps.map(s=>s.text).join(' ');assert.match(text,/orange top bar/);assert.match(text,/1\/12 loops/);assert.match(text,/Drag its symbol/);
 }
});
