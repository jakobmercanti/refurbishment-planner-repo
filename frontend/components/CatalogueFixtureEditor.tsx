"use client";
import { useEffect, useRef, useState } from "react";
import { STAIRCASE_MODELS } from "@/lib/architecturalModels";
import { ComponentColours } from "@/components/ComponentColours";
import { DisplayNumberInput } from "@/components/DisplayNumberInput";
import { EditableNumberInput } from "@/components/EditableNumberInput";
import { FixturePreview } from "@/components/FixturePreview";
import { ELECTRICAL_SUBCATEGORIES, electricalPlacement } from "@/lib/electricalAssets";
import { isElectricalObstacle } from "@/lib/electricalLayout";
import { constrainObstacleToRoom, DEFAULT_OBSTACLE_WALL_LOCK, type PlacementRequest, type PlacementWall } from "@/lib/elementPlacement";
import { formatLength, UNIT_LABEL, type DisplayUnits } from "@/lib/units";
import { MACRO_CATEGORY_ORDER, macroCategoryDisplay, macroCategoryForCategoryId, type MacroCategoryId } from "@/lib/catalogueTaxonomy";
import type { CatalogueItem, Obstacle, Room } from "@/lib/types";

const ROOM_FIXTURE_KINDS = new Set(["SHOWER", "BASIN", "TOILET", "FURNITURE"]);
type RoomCatalogueItem = CatalogueItem & { fixture_kind: NonNullable<Obstacle["fixture_kind"]> };
type ElementEditRequest = { id: string; roomId: string; requestId: number };
type SelectorLevel = "category" | "subcategory" | "object";
type DimensionAxis = "width" | "depth" | "height";

function PositiveDimensionFields({ value, displayUnits, onChange }: { value: Obstacle; displayUnits: DisplayUnits; onChange: (axis: DimensionAxis, nextValue: number) => void }) {
  const [error, setError] = useState("");
  const errorMessage = "Dimensions must be positive numbers.";
  const update = (axis: DimensionAxis, nextValue: number) => {
    if (!Number.isFinite(nextValue) || nextValue <= 0) {
      setError(errorMessage);
      return;
    }
    setError("");
    onChange(axis, nextValue);
  };

  return <div className="appearance-dimensions-fields fixture-fields three-columns" aria-label="Dimensions">
    {(["width", "depth", "height"] as const).map(axis => <label className="field" key={axis}><span>{axis[0].toUpperCase() + axis.slice(1)} {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput minMm={1} valueMm={value.dimensions[axis].value} units={displayUnits} onMmChange={nextValue => update(axis, nextValue)} onInvalidValue={() => setError(errorMessage)} /></label>)}
    {error && <p className="inline-error appearance-dimensions-error" role="alert">{error}</p>}
  </div>;
}

function isRoomFixture(item: CatalogueItem): item is RoomCatalogueItem {
  return ROOM_FIXTURE_KINDS.has(item.fixture_kind);
}
export function CatalogueFixtureEditor({ room, displayUnits, onChange, apiUrl, refreshKey = 0, elementEditRequest, onEditEnd, onElementSelected, onBeginPlacement, placementWalls = [], categoryFilter }: {
  placementWalls?: PlacementWall[];
  /** Restrict the shared catalogue/placement editor to a category, e.g. Electric. */
  categoryFilter?: string;
  onBeginPlacement?: (request: PlacementRequest) => void;
  onEditEnd?: () => void;
  onElementSelected?: (selection: { id: string; roomId: string } | null) => void;
  room: Room; displayUnits: DisplayUnits; onChange: (items: Obstacle[]) => void; apiUrl: string; refreshKey?: number; elementEditRequest?: ElementEditRequest | null;
}) {
  const roomWalls = room.source_floorplan_room_id ? placementWalls : [];
  const electrical = categoryFilter === "electric";
  const listedRoomObstacles = electrical ? room.obstacles.filter(isElectricalObstacle) : room.obstacles;
  const [mountingGap, setMountingGap] = useState(550);
  const [baseUnitId, setBaseUnitId] = useState("");
  const [mountingError, setMountingError] = useState("");
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [error, setError] = useState("");
  const [macroCategory, setMacroCategory] = useState<MacroCategoryId>("bathroom");
  const [category, setCategory] = useState("showers");
  const [objectId, setObjectId] = useState<string | null>("");
  const [positionExpanded, setPositionExpanded] = useState(false);
  const [baseHeightExpanded, setBaseHeightExpanded] = useState(false);
  const [draft, setDraft] = useState<Obstacle | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [wallLockPreference, setWallLockPreference] = useState(DEFAULT_OBSTACLE_WALL_LOCK);
  const [selectorOpen, setSelectorOpen] = useState<SelectorLevel | null>(null);
  const [selectorExpanded, setSelectorExpanded] = useState(false);
  const [elementsListExpanded, setElementsListExpanded] = useState(true);
  const [hoveredObjectId, setHoveredObjectId] = useState<string | null>(null);
  const selectorRef = useRef<HTMLDivElement>(null);
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
        setCategory(electrical ? roomProduct.subcategory : roomProduct.category_id);
        setObjectId(roomProduct.id);
      }
      setEditingId(item.id);
      setElementsListExpanded(true);
      setWallLockPreference(item.wall_lock ?? false);
      setDraft(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [elementEditRequest, items, room.id, room.obstacles, electrical]);
  useEffect(() => {
    if (!selectorOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!selectorRef.current?.contains(event.target as Node)) setSelectorOpen(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectorOpen(null);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectorOpen]);
  useEffect(() => {
    if (!elementEditRequest || elementEditRequest.roomId !== room.id || editingId !== elementEditRequest.id) return;
    const frame = window.requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`[data-element-id="${elementEditRequest.id}"]`);
      row?.scrollIntoView({ block: "nearest" });
      row?.querySelector<HTMLButtonElement>("button")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingId, elementEditRequest, room.id]);
  const fixtureItems = items.filter((item): item is RoomCatalogueItem =>
    (categoryFilter ? item.category_id === categoryFilter : item.category_id !== "electric") && isRoomFixture(item));
  const categories: Array<[string, string]> = electrical
    ? [...new Set([...ELECTRICAL_SUBCATEGORIES, ...fixtureItems.map(item => item.subcategory)])].filter(name => fixtureItems.some(item => item.subcategory === name)).map(name => [name, name])
    : [...new Map(fixtureItems.map(item => [item.category_id, item.category_name])).entries()];
  const categoriesByMacro = new Map<MacroCategoryId, Array<[string, string]>>();
  categories.forEach((entry) => {
    const macroId = electrical ? "electrical" : macroCategoryForCategoryId(entry[0]);
    categoriesByMacro.set(macroId, [...(categoriesByMacro.get(macroId) ?? []), entry]);
  });
  const availableMacroCategories = MACRO_CATEGORY_ORDER.filter((id) => categoriesByMacro.has(id));
  const activeMacroCategory = availableMacroCategories.includes(macroCategory) ? macroCategory : availableMacroCategories[0];
  const macroCategories = activeMacroCategory ? categoriesByMacro.get(activeMacroCategory) ?? [] : [];
  const activeCategory = category === "" ? "" : macroCategories.some(([id]) => id === category) ? category : macroCategories[0]?.[0] ?? "";
  const family = fixtureItems.filter(item => (electrical ? item.subcategory : item.category_id) === activeCategory);
  // `subcategory` is an Object catalogue grouping, not a second family. The
  // previous filter selected only the first grouping (for example, the
  // 4-person table) and hid every sibling entry from the editor.
  const objects = [...family].sort((a, b) => a.subcategory.localeCompare(b.subcategory) || Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name));
  const selected = objectId === null ? undefined : objects.find(item => item.id === objectId) ?? objects[0];
  const selectedObjectLabel = selected ? `${selected.name.replace(/^Default /i, "")}${!selected.is_default ? ` / ${selected.supplier}` : ""}` : "";
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
      ...electricalPlacement(item.representation_key, item.height_mm, room.wall_height.value),
    };
  }
  const value = existing ?? draft ?? (selected ? fromCatalogue(selected) : null);
  const hoveredObject = hoveredObjectId ? objects.find(item => item.id === hoveredObjectId) : undefined;
  const previewValue = hoveredObject && hoveredObject.id !== selected?.id ? fromCatalogue(hoveredObject, wallLockPreference) : value;
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
  const activeCategoryDisplay = activeCategory ? (activeCategory === "storage" ? "Fittings" : macroCategories.find(([id]) => id === activeCategory)?.[1] ?? "") : "";
  function selectMacroCategory(nextMacro: MacroCategoryId) {
    if (nextMacro === activeMacroCategory) {
      setSelectorExpanded(true);
      setSelectorOpen("subcategory");
      return;
    }
    setMacroCategory(nextMacro);
    setCategory("");
    setObjectId(null);
    setHoveredObjectId(null);
    setDraft(null);
    setEditingId(null);
    setBaseHeightExpanded(false);
    setSelectorExpanded(true);
    setSelectorOpen("subcategory");
  }
 function selectCategory(nextCategory: string) {
   if (nextCategory === activeCategory) {
     setSelectorExpanded(true);
     setSelectorOpen("object");
     return;
   }
   setCategory(nextCategory);
    setObjectId(electrical ? "" : null);
   setHoveredObjectId(null);
   setDraft(null);
   setEditingId(null);
    setBaseHeightExpanded(false);
    setSelectorExpanded(true);
    setSelectorOpen("object");
  }
  function selectObject(item: RoomCatalogueItem) {
    setHoveredObjectId(null);
    choose(item);
    setSelectorOpen(null);
    setSelectorExpanded(false);
  }
  const positionSummary = value ? `X ${formatLength(value.center.x, displayUnits)} · Y ${formatLength(value.center.y, displayUnits)} · Rot ${value.rotation_deg.toFixed(0)}°` : "Set placement coordinates";
  const baseHeightRelevant = Boolean(value && (cabinet || stairModel || value.base_z_mm > 0 || baseHeightExpanded));
  function resetDimensions() {
    if (!value) return;
    const sourceItem = items.find(item => item.id === value.model_id) ?? selected;
    if (!sourceItem) return;
    change({
      ...value,
      verified: false,
      dimensions: {
        width: { ...value.dimensions.width, value: sourceItem.width_mm, verified: false, source_type: "USER_MEASURED" },
        depth: { ...value.dimensions.depth, value: sourceItem.depth_mm, verified: false, source_type: "USER_MEASURED" },
        height: { ...value.dimensions.height, value: sourceItem.height_mm, verified: false, source_type: "USER_MEASURED" },
      },
    });
  }
  const dimensionsContent = value ? <PositiveDimensionFields value={value} displayUnits={displayUnits} onChange={(axis, nextValue) => change({ ...value, verified: false, dimensions: { ...value.dimensions, [axis]: { ...value.dimensions[axis], value: nextValue, verified: false, source_type: "USER_MEASURED" } } })} /> : null;

  return <section className="fixture-editor element-add-editor" aria-label="Add fittings">
    {error && <p role="alert">{error}</p>}{!items.length && !error && <p>Loading Object catalogue…</p>}
    <div className="fixture-cascading-menu" ref={selectorRef}>
      {!selectorExpanded ? <div className="fixture-cascading-collapsed">
        <strong>{selectedObjectLabel || "Select object"}</strong>
        <button type="button" aria-label="Expand fittings selector" aria-expanded={false} onClick={() => setSelectorExpanded(true)}>▾</button>
      </div> : <div className="fixture-cascading-selector" aria-label="Fittings catalogue selector">
        <div className="fixture-cascading-menu-header">
          <strong>{selectedObjectLabel || "Select object"}</strong>
          <button type="button" aria-label="Collapse fittings selector" aria-expanded={true} onClick={() => { setSelectorOpen(null); setHoveredObjectId(null); setSelectorExpanded(false); }}>▴</button>
        </div>
      {!electrical && <div className="fixture-cascading-level">
        <button type="button" className="fixture-cascading-trigger" aria-expanded={selectorOpen === "category"} aria-controls="fixture-category-options" onClick={() => setSelectorOpen(current => current === "category" ? null : "category")}>
          <span className="fixture-cascading-trigger-copy"><span>Category</span><strong className={!activeMacroCategory ? "placeholder" : undefined}>{activeMacroCategory ? macroCategoryDisplay(activeMacroCategory) : "Select category"}</strong></span><span className="fixture-cascading-chevron" aria-hidden>{selectorOpen === "category" ? "▴" : "▾"}</span>
        </button>
        {selectorOpen === "category" && <div id="fixture-category-options" className="fixture-cascading-options" role="listbox" aria-label="Category options">
          {availableMacroCategories.map(id => <button type="button" role="option" aria-selected={id === activeMacroCategory} className={id === activeMacroCategory ? "selected" : undefined} key={id} onClick={() => selectMacroCategory(id)}>{macroCategoryDisplay(id)}</button>)}
        </div>}
      </div>}
      <div className="fixture-cascading-level">
        <button type="button" className="fixture-cascading-trigger" disabled={!activeMacroCategory || macroCategories.length === 0} aria-expanded={selectorOpen === "subcategory"} aria-controls="fixture-subcategory-options" onClick={() => setSelectorOpen(current => current === "subcategory" ? null : "subcategory")}>
          <span className="fixture-cascading-trigger-copy"><span>Subcategory</span><strong className={!activeCategoryDisplay ? "placeholder" : undefined}>{activeCategoryDisplay || "Select subcategory"}</strong></span><span className="fixture-cascading-chevron" aria-hidden>{selectorOpen === "subcategory" ? "▴" : "▾"}</span>
        </button>
        {selectorOpen === "subcategory" && <div id="fixture-subcategory-options" className="fixture-cascading-options" role="listbox" aria-label="Subcategory options">
          {macroCategories.map(([id, name]) => <button type="button" role="option" aria-selected={id === activeCategory} className={id === activeCategory ? "selected" : undefined} key={id} onClick={() => selectCategory(id)}>{id === "storage" ? "Fittings" : name}</button>)}
        </div>}
      </div>
      <div className="fixture-cascading-level">
        <button type="button" className="fixture-cascading-trigger" disabled={!activeCategory || objects.length === 0} aria-expanded={selectorOpen === "object"} aria-controls="fixture-object-options" onClick={() => setSelectorOpen(current => current === "object" ? null : "object")}>
          <span className="fixture-cascading-trigger-copy"><span>Object</span><strong className={!selectedObjectLabel ? "placeholder" : undefined}>{selectedObjectLabel || "Select object"}</strong></span><span className="fixture-cascading-chevron" aria-hidden>{selectorOpen === "object" ? "▴" : "▾"}</span>
        </button>
        {selectorOpen === "object" && <div id="fixture-object-options" className="fixture-cascading-options" role="listbox" aria-label="Object options">
          {objects.map(item => <button type="button" role="option" aria-selected={item.id === selected?.id} className={item.id === selected?.id ? "selected" : undefined} key={item.id} onMouseEnter={() => setHoveredObjectId(item.id)} onMouseLeave={() => setHoveredObjectId(null)} onFocus={() => setHoveredObjectId(item.id)} onBlur={() => setHoveredObjectId(null)} onClick={() => selectObject(item)}>{item.name.replace(/^Default /i, "")}{!item.is_default ? ` / ${item.supplier}` : ""}</button>)}
        </div>}
      </div>
        </div>}
    </div>
    {value && <>
      {previewValue && !previewValue.stl_base64 && <FixturePreview obstacle={previewValue} compact />}
      <ComponentColours compact previewObstacle={value} dimensionsContent={dimensionsContent} onResetDimensions={resetDimensions} source={{ ...value, colour_parts: items.find(item => item.id === value.model_id)?.colour_parts }} onChange={component_colors => {
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
          <label className="fixture-lock-switch"><input type="checkbox" checked={value.wall_lock ?? DEFAULT_OBSTACLE_WALL_LOCK} onChange={event => { const wallLock = event.target.checked; setWallLockPreference(wallLock); change({ ...value, wall_lock: wallLock }); }} /><span>Keep next to wall</span></label>
        </div>}
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
    {listedRoomObstacles.length > 0 && <section className="fixture-add-section elements-list-section" aria-label="Elements list">
      <button type="button" className="fixture-section-toggle" aria-expanded={elementsListExpanded} onClick={() => setElementsListExpanded(current => !current)}><span><strong>Elements list</strong></span><span aria-hidden>{elementsListExpanded ? "−" : "›"}</span></button>
      {elementsListExpanded && <div className="fixture-section-content elements-list-content"><div className="fixture-list">{listedRoomObstacles.map(item => <article key={item.id} data-element-id={item.id} className={item.id === editingId ? "editing" : ""}>
        <strong>{item.name}</strong><button onClick={() => { const product = items.find(p => p.id === item.model_id); if (product && isRoomFixture(product)) { setMacroCategory(macroCategoryForCategoryId(product.category_id)); setCategory(electrical ? product.subcategory : product.category_id); setObjectId(product.id); } setWallLockPreference(item.wall_lock ?? false); setEditingId(item.id); onElementSelected?.({ id: item.id, roomId: room.id }); }}>Edit</button>
        <button aria-label={`Remove ${item.name}`} onClick={() => { onChange(room.obstacles.filter(p => p.id !== item.id)); if (item.id === editingId) { setEditingId(null); onEditEnd?.(); } }}>×</button>
      </article>)}</div></div>}
    </section>}
  </section>;
}
