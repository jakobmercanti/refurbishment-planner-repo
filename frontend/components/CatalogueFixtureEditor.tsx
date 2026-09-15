"use client";
import { useEffect, useState } from "react";
import { STAIRCASE_MODELS } from "@/lib/architecturalModels";
import { DisplayNumberInput } from "@/components/DisplayNumberInput";
import { EditableNumberInput } from "@/components/EditableNumberInput";
import { FixturePreview } from "@/components/FixturePreview";
import { alignObstacleToNearestWall } from "@/lib/layoutInteraction";
import { CUSTOM_FINISH_ID, finishChoiceForColour, woodFinishOptions } from "@/lib/finishOptions";
import { UNIT_LABEL, type DisplayUnits } from "@/lib/units";
import type { CatalogueItem, Obstacle, Room } from "@/lib/types";

const ROOM_FIXTURE_KINDS = new Set(["SHOWER", "BASIN", "TOILET", "FURNITURE"]);
const MACRO_CATEGORY_ORDER = ["bathroom", "kitchen", "living", "bedroom", "staircases", "radiators", "other"] as const;
type MacroCategoryId = typeof MACRO_CATEGORY_ORDER[number];
const MACRO_CATEGORY_LABELS: Record<MacroCategoryId, string> = {
  bathroom: "Bathroom fixtures",
  kitchen: "Kitchen",
  living: "Living Room",
  bedroom: "Bedroom",
  staircases: "Staircases",
  radiators: "Radiators",
  other: "Other",
};
type RoomCatalogueItem = CatalogueItem & { fixture_kind: NonNullable<Obstacle["fixture_kind"]> };
type ElementEditRequest = { id: string; roomId: string; requestId: number };
type ComponentColourTarget = "LEGS" | "TABLE_TOP" | "BED_FRAME" | "BEDDING" | "CABINET_STRUCTURE" | "CABINET_FRONT";
type ComponentColourField = "color_hex" | "secondary_color_hex" | "hardware_color_hex";

function componentColourOptionsFor(representationKey?: string): Array<{ id: ComponentColourTarget; label: string }> {
  if (representationKey?.startsWith("furniture-table-")) return [{ id: "LEGS", label: "Legs" }, { id: "TABLE_TOP", label: "Table top" }];
  if (representationKey?.startsWith("furniture-bed-")) return [{ id: "LEGS", label: "Legs" }, { id: "BED_FRAME", label: "Frame" }, { id: "BEDDING", label: "Bedding" }];
  if (representationKey?.startsWith("furniture-kitchen-cabinet-")) return [{ id: "CABINET_STRUCTURE", label: "Structure" }, { id: "CABINET_FRONT", label: "Doors front" }];
  return [];
}

function componentColourFieldFor(target: ComponentColourTarget): ComponentColourField {
  if (target === "LEGS") return "hardware_color_hex";
  if (target === "TABLE_TOP" || target === "BED_FRAME" || target === "CABINET_FRONT") return "color_hex";
  return "secondary_color_hex";
}

function defaultComponentColourFor(target: ComponentColourTarget, catalogueColour?: string): string {
  if (target === "TABLE_TOP") return catalogueColour ?? "#b99b77";
  if (target === "BED_FRAME") return catalogueColour ?? "#b99b77";
  if (target === "CABINET_FRONT") return catalogueColour ?? "#C7B69C";
  if (target === "BEDDING") return "#f2eee5";
  if (target === "CABINET_STRUCTURE") return "#F4F3EE";
  return "#715840";
}

function isRoomFixture(item: CatalogueItem): item is RoomCatalogueItem {
  return ROOM_FIXTURE_KINDS.has(item.fixture_kind);
}
function macroCategoryForCategoryId(categoryId: string): MacroCategoryId {
  if (["showers", "basins", "toilets", "baths", "storage"].includes(categoryId)) return "bathroom";
  if (categoryId.startsWith("kitchen-")) return "kitchen";
  if (categoryId.startsWith("living-")) return "living";
  if (categoryId.startsWith("bedroom-")) return "bedroom";
  if (categoryId.startsWith("radiators-")) return "radiators";
  if (categoryId.startsWith("staircases-")) return "staircases";
  return "other";
}

export function CatalogueFixtureEditor({ room, displayUnits, onChange, apiUrl, refreshKey = 0, elementEditRequest }: {
  room: Room; displayUnits: DisplayUnits; onChange: (items: Obstacle[]) => void; apiUrl: string; refreshKey?: number; elementEditRequest?: ElementEditRequest | null;
}) {
  const [mountingGap, setMountingGap] = useState(550);
  const [baseUnitId, setBaseUnitId] = useState("");
  const [mountingError, setMountingError] = useState("");
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [error, setError] = useState("");
  const [macroCategory, setMacroCategory] = useState<MacroCategoryId>("bathroom");
  const [category, setCategory] = useState("showers");
  const [objectId, setObjectId] = useState("");
  const [finishChoice, setFinishChoice] = useState(CUSTOM_FINISH_ID);
  const [coloursExpanded, setColoursExpanded] = useState(false);
  const [componentColourTarget, setComponentColourTarget] = useState<ComponentColourTarget>("TABLE_TOP");
  const [positionDimensionsExpanded, setPositionDimensionsExpanded] = useState(false);
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
        const componentOptions = componentColourOptionsFor(roomProduct.representation_key);
        if (componentOptions[0]) setComponentColourTarget(componentOptions[0].id);
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
  const currentValue = valueForFixture(existing, draft, selected);
  const bathroomFixture = ["SHOWER", "BASIN", "TOILET"].includes(currentValue?.fixture_kind ?? "") || currentValue?.representation_key?.startsWith("furniture-bath-") === true;
  const showFinishSelector = currentValue?.fixture_kind === "FURNITURE" && !/^furniture-(radiator|bath)-/.test(currentValue?.representation_key ?? "");
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
      base_z_mm: item.representation_key?.startsWith("furniture-kitchen-cabinet-") ? 1500 : 0, rotation_deg: 0, verified: false, source_type: "USER_MEASURED", wall_lock: true,
      color_hex: item.color_hex, stl_filename: item.stl_filename ?? undefined, stl_base64: item.stl_base64 ?? undefined,
      side_clearance_mm: item.side_clearance_mm ?? undefined, front_clearance_mm: item.front_clearance_mm ?? undefined,
    };
  }
  const value = existing ?? draft ?? (selected ? fromCatalogue(selected) : null);
  const stairModel = value?.representation_key ? STAIRCASE_MODELS[value.representation_key] : undefined;
  const cabinet = value?.representation_key?.startsWith("furniture-kitchen-cabinet-");
  const kitchen = value?.representation_key?.startsWith("furniture-kitchen-");
  const componentColourOptions = componentColourOptionsFor(value?.representation_key);
  const activeComponentColourTarget = componentColourOptions.some(option => option.id === componentColourTarget) ? componentColourTarget : componentColourOptions[0]?.id;
  const baseUnits = room.obstacles.filter(item => item.id !== value?.id && item.representation_key?.startsWith("furniture-kitchen-") && !item.representation_key.includes("cabinet-"));
  function componentColourFor(target: ComponentColourTarget): string {
    const field = componentColourFieldFor(target);
    return value?.[field] ?? defaultComponentColourFor(target, selected?.color_hex);
  }
  const selectedComponentColour = activeComponentColourTarget ? componentColourFor(activeComponentColourTarget) : (value?.color_hex ?? "#F4F3EE");
  const selectedFinishChoice = activeComponentColourTarget ? finishChoiceForColour(selectedComponentColour) : finishChoice;
  function change(next: Obstacle) {
    if (next.base_z_mm < 0 || ![next.base_z_mm, next.center.x, next.center.y, next.rotation_deg, ...Object.values(next.dimensions).map(d => d.value)].every(Number.isFinite)
      || Object.values(next.dimensions).some(d => d.value <= 0)) return;
    const positioned = next.wall_lock ? alignObstacleToNearestWall(next, room.vertices, next.center) : next;
    if (existing) onChange(room.obstacles.map(item => item.id === existing.id ? positioned : item));
    else setDraft(positioned);
  }
  function choose(item?: RoomCatalogueItem) {
    if (!item) return;
    setObjectId(item.id); setFinishChoice(finishChoiceForColour(item.color_hex));
    const componentOptions = componentColourOptionsFor(item.representation_key);
    if (componentOptions[0]) setComponentColourTarget(componentOptions[0].id);
    const next = fromCatalogue(item);
    if (existing) change({ ...next, id: existing.id, center: existing.center, rotation_deg: existing.rotation_deg, wall_lock: existing.wall_lock });
    else setDraft(next);
  }
  function changeComponentColour(nextColour: string) {
    if (!value) return;
    if (!activeComponentColourTarget) { change({ ...value, color_hex: nextColour }); return; }
    const field = componentColourFieldFor(activeComponentColourTarget);
    change({ ...value, [field]: nextColour });
  }
  function resetComponentColour() {
    if (!value) return;
    const defaultColour = activeComponentColourTarget ? defaultComponentColourFor(activeComponentColourTarget, selected?.color_hex) : (selected?.color_hex ?? "#F4F3EE");
    setFinishChoice(finishChoiceForColour(defaultColour));
    changeComponentColour(defaultColour);
  }
  return <section className="fixture-editor" aria-label="Add elements">
    {error && <p role="alert">{error}</p>}{!items.length && !error && <p>Loading Object catalogue…</p>}
    <div className="fixture-selectors" style={{ gridTemplateColumns: "1fr" }}>
      <label className="field"><span>Category</span><select value={activeMacroCategory ?? ""} onChange={event => { const nextMacro = event.target.value as MacroCategoryId; const nextCategories = categoriesByMacro.get(nextMacro) ?? []; setMacroCategory(nextMacro); setCategory(nextCategories[0]?.[0] ?? ""); setObjectId(""); setFinishChoice(CUSTOM_FINISH_ID); setDraft(null); setEditingId(null); }}>{availableMacroCategories.map(id => <option key={id} value={id}>{MACRO_CATEGORY_LABELS[id]}</option>)}</select></label>
      <label className="field"><span>Subcategory</span><select value={activeCategory ?? ""} onChange={event => { setCategory(event.target.value); setObjectId(""); setFinishChoice(CUSTOM_FINISH_ID); setDraft(null); setEditingId(null); }}>{macroCategories.map(([id, name]) => <option key={id} value={id}>{id === "storage" ? "Elements" : name}</option>)}</select></label>
      <label className="field"><span>Object</span><select value={selected?.id ?? ""} onChange={event => choose(objects.find(item => item.id === event.target.value))}>{objects.map(item => <option key={item.id} value={item.id}>{item.subcategory} · {item.name}{!item.is_default ? ` · ${item.supplier}` : ""}</option>)}</select></label>
    </div>
    {value && <>
      <div className="fixture-colours-controls" role="group" aria-label="Colours">
        <button type="button" className="fixture-colours-toggle" aria-expanded={coloursExpanded} onClick={() => setColoursExpanded(current => !current)}>
          <strong>Colours</strong><span aria-hidden>{coloursExpanded ? "−" : "+"}</span>
        </button>
        {coloursExpanded && <div className="fixture-colours-fields">
          {componentColourOptions.length > 0 && <label className="field"><span>Component</span><select aria-label="Colour component" value={activeComponentColourTarget ?? componentColourOptions[0].id} onChange={event => setComponentColourTarget(event.target.value as ComponentColourTarget)}>{componentColourOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>}
          {!bathroomFixture && (showFinishSelector ? <label className="field"><span>{componentColourOptions.length > 0 ? "Colour" : stairModel ? "Treads" : cabinet ? "Cabinet fronts" : "Colour"}</span><select aria-label="Element colour" value={selectedFinishChoice} onChange={(event) => {
            const nextChoice = event.target.value;
            setFinishChoice(nextChoice);
            if (nextChoice === CUSTOM_FINISH_ID) return;
            const nextColour = woodColourOptions.find((option) => option.id === nextChoice)?.colorHex;
            if (nextColour) changeComponentColour(nextColour);
          }}><option value={CUSTOM_FINISH_ID}>Custom colour</option>{woodColourOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label> : <>
            <label className="field"><span>{stairModel ? "Treads" : "Colour"}</span><input type="color" value={selectedComponentColour} onChange={event => changeComponentColour(event.target.value)} /></label>
            <button type="button" className="review-style-button colour-reset-button" onClick={resetComponentColour}>Reset to default</button>
          </>)}
          {bathroomFixture ? <label className="field"><span>Taps and faucets</span><input type="color" value={value.hardware_color_hex ?? "#B6BABB"} onChange={event => change({ ...value, hardware_color_hex: event.target.value })} /></label> : (stairModel || (kitchen && !cabinet)) && <div className="fixture-field-group"><span>Component colours</span>
            {stairModel && !stairModel.glass && <label className="field"><span>Handrail and balusters</span><input type="color" value={value.handrail_color_hex ?? "#725236"} onChange={event => change({ ...value, handrail_color_hex: event.target.value })} /></label>}
            {stairModel?.glass && <p>Clear glass guarding remains uncoloured.</p>}
            {(!stairModel || !stairModel.open) && <label className="field"><span>{stairModel ? "Wall below staircase" : "Worktop"}</span><input type="color" value={value.secondary_color_hex ?? (stairModel ? "#e5ded2" : "#77736B")} onChange={event => change({ ...value, secondary_color_hex: event.target.value })} /></label>}
            <label className="field"><span>{stairModel ? "Stair structure" : "Handles and metal fittings"}</span><input type="color" value={value.hardware_color_hex ?? (stairModel ? "#465052" : "#B6BABB")} onChange={event => change({ ...value, hardware_color_hex: event.target.value })} /></label>
          </div>}
          {!bathroomFixture && showFinishSelector && selectedFinishChoice === CUSTOM_FINISH_ID && <>
            <label className="field"><span>Custom colour</span><input aria-label="Custom colour" type="color" value={selectedComponentColour} onChange={event => changeComponentColour(event.target.value)} /></label>
            <button type="button" className="review-style-button colour-reset-button" onClick={resetComponentColour}>Reset to default</button>
          </>}
        </div>}
      </div>
      {!value.stl_base64 && <FixturePreview obstacle={value} />}
      <div className="fixture-colours-controls fixture-position-controls" role="group" aria-label="Position and dimensions">
        <button type="button" className="fixture-colours-toggle" aria-expanded={positionDimensionsExpanded} onClick={() => setPositionDimensionsExpanded(current => !current)}>
          <strong>Position and dimensions</strong><span aria-hidden>{positionDimensionsExpanded ? "−" : "+"}</span>
        </button>
        {positionDimensionsExpanded && <div className="fixture-colours-fields">
          {stairModel && <label className="field"><span>Floor-to-floor rise {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput units={displayUnits} minMm={1} valueMm={value.dimensions.height.value * Math.max(...stairModel.steps.map(step => step.top)) / stairModel.height} onMmChange={rise => change({ ...value, verified: false, dimensions: { ...value.dimensions, height: { ...value.dimensions.height, value: rise * stairModel.height / Math.max(...stairModel.steps.map(step => step.top)), verified: false, source_type: "USER_MEASURED" } } })} /><small>Stretches the flight and guarding together. Overall height below includes guarding.</small></label>}
          <label className="field"><span>{cabinet ? "Mounting height above floor" : "Base height above floor"} {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput units={displayUnits} minMm={0} valueMm={value.base_z_mm} onMmChange={base_z_mm => change({ ...value, base_z_mm })} /></label>
          {cabinet && <div className="fixture-field-group"><span>Place above a lower kitchen element</span>
            <label className="field"><span>Lower element</span><select value={baseUnitId} onChange={event => setBaseUnitId(event.target.value)}><option value="">Select an element</option>{baseUnits.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="field"><span>Gap above lower element {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput units={displayUnits} minMm={0} valueMm={mountingGap} onMmChange={setMountingGap} /></label>
            <button type="button" disabled={!baseUnitId} onClick={() => {
              const base = baseUnits.find(item => item.id === baseUnitId); if (!base) return;
              const base_z_mm = base.base_z_mm + base.dimensions.height.value + mountingGap;
              if (base_z_mm + value.dimensions.height.value > room.wall_height.value) { setMountingError("This cabinet would exceed the room height. Reduce the gap or cabinet height."); return; }
              setMountingError(""); const angle = base.rotation_deg * Math.PI / 180, shift = (base.dimensions.depth.value - value.dimensions.depth.value) / 2;
              change({ ...value, base_z_mm, rotation_deg: base.rotation_deg, center: { x: base.center.x - Math.sin(angle) * shift, y: base.center.y + Math.cos(angle) * shift }, wall_lock: base.wall_lock, dimensions: { ...value.dimensions, width: { ...value.dimensions.width, value: base.dimensions.width.value, verified: false, source_type: "USER_MEASURED" } } });
            }}>Match width and align above</button>
            {mountingError && <p role="alert">{mountingError}</p>}
          </div>}
          <div className="fixture-field-group"><span>Position</span><div className="fixture-fields three-columns">
            {(["x", "y"] as const).map(axis => <label className="field" key={axis}><span>{axis.toUpperCase()} {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput valueMm={value.center[axis]} units={displayUnits} onMmChange={n => change({ ...value, center: { ...value.center, [axis]: n } })} /></label>)}
            <label className="field"><span>Rotation °</span><EditableNumberInput value={value.rotation_deg} onValueChange={rotation_deg => change({ ...value, rotation_deg })} /></label>
          </div></div>
          <label className="fixture-lock-choice"><input type="checkbox" checked={value.wall_lock ?? false} onChange={event => change({ ...value, wall_lock: event.target.checked })} />Keep adjacent to nearest wall</label>
          <div className="fixture-field-group"><span>Dimensions</span><div className="fixture-fields three-columns">
            {(["width", "depth", "height"] as const).map(axis => <label className="field" key={axis}><span>{axis[0].toUpperCase() + axis.slice(1)} {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput minMm={1} valueMm={value.dimensions[axis].value} units={displayUnits} onMmChange={n => change({ ...value, verified: false, dimensions: { ...value.dimensions, [axis]: { ...value.dimensions[axis], value: n, verified: false, source_type: "USER_MEASURED" } } })} /></label>)}
          </div></div>
        </div>}
      </div>
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
