"use client";
import { useEffect, useState } from "react";
import { DisplayNumberInput } from "@/components/DisplayNumberInput";
import { EditableNumberInput } from "@/components/EditableNumberInput";
import { FixturePreview } from "@/components/FixturePreview";
import { alignObstacleToNearestWall } from "@/lib/layoutInteraction";
import { UNIT_LABEL, type DisplayUnits } from "@/lib/units";
import type { CatalogueItem, Obstacle, Room } from "@/lib/types";

export function CatalogueFixtureEditor({ room, displayUnits, onChange, apiUrl, refreshKey = 0 }: {
  room: Room; displayUnits: DisplayUnits; onChange: (items: Obstacle[]) => void; apiUrl: string; refreshKey?: number;
}) {
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("showers");
  const [subcategory, setSubcategory] = useState("");
  const [objectId, setObjectId] = useState("");
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
  const categories = [...new Map(items.map(item => [item.category_id, item.category_name])).entries()];
  const activeCategory = categories.some(([id]) => id === category) ? category : categories[0]?.[0];
  const family = items.filter(item => item.category_id === activeCategory);
  const subcategories = [...new Set(family.map(item => item.subcategory))].sort();
  const activeSubcategory = subcategories.includes(subcategory) ? subcategory : subcategories[0];
  const objects = family.filter(item => item.subcategory === activeSubcategory).sort((a, b) => Number(b.name === "Default") - Number(a.name === "Default") || a.name.localeCompare(b.name));
  const selected = objects.find(item => item.id === objectId) ?? objects[0];
  const existing = room.obstacles.find(item => item.id === editingId);
  function fromCatalogue(item: CatalogueItem): Obstacle {
    const measured = (value: number) => ({ value, uncertainty_mm: 5, verified: false, source_type: "USER_MEASURED" });
    return {
      id: "draft", name: item.name === "Default" ? `${item.category_name} · ${item.subcategory}` : item.name,
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
  function choose(item?: CatalogueItem) {
    if (!item) return;
    setObjectId(item.id); const next = fromCatalogue(item);
    if (existing) change({ ...next, id: existing.id, center: existing.center, rotation_deg: existing.rotation_deg, wall_lock: existing.wall_lock });
    else setDraft(next);
  }
  return <section className="fixture-editor" aria-label="Add elements">
    <div className="fixture-heading"><h2>{existing ? "Edit element · live" : "Add element"}</h2><span>{room.obstacles.length} placed</span></div>
    {error && <p role="alert">{error}</p>}{!items.length && !error && <p>Loading Object catalogue…</p>}
    <div className="fixture-selectors" style={{ gridTemplateColumns: "1fr" }}>
      <label className="field"><span>Category</span><select value={activeCategory ?? ""} onChange={event => { setCategory(event.target.value); setSubcategory(""); setObjectId(""); setDraft(null); setEditingId(null); }}>{categories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="field"><span>Subcategory</span><select value={activeSubcategory ?? ""} onChange={event => { setSubcategory(event.target.value); setObjectId(""); setDraft(null); setEditingId(null); }}>{subcategories.map(name => <option key={name}>{name}</option>)}</select></label>
      <label className="field"><span>Object</span><select value={selected?.id ?? ""} onChange={event => choose(objects.find(item => item.id === event.target.value))}>{objects.map(item => <option key={item.id} value={item.id}>{item.name}{item.name !== "Default" ? ` · ${item.supplier}` : ""}</option>)}</select></label>
    </div>
    {value && <>
      {value.fixture_kind !== "FURNITURE" && !value.stl_base64 && <FixturePreview obstacle={value} />}
      <div className="fixture-field-group"><span>Position</span><div className="fixture-fields three-columns">
        {(["x", "y"] as const).map(axis => <label className="field" key={axis}><span>{axis.toUpperCase()} {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput valueMm={value.center[axis]} units={displayUnits} onMmChange={n => change({ ...value, center: { ...value.center, [axis]: n } })} /></label>)}
        <label className="field"><span>Rotation °</span><EditableNumberInput value={value.rotation_deg} onValueChange={rotation_deg => change({ ...value, rotation_deg })} /></label>
      </div></div>
      <label className="fixture-lock-choice"><input type="checkbox" checked={value.wall_lock ?? false} onChange={event => change({ ...value, wall_lock: event.target.checked })} />Keep adjacent to nearest wall</label>
      <div className="fixture-field-group"><span>Dimensions</span><div className="fixture-fields three-columns">
        {(["width", "depth", "height"] as const).map(axis => <label className="field" key={axis}><span>{axis[0].toUpperCase() + axis.slice(1)} {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput minMm={1} valueMm={value.dimensions[axis].value} units={displayUnits} onMmChange={n => change({ ...value, verified: false, dimensions: { ...value.dimensions, [axis]: { ...value.dimensions[axis], value: n, verified: false, source_type: "USER_MEASURED" } } })} /></label>)}
      </div></div>
      <button className="fixture-save" disabled={!!error} onClick={() => {
        if (existing) { setEditingId(null); setDraft(null); return; }
        const next = { ...value, id: `fixture-${crypto.randomUUID()}` };
        onChange([...room.obstacles, next.wall_lock ? alignObstacleToNearestWall(next, room.vertices, next.center) : next]);
        setEditingId(next.id); setDraft(null);
      }}>{existing ? "Done" : "Add element"}</button>
    </>}
    <div className="fixture-list">{room.obstacles.map(item => <article key={item.id} className={item.id === editingId ? "editing" : ""}>
      <strong>{item.name}</strong><button onClick={() => { const product = items.find(p => p.id === item.model_id); if (product) { setCategory(product.category_id); setSubcategory(product.subcategory); setObjectId(product.id); } setEditingId(item.id); }}>Edit</button>
      <button aria-label={`Remove ${item.name}`} onClick={() => { onChange(room.obstacles.filter(p => p.id !== item.id)); if (item.id === editingId) setEditingId(null); }}>×</button>
    </article>)}</div>
  </section>;
}
