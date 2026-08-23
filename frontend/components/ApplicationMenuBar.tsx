"use client";

import { useRef, useState } from "react";
import type { Room, WallViewMode } from "@/lib/types";

interface ApplicationMenuBarProps {
  room: Room;
  personPanelVisible: boolean;
  wallMode: WallViewMode;
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
  link.download = filename.toLowerCase().endsWith(".json") ? filename : `${filename}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ApplicationMenuBar({ room, personPanelVisible, wallMode, onOpenRoom, onOpenCatalogue, onTogglePersonPanel, onWallModeChange, onOpenSettings }: ApplicationMenuBarProps) {
  const [menu, setMenu] = useState<MenuName>(null);
  const [error, setError] = useState<string | null>(null);
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

  return <nav className="software-menu" aria-label="Application menu">
    <div className="software-menu-item"><button className={menu === "FILE" ? "active" : ""} onClick={() => toggle("FILE")}>File</button>{menu === "FILE" && <div className="software-dropdown"><button onClick={() => fileInput.current?.click()}><span>Open…</span><kbd>Ctrl+O</kbd></button><button onClick={() => { downloadRoom(room, "renovation-fit-room.json"); setMenu(null); }}><span>Save</span><kbd>Ctrl+S</kbd></button><button onClick={() => { const name = window.prompt("Save room as", "bathroom-plan.json"); if (name) downloadRoom(room, name); setMenu(null); }}><span>Save as…</span></button>{error && <p>{error}</p>}</div>}</div>
    <div className="software-menu-item"><button className={menu === "TOOLS" ? "active" : ""} onClick={() => toggle("TOOLS")}>Tools</button>{menu === "TOOLS" && <div className="software-dropdown"><button onClick={() => { onOpenCatalogue(); setMenu(null); }}><span>Object catalogue…</span></button><button onClick={() => { onTogglePersonPanel(); setMenu(null); }}><span>{personPanelVisible ? "✓ " : ""}Human mock-up panel</span></button></div>}</div>
    <div className="software-menu-item"><button className={menu === "VIEW" ? "active" : ""} onClick={() => toggle("VIEW")}>View</button>{menu === "VIEW" && <div className="software-dropdown" role="menu" aria-label="Wall display"><button aria-pressed={wallMode === "SOLID"} onClick={() => setWallMode("SOLID")}><span>{wallMode === "SOLID" ? "✓ " : ""}Solid walls</span></button><button aria-pressed={wallMode === "TRANSPARENT"} onClick={() => setWallMode("TRANSPARENT")}><span>{wallMode === "TRANSPARENT" ? "✓ " : ""}Transparent walls</span></button><button aria-pressed={wallMode === "INVISIBLE"} onClick={() => setWallMode("INVISIBLE")}><span>{wallMode === "INVISIBLE" ? "✓ " : ""}Invisible walls</span></button></div>}</div>
    <div className="software-menu-item"><button className={menu === "SETTINGS" ? "active" : ""} onClick={() => toggle("SETTINGS")}>Settings</button>{menu === "SETTINGS" && <div className="software-dropdown"><button onClick={() => { onOpenSettings(); setMenu(null); }}><span>Preferences…</span></button><button disabled><span>Engineering units</span><kbd>mm</kbd></button></div>}</div>
    <input ref={fileInput} hidden type="file" accept="application/json,.json" onChange={(event) => { void openFile(event.target.files?.[0]); event.target.value = ""; }} />
  </nav>;
}
