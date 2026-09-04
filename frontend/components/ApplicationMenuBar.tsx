"use client";

import { useEffect, useRef, useState } from "react";
import type { Room, WallViewMode } from "@/lib/types";
import type { ToolbarDefinition, ToolbarId, ToolbarVisibility } from "@/lib/toolbars";

interface ApplicationMenuBarProps {
  room: Room;
  mode: "EDITOR" | "ANALYSIS";
  wallMode: WallViewMode;
  floorplanStyle: "DEFAULT" | "TRADITIONAL";
  displayUnits: "MM" | "CM" | "INCHES" | "FEET" | "METERS";
  onOpenRoom: (room: Room) => Promise<void>;
  onOpenCatalogue: () => void;
  onOpenCatalogueManager: (opener: HTMLButtonElement) => void;
  onWallModeChange: (mode: WallViewMode) => void;
  onFloorplanStyleChange: (style: "DEFAULT" | "TRADITIONAL") => void;
  onExportFloorplan: () => void;
  onOpenSettings: () => void;
  toolbars: ToolbarDefinition[];
  toolbarVisibility: ToolbarVisibility;
  onToggleToolbar: (id: ToolbarId) => void;
  onShowAllToolbars: () => void;
  onHideAllToolbars: () => void;
}

type MenuName = "FILE" | "TOOLS" | "VIEW" | "TOOLBAR" | "SETTINGS" | null;

function downloadRoom(room: Room, filename: string) {
  const blob = new Blob([JSON.stringify(room, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const stem = filename.trim().replace(/\.json$/i, "").replace(/[\\/:*?"<>|]+/g, "-") || "bathroom-plan";
  link.download = `${stem}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function saveRoomAs(room: Room, filename: string) {
  const stem = filename.trim().replace(/\.json$/i, "").replace(/[\\/:*?"<>|]+/g, "-") || "bathroom-plan";
  const picker = (window as Window & { showSaveFilePicker?: (options: unknown) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
  if (!picker) { downloadRoom(room, stem); return; }
  try {
    const handle = await picker({ suggestedName: `${stem}.json`, types: [{ description: "Renovation Fit room", accept: { "application/json": [".json"] } }] });
    const writable = await handle.createWritable();
    await writable.write(new Blob([JSON.stringify(room, null, 2)], { type: "application/json" }));
    await writable.close();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    downloadRoom(room, stem);
  }
}

export function ApplicationMenuBar({ room, mode, wallMode, floorplanStyle, displayUnits, onOpenRoom, onOpenCatalogue, onOpenCatalogueManager, onWallModeChange, onFloorplanStyleChange, onExportFloorplan, onOpenSettings, toolbars, toolbarVisibility, onToggleToolbar, onShowAllToolbars, onHideAllToolbars }: ApplicationMenuBarProps) {
  const [menu, setMenu] = useState<MenuName>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveName, setSaveName] = useState("bathroom-plan");
  const fileInput = useRef<HTMLInputElement>(null);
  const toolsButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menu) return;
    function closeOnBackgroundPointer(event: PointerEvent) {
      if (event.target instanceof Element && !event.target.closest(".software-menu")) setMenu(null);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenu(null);
    }
    document.addEventListener("pointerdown", closeOnBackgroundPointer, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnBackgroundPointer, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menu]);

  function toggle(next: Exclude<MenuName, null>) {
    setMenu((current) => current === next ? null : next);
    setError(null);
  }

  async function openFile(file?: File) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Room;
      await onOpenRoom(parsed);
      setMenu(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The selected room file is invalid.");
    }
  }

  function setWallMode(mode: WallViewMode) {
    onWallModeChange(mode);
    setMenu(null);
  }

  return <>
  <nav className="software-menu" aria-label="Application menu">
    <div className="software-menu-item"><button className={menu === "FILE" ? "active" : ""} onClick={() => toggle("FILE")}>File</button>{menu === "FILE" && <div className="software-dropdown"><button onClick={() => fileInput.current?.click()}><span>Open…</span><kbd>Ctrl+O</kbd></button><button onClick={() => { downloadRoom(room, "renovation-fit-room"); setMenu(null); }}><span>Save</span><kbd>Ctrl+S</kbd></button><button onClick={() => { setSaveName("bathroom-plan"); setSaveAsOpen(true); setMenu(null); }}><span>Save as…</span></button>{error && <p>{error}</p>}</div>}</div>
    <div className="software-menu-item"><button ref={toolsButton} className={menu === "TOOLS" ? "active" : ""} onClick={() => toggle("TOOLS")}>Tools</button>{menu === "TOOLS" && <div className="software-dropdown">{mode === "EDITOR" && <button onClick={() => { onExportFloorplan(); setMenu(null); }}><span>Export floorplan…</span></button>}<button onClick={() => { onOpenCatalogue(); setMenu(null); }}><span>Object catalogue…</span></button><button onClick={(event) => { onOpenCatalogueManager(toolsButton.current ?? event.currentTarget); setMenu(null); }}><span>Object catalogue manager…</span></button></div>}</div>
    <div className="software-menu-item"><button className={menu === "VIEW" ? "active" : ""} onClick={() => toggle("VIEW")}>View</button>{menu === "VIEW" && <div className="software-dropdown" role="menu" aria-label={mode === "EDITOR" ? "Floorplan display" : "Wall display"}>{mode === "EDITOR" ? <><button aria-pressed={floorplanStyle === "DEFAULT"} onClick={() => { onFloorplanStyleChange("DEFAULT"); setMenu(null); }}><span>{floorplanStyle === "DEFAULT" ? "✓ " : ""}Default view</span></button><button aria-pressed={floorplanStyle === "TRADITIONAL"} onClick={() => { onFloorplanStyleChange("TRADITIONAL"); setMenu(null); }}><span>{floorplanStyle === "TRADITIONAL" ? "✓ " : ""}Traditional view</span></button></> : <><button aria-pressed={wallMode === "SOLID"} onClick={() => setWallMode("SOLID")}><span>{wallMode === "SOLID" ? "✓ " : ""}Solid walls</span></button><button aria-pressed={wallMode === "TRANSPARENT"} onClick={() => setWallMode("TRANSPARENT")}><span>{wallMode === "TRANSPARENT" ? "✓ " : ""}Transparent walls</span></button><button aria-pressed={wallMode === "CUTAWAY_2D"} onClick={() => setWallMode("CUTAWAY_2D")}><span>{wallMode === "CUTAWAY_2D" ? "✓ " : ""}2D cutaway walls</span></button><button aria-pressed={wallMode === "INVISIBLE"} onClick={() => setWallMode("INVISIBLE")}><span>{wallMode === "INVISIBLE" ? "✓ " : ""}Invisible walls</span></button></>}</div>}</div>
    <div className="software-menu-item"><button className={menu === "TOOLBAR" ? "active" : ""} onClick={() => toggle("TOOLBAR")}>Toolbar</button>{menu === "TOOLBAR" && <div className="software-dropdown toolbar-menu" role="menu" aria-label={`${mode === "EDITOR" ? "Floorplan" : "3D viewer"} toolbars`}><div className="toolbar-menu-actions"><button type="button" onClick={() => { onShowAllToolbars(); setMenu(null); }}>Show all</button><button type="button" onClick={() => { onHideAllToolbars(); setMenu(null); }}>Hide all</button></div>{toolbars.map((toolbar) => <button key={toolbar.id} type="button" role="menuitemcheckbox" aria-checked={toolbarVisibility[toolbar.id]} onClick={() => onToggleToolbar(toolbar.id)}><span className="menu-check">{toolbarVisibility[toolbar.id] ? "✓" : ""}</span><span>{toolbar.name}</span></button>)}</div>}</div>
    <div className="software-menu-item"><button className={menu === "SETTINGS" ? "active" : ""} onClick={() => toggle("SETTINGS")}>Settings</button>{menu === "SETTINGS" && <div className="software-dropdown"><button onClick={() => { onOpenSettings(); setMenu(null); }}><span>Preferences…</span></button><button disabled><span>Display units</span><kbd>{{ MM: "mm", CM: "cm", INCHES: "in", FEET: "ft", METERS: "m" }[displayUnits]}</kbd></button></div>}</div>
    <input ref={fileInput} hidden type="file" accept="application/json,.json" onChange={(event) => { void openFile(event.target.files?.[0]); event.target.value = ""; }} />
  </nav>
  {saveAsOpen && <div className="modal-backdrop save-as-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSaveAsOpen(false); }}><form className="save-as-dialog" role="dialog" aria-modal="true" aria-labelledby="save-as-title" onSubmit={(event) => { event.preventDefault(); void saveRoomAs(room, saveName); setSaveAsOpen(false); }}><header><div><span className="eyebrow">Save project file</span><h2 id="save-as-title">Save room as</h2></div><button type="button" className="modal-close" onClick={() => setSaveAsOpen(false)}>×</button></header><label><span>File name</span><div><input autoFocus value={saveName} onChange={(event) => setSaveName(event.target.value.replace(/\.json$/i, ""))} aria-label="Room file name" /><strong>.json</strong></div><small>Choose the destination folder after pressing Save file.</small></label><footer><button type="button" onClick={() => setSaveAsOpen(false)}>Cancel</button><button className="primary" type="submit">Save file</button></footer></form></div>}
  </>;
}
