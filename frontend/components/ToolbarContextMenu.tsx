"use client";

import type { ToolbarDefinition, ToolbarId, ToolbarVisibility } from "@/lib/toolbars";

interface ToolbarContextMenuProps {
  x: number;
  y: number;
  toolbars: ToolbarDefinition[];
  visibility: ToolbarVisibility;
  onToggle: (id: ToolbarId) => void;
  onClose: () => void;
}

export function ToolbarContextMenu({ x, y, toolbars, visibility, onToggle, onClose }: ToolbarContextMenuProps) {
  return <div className="toolbar-context-menu" role="menu" aria-label="Background actions" style={{ left: x, top: y }} onContextMenu={(event) => event.preventDefault()}>
    <button className="toolbar-context-parent" type="button" role="menuitem" aria-haspopup="menu"><span>Toolbars</span><span aria-hidden>›</span></button>
    <div className="toolbar-context-submenu" role="menu" aria-label="Toolbars">
      {toolbars.map((toolbar) => <button key={toolbar.id} type="button" role="menuitemcheckbox" aria-checked={visibility[toolbar.id]} onClick={() => { onToggle(toolbar.id); onClose(); }}><span className="menu-check">{visibility[toolbar.id] ? "✓" : ""}</span><span>{toolbar.name}</span></button>)}
    </div>
  </div>;
}
