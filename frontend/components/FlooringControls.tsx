"use client";

import { useId, useMemo } from "react";
import { defaultFloorDesign, FLOORING_PATTERNS, flooringSwatch, normalizeFloorDesign, WOOD_COLOURS, TILE_MATERIALS, type FloorDesign, type FlooringPattern } from "@/lib/flooring";

export function FlooringPatternDefinition({ id, design, scale = 1, origin = { x: 0, y: 0 }, flipY = false }: {
  id: string; design: FloorDesign; scale?: number; origin?: { x: number; y: number }; flipY?: boolean;
}) {
  const swatch = useMemo(() => flooringSwatch(design), [design]);
  return <pattern id={id} patternUnits="userSpaceOnUse" width={swatch.width} height={swatch.height}
    patternTransform={`translate(${origin.x} ${origin.y}) scale(${scale} ${flipY ? -scale : scale}) rotate(${normalizeFloorDesign(design).rotation_deg})${swatch.diagonal ? " matrix(1 -1 1 1 0 0)" : ""}`}>
    <image href={swatch.url} width={swatch.width} height={swatch.height} preserveAspectRatio="none" />
  </pattern>;
}

export function FlooringPreview({ design }: { design: FloorDesign }) {
  const id = `floor-preview-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const extent = Math.max(design.length_mm * 2, design.width_mm * 4);
  return <svg viewBox={`0 0 ${extent} ${extent}`} role="img" aria-label="Flooring pattern preview" style={{ width: "100%", aspectRatio: "1", display: "block", borderRadius: 8 }}>
    <defs><FlooringPatternDefinition id={id} design={design} /></defs><rect width={extent} height={extent} fill={`url(#${id})`} />
  </svg>;
}

function DimensionInput({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  // Commit on blur/Enter so intermediate typing ("", "1", "12") never shrinks a floor element.
  return <label className="field"><span>{label}</span><input key={value} aria-label={label} type="number" defaultValue={value} min={min} max={max} step="any"
    onBlur={(event) => { const next = event.currentTarget.valueAsNumber; if (Number.isFinite(next) && next >= min && next <= max) onChange(next); else event.currentTarget.value = String(value); }}
    onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } if (event.key === "Escape") { event.currentTarget.value = String(value); event.currentTarget.blur(); } }} /></label>;
}

export function FlooringControls({ design: saved, onChange }: { design?: FloorDesign; onChange: (design: FloorDesign) => void }) {
  const design = saved ? normalizeFloorDesign(saved) : defaultFloorDesign();
  const wood = design.pattern.startsWith("wood-");
  const flooringType = wood ? "wood" : "tile";
  const availablePatterns = FLOORING_PATTERNS.filter((pattern) => pattern.material === flooringType);
  const update = (patch: Partial<FloorDesign>) => onChange(normalizeFloorDesign({ ...design, ...patch }));
  return <div className="flooring-controls">
    <label className="field"><span>Flooring type</span><select aria-label="Flooring type" value={saved ? flooringType : ""} onChange={(event) => {
      const type = event.target.value as "tile" | "wood";
      const next = defaultFloorDesign(FLOORING_PATTERNS.find((pattern) => pattern.material === type)!.id);
      onChange({ ...next, rotation_deg: design.rotation_deg, wood_id: design.wood_id, tile_colour: design.tile_colour, tile_material_id: design.tile_material_id });
    }}><option value="" disabled>Choose a flooring type</option><option value="tile">Tiles</option><option value="wood">Wooden flooring</option></select></label>
    <label className="field"><span>Flooring pattern</span><select aria-label="Flooring pattern" value={saved ? design.pattern : ""} onChange={(event) => {
      const next = defaultFloorDesign(event.target.value as FlooringPattern);
      onChange({ ...next, rotation_deg: design.rotation_deg, wood_id: design.wood_id, tile_colour: design.tile_colour, tile_material_id: design.tile_material_id });
    }}><option value="" disabled>Choose a flooring pattern</option>{availablePatterns.map((pattern) => <option key={pattern.id} value={pattern.id}>{pattern.name}</option>)}</select></label>
    {saved && <>
      {!wood && <label className="field"><span>Tile material</span><select aria-label="Tile material" value={design.tile_material_id ?? ""} onChange={(event) => {
        const material = TILE_MATERIALS.find((tile) => tile.id === event.target.value);
        update({ tile_material_id: material?.id, ...(material ? { tile_colour: material.colour } : {}) });
      }}><option value="">Custom colour</option>{TILE_MATERIALS.map((tile) => <option key={tile.id} value={tile.id}>{tile.name}</option>)}</select></label>}
      <div style={{ maxWidth: 190, margin: "12px auto" }}><FlooringPreview design={design} /></div>
      <DimensionInput label="Rotation (degrees)" value={design.rotation_deg} min={-36000} max={36000} onChange={(rotation_deg) => update({ rotation_deg })} />
      <DimensionInput label={design.pattern === "wood-hexagonal" ? "Hexagon point-to-point size (mm)" : design.pattern === "wood-versailles" ? "Border / board width (mm)" : "Element width (mm)"} value={design.width_mm} min={20} max={3000} onChange={(width_mm) => update({ width_mm })} />
      {!["tile-square", "wood-hexagonal"].includes(design.pattern) && <DimensionInput label={design.pattern === "wood-versailles" ? "Panel size (mm)" : "Element length (mm)"} value={design.length_mm} min={design.width_mm} max={6000} onChange={(length_mm) => update({ length_mm })} />}
      {wood ? <label className="field"><span>Wood colour</span><select aria-label="Wood colour" value={design.wood_id} onChange={(event) => update({ wood_id: event.target.value })}>{WOOD_COLOURS.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label> : <label className="field"><span>Tile colour</span><input aria-label="Tile colour" type="color" value={design.tile_colour} onChange={(event) => update({ tile_colour: event.target.value })} /></label>}
      <label className="field"><span>{wood ? "Joint colour" : "Grout colour"}</span><input aria-label={wood ? "Joint colour" : "Grout colour"} type="color" value={design.grout_colour} onChange={(event) => update({ grout_colour: event.target.value })} /></label>
      <button type="button" className="review-style-button colour-reset-button" onClick={() => {
        const defaults = defaultFloorDesign(design.pattern);
        update({ wood_id: defaults.wood_id, tile_colour: defaults.tile_colour, grout_colour: defaults.grout_colour });
      }}>Reset colours to default</button>
      <DimensionInput label={wood ? "Joint width (mm)" : "Grout width (mm)"} value={design.grout_mm} min={0} max={Math.min(20, design.width_mm / 4)} onChange={(grout_mm) => update({ grout_mm })} />
      <small>Sizes are in millimetres. Edge pieces are cut to fit; wood shades and grain are illustrative.</small>
    </>}
  </div>;
}
