import test from "node:test";
import assert from "node:assert/strict";
import { chooseLayoutOpen, chooseLayoutSave } from "../lib/electricalFilePicker";

test("native save picker opens synchronously with a suggested electrical filename", async () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, "window");
  let called = false;
  const handle = { createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { showSaveFilePicker(options: { suggestedName: string }) { called = true; assert.equal(options.suggestedName, "room.electricallayout"); return Promise.resolve(handle); } } });
  try { const request = chooseLayoutSave("room.electricallayout"); assert.equal(called, true); assert.equal(await request, handle); }
  finally { if (old) Object.defineProperty(globalThis, "window", old); else Reflect.deleteProperty(globalThis, "window"); }
});

test("open picker returns the selected file; unavailable pickers opt into fallback UI", async () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, "window");
  const file = new File(["layout"], "room.electricallayout");
  const browser: { showOpenFilePicker?: () => Promise<{ getFile(): Promise<File> }[]> } = { showOpenFilePicker: async () => [{ getFile: async () => file }] };
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  try { assert.equal(await chooseLayoutOpen(), file); delete browser.showOpenFilePicker; assert.equal(chooseLayoutOpen(), null); assert.equal(chooseLayoutSave("room.electricallayout"), null); }
  finally { if (old) Object.defineProperty(globalThis, "window", old); else Reflect.deleteProperty(globalThis, "window"); }
});
