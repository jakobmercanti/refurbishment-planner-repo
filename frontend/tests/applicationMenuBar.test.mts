import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApplicationMenuBar } from "../components/ApplicationMenuBar.tsx";
import type { Room } from "../lib/types.ts";

test("application menu keeps the requested top-level order", () => {
  const markup = renderToStaticMarkup(createElement(ApplicationMenuBar, {
    room: {} as Room,
    onPrepareProject: async () => new File([], "project"),
    onSaveProject: async () => {},
    onOpenProject: async () => {},
    onOpenAssets: () => {},
    onOpenPrivacy: () => {},
    mode: "EDITOR",
    wallMode: "SOLID",
    floorplanStyle: "DEFAULT",
    displayUnits: "MM",
    onDisplayUnitsChange: () => {},
    onOpenRoom: async () => {},
    onOpenCatalogue: () => {},
    onOpenElectricalLayout: () => {},
    onOpenCatalogueManager: () => {},
    catalogueManagerAvailable: false,
    onWallModeChange: () => {},
    onFloorplanStyleChange: () => {},
    onExportFloorplan: () => {},
    onImportDrawing: () => {},
    onOpenSettings: () => {},
    toolbars: [],
    toolbarVisibility: {},
    toolbarAvailability: {},
    onToggleToolbar: () => {},
    onShowAllToolbars: () => {},
    onHideAllToolbars: () => {},
  }));
  const firstMenuLabels = [...markup.matchAll(/<button[^>]*>([^<]+)<\/button>/g)]
    .map((match) => match[1])
    .slice(0, 6);

  assert.deepEqual(firstMenuLabels, ["File", "Tools", "Library", "View", "Toolbar", "Settings"]);
});
