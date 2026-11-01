import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WindowHelpButton, WindowHelpScope } from "../components/WindowHelpButton.tsx";

test("nested help with the same body is removed even when its headings differ", () => {
  const steps = [{ heading: "Main", text: "The same guidance" }];
  const html = renderToStaticMarkup(createElement(WindowHelpScope, { title: "Parent", steps }, createElement(WindowHelpButton, { title: "Child", steps: [{ heading: "Different title", text: "The same guidance" }] })));
  assert.equal(html, "");
});
test("different task guidance retains its help button", () => {
  const html = renderToStaticMarkup(createElement(WindowHelpScope, { title: "Parent", steps: [{ heading: "Main", text: "Overview" }] }, createElement(WindowHelpButton, { title: "Child", steps: [{ heading: "Child", text: "Specific guidance" }] })));
  assert.match(html, /Help for Child/);
});
