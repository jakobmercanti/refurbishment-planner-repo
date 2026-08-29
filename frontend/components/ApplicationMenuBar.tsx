"use client";

import { useRef, useState } from "react";
import type { Room, WallViewMode } from "@/lib/types";

interface ApplicationMenuBarProps {
  room: Room;
  personPanelVisible: boolean;
  wallMode: WallViewMode;
  displayUnits: "MM" | "CM" | "INCHES" | "FEET" | "METERS";
  onOpenRoom: (room: Room) => Promise<void>;
  onOpenCatalogue: () => void;
  onTogglePersonPanel: () => void;
  onWallModeChange: (mode: WallViewMode) => void;
  onOpenSettings: () => void;
}

type MenuName = "FILE" | "TOOLS" | "VIEW" | "SETTINGS" | null;

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

export function ApplicationMenuBar({ room, personPanelVisible, wallMode, displayUnits, onOpenRoom, onOpenCatalogue, onTogglePersonPanel, onWallModeChange, onOpenSettings }: ApplicationMenuBarProps) {
  const [menu, setMenu] = useState<MenuName>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveName, setSaveName] = useState("bathroom-plan");
  const fileInput = useRef<HTMLInputElement>(null);

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
    <div className="software-menu-item"><button className={menu === "TOOLS" ? "active" : ""} onClick={() => toggle("TOOLS")}>Tools</button>{menu === "TOOLS" && <div className="software-dropdown"><button onClick={() => { onOpenCatalogue(); setMenu(null); }}><span>Object catalogue…</span></button><button onClick={() => { onTogglePersonPanel(); setMenu(null); }}><span>{personPanelVisible ? "✓ " : ""}Human mock-up panel</span></button></div>}</div>
    <div className="software-menu-item"><button className={menu === "VIEW" ? "active" : ""} onClick={() => toggle("VIEW")}>View</button>{menu === "VIEW" && <div className="software-dropdown" role="menu" aria-label="Wall display"><button aria-pressed={wallMode === "SOLID"} onClick={() => setWallMode("SOLID")}><span>{wallMode === "SOLID" ? "✓ " : ""}Solid walls</span></button><button aria-pressed={wallMode === "TRANSPARENT"} onClick={() => setWallMode("TRANSPARENT")}><span>{wallMode === "TRANSPARENT" ? "✓ " : ""}Transparent walls</span></button><button aria-pressed={wallMode === "CUTAWAY_2D"} onClick={() => setWallMode("CUTAWAY_2D")}><span>{wallMode === "CUTAWAY_2D" ? "✓ " : ""}2D cutaway walls</span></button><button aria-pressed={wallMode === "INVISIBLE"} onClick={() => setWallMode("INVISIBLE")}><span>{wallMode === "INVISIBLE" ? "✓ " : ""}Invisible walls</span></button></div>}</div>
    <div className="software-menu-item"><button className={menu === "SETTINGS" ? "active" : ""} onClick={() => toggle("SETTINGS")}>Settings</button>{menu === "SETTINGS" && <div className="software-dropdown"><button onClick={() => { onOpenSettings(); setMenu(null); }}><span>Preferences…</span></button><button disabled><span>Display units</span><kbd>{{ MM: "mm", CM: "cm", INCHES: "in", FEET: "ft", METERS: "m" }[displayUnits]}</kbd></button></div>}</div>
    <input ref={fileInput} hidden type="file" accept="application/json,.json" onChange={(event) => { void openFile(event.target.files?.[0]); event.target.value = ""; }} />
  </nav>
  {saveAsOpen && <div className="modal-backdrop save-as-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSaveAsOpen(false); }}><form className="save-as-dialog" role="dialog" aria-modal="true" aria-labelledby="save-as-title" onSubmit={(event) => { event.preventDefault(); void saveRoomAs(room, saveName); setSaveAsOpen(false); }}><header><div><span className="eyebrow">Save project file</span><h2 id="save-as-title">Save room as</h2></div><button type="button" className="modal-close" onClick={() => setSaveAsOpen(false)}>×</button></header><label><span>File name</span><div><input autoFocus value={saveName} onChange={(event) => setSaveName(event.target.value.replace(/\.json$/i, ""))} aria-label="Room file name" /><strong>.json</strong></div><small>Choose the destination folder after pressing Save file.</small></label><footer><button type="button" onClick={() => setSaveAsOpen(false)}>Cancel</button><button className="primary" type="submit">Save file</button></footer></form></div>}
  </>;
}
