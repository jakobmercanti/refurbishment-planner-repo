"use client";
import { useEffect, useState } from "react";
import { STAIRCASE_MODELS } from "@/lib/architecturalModels";
import { ComponentColours } from "@/components/ComponentColours";
import { DisplayNumberInput } from "@/components/DisplayNumberInput";
import { EditableNumberInput } from "@/components/EditableNumberInput";
import { FixturePreview } from "@/components/FixturePreview";
import { constrainObstacleToRoom, type PlacementRequest, type PlacementWall } from "@/lib/elementPlacement";
import { formatLength, UNIT_LABEL, type DisplayUnits } from "@/lib/units";
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

export function CatalogueFixtureEditor({ room, displayUnits, onChange, apiUrl, refreshKey = 0, elementEditRequest, onEditEnd, onElementSelected, onBeginPlacement, placementWalls = [] }: {
  placementWalls?: PlacementWall[];
  onBeginPlacement?: (request: PlacementRequest) => void;
  onEditEnd?: () => void;
  onElementSelected?: (selection: { id: string; roomId: string } | null) => void;
  room: Room; displayUnits: DisplayUnits; onChange: (items: Obstacle[]) => void; apiUrl: string; refreshKey?: number; elementEditRequest?: ElementEditRequest | null;
}) {
  const roomWalls = room.source_floorplan_room_id ? placementWalls : [];
  const [mountingGap, setMountingGap] = useState(550);
  const [baseUnitId, setBaseUnitId] = useState("");
  const [mountingError, setMountingError] = useState("");
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [error, setError] = useState("");
  const [macroCategory, setMacroCategory] = useState<MacroCategoryId>("bathroom");
  const [category, setCategory] = useState("showers");
  const [objectId, setObjectId] = useState("");
  const [positionExpanded, setPositionExpanded] = useState(false);
  const [dimensionsExpanded, setDimensionsExpanded] = useState(false);
  const [baseHeightExpanded, setBaseHeightExpanded] = useState(false);
  const [draft, setDraft] = useState<Obstacle | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [wallLockPreference, setWallLockPreference] = useState(true);
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
      }
      setEditingId(item.id);
      setWallLockPreference(item.wall_lock ?? false);
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
  function fromCatalogue(item: RoomCatalogueItem, wallLock = wallLockPreference): Obstacle {
    const measured = (value: number) => ({ value, uncertainty_mm: 5, verified: false, source_type: "USER_MEASURED" });
    return {
      id: "draft", name: item.name,
      kind: item.plan_shape === "ELLIPSE" ? "CYLINDER" : "BOX", fixture_kind: item.fixture_kind,
      model_id: item.id, plan_symbol_data_url: item.plan_symbol_data_url, representation_key: item.representation_key, subcategory: item.subcategory, plan_symbol_url: item.plan_symbol_url,
      center: { x: (Math.min(...room.vertices.map(p => p.x)) + Math.max(...room.vertices.map(p => p.x))) / 2, y: (Math.min(...room.vertices.map(p => p.y)) + Math.max(...room.vertices.map(p => p.y))) / 2 },
      dimensions: { width: measured(item.width_mm), depth: measured(item.depth_mm), height: measured(item.height_mm) },
      base_z_mm: item.representation_key?.startsWith("furniture-kitchen-cabinet-") ? 1500 : 0, rotation_deg: 0, verified: false, source_type: "USER_MEASURED", wall_lock: wallLock,
      color_hex: item.color_hex, stl_filename: item.stl_filename ?? undefined, stl_base64: item.stl_base64 ?? undefined,
      side_clearance_mm: item.side_clearance_mm ?? undefined, front_clearance_mm: item.front_clearance_mm ?? undefined,
    };
  }
  const value = existing ?? draft ?? (selected ? fromCatalogue(selected) : null);
  const stairModel = value?.representation_key ? STAIRCASE_MODELS[value.representation_key] : undefined;
  const cabinet = value?.representation_key?.startsWith("furniture-kitchen-cabinet-");
  const baseUnits = room.obstacles.filter(item => item.id !== value?.id && item.representation_key?.startsWith("furniture-kitchen-") && !item.representation_key.includes("cabinet-"));
  function change(next: Obstacle) {
    if (next.base_z_mm < 0 || ![next.base_z_mm, next.center.x, next.center.y, next.rotation_deg, ...Object.values(next.dimensions).map(d => d.value)].every(Number.isFinite)
      || Object.values(next.dimensions).some(d => d.value <= 0)) return;
    const positioned = existing ? constrainObstacleToRoom(next, room, next.center, roomWalls) : next;
    if (!positioned) { setMountingError("This element cannot fit inside this room at these dimensions."); return; }
    setMountingError("");
    if (existing) onChange(room.obstacles.map(item => item.id === existing.id ? positioned : item));
    else setDraft(positioned);
  }
  function choose(item?: RoomCatalogueItem) {
    if (!item) return;
    setObjectId(item.id);
    setBaseHeightExpanded(false);
    const next = fromCatalogue(item);
    if (existing) change({ ...next, id: existing.id, center: existing.center, rotation_deg: existing.rotation_deg, wall_lock: existing.wall_lock });
    else setDraft(next);
  }
  const positionSummary = value ? `X ${formatLength(value.center.x, displayUnits)} · Y ${formatLength(value.center.y, displayUnits)} · Rot ${value.rotation_deg.toFixed(0)}°` : "Set placement coordinates";
  const dimensionsSummary = value ? `${formatLength(value.dimensions.width.value, displayUnits)} × ${formatLength(value.dimensions.depth.value, displayUnits)} × ${formatLength(value.dimensions.height.value, displayUnits)}` : "Set object dimensions";
  const baseHeightRelevant = Boolean(value && (cabinet || stairModel || value.base_z_mm > 0 || baseHeightExpanded));
  return <section className="fixture-editor element-add-editor" aria-label="Add elements">
    {error && <p role="alert">{error}</p>}{!items.length && !error && <p>Loading Object catalogue…</p>}
    <div className="fixture-selectors element-object-selectors compact-catalogue-selectors">
      <label className="field"><span>Category</span><select value={activeMacroCategory ?? ""} onChange={event => { const nextMacro = event.target.value as MacroCategoryId; const nextCategories = categoriesByMacro.get(nextMacro) ?? []; setMacroCategory(nextMacro); setCategory(nextCategories[0]?.[0] ?? ""); setObjectId(""); setDraft(null); setEditingId(null); setBaseHeightExpanded(false); }}>{availableMacroCategories.map(id => <option key={id} value={id}>{MACRO_CATEGORY_LABELS[id]}</option>)}</select></label>
      <label className="field"><span>Subcategory</span><select value={activeCategory ?? ""} onChange={event => { setCategory(event.target.value); setObjectId(""); setDraft(null); setEditingId(null); setBaseHeightExpanded(false); }}>{macroCategories.map(([id, name]) => <option key={id} value={id}>{id === "storage" ? "Elements" : name}</option>)}</select></label>
      <label className="field element-object-select"><span>Object</span><select value={selected?.id ?? ""} onChange={event => choose(objects.find(item => item.id === event.target.value))}>{objects.map(item => <option key={item.id} value={item.id}>{item.name.replace(/^Default /i, "")}{!item.is_default ? ` / ${item.supplier}` : ""}</option>)}</select></label>
      {selected && <small className="catalogue-selection-caption">{selected.name.replace(/^Default /i, "")}</small>}
    </div>
    {value && <>
      {!value.stl_base64 && <FixturePreview obstacle={value} compact />}
      <ComponentColours compact previewObstacle={value} source={{ ...value, colour_parts: items.find(item => item.id === value.model_id)?.colour_parts }} onChange={component_colors => {
        const next = { ...value, component_colors };
        if (existing) onChange(room.obstacles.map(item => item.id === existing.id ? next : item));
        else setDraft(next);
      }} onMaterialsChange={component_materials => {
        const next = { ...value, component_materials };
        if (existing) onChange(room.obstacles.map(item => item.id === existing.id ? next : item));
        else setDraft(next);
      }} onAppearanceChange={(component_colors, component_materials) => {
        const next = { ...value, component_colors, component_materials };
        if (existing) onChange(room.obstacles.map(item => item.id === existing.id ? next : item));
        else setDraft(next);
      }} />
      <section className="fixture-add-section" aria-label="Position">
        <button type="button" className="fixture-section-toggle" aria-expanded={positionExpanded} onClick={() => setPositionExpanded(current => !current)}><span><strong>Position</strong><small>{positionSummary}</small></span><span aria-hidden>{positionExpanded ? "−" : "›"}</span></button>
        {positionExpanded && <div className="fixture-section-content">
          {stairModel && <label className="field"><span>Floor-to-floor rise {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput units={displayUnits} minMm={1} valueMm={value.dimensions.height.value * Math.max(...stairModel.steps.map(step => step.top)) / stairModel.height} onMmChange={rise => change({ ...value, verified: false, dimensions: { ...value.dimensions, height: { ...value.dimensions.height, value: rise * stairModel.height / Math.max(...stairModel.steps.map(step => step.top)), verified: false, source_type: "USER_MEASURED" } } })} /><small>Stretches the flight and guarding together. Overall height below includes guarding.</small></label>}
          {baseHeightRelevant && <label className="field"><span>{cabinet ? "Mounting height above floor" : "Base height above floor"} {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput units={displayUnits} minMm={0} valueMm={value.base_z_mm} onMmChange={base_z_mm => change({ ...value, base_z_mm })} /></label>}
          {!baseHeightRelevant && <button type="button" className="element-inline-action" onClick={() => setBaseHeightExpanded(true)}>Set base height…</button>}
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
          <div className="fixture-field-group"><span>Coordinates</span><div className="fixture-fields three-columns">
            {(["x", "y"] as const).map(axis => <label className="field" key={axis}><span>{axis.toUpperCase()} {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput valueMm={value.center[axis]} units={displayUnits} onMmChange={n => change({ ...value, center: { ...value.center, [axis]: n } })} /></label>)}
            <label className="field"><span>Rotation °</span><EditableNumberInput value={value.rotation_deg} onValueChange={rotation_deg => change({ ...value, rotation_deg })} /></label>
          </div></div>
          <label className="fixture-lock-switch"><input type="checkbox" checked={value.wall_lock ?? false} onChange={event => { const wallLock = event.target.checked; setWallLockPreference(wallLock); change({ ...value, wall_lock: wallLock }); }} /><span>Keep adjacent to nearest wall</span></label>
        </div>}
      </section>
      <section className="fixture-add-section" aria-label="Dimensions">
        <button type="button" className="fixture-section-toggle" aria-expanded={dimensionsExpanded} onClick={() => setDimensionsExpanded(current => !current)}><span><strong>Dimensions</strong><small>{dimensionsSummary}</small></span><span aria-hidden>{dimensionsExpanded ? "−" : "›"}</span></button>
        {dimensionsExpanded && <div className="fixture-section-content"><div className="fixture-fields three-columns">
          {(["width", "depth", "height"] as const).map(axis => <label className="field" key={axis}><span>{axis[0].toUpperCase() + axis.slice(1)} {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput minMm={1} valueMm={value.dimensions[axis].value} units={displayUnits} onMmChange={n => change({ ...value, verified: false, dimensions: { ...value.dimensions, [axis]: { ...value.dimensions[axis], value: n, verified: false, source_type: "USER_MEASURED" } } })} /></label>)}
        </div></div>}
      </section>
      {mountingError && <p role="alert">{mountingError}</p>}
      <button className="fixture-save" disabled={!!error} onClick={() => {
        if (existing) { setEditingId(null); setDraft(null); onEditEnd?.(); return; }
        const next = { ...value, id: `fixture-${crypto.randomUUID()}` };
        if (onBeginPlacement) {
          onBeginPlacement({ id: next.id, obstacle: next });
          setDraft(null); setEditingId(null);
        } else {
          const positioned = constrainObstacleToRoom(next, room, next.center, roomWalls);
          if (!positioned) { setMountingError("This element is too large for the room."); return; }
          onChange([...room.obstacles, positioned]); setEditingId(next.id); setDraft(null);
        }
      }}>{existing ? "Done" : "Add element"}</button>
    </>}
    <div className="fixture-list">{room.obstacles.map(item => <article key={item.id} data-element-id={item.id} className={item.id === editingId ? "editing" : ""}>
      <strong>{item.name}</strong><button onClick={() => { const product = items.find(p => p.id === item.model_id); if (product && isRoomFixture(product)) { setMacroCategory(macroCategoryForCategoryId(product.category_id)); setCategory(product.category_id); setObjectId(product.id); } setWallLockPreference(item.wall_lock ?? false); setEditingId(item.id); onElementSelected?.({ id: item.id, roomId: room.id }); }}>Edit</button>
      <button aria-label={`Remove ${item.name}`} onClick={() => { onChange(room.obstacles.filter(p => p.id !== item.id)); if (item.id === editingId) { setEditingId(null); onEditEnd?.(); } }}>×</button>
    </article>)}</div>
  </section>;
}
