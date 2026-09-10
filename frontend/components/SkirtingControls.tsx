"use client";
import { useId } from "react";
import { WOOD_COLOURS } from "@/lib/flooring";
import { normalizeSkirting, type SkirtingBoardSettings } from "@/lib/skirting";

function SizeInput({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (value: number) => void }) {
  return <label className="field"><span>{label}</span><input key={value} type="number" aria-label={label} defaultValue={value} min={1} max={max} step="any" onBlur={event => {
    const next = event.currentTarget.valueAsNumber;
    if (Number.isFinite(next) && next >= 1 && next <= max) onChange(next);
    else event.currentTarget.value = String(value);
  }} onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { event.currentTarget.value = String(value); event.currentTarget.blur(); } }} /></label>;
}

export function SkirtingControls({ value, onChange, collapsed = false, onToggleCollapsed }: { value?: SkirtingBoardSettings; onChange: (settings: SkirtingBoardSettings) => void; collapsed?: boolean; onToggleCollapsed?: (collapsed: boolean) => void }) {
  const id = useId(), settings = normalizeSkirting(value);
  const update = (patch: Partial<SkirtingBoardSettings>) => onChange(normalizeSkirting({ ...settings, ...patch }));
  return <section data-skirting-controls style={{ borderTop: "1px solid #c6c9c4", marginTop: 16, paddingTop: 12 }}>
    {settings.enabled && collapsed ? <button type="button" className="skirting-summary" aria-label="Expand skirting board settings" aria-expanded="false" onClick={() => onToggleCollapsed?.(false)}><span className="skirting-summary-title"><span className="skirting-summary-check" aria-hidden="true">✓</span>Skirting board</span><span className="skirting-summary-action">Show settings</span></button> : <>
    <label className="viewer-lock-choice"><input type="checkbox" checked={settings.enabled} aria-controls={id} aria-expanded={settings.enabled} onChange={event => update({ enabled: event.target.checked })} /><span>Skirting board</span></label>
    {settings.enabled && <div id={id}>
      <p>Applies around this room, with gaps at doors.</p>
      <label className="field"><span>Colour</span><select aria-label="Skirting board colour" value={settings.colour_mode} onChange={event => update({ colour_mode: event.target.value as SkirtingBoardSettings["colour_mode"] })}><option value="CUSTOM">Custom colour</option><option value="WALL">Same colour as wall</option><option value="WOOD">Wood</option></select></label>
      {settings.colour_mode === "CUSTOM" && <label className="field"><span>Custom colour</span><input type="color" aria-label="Custom skirting board colour" value={settings.custom_colour} onChange={event => update({ custom_colour: event.target.value })} /></label>}
      {settings.colour_mode === "WOOD" && <label className="field"><span>Wood colour</span><select aria-label="Skirting board wood colour" value={settings.wood_id} onChange={event => update({ wood_id: event.target.value })}>{WOOD_COLOURS.map(wood => <option key={wood.id} value={wood.id}>{wood.name}</option>)}</select></label>}
      <div className="coordinate-fields"><SizeInput label="Skirting board height (mm)" value={settings.height_mm} max={600} onChange={height_mm => update({ height_mm })} /><SizeInput label="Skirting board thickness (mm)" value={settings.thickness_mm} max={100} onChange={thickness_mm => update({ thickness_mm })} /></div>
    </div>}
    </>}
  </section>;
}
