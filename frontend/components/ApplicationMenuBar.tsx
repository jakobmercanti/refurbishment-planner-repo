"use client";

import { useEffect, useRef, useState } from "react";
import { useCompactWorkspace } from "@/lib/useCompactWorkspace";
import { ProjectDownloadDialog } from "@/components/ProjectDownloadDialog";
import type { Room, WallViewMode } from "@/lib/types";
import { FLOORPLAN_STYLE_OPTIONS, type FloorplanStyle } from "@/lib/floorplanStyles";
import type { ToolbarDefinition, ToolbarId, ToolbarVisibility } from "@/lib/toolbars";

interface ApplicationMenuBarProps {
  room: Room;
  onPrepareProject: (filename?: string) => Promise<File>;
  onSaveProject: (filename?: string) => Promise<void>;
  onOpenProject: (file: File) => Promise<void>;
  onOpenAssets: () => void;
  onOpenPrivacy: () => void;
  mode: "EDITOR" | "ANALYSIS";
  wallMode: WallViewMode;
  floorplanStyle: FloorplanStyle;
  displayUnits: "MM" | "CM" | "INCHES" | "FEET" | "METERS";
  onOpenRoom: (room: Room) => Promise<void>;
  onOpenCatalogue: () => void;
  onOpenCatalogueManager: (opener: HTMLButtonElement) => void;
  catalogueManagerAvailable: boolean;
  onWallModeChange: (mode: WallViewMode) => void;
  onFloorplanStyleChange: (style: FloorplanStyle) => void;
  onExportFloorplan: () => void;
  onSaveView?: () => void;
  onAnnotate?: () => void;
  onImportDrawing: (file: File) => void;
  onOpenSettings: () => void;
  toolbars: ToolbarDefinition[];
  toolbarVisibility: ToolbarVisibility;
  toolbarAvailability: ToolbarVisibility;
  onToggleToolbar: (id: ToolbarId) => void;
  onShowAllToolbars: () => void;
  onHideAllToolbars: () => void;
}

type MenuName = "FILE" | "TOOLS" | "VIEW" | "TOOLBAR" | "SETTINGS" | null;

export function ApplicationMenuBar({ onPrepareProject, onSaveProject, onOpenProject, onOpenAssets, onOpenPrivacy, mode, wallMode, floorplanStyle, displayUnits, onOpenRoom, onOpenCatalogue, onOpenCatalogueManager, catalogueManagerAvailable, onWallModeChange, onFloorplanStyleChange, onExportFloorplan, onSaveView, onAnnotate, onImportDrawing, onOpenSettings, toolbars, toolbarVisibility, toolbarAvailability, onToggleToolbar, onShowAllToolbars, onHideAllToolbars }: ApplicationMenuBarProps) {
  const compact = useCompactWorkspace();
  const [preparedFile, setPreparedFile] = useState<File | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [menu, setMenu] = useState<MenuName>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveName, setSaveName] = useState("bathroom-plan");
  const fileInput = useRef<HTMLInputElement>(null);
  const drawingInput = useRef<HTMLInputElement>(null);
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

  async function saveProject(filename?: string) {
    if (preparing) return;
    setPreparing(true); setError(null);
    try {
      if (compact) setPreparedFile(await onPrepareProject(filename));
      else await onSaveProject(filename);
      setSaveAsOpen(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to prepare the project file."); }
    finally { setPreparing(false); }
  }

  function toggle(next: Exclude<MenuName, null>) {
    setMenu((current) => current === next ? null : next);
    setError(null);
  }

  async function openFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 200 * 1024 * 1024) throw new Error("Choose a project smaller than 200 MB.");
      const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      const isPackage = /\.(floorplan3d|zip)$/i.test(file.name) || (signature[0] === 0x50 && signature[1] === 0x4b);
      if (isPackage) await onOpenProject(file);
      else { const parsed = JSON.parse(await file.text()) as Room; await onOpenRoom(parsed); }
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
    <div className="software-menu-item"><button className={menu === "FILE" ? "active" : ""} onClick={() => toggle("FILE")}>File</button>{menu === "FILE" && <div className="software-dropdown"><button onClick={() => fileInput.current?.click()}><span>Open project…</span><kbd>Ctrl+O</kbd></button><button disabled={preparing} onClick={() => { void saveProject(); setMenu(null); }}><span>Save</span><kbd>Ctrl+S</kbd></button><button onClick={() => { setSaveName("bathroom-plan"); setSaveAsOpen(true); setMenu(null); }}><span>Save as…</span></button>{error && <p>{error}</p>}</div>}</div>
    <div className="software-menu-item"><button ref={toolsButton} className={menu === "TOOLS" ? "active" : ""} onClick={() => toggle("TOOLS")}>Tools</button>{menu === "TOOLS" && <div className="software-dropdown">{mode === "EDITOR" ? <><button onClick={() => { drawingInput.current?.click(); setMenu(null); }}><span>Import drawing…</span></button><button onClick={() => { onExportFloorplan(); setMenu(null); }}><span>Export floorplan…</span></button><button onClick={() => { onAnnotate?.(); setMenu(null); }}><span>Annotate</span></button></> : <button onClick={() => { onSaveView?.(); setMenu(null); }}><span>Save view…</span></button>}<button onClick={() => { onOpenCatalogue(); setMenu(null); }}><span>Object catalogue…</span></button><button onClick={() => { onOpenAssets(); setMenu(null); }}><span>My 3D models…</span></button>{catalogueManagerAvailable && <button onClick={(event) => { onOpenCatalogueManager(toolsButton.current ?? event.currentTarget); setMenu(null); }}><span>Object catalogue manager…</span></button>}</div>}</div>
    <div className="software-menu-item"><button className={menu === "VIEW" ? "active" : ""} onClick={() => toggle("VIEW")}>View</button>{menu === "VIEW" && <div className="software-dropdown" role="menu" aria-label={mode === "EDITOR" ? "Floorplan display" : "Wall display"}>{mode === "EDITOR" ? FLOORPLAN_STYLE_OPTIONS.map((option) => <button key={option.value} aria-pressed={floorplanStyle === option.value} onClick={() => { onFloorplanStyleChange(option.value); setMenu(null); }}><span>{floorplanStyle === option.value ? "✓ " : ""}{option.label}</span></button>) : <><button aria-pressed={wallMode === "SOLID"} onClick={() => setWallMode("SOLID")}><span>{wallMode === "SOLID" ? "✓ " : ""}Solid walls</span></button><button aria-pressed={wallMode === "TRANSPARENT"} onClick={() => setWallMode("TRANSPARENT")}><span>{wallMode === "TRANSPARENT" ? "✓ " : ""}Transparent walls</span></button><button aria-pressed={wallMode === "CUTAWAY_2D"} onClick={() => setWallMode("CUTAWAY_2D")}><span>{wallMode === "CUTAWAY_2D" ? "✓ " : ""}2D cutaway walls</span></button><button aria-pressed={wallMode === "CUTAWAY_3D"} onClick={() => setWallMode("CUTAWAY_3D")}><span>{wallMode === "CUTAWAY_3D" ? "✓ " : ""}3D cutaway walls</span></button><button aria-pressed={wallMode === "INVISIBLE"} onClick={() => setWallMode("INVISIBLE")}><span>{wallMode === "INVISIBLE" ? "✓ " : ""}Invisible walls</span></button></>}</div>}</div>
    <div className="software-menu-item"><button className={menu === "TOOLBAR" ? "active" : ""} onClick={() => toggle("TOOLBAR")}>Toolbar</button>{menu === "TOOLBAR" && <div className="software-dropdown toolbar-menu" role="menu" aria-label={`${mode === "EDITOR" ? "Floorplan" : "3D viewer"} toolbars`}><div className="toolbar-menu-actions"><button type="button" onClick={() => { onShowAllToolbars(); setMenu(null); }}>Show all</button><button type="button" onClick={() => { onHideAllToolbars(); setMenu(null); }}>Hide all</button></div>{toolbars.filter((toolbar) => toolbarAvailability[toolbar.id]).map((toolbar) => <button key={toolbar.id} type="button" role="menuitemcheckbox" aria-checked={toolbarVisibility[toolbar.id]} onClick={() => onToggleToolbar(toolbar.id)}><span className="menu-check">{toolbarVisibility[toolbar.id] ? "✓" : ""}</span><span>{toolbar.name}</span></button>)}</div>}</div>
    <div className="software-menu-item"><button className={menu === "SETTINGS" ? "active" : ""} onClick={() => toggle("SETTINGS")}>Settings</button>{menu === "SETTINGS" && <div className="software-dropdown"><button onClick={() => { onOpenSettings(); setMenu(null); }}><span>Preferences…</span></button><button onClick={() => { onOpenPrivacy(); setMenu(null); }}><span>Privacy and local saving…</span></button><button disabled><span>Display units</span><kbd>{{ MM: "mm", CM: "cm", INCHES: "in", FEET: "ft", METERS: "m" }[displayUnits]}</kbd></button></div>}</div>
    <input ref={fileInput} hidden type="file" aria-label="Open project file" accept={compact ? undefined : ".floorplan3d,.zip,application/zip,application/json,.json,application/octet-stream"} onChange={(event) => { void openFile(event.target.files?.[0]); event.target.value = ""; }} />
    <input ref={drawingInput} hidden type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImportDrawing(file); event.target.value = ""; }} />
  </nav>
  {preparedFile && <ProjectDownloadDialog file={preparedFile} onClose={() => setPreparedFile(null)} />}
  {preparing && <div className="project-file-progress" role="status">Preparing your project file…</div>}
  {error && <div className="project-error" role="alert">{error}<button onClick={() => setError(null)} aria-label="Dismiss file error">×</button></div>}
  {saveAsOpen && <div className="modal-backdrop save-as-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSaveAsOpen(false); }}><form className="save-as-dialog" role="dialog" aria-modal="true" aria-labelledby="save-as-title" onSubmit={(event) => { event.preventDefault(); void saveProject(saveName); }}><header><div><span className="eyebrow">Save project file</span><h2 id="save-as-title">Save project as</h2></div><button type="button" className="modal-close" onClick={() => setSaveAsOpen(false)}>×</button></header><label><span>File name</span><div><input autoFocus value={saveName} onChange={(event) => setSaveName(event.target.value.replace(/\.json$/i, ""))} aria-label="Project file name" /><strong>.floorplan3d</strong></div><small>Includes every room and referenced local model.</small>{error && <p role="alert">{error}</p>}</label><footer><button type="button" onClick={() => setSaveAsOpen(false)}>Cancel</button><button className="primary" type="submit" disabled={preparing}>{preparing ? "Preparing…" : "Save file"}</button></footer></form></div>}
  </>;
}
