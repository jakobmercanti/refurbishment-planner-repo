"use client";
import { useEffect, useState } from "react";
import { DisplayNumberInput } from "@/components/DisplayNumberInput";
import { EditableNumberInput } from "@/components/EditableNumberInput";
import { FixturePreview } from "@/components/FixturePreview";
import { alignObstacleToNearestWall } from "@/lib/layoutInteraction";
import { CUSTOM_FINISH_ID, finishChoiceForColour, woodFinishOptions } from "@/lib/finishOptions";
import { UNIT_LABEL, type DisplayUnits } from "@/lib/units";
import type { CatalogueItem, Obstacle, Room } from "@/lib/types";

const ROOM_FIXTURE_KINDS = new Set(["SHOWER", "BASIN", "TOILET", "FURNITURE"]);
const MACRO_CATEGORY_ORDER = ["bathroom", "kitchen", "living", "bedroom", "staircases", "other"] as const;
type MacroCategoryId = typeof MACRO_CATEGORY_ORDER[number];
const MACRO_CATEGORY_LABELS: Record<MacroCategoryId, string> = {
  bathroom: "Bathroom fixtures",
  kitchen: "Kitchen",
  living: "Living Room",
  bedroom: "Bedroom",
  staircases: "Staircases",
  other: "Other",
};
type RoomCatalogueItem = CatalogueItem & { fixture_kind: NonNullable<Obstacle["fixture_kind"]> };
type ElementEditRequest = { id: string; roomId: string; requestId: number };
function isRoomFixture(item: CatalogueItem): item is RoomCatalogueItem {
  return ROOM_FIXTURE_KINDS.has(item.fixture_kind);
}
function macroCategoryForCategoryId(categoryId: string): MacroCategoryId {
  if (["showers", "basins", "toilets", "storage"].includes(categoryId)) return "bathroom";
  if (categoryId.startsWith("kitchen-")) return "kitchen";
  if (categoryId.startsWith("living-")) return "living";
  if (categoryId.startsWith("bedroom-")) return "bedroom";
  if (categoryId.startsWith("staircases-")) return "staircases";
  return "other";
}

export function CatalogueFixtureEditor({ room, displayUnits, onChange, apiUrl, refreshKey = 0, elementEditRequest }: {
  room: Room; displayUnits: DisplayUnits; onChange: (items: Obstacle[]) => void; apiUrl: string; refreshKey?: number; elementEditRequest?: ElementEditRequest | null;
}) {
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [error, setError] = useState("");
  const [macroCategory, setMacroCategory] = useState<MacroCategoryId>("bathroom");
  const [category, setCategory] = useState("showers");
  const [objectId, setObjectId] = useState("");
  const [finishChoice, setFinishChoice] = useState(CUSTOM_FINISH_ID);
  const [draft, setDraft] = useState<Obstacle | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => { void fetch(`${apiUrl}/catalog/items`, { signal: controller.signal, cache: "no-store" })
      .then(response => { if (!response.ok) throw new Error("Object catalogue is unavailable."); return response.json() as Promise<CatalogueItem[]>; })
      .then(records => { setItems(records); setError(""); })
      .catch(reason => { if (!controller.signal.aborted) setError(String(reason)); }); };
    refresh(); window.addEventListener("focus", refresh); window.addEventListener("catalogue-changed", refresh);
    return () => { controller.abort(); window.removeEventListener("focus", refresh); window.removeEventListener("catalogue-changed", refresh); };
  }, [apiUrl, refreshKey]);
  useEffect(() => {
    if (!elementEditRequest || elementEditRequest.roomId !== room.id) return;
    const item = room.obstacles.find((obstacle) => obstacle.id === elementEditRequest.id);
    if (!item) return;
    const product = items.find((candidate) => candidate.id === item.model_id);
    const roomProduct = product && isRoomFixture(product) ? product : null;
    const frame = window.requestAnimationFrame(() => {
      if (roomProduct) {
        setMacroCategory(macroCategoryForCategoryId(roomProduct.category_id));
        setCategory(roomProduct.category_id);
        setObjectId(roomProduct.id);
        setFinishChoice(roomProduct.fixture_kind === "FURNITURE" ? finishChoiceForColour(item.color_hex) : CUSTOM_FINISH_ID);
      }
      setEditingId(item.id);
      setDraft(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [elementEditRequest, items, room.id, room.obstacles]);
  useEffect(() => {
    if (!elementEditRequest || elementEditRequest.roomId !== room.id || editingId !== elementEditRequest.id) return;
    const frame = window.requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`[data-element-id="${elementEditRequest.id}"]`);
      row?.scrollIntoView({ block: "nearest" });
      row?.querySelector<HTMLButtonElement>("button")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingId, elementEditRequest, room.id]);
  const fixtureItems = items.filter(isRoomFixture);
  const categories = [...new Map(fixtureItems.map(item => [item.category_id, item.category_name])).entries()];
  const categoriesByMacro = new Map<MacroCategoryId, Array<[string, string]>>();
  categories.forEach((entry) => {
    const macroId = macroCategoryForCategoryId(entry[0]);
    categoriesByMacro.set(macroId, [...(categoriesByMacro.get(macroId) ?? []), entry]);
  });
  const availableMacroCategories = MACRO_CATEGORY_ORDER.filter((id) => categoriesByMacro.has(id));
  const activeMacroCategory = availableMacroCategories.includes(macroCategory) ? macroCategory : availableMacroCategories[0];
  const macroCategories = activeMacroCategory ? categoriesByMacro.get(activeMacroCategory) ?? [] : [];
  const activeCategory = macroCategories.some(([id]) => id === category) ? category : macroCategories[0]?.[0];
  const family = fixtureItems.filter(item => item.category_id === activeCategory);
  // `subcategory` is an Object catalogue grouping, not a second family. The
  // previous filter selected only the first grouping (for example, the
  // 4-person table) and hid every sibling entry from the editor.
  const objects = [...family].sort((a, b) => a.subcategory.localeCompare(b.subcategory) || Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name));
  const selected = objects.find(item => item.id === objectId) ?? objects[0];
  const existing = room.obstacles.find(item => item.id === editingId);
  const woodColourOptions = woodFinishOptions();
  const showFinishSelector = valueForFixture(existing, draft, selected)?.fixture_kind === "FURNITURE";
  function valueForFixture(current: Obstacle | undefined, pending: Obstacle | null, catalogueItem?: RoomCatalogueItem) {
    return current ?? pending ?? catalogueItem;
  }
  function fromCatalogue(item: RoomCatalogueItem): Obstacle {
    const measured = (value: number) => ({ value, uncertainty_mm: 5, verified: false, source_type: "USER_MEASURED" });
    return {
      id: "draft", name: item.name,
      kind: item.plan_shape === "ELLIPSE" ? "CYLINDER" : "BOX", fixture_kind: item.fixture_kind,
      model_id: item.id, plan_symbol_data_url: item.plan_symbol_data_url, representation_key: item.representation_key, subcategory: item.subcategory, plan_symbol_url: item.plan_symbol_url,
      center: { x: (Math.min(...room.vertices.map(p => p.x)) + Math.max(...room.vertices.map(p => p.x))) / 2, y: (Math.min(...room.vertices.map(p => p.y)) + Math.max(...room.vertices.map(p => p.y))) / 2 },
      dimensions: { width: measured(item.width_mm), depth: measured(item.depth_mm), height: measured(item.height_mm) },
      base_z_mm: 0, rotation_deg: 0, verified: false, source_type: "USER_MEASURED", wall_lock: true,
      color_hex: item.color_hex, stl_filename: item.stl_filename ?? undefined, stl_base64: item.stl_base64 ?? undefined,
      side_clearance_mm: item.side_clearance_mm ?? undefined, front_clearance_mm: item.front_clearance_mm ?? undefined,
    };
  }
  const value = existing ?? draft ?? (selected ? fromCatalogue(selected) : null);
  function change(next: Obstacle) {
    if (![next.center.x, next.center.y, next.rotation_deg, ...Object.values(next.dimensions).map(d => d.value)].every(Number.isFinite)
      || Object.values(next.dimensions).some(d => d.value <= 0)) return;
    const positioned = next.wall_lock ? alignObstacleToNearestWall(next, room.vertices, next.center) : next;
    if (existing) onChange(room.obstacles.map(item => item.id === existing.id ? positioned : item));
    else setDraft(positioned);
  }
  function choose(item?: RoomCatalogueItem) {
    if (!item) return;
    setObjectId(item.id); setFinishChoice(finishChoiceForColour(item.color_hex)); const next = fromCatalogue(item);
    if (existing) change({ ...next, id: existing.id, center: existing.center, rotation_deg: existing.rotation_deg, wall_lock: existing.wall_lock });
    else setDraft(next);
  }
  return <section className="fixture-editor" aria-label="Add elements">
    <div className="fixture-heading"><h2>{existing ? "Edit element · live" : "Add element"}</h2><span>{room.obstacles.length} placed</span></div>
    {error && <p role="alert">{error}</p>}{!items.length && !error && <p>Loading Object catalogue…</p>}
    <div className="fixture-selectors" style={{ gridTemplateColumns: "1fr" }}>
      <label className="field"><span>Category</span><select value={activeMacroCategory ?? ""} onChange={event => { const nextMacro = event.target.value as MacroCategoryId; const nextCategories = categoriesByMacro.get(nextMacro) ?? []; setMacroCategory(nextMacro); setCategory(nextCategories[0]?.[0] ?? ""); setObjectId(""); setFinishChoice(CUSTOM_FINISH_ID); setDraft(null); setEditingId(null); }}>{availableMacroCategories.map(id => <option key={id} value={id}>{MACRO_CATEGORY_LABELS[id]}</option>)}</select></label>
      <label className="field"><span>Subcategory</span><select value={activeCategory ?? ""} onChange={event => { setCategory(event.target.value); setObjectId(""); setFinishChoice(CUSTOM_FINISH_ID); setDraft(null); setEditingId(null); }}>{macroCategories.map(([id, name]) => <option key={id} value={id}>{id === "storage" ? "Elements" : name}</option>)}</select></label>
      <label className="field"><span>Object</span><select value={selected?.id ?? ""} onChange={event => choose(objects.find(item => item.id === event.target.value))}>{objects.map(item => <option key={item.id} value={item.id}>{item.subcategory} · {item.name}{!item.is_default ? ` · ${item.supplier}` : ""}</option>)}</select></label>
    </div>
    {value && <>
      {showFinishSelector ? <label className="field"><span>Colour</span><select aria-label="Element colour" value={finishChoice} onChange={(event) => {
        const nextChoice = event.target.value;
        setFinishChoice(nextChoice);
        if (nextChoice === CUSTOM_FINISH_ID) return;
        const nextColour = woodColourOptions.find((option) => option.id === nextChoice)?.colorHex;
        if (nextColour) change({ ...value, color_hex: nextColour });
      }}><option value={CUSTOM_FINISH_ID}>Custom colour</option>{woodColourOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label> : <>
        <label className="field"><span>Colour</span><input type="color" value={value.color_hex ?? "#F4F3EE"} onChange={event => change({ ...value, color_hex: event.target.value })} /></label>
        <button type="button" className="review-style-button colour-reset-button" onClick={() => change({ ...value, color_hex: selected?.color_hex ?? "#F4F3EE" })}>Reset to default</button>
      </>}
      {!value.stl_base64 && <FixturePreview obstacle={value} />}
      <div className="fixture-field-group"><span>Position</span><div className="fixture-fields three-columns">
        {(["x", "y"] as const).map(axis => <label className="field" key={axis}><span>{axis.toUpperCase()} {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput valueMm={value.center[axis]} units={displayUnits} onMmChange={n => change({ ...value, center: { ...value.center, [axis]: n } })} /></label>)}
        <label className="field"><span>Rotation °</span><EditableNumberInput value={value.rotation_deg} onValueChange={rotation_deg => change({ ...value, rotation_deg })} /></label>
      </div></div>
      <label className="fixture-lock-choice"><input type="checkbox" checked={value.wall_lock ?? false} onChange={event => change({ ...value, wall_lock: event.target.checked })} />Keep adjacent to nearest wall</label>
      <div className="fixture-field-group"><span>Dimensions</span><div className="fixture-fields three-columns">
        {(["width", "depth", "height"] as const).map(axis => <label className="field" key={axis}><span>{axis[0].toUpperCase() + axis.slice(1)} {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput minMm={1} valueMm={value.dimensions[axis].value} units={displayUnits} onMmChange={n => change({ ...value, verified: false, dimensions: { ...value.dimensions, [axis]: { ...value.dimensions[axis], value: n, verified: false, source_type: "USER_MEASURED" } } })} /></label>)}
      </div></div>
      {showFinishSelector && finishChoice === CUSTOM_FINISH_ID && <>
        <label className="field"><span>Custom colour</span><input aria-label="Custom colour" type="color" value={value.color_hex ?? "#F4F3EE"} onChange={event => change({ ...value, color_hex: event.target.value })} /></label>
        <button type="button" className="review-style-button colour-reset-button" onClick={() => { const defaultColour = selected?.color_hex ?? "#F4F3EE"; setFinishChoice(finishChoiceForColour(defaultColour)); change({ ...value, color_hex: defaultColour }); }}>Reset to default</button>
      </>}
      <button className="fixture-save" disabled={!!error} onClick={() => {
        if (existing) { setEditingId(null); setDraft(null); return; }
        const next = { ...value, id: `fixture-${crypto.randomUUID()}` };
        onChange([...room.obstacles, next.wall_lock ? alignObstacleToNearestWall(next, room.vertices, next.center) : next]);
        setEditingId(next.id); setDraft(null);
      }}>{existing ? "Done" : "Add element"}</button>
    </>}
    <div className="fixture-list">{room.obstacles.map(item => <article key={item.id} data-element-id={item.id} className={item.id === editingId ? "editing" : ""}>
      <strong>{item.name}</strong><button onClick={() => { const product = items.find(p => p.id === item.model_id); if (product && isRoomFixture(product)) { setMacroCategory(macroCategoryForCategoryId(product.category_id)); setCategory(product.category_id); setObjectId(product.id); setFinishChoice(product.fixture_kind === "FURNITURE" ? finishChoiceForColour(item.color_hex) : CUSTOM_FINISH_ID); } setEditingId(item.id); }}>Edit</button>
      <button aria-label={`Remove ${item.name}`} onClick={() => { onChange(room.obstacles.filter(p => p.id !== item.id)); if (item.id === editingId) setEditingId(null); }}>×</button>
    </article>)}</div>
  </section>;
}
