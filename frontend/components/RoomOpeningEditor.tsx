"use client";
import { useState } from "react";
import { DisplayNumberInput } from "@/components/DisplayNumberInput";
import { OpeningPreview } from "@/components/OpeningPreview";
import { CUSTOM_FINISH_ID, finishChoiceForColour, woodFinishOptions } from "@/lib/finishOptions";
import { doorModel } from "@/lib/doorModels";
import { cornerOffsetsOnWallSegment, isOpeningPlacementValid } from "@/lib/openingPlacement";
import type { CatalogueItem, Opening, Room } from "@/lib/types";
import { UNIT_LABEL, type DisplayUnits } from "@/lib/units";

/** Edits openings in imported standalone rooms, which have no full-plan wall record. */
export function RoomOpeningEditor({ room, opening, items, units, onChange }: { room: Room; opening: Opening; items: CatalogueItem[]; units: DisplayUnits; onChange: (room: Room) => void }) {
  const [draft, setDraft] = useState(opening);
  const [finish, setFinish] = useState(finishChoiceForColour(typeof opening.metadata?.color_hex === "string" ? opening.metadata.color_hex : undefined));
  const [error, setError] = useState("");
  const variants = items.filter(item => item.fixture_kind === draft.kind);
  const item = variants.find(item => item.id === draft.metadata?.catalogue_item_id) ?? variants.find(item => item.representation_key && item.representation_key === draft.metadata?.representation_key);
  const colour = typeof draft.metadata?.color_hex === "string" ? draft.metadata.color_hex : item?.color_hex ?? "#F4F3EE";
  const metadata = (value: Record<string, unknown>) => setDraft(current => ({ ...current, metadata: { ...current.metadata, ...value } }));
  function save() {
    const index = Number(draft.parent_wall_id.split("-")[1]) - 1;
    const start = room.vertices[index], end = room.vertices[(index + 1) % room.vertices.length];
    const width = draft.width.value, height = draft.height.value, offset = draft.offset_mm, sill = draft.sill_height_mm;
    if (!start || !end || ![width, height, offset, sill].every(Number.isFinite) || width <= 0 || height <= 0 || offset < 0 || sill < 0 || offset + width > Math.hypot(end.x - start.x, end.y - start.y) || sill + height > room.wall_height.value) { setError("The opening must fit within the wall, with positive dimensions and a non-negative offset and sill."); return; }
    const blockers = room.openings.filter(other => other.id !== draft.id && other.parent_wall_id === draft.parent_wall_id).map(other => ({ offset: other.offset_mm, width: other.width.value }));
    if (!isOpeningPlacementValid(offset, width, Math.hypot(end.x - start.x, end.y - start.y), cornerOffsetsOnWallSegment(start, end, room.vertices), blockers, 50)) { setError("Keep the opening at least 50 mm clear of corners and other openings."); return; }
    setError(""); onChange({ ...room, version: room.version + 1, openings: room.openings.map(other => other.id === draft.id ? draft : other) });
  }
  return <section className="tool-section full-plan-openings-panel" aria-label="Edit opening">
    <label className="field"><span>{draft.kind === "DOOR" ? "Door" : "Window"} type</span><select value={item?.id ?? ""} onChange={event => {
      const next = variants.find(item => item.id === event.target.value); if (!next) return;
      setDraft({ ...draft, width: { ...draft.width, value: next.width_mm, verified: false }, height: { ...draft.height, value: next.height_mm, verified: false }, door_type: (doorModel(next.representation_key)?.leaves ?? 1) > 1 ? "DOUBLE" : "SINGLE", metadata: { ...draft.metadata, representation_key: next.representation_key, catalogue_item_id: next.id, window_depth_mm: next.depth_mm, color_hex: next.color_hex } });
      setFinish(finishChoiceForColour(next.color_hex));
    }}><option value="" disabled>Current model</option>{variants.map(item => <option key={item.id} value={item.id}>{item.category_name} · {item.name}</option>)}</select></label>
    <OpeningPreview item={item} kind={draft.kind === "WINDOW" ? "WINDOW" : "DOOR"} doorType={draft.door_type} width={draft.width.value} height={draft.height.value} colorHex={colour} />
    <label className="field"><span>Parent wall</span><select value={draft.parent_wall_id} onChange={event => setDraft({ ...draft, parent_wall_id: event.target.value })}>{room.vertices.map((_, index) => <option key={index} value={`wall-${String(index + 1).padStart(3, "0")}`}>Wall {index + 1}</option>)}</select></label>
    {(["width", "height"] as const).map(key => <label className="field" key={key}><span>{key} {UNIT_LABEL[units]}</span><DisplayNumberInput units={units} minMm={1} valueMm={draft[key].value} onMmChange={value => setDraft({ ...draft, [key]: { ...draft[key], value, verified: false, source_type: "USER_MEASURED" } })} /></label>)}
    <label className="field"><span>Offset {UNIT_LABEL[units]}</span><DisplayNumberInput units={units} minMm={0} valueMm={draft.offset_mm} onMmChange={offset_mm => setDraft({ ...draft, offset_mm })} /></label>
    {draft.kind === "WINDOW" ? <label className="field"><span>Sill {UNIT_LABEL[units]}</span><DisplayNumberInput units={units} minMm={0} valueMm={draft.sill_height_mm} onMmChange={sill_height_mm => setDraft({ ...draft, sill_height_mm })} /></label> : <>
      <label className="field"><span>Hinge side</span><select disabled={draft.door_type === "DOUBLE"} value={draft.hinge_side ?? "START"} onChange={event => setDraft({ ...draft, hinge_side: event.target.value as "START" | "END" })}><option value="START">Wall start</option><option value="END">Wall end</option></select></label>
      <label className="field"><span>Direction</span><select value={draft.opens_inward === false ? "OUT" : "IN"} onChange={event => setDraft({ ...draft, opens_inward: event.target.value === "IN" })}><option value="IN">Into room</option><option value="OUT">Out of room</option></select></label>
    </>}
    <label className="field"><span>Colour</span><select value={finish} onChange={event => { setFinish(event.target.value); const wood = woodFinishOptions().find(item => item.id === event.target.value); if (wood) metadata({ color_hex: wood.colorHex }); }}><option value={CUSTOM_FINISH_ID}>Custom colour</option>{woodFinishOptions().map(wood => <option key={wood.id} value={wood.id}>{wood.label}</option>)}</select></label>
    {finish === CUSTOM_FINISH_ID && <label className="field"><span>Custom colour</span><input type="color" value={colour} onChange={event => metadata({ color_hex: event.target.value })} /></label>}
    {error && <p role="alert" className="inline-error">{error}</p>}
    <button type="button" className="primary-small" onClick={save}>Update {draft.kind.toLowerCase()}</button>
    <button type="button" onClick={() => onChange({ ...room, version: room.version + 1, openings: room.openings.filter(other => other.id !== opening.id) })}>Remove {draft.kind.toLowerCase()}</button>
  </section>;
}
