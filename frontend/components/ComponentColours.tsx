"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { colourForPart, colourPartsFor, partSupportsFinish, FULL_PART_ID, GLASS_PART_ID, type ColourSource } from "@/lib/assetColours";
import { woodFinishOptions } from "@/lib/finishOptions";
import { METAL_FINISHES, metalFinishForColour, metalSwatchStyle } from "@/lib/metalFinishes";
import { FABRICS, fabricById, fabricSwatchStyle, resolvedPartFabrics } from "@/lib/fabrics";
import { Popup } from "@/components/Popup";
import { FixturePreview } from "@/components/FixturePreview";
import type { Obstacle } from "@/lib/types";

/** The same database-driven part picker is used by both element windows. */
export function ComponentColours({ source, onChange, onMaterialsChange, onAppearanceChange, compact = false, previewObstacle, dimensionsContent, onResetDimensions }: { source: ColourSource; onChange: (colours: Record<string, string>) => void; onMaterialsChange?: (materials: Record<string, string>) => void; onAppearanceChange?: (colours: Record<string, string>, materials: Record<string, string>) => void; compact?: boolean; previewObstacle?: Obstacle; dimensionsContent?: ReactNode; onResetDimensions?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const [customFinishOverride, setCustomFinishOverride] = useState("");
  const snapshot = useRef<{ colours: Record<string, string>; materials: Record<string, string> } | null>(null);
  const id = useId();
  const parts = colourPartsFor(source);
  const editableColours = Object.fromEntries(Object.entries(source.component_colors ?? {}).filter(([key]) => key !== GLASS_PART_ID));
  const sourceRecord = source as ColourSource & { id?: string; model_id?: string; name?: string };
  const appearanceObjectName = (previewObstacle?.name ?? sourceRecord.name)?.replace(/^Default /i, "").trim();
  const sourceIdentity = `${sourceRecord.id ?? sourceRecord.model_id ?? ""}|${source.representation_key ?? ""}|${source.fixture_kind ?? ""}|${source.color_hex ?? ""}`;
  useEffect(() => { setSelected(FULL_PART_ID); }, [sourceIdentity]);
  const part = parts.find(part => part.id === selected) ?? parts[0];
  if (!part) return null;
  const colour = colourForPart(source, part);
  const finishKey = `${sourceIdentity}|${part.id}|${colour}`;
  const customFinish = customFinishOverride === finishKey;
  const updateAppearance = (colours: Record<string, string>, materials: Record<string, string> = { ...source.component_materials }) => {
    if (onAppearanceChange) onAppearanceChange(colours, materials);
    else {
      onChange(colours);
      if (onMaterialsChange) onMaterialsChange(materials);
    }
  };
  const isFullPart = part.id === FULL_PART_ID;
  const setColour = (next: string) => {
    setCustomFinishOverride(`${sourceIdentity}|${part.id}|${next}`);
    const colours = { ...editableColours, [part.id]: next };
    if (isFullPart) parts.filter(candidate => candidate.id !== FULL_PART_ID).forEach(candidate => { colours[candidate.id] = next; });
    updateAppearance(colours);
  };
  const textile = part.material_type === "textile";
  const fabricId = resolvedPartFabrics(source)[part.id] ?? "plain";
  const fabric = fabricById(fabricId);
  const showWoodPreset = partSupportsFinish(part, "wood") || (isFullPart && parts.some(candidate => partSupportsFinish(candidate, "wood")));
  const showMetalPreset = partSupportsFinish(part, "metal") || (isFullPart && parts.some(candidate => partSupportsFinish(candidate, "metal")));
  const woodPreset = !customFinish && showWoodPreset ? woodFinishOptions().find(option => option.colorHex.toLowerCase() === colour.toLowerCase()) : undefined;
  const metalPreset = !customFinish && showMetalPreset ? metalFinishForColour(colour) : undefined;
  const materialLabel = textile ? (fabric?.name ?? "Plain finish") : (metalPreset?.name ?? woodPreset?.label ?? "Custom colour");
  const summarySwatchStyle = textile && fabricId !== "plain" ? fabricSwatchStyle(fabricId, colour) : metalPreset ? metalSwatchStyle(colour) : { backgroundColor: colour };

  function applyFinish(value: string) {
    if (!value) { setCustomFinishOverride(finishKey); return; }
    setCustomFinishOverride("");
    const metal = METAL_FINISHES.find(finish => `metal:${finish.id}` === value);
    const wood = woodFinishOptions().find(finish => finish.id === value);
    const nextColour = metal?.colour ?? wood?.colorHex;
    if (!nextColour) return;
    const next = { ...editableColours, [part.id]: nextColour };
    if (isFullPart) {
      // A metal preset on a mixed object affects its fittings, not ceramics or
      // upholstery. Explicitly retain other colours before setting Full part.
      parts.filter(candidate => candidate.id !== FULL_PART_ID).forEach(candidate => {
        next[candidate.id] = partSupportsFinish(candidate, metal ? "metal" : "wood")
          ? nextColour : colourForPart(source, candidate);
      });
    }
    updateAppearance(next);
  }

  function openEditor() {
    snapshot.current = { colours: { ...editableColours }, materials: { ...source.component_materials } };
    setEditorOpen(true);
  }

  function closeEditor(commit: boolean) {
    if (!commit) setCustomFinishOverride("");
    if (!commit && snapshot.current) {
      updateAppearance(snapshot.current.colours, snapshot.current.materials);
    }
    snapshot.current = null;
    setEditorOpen(false);
  }

  const materialField = (showWoodPreset || showMetalPreset) && <label className="field"><span>Material finish</span><select aria-label={part.label + " colour preset"} value={metalPreset ? `metal:${metalPreset.id}` : woodPreset?.id ?? ""} onChange={event => applyFinish(event.target.value)}><option value="">Custom colour</option>{showMetalPreset && <optgroup label="Metals">{METAL_FINISHES.map(finish => <option key={finish.id} value={`metal:${finish.id}`}>{finish.name}</option>)}</optgroup>}{showWoodPreset && <optgroup label="Wood">{woodFinishOptions().map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</optgroup>}</select></label>;
  const colourField = <label className={"field " + (compact ? "appearance-colour-field" : "")}><span>{compact ? "Colour" : part.label + " colour"}</span>{compact ? <span className="appearance-colour-value"><input aria-label={part.label + " colour"} type="color" value={colour} onChange={event => setColour(event.target.value)} /><code>{colour.toUpperCase()}</code></span> : <input aria-label={part.label + " colour"} type="color" value={colour} onChange={event => setColour(event.target.value)} />}</label>;
  const fabricField = textile && (onMaterialsChange || onAppearanceChange) && <div className="fabric-finish-picker">
    <label className="field"><span>Fabric</span><select aria-label={part.label + " fabric"} value={fabricId} onChange={event => { const materials = { ...source.component_materials, [part.id]: event.target.value }; if (isFullPart) parts.filter(candidate => candidate.id !== FULL_PART_ID && candidate.material_type === "textile").forEach(candidate => { materials[candidate.id] = event.target.value; }); updateAppearance({ ...editableColours }, materials); }}><option value="plain">Plain finish</option>{FABRICS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <div className="fabric-finish-preview" style={fabricId === "plain" ? { backgroundColor: colour } : fabricSwatchStyle(fabricId, colour)} aria-label={(fabric?.name ?? "Plain finish") + " in " + colour} />
    <small>{fabric?.description ?? "Smooth colour without a fabric texture."} Choose any colour below.</small>
  </div>;

  const resetAppearanceButton = <button type="button" className="review-style-button colour-reset-button" onClick={() => { setCustomFinishOverride(""); const colours = { ...editableColours }; const materials = { ...source.component_materials }; if (isFullPart) parts.forEach(candidate => { delete colours[candidate.id]; delete materials[candidate.id]; }); else { colours[part.id] = part.default_color_hex; if (textile) delete materials[part.id]; } updateAppearance(colours, materials); }}>{compact ? "Reset appearance" : "Reset " + part.label.toLowerCase() + " to default"}</button>;
  const resetFabricButton = !compact && textile && (onMaterialsChange || onAppearanceChange) && <button type="button" className="review-style-button colour-reset-button" onClick={() => { const next = { ...source.component_materials }; delete next[part.id]; updateAppearance({ ...editableColours }, next); }}>Reset fabric to default</button>;
  const resetDimensionsButton = compact && onResetDimensions && <button type="button" className="review-style-button colour-reset-button" onClick={onResetDimensions}>Reset dimensions</button>;
  const editorFields = <div id={id} className={"fixture-colours-fields " + (compact ? "appearance-editor-fields" : "")}>
      {compact && <div className="appearance-preview-card"><i style={summarySwatchStyle} aria-hidden /><div><strong>{part.label}</strong><span>{materialLabel}</span><code>{colour.toUpperCase()}</code></div></div>}
      <label className="field"><span>{compact ? "Part" : "Component"}</span><select aria-label="Colour component" value={part.id} onChange={event => setSelected(event.target.value)}>{parts.map(part => <option key={part.id} value={part.id}>{part.label}</option>)}</select></label>
    {compact ? <div className="appearance-material-colour-row">{fabricField}{!textile && materialField}{colourField}</div> : <>{fabricField}{materialField}{colourField}</>}
  </div>;

  return <div className={`fixture-colours-controls ${compact ? "fixture-colours-compact" : ""}`} role="group" aria-label={compact ? "Appearance & dimensions" : "Colours"}>
    <button type="button" className="fixture-colours-toggle" aria-expanded={compact ? editorOpen : expanded} aria-controls={compact ? undefined : id} onClick={() => compact ? openEditor() : setExpanded(value => !value)}>
      {compact ? <span className="appearance-summary"><strong>Appearance &amp; dimensions</strong><span className="appearance-summary-detail"><i className="appearance-summary-swatch" style={summarySwatchStyle} aria-hidden /><span><b>{part.label}</b><small>{materialLabel}</small></span></span></span> : <strong>Colours</strong>}
      <span aria-hidden>{compact ? "›" : expanded ? "−" : "+"}</span>
    </button>
    {!compact && expanded && <>{editorFields}{resetAppearanceButton}{resetFabricButton}</>}
    {compact && editorOpen && typeof document !== "undefined" && createPortal(<Popup open className={"appearance-popup" + (appearanceObjectName ? " appearance-popup-has-object" : "")} title="Appearance & dimensions" message="" confirmLabel="Done" onCancel={() => closeEditor(false)} onConfirm={() => closeEditor(true)}>
      <div className={`appearance-popup-grid${previewObstacle ? "" : " appearance-popup-grid-without-preview"}`}>
        <div className="appearance-popup-form">{appearanceObjectName && <div className="appearance-object-heading"><h2>{appearanceObjectName}</h2></div>}{editorFields}{dimensionsContent && <div className="appearance-section-divider" aria-hidden="true" />}{dimensionsContent}{(resetDimensionsButton || resetAppearanceButton) && <><div className="appearance-section-divider" aria-hidden="true" /><div className="appearance-actions-row">{resetAppearanceButton}{resetDimensionsButton}</div></>}</div>
        {previewObstacle && <div className="appearance-popup-preview"><div className="appearance-preview-heading"><strong>Live preview</strong><span>Updates as you edit</span></div><FixturePreview obstacle={previewObstacle} appearanceControls /></div>}
      </div>
    </Popup>, document.body)}
  </div>;
}
