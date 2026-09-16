"use client";

import { useId, useState } from "react";
import { colourForPart, colourPartsFor, type ColourSource } from "@/lib/assetColours";
import { woodFinishOptions } from "@/lib/finishOptions";

/** The same database-driven part picker is used by both element windows. */
export function ComponentColours({ source, onChange }: { source: ColourSource; onChange: (colours: Record<string, string>) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState("");
  const id = useId();
  const parts = colourPartsFor(source);
  const part = parts.find(part => part.id === selected) ?? parts[0];
  const colour = colourForPart(source, part);
  const setColour = (next: string) => onChange({ ...source.component_colors, [part.id]: next });
  return <div className="fixture-colours-controls" role="group" aria-label="Colours">
    <button type="button" className="fixture-colours-toggle" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}><strong>Colours</strong><span aria-hidden>{expanded ? "−" : "+"}</span></button>
    {expanded && <div id={id} className="fixture-colours-fields">
      <label className="field"><span>Component</span><select aria-label="Colour component" value={part.id} onChange={event => setSelected(event.target.value)}>{parts.map(part => <option key={part.id} value={part.id}>{part.label}</option>)}</select></label>
      <label className="field"><span>{part.label} colour</span><input aria-label={`${part.label} colour`} type="color" value={colour} onChange={event => setColour(event.target.value)} /></label>
      <label className="field"><span>Hex colour</span><input key={`${part.id}-${colour}`} aria-label={`${part.label} hex colour`} defaultValue={colour.toUpperCase()} maxLength={7} pattern="#[0-9A-Fa-f]{6}" onBlur={event => { if (/^#[0-9a-f]{6}$/i.test(event.target.value)) setColour(event.target.value); else event.target.value = colour.toUpperCase(); }} /></label>
      <label className="field"><span>Colour preset</span><select aria-label={`${part.label} colour preset`} value="" onChange={event => { if (event.target.value) setColour(event.target.value); }}><option value="">Choose a preset…</option>{woodFinishOptions().map(option => <option key={option.id} value={option.colorHex}>{option.label}</option>)}</select></label>
      <button type="button" className="review-style-button colour-reset-button" onClick={() => setColour(part.default_color_hex)}>Reset {part.label.toLowerCase()} to default</button>
      {part.id === "glass" && /tint/i.test(part.label) && <small>Changes the tint; glass remains transparent.</small>}
    </div>}
  </div>;
}
