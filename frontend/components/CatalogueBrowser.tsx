"use client";

import { useEffect, useState } from "react";
import { EditableNumberInput } from "@/components/EditableNumberInput";
import type { CatalogueCategory, CatalogueItem, CatalogueItemInput } from "@/lib/types";

interface CatalogueBrowserProps {
  apiUrl: string;
  open: boolean;
  onClose: () => void;
  onInsert: (item: CatalogueItem) => void;
}

const CATEGORY_KINDS: Record<string, CatalogueItemInput["fixture_kind"]> = {
  showers: "SHOWER",
  basins: "BASIN",
  toilets: "TOILET",
  storage: "FURNITURE",
};

function blankEntry(): CatalogueItemInput {
  return {
    category_id: "storage",
    fixture_kind: "FURNITURE",
    name: "",
    supplier: "",
    sku: "",
    width_mm: 600,
    depth_mm: 450,
    height_mm: 850,
    color_hex: "#b99b77",
    description: "",
  };
}

export function CatalogueBrowser({ apiUrl, open, onClose, onInsert }: CatalogueBrowserProps) {
  const [categories, setCategories] = useState<CatalogueCategory[]>([]);
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [categoryId, setCategoryId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<CatalogueItemInput>(blankEntry);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch(`${apiUrl}/catalog/categories`)
      .then((response) => response.ok ? response.json() as Promise<CatalogueCategory[]> : Promise.reject(new Error("Catalogue categories are unavailable.")))
      .then(setCategories)
      .catch((reason: Error) => setError(reason.message));
  }, [apiUrl, open]);

  useEffect(() => {
    if (!open) return;
    const parameters = new URLSearchParams();
    if (categoryId) parameters.set("category_id", categoryId);
    if (search.trim()) parameters.set("search", search.trim());
    fetch(`${apiUrl}/catalog/items?${parameters}`)
      .then((response) => response.ok ? response.json() as Promise<CatalogueItem[]> : Promise.reject(new Error("Catalogue objects are unavailable.")))
      .then(setItems)
      .catch((reason: Error) => setError(reason.message));
  }, [apiUrl, categoryId, open, search]);

  if (!open) return null;

  function setField<K extends keyof CatalogueItemInput>(key: K, value: CatalogueItemInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function beginCreate() {
    setForm(blankEntry());
    setEditingId(null);
    setShowForm(true);
    setError(null);
  }

  function beginEdit(item: CatalogueItem) {
    setForm({
      category_id: item.category_id,
      fixture_kind: item.fixture_kind,
      name: item.name,
      supplier: item.supplier,
      sku: item.sku,
      width_mm: item.width_mm,
      depth_mm: item.depth_mm,
      height_mm: item.height_mm,
      color_hex: item.color_hex,
      description: item.description,
    });
    setEditingId(item.id);
    setShowForm(true);
    setError(null);
  }

  async function saveEntry() {
    if (!form.name.trim() || !form.supplier.trim() || !form.sku.trim()) {
      setError("Name, supplier and SKU are required.");
      return;
    }
    const response = await fetch(`${apiUrl}/catalog/items${editingId ? `/${editingId}` : ""}`, {
      method: editingId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!response.ok) {
      const payload = await response.json() as { detail?: string };
      setError(payload.detail ?? "The catalogue entry could not be saved.");
      return;
    }
    const saved = await response.json() as CatalogueItem;
    setItems((current) => editingId ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved].sort((a, b) => a.name.localeCompare(b.name)));
    setShowForm(false);
    setEditingId(null);
    setError(null);
    const responseCategories = await fetch(`${apiUrl}/catalog/categories`);
    if (responseCategories.ok) setCategories(await responseCategories.json() as CatalogueCategory[]);
  }

  async function archiveEntry() {
    if (!editingId || !window.confirm("Remove this entry from the active catalogue?")) return;
    const response = await fetch(`${apiUrl}/catalog/items/${editingId}`, { method: "DELETE" });
    if (!response.ok) {
      setError("The catalogue entry could not be removed.");
      return;
    }
    setItems((current) => current.filter((item) => item.id !== editingId));
    setShowForm(false);
    setEditingId(null);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="catalogue-modal" role="dialog" aria-modal="true" aria-labelledby="catalogue-title">
        <header className="catalogue-header"><div><span className="eyebrow">Persistent SQLite library</span><h2 id="catalogue-title">Bathroom object catalogue</h2><p>Explore products or maintain supplier-specific entries.</p></div><button className="modal-close" onClick={onClose} aria-label="Close catalogue">×</button></header>
        <div className="catalogue-toolbar"><label><span>Search catalogue</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, supplier or SKU" /></label><button onClick={beginCreate}>+ Add supplier entry</button></div>
        <div className="catalogue-layout">
          <nav className="catalogue-categories" aria-label="Catalogue categories"><button className={!categoryId ? "active" : ""} onClick={() => setCategoryId("")}><span>All objects</span><small>{categories.reduce((total, item) => total + item.item_count, 0)}</small></button>{categories.map((category) => <button key={category.id} className={categoryId === category.id ? "active" : ""} onClick={() => setCategoryId(category.id)} title={category.description}><span>{category.name}</span><small>{category.item_count}</small></button>)}</nav>
          <div className="catalogue-results">
            <div className="catalogue-result-heading"><strong>{categoryId ? categories.find((item) => item.id === categoryId)?.name : "All objects"}</strong><span>{items.length} result{items.length === 1 ? "" : "s"}</span></div>
            {items.length === 0 ? <p className="catalogue-empty">No objects match this view.</p> : <div className="catalogue-grid">{items.map((item) => <article key={item.id}><div className="catalogue-object-preview" style={{ "--object-colour": item.color_hex } as React.CSSProperties}><span /></div><div className="catalogue-object-body"><span className="catalogue-category-label">{item.category_name}</span><h3>{item.name}</h3><p>{item.supplier} · {item.sku}</p><code>{item.width_mm.toFixed(0)} × {item.depth_mm.toFixed(0)} × {item.height_mm.toFixed(0)} mm</code><div className="catalogue-card-actions"><button onClick={() => beginEdit(item)}>Edit entry</button><button className="catalogue-insert" onClick={() => { onInsert(item); onClose(); }}>Add to room</button></div></div></article>)}</div>}
          </div>
        </div>

        {showForm && <div className="catalogue-form-backdrop"><form className="catalogue-form" onSubmit={(event) => { event.preventDefault(); void saveEntry(); }}><div className="catalogue-form-heading"><div><span className="eyebrow">Supplier catalogue</span><h3>{editingId ? "Modify entry" : "Add new entry"}</h3></div><button type="button" onClick={() => setShowForm(false)}>×</button></div><div className="catalogue-form-grid">
          <label className="field"><span>Category</span><select value={form.category_id} onChange={(event) => { const next = event.target.value; setForm((current) => ({ ...current, category_id: next, fixture_kind: CATEGORY_KINDS[next] })); }}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label className="field"><span>Colour</span><input type="color" value={form.color_hex} onChange={(event) => setField("color_hex", event.target.value)} /></label>
          <label className="field span-two"><span>Object name</span><input value={form.name} onChange={(event) => setField("name", event.target.value)} /></label>
          <label className="field"><span>Supplier</span><input value={form.supplier} onChange={(event) => setField("supplier", event.target.value)} /></label>
          <label className="field"><span>Supplier SKU</span><input value={form.sku} onChange={(event) => setField("sku", event.target.value)} /></label>
          <label className="field"><span>Width mm</span><EditableNumberInput min={1} value={form.width_mm} onValueChange={(value) => setField("width_mm", value)} /></label>
          <label className="field"><span>Depth mm</span><EditableNumberInput min={1} value={form.depth_mm} onValueChange={(value) => setField("depth_mm", value)} /></label>
          <label className="field"><span>Height mm</span><EditableNumberInput min={1} value={form.height_mm} onValueChange={(value) => setField("height_mm", value)} /></label>
          <label className="field span-two"><span>Description</span><textarea value={form.description} onChange={(event) => setField("description", event.target.value)} /></label>
        </div>{error && <p className="inline-error">{error}</p>}<div className="catalogue-form-actions">{editingId && <button className="catalogue-archive" type="button" onClick={() => void archiveEntry()}>Archive</button>}<button type="button" onClick={() => setShowForm(false)}>Cancel</button><button className="catalogue-insert" type="submit">{editingId ? "Save changes" : "Create entry"}</button></div></form></div>}
        {error && !showForm && <p className="catalogue-error">{error}</p>}
      </section>
    </div>
  );
}
