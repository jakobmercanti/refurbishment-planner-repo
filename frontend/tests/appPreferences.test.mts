import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_APPEARANCE_STORAGE_KEY,
  readAppearancePreferences,
  resolveTheme,
  watchThemePreference,
  writeAppearancePreferences,
} from "../lib/appPreferences.ts";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

class FakeMediaQuery {
  matches = false;
  listeners = new Set<EventListener>();
  addEventListener(_type: string, listener: EventListener) { this.listeners.add(listener); }
  removeEventListener(_type: string, listener: EventListener) { this.listeners.delete(listener); }
  change(matches: boolean) {
    this.matches = matches;
    for (const listener of this.listeners) listener(new Event("change"));
  }
}

test("appearance preferences persist theme and density together as app-local values", () => {
  const storage = new MemoryStorage();
  writeAppearancePreferences({ theme: "DARK", density: "COMFORTABLE" }, storage);
  assert.deepEqual(JSON.parse(storage.getItem(APP_APPEARANCE_STORAGE_KEY)!), {
    theme: "dark",
    density: "comfortable",
  });
  assert.deepEqual(readAppearancePreferences(storage), { theme: "DARK", density: "COMFORTABLE" });

  writeAppearancePreferences({ theme: "SYSTEM", density: "COMPACT" }, storage);
  assert.deepEqual(readAppearancePreferences(storage), { theme: "SYSTEM", density: "COMPACT" });
});

test("malformed or unsupported stored appearance values fall back independently", () => {
  const storage = new MemoryStorage();
  storage.setItem(APP_APPEARANCE_STORAGE_KEY, JSON.stringify({ theme: "sepia", density: "compact" }));
  assert.deepEqual(readAppearancePreferences(storage), { density: "COMPACT" });
  storage.setItem(APP_APPEARANCE_STORAGE_KEY, "{");
  assert.deepEqual(readAppearancePreferences(storage), {});
});

test("System resolves to the current OS preference while fixed themes ignore it", () => {
  assert.equal(resolveTheme("SYSTEM", false), "light");
  assert.equal(resolveTheme("SYSTEM", true), "dark");
  assert.equal(resolveTheme("LIGHT", true), "light");
  assert.equal(resolveTheme("DARK", false), "dark");
});

test("System theme follows media changes and removes its listener on cleanup", () => {
  const media = new FakeMediaQuery();
  const root = { dataset: {} } as HTMLElement;
  const cleanup = watchThemePreference("SYSTEM", root, media as unknown as MediaQueryList);
  assert.equal(root.dataset.theme, "light");
  assert.equal(root.dataset.themeMode, "system");
  assert.equal(media.listeners.size, 1);

  media.change(true);
  assert.equal(root.dataset.theme, "dark");
  media.change(false);
  assert.equal(root.dataset.theme, "light");
  cleanup();
  assert.equal(media.listeners.size, 0);
  media.change(true);
  assert.equal(root.dataset.theme, "light");
});

test("explicit themes do not subscribe to OS changes", () => {
  const media = new FakeMediaQuery();
  const root = { dataset: {} } as HTMLElement;
  const cleanup = watchThemePreference("DARK", root, media as unknown as MediaQueryList);
  assert.equal(root.dataset.theme, "dark");
  assert.equal(root.dataset.themeMode, "dark");
  assert.equal(media.listeners.size, 0);
  media.change(false);
  assert.equal(root.dataset.theme, "dark");
  cleanup();
});

test("storage failures do not interrupt the in-memory preference workflow", () => {
  const unavailable = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };
  assert.deepEqual(readAppearancePreferences(unavailable), {});
  assert.doesNotThrow(() => writeAppearancePreferences({ theme: "LIGHT", density: "COMPACT" }, unavailable));
});
