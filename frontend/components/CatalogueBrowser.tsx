"use client";
/* Catalogue previews are local capped data URLs, so Next image optimisation is not applicable. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { DisplayNumberInput } from "@/components/DisplayNumberInput";
import { formatLength, UNIT_LABEL, type DisplayUnits } from "@/lib/units";
import type { CatalogueCategory, CatalogueItem, CatalogueItemInput, MaterialCollection } from "@/lib/types";

interface CatalogueBrowserProps {
  apiUrl: string;
  open: boolean;
  displayUnits: DisplayUnits;
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
    stl_filename: null,
    stl_base64: null,
    side_clearance_mm: null,
    front_clearance_mm: null,
    subcategory: "General",
    plan_shape: "RECTANGLE",
    images: [],
  };
}

function trapFocus(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((element) => element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); event.stopPropagation(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); event.stopPropagation(); first.focus(); }
}

function normalizeCatalogueItem(item: CatalogueItem, apiUrl: string): CatalogueItem {
  return {
    ...item,
    images: Array.isArray(item.images) ? item.images.map((image) => ({ ...image, data_url: image?.data_url || (image?.url ? `${apiUrl}${image.url}` : "") })) : [],
    subcategory: item.subcategory?.trim() || "General",
    plan_shape: item.plan_shape === "ELLIPSE" ? "ELLIPSE" : "RECTANGLE",
  };
}

export function CatalogueBrowser({ apiUrl, open, displayUnits, onClose, onInsert }: CatalogueBrowserProps) {
  const [categories, setCategories] = useState<CatalogueCategory[]>([]);
  const [materialCollections, setMaterialCollections] = useState<MaterialCollection[]>([]);
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [navigationItems, setNavigationItems] = useState<CatalogueItem[]>([]);
  const [categoryId, setCategoryIdState] = useState<string>("");
  const [activeSubcategory, setActiveSubcategory] = useState("");
  const [activeMaterialId, setActiveMaterialId] = useState<string | null>(null);
  const [activeMaterialFamilyId, setActiveMaterialFamilyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<CatalogueItemInput>(blankEntry);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ fixtures: true, PAINT: true, TILE: true });
  const [settingsCategory, setSettingsCategory] = useState<CatalogueCategory | null>(null);
  const [picturePending, setPicturePending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formStatus, setFormStatus] = useState("");
  const stlInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const supplierDialog = useRef<HTMLFormElement>(null);
  const supplierFirstControl = useRef<HTMLSelectElement>(null);
  const supplierOpener = useRef<HTMLElement | null>(null);
  const settingsDialog = useRef<HTMLFormElement>(null);
  const settingsFirstControl = useRef<HTMLInputElement>(null);
  const settingsOpener = useRef<HTMLElement | null>(null);
  const setCategoryId = (value: string) => {
    setCategoryIdState(value);
    if (!value) setActiveSubcategory("");
  };

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement;
    closeButton.current?.focus();
    return () => { opener.current?.focus(); };
  }, [open]);

  useEffect(() => {
    if (!open || showForm || settingsCategory) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open, settingsCategory, showForm]);

  useEffect(() => {
    if (!open) return;
    fetch(`${apiUrl}/catalog/categories`)
      .then((response) => response.ok ? response.json() as Promise<CatalogueCategory[]> : Promise.reject(new Error("Catalogue categories are unavailable.")))
      .then(setCategories)
      .catch((reason: Error) => setError(reason.message));
    fetch(`${apiUrl}/catalog/materials`)
      .then((response) => response.ok ? response.json() as Promise<MaterialCollection[]> : Promise.reject(new Error("Catalogue materials are unavailable.")))
      .then(setMaterialCollections)
      .catch((reason: Error) => setError(reason.message));
    fetch(`${apiUrl}/catalog/items`)
      .then((response) => response.ok ? response.json() as Promise<CatalogueItem[]> : Promise.reject(new Error("Catalogue objects are unavailable.")))
      .then((records) => setNavigationItems(records.map((item) => normalizeCatalogueItem(item, apiUrl))))
      .catch((reason: Error) => setError(reason.message));
  }, [apiUrl, open]);

  useEffect(() => {
    if (!open) return;
    const parameters = new URLSearchParams();
    if (categoryId) parameters.set("category_id", categoryId);
    if (activeSubcategory) parameters.set("subcategory", activeSubcategory);
    if (search.trim()) parameters.set("search", search.trim());
    fetch(`${apiUrl}/catalog/items?${parameters}`)
      .then((response) => response.ok ? response.json() as Promise<CatalogueItem[]> : Promise.reject(new Error("Catalogue objects are unavailable.")))
      .then((records) => setItems(records.map((item) => normalizeCatalogueItem(item, apiUrl))))
      .catch((reason: Error) => setError(reason.message));
  }, [activeSubcategory, apiUrl, categoryId, open, search]);

  useEffect(() => {
    if (!showForm) return;
    supplierFirstControl.current?.focus();
    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setShowForm(false); return; }
      if (event.key !== "Tab" || !supplierDialog.current) return;
      const focusable = Array.from(supplierDialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const firstControl = focusable[0]; const lastControl = focusable.at(-1)!;
      if (!supplierDialog.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? lastControl : firstControl).focus(); return; }
      if (event.shiftKey && document.activeElement === firstControl) { event.preventDefault(); event.stopPropagation(); lastControl.focus(); }
      else if (!event.shiftKey && document.activeElement === lastControl) { event.preventDefault(); event.stopPropagation(); firstControl.focus(); }
    };
    document.addEventListener("keydown", keepFocusInside, true);
    return () => { document.removeEventListener("keydown", keepFocusInside, true); if (supplierOpener.current?.isConnected) supplierOpener.current.focus(); };
  }, [showForm]);

  const settingsCategoryId = settingsCategory?.id;
  useEffect(() => {
    if (!settingsCategoryId) return;
    settingsFirstControl.current?.focus();
    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setSettingsCategory(null); return; }
      if (event.key !== "Tab" || !settingsDialog.current) return;
      const focusable = Array.from(settingsDialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const firstControl = focusable[0]; const lastControl = focusable.at(-1)!;
      if (!settingsDialog.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? lastControl : firstControl).focus(); return; }
      if (event.shiftKey && document.activeElement === firstControl) { event.preventDefault(); event.stopPropagation(); lastControl.focus(); }
      else if (!event.shiftKey && document.activeElement === lastControl) { event.preventDefault(); event.stopPropagation(); firstControl.focus(); }
    };
    document.addEventListener("keydown", keepFocusInside, true);
    return () => { document.removeEventListener("keydown", keepFocusInside, true); if (settingsOpener.current?.isConnected) settingsOpener.current.focus(); };
  }, [settingsCategoryId]);

  if (!open) return null;

  const activeMaterial = materialCollections.find((collection) => collection.id === activeMaterialId);
  const activeMaterialFamily = activeMaterial?.families.find((family) => family.id === activeMaterialFamilyId);
  const visibleMaterialFamilies = activeMaterial
    ? activeMaterialFamilyId
      ? activeMaterial.families.filter((family) => family.id === activeMaterialFamilyId)
      : activeMaterial.families
    : [];
  const activeCategory = categories.find((category) => category.id === form.category_id);
  const useCategoryClearances = form.side_clearance_mm === null && form.front_clearance_mm === null;
  const nestedDialogOpen = showForm || settingsCategory !== null;

  function setField<K extends keyof CatalogueItemInput>(key: K, value: CatalogueItemInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function beginCreate(control: HTMLElement) {
    supplierOpener.current = control;
    setForm(blankEntry());
    setEditingId(null);
    setShowForm(true);
    setError(null);
    setFormStatus("");
  }

  function beginEdit(item: CatalogueItem, control: HTMLElement) {
    supplierOpener.current = control;
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
      stl_filename: item.stl_filename,
      stl_base64: item.stl_base64,
      side_clearance_mm: item.side_clearance_mm,
      front_clearance_mm: item.front_clearance_mm,
      subcategory: item.subcategory,
      plan_shape: item.plan_shape,
      images: item.images,
    });
    setEditingId(item.id);
    setShowForm(true);
    setError(null);
    setFormStatus("");
  }

  function openCategorySettings(category: CatalogueCategory | null, control: HTMLElement) {
    if (!category) return;
    settingsOpener.current = control;
    setSettingsCategory(category);
  }

  function importPictures(files: FileList | null) {
    if (!files) return;
    const selected = Array.from(files);
    if (form.images.length + selected.length > 3) { setError("Each item can have up to three pictures."); return; }
    if (selected.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 500_000)) { setError("Pictures must be JPEG, PNG or WebP and no larger than 500 KB each."); return; }
    setPicturePending(true);
    setFormStatus("Reading pictures…");
    Promise.all(selected.map((file) => new Promise<{ data_url: string; alt: string }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ data_url: String(reader.result), alt: file.name.replace(/\.[^.]+$/, "") });
      reader.onerror = reject;
      reader.readAsDataURL(file);
    }))).then((pictures) => { setForm((current) => ({ ...current, images: [...current.images, ...pictures] })); setError(null); setFormStatus(`${pictures.length} picture${pictures.length === 1 ? "" : "s"} ready to save.`); }).catch(() => { setError("A picture could not be read."); setFormStatus("Picture import failed."); }).finally(() => setPicturePending(false));
  }

  async function saveCategoryDefaults(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settingsCategory) return;
    const response = await fetch(`${apiUrl}/catalog/categories/${settingsCategory.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ default_side_clearance_mm: settingsCategory.default_side_clearance_mm, default_front_clearance_mm: settingsCategory.default_front_clearance_mm }) });
    if (!response.ok) { setError("Category settings could not be saved."); return; }
    const saved = await response.json() as CatalogueCategory;
    setCategories((current) => current.map((category) => category.id === saved.id ? saved : category));
    setSettingsCategory(null);
  }

  function importStl(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".stl")) {
      setError("Choose an STL file.");
      return;
    }
    if (file.size > 20_000_000) {
      setError("The STL must be smaller than 20 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setForm((current) => ({ ...current, stl_filename: file.name, stl_base64: String(reader.result) }));
      setError(null);
    };
    reader.onerror = () => setError("The STL file could not be read.");
    reader.readAsDataURL(file);
  }

  async function saveEntry() {
    if (!form.name.trim() || !form.supplier.trim() || !form.sku.trim()) {
      setError("Name, supplier and SKU are required.");
      return;
    }
    setSaving(true);
    setFormStatus("Saving catalogue entry and pictures…");
    let response: Response;
    try {
      response = await fetch(`${apiUrl}/catalog/items${editingId ? `/${editingId}` : ""}`, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, images: form.images.map((image) => ({ ...image, data_url: image.url ? null : image.data_url })) }),
      });
    } catch {
      setError("The catalogue service is unavailable.");
      setFormStatus("Catalogue entry could not be saved.");
      setSaving(false);
      return;
    }
    if (!response.ok) {
      const payload = await response.json() as { detail?: string };
      setError(payload.detail ?? "The catalogue entry could not be saved.");
      setFormStatus("Catalogue entry could not be saved.");
      setSaving(false);
      return;
    }
    const saved = normalizeCatalogueItem(await response.json() as CatalogueItem, apiUrl);
    setItems((current) => editingId ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved].sort((a, b) => a.name.localeCompare(b.name)));
    setNavigationItems((current) => editingId ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved].sort((a, b) => a.name.localeCompare(b.name)));
    setShowForm(false);
    setEditingId(null);
    setError(null);
    setFormStatus("Catalogue entry saved.");
    setSaving(false);
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
      <section className="catalogue-modal" role={nestedDialogOpen ? undefined : "dialog"} aria-modal={nestedDialogOpen ? undefined : "true"} aria-labelledby={nestedDialogOpen ? undefined : "catalogue-title"} onKeyDown={nestedDialogOpen ? undefined : trapFocus}>
        <header className="catalogue-header" aria-hidden={nestedDialogOpen || undefined} inert={nestedDialogOpen || undefined}><div><h2 id="catalogue-title">Object catalogue</h2><p>Bathroom fixtures, paints and tiles are organised by collection and family. Built-in defaults remain editable.</p></div><button ref={closeButton} className="modal-close" onClick={onClose} aria-label="Close catalogue">×</button></header>
        {!activeMaterial && <div className="catalogue-toolbar" aria-hidden={nestedDialogOpen || undefined} inert={nestedDialogOpen || undefined}><label><span>Search catalogue</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, supplier or SKU" /></label><button onClick={(event) => beginCreate(event.currentTarget)}>+ Add supplier entry</button></div>}
        <div className="catalogue-layout" aria-hidden={nestedDialogOpen || undefined} inert={nestedDialogOpen || undefined}>
          <nav className="catalogue-categories" aria-label="Catalogue categories">
            <button className="catalogue-disclosure" aria-expanded={expanded.fixtures} aria-controls="catalogue-fixtures" onClick={() => setExpanded((current) => ({ ...current, fixtures: !current.fixtures }))}><strong>Bathroom fixtures</strong><span aria-hidden>{expanded.fixtures ? "−" : "+"}</span></button>
            {expanded.fixtures && <div id="catalogue-fixtures" className="catalogue-branch">
              <button className={!categoryId && !activeMaterial ? "active" : ""} onClick={() => { setCategoryId(""); setActiveSubcategory(""); setActiveMaterialId(null); }}><span>All objects</span><small>{categories.reduce((total, item) => total + item.item_count, 0)}</small></button>
              {categories.map((category) => {
                const subcategories = [...new Set(navigationItems.filter((item) => item.category_id === category.id).map((item) => item.subcategory))];
                const key = `category-${category.id}`;
                return <div key={category.id} className="catalogue-tree-item">
                  <button aria-expanded={expanded[key] ?? false} aria-controls={`${key}-children`} onClick={() => { setExpanded((current) => ({ ...current, [key]: !(current[key] ?? false) })); setCategoryId(category.id); setActiveSubcategory(""); setActiveMaterialId(null); }} title={category.description}><span>{category.name}</span><small>{category.item_count}</small></button>
                  {(expanded[key] ?? false) && <div id={`${key}-children`} className="catalogue-branch nested"><button onClick={(event) => openCategorySettings(category, event.currentTarget)}>⚙ Category settings</button>{subcategories.map((subcategory) => <button key={subcategory} className={categoryId === category.id && activeSubcategory === subcategory ? "active" : ""} onClick={() => { setCategoryId(category.id); setActiveSubcategory(subcategory); setActiveMaterialId(null); }}><span>{subcategory}</span></button>)}</div>}
                </div>;
              })}
            </div>}
            {(["PAINT", "TILE"] as const).map((kind) => <div key={kind}><button className="catalogue-disclosure" aria-expanded={expanded[kind]} aria-controls={`catalogue-${kind}`} onClick={() => setExpanded((current) => ({ ...current, [kind]: !current[kind] }))}><strong>{kind === "PAINT" ? "Paints" : "Tiles"}</strong><span aria-hidden>{expanded[kind] ? "−" : "+"}</span></button>{expanded[kind] && <div id={`catalogue-${kind}`} className="catalogue-branch">{materialCollections.filter((collection) => collection.kind === kind).map((collection) => { const key = `material-${collection.id}`; return <div key={collection.id} className="catalogue-tree-item"><button aria-expanded={expanded[key] ?? false} aria-controls={`${key}-families`} className={activeMaterialId === collection.id ? "active" : ""} onClick={() => { setExpanded((current) => ({ ...current, [key]: !(current[key] ?? false) })); setActiveMaterialId(collection.id); setActiveMaterialFamilyId(null); setCategoryId(""); }}><span>{collection.name}</span><small>{collection.families.reduce((total, family) => total + family.items.length, 0)}</small></button>{(expanded[key] ?? false) && <div id={`${key}-families`} className="catalogue-branch nested">{collection.families.map((family) => <button key={family.id} className={activeMaterialFamilyId === family.id ? "active" : ""} aria-pressed={activeMaterialFamilyId === family.id} onClick={() => { setActiveMaterialId(collection.id); setActiveMaterialFamilyId(family.id); setCategoryId(""); document.getElementById(`family-${family.id}`)?.scrollIntoView({ block: "start" }); }}><span>{family.name}</span><small>{family.items.length}</small></button>)}</div>}</div>; })}</div>}</div>)}
          </nav>
          <div className="catalogue-results">
            {activeMaterial ? <>
              <div className="catalogue-result-heading"><strong>{activeMaterialFamily?.name ?? activeMaterial.name}</strong><span>{visibleMaterialFamilies.reduce((total, family) => total + family.items.length, 0)} colours</span></div>
              <div className="catalogue-grid">{visibleMaterialFamilies.map((family) => <section id={`family-${family.id}`} key={family.id} className="catalogue-material-family"><h3>{family.name}</h3><div className="catalogue-material-swatches">{family.items.map((item) => <div key={item.id} title={item.code ?? item.name}><span style={{ background: item.color_hex }} /><small>{item.name}</small><code>{item.color_hex.toUpperCase()}</code></div>)}</div></section>)}</div>
            </> : <>
              <div className="catalogue-result-heading"><strong>{activeSubcategory || (categoryId ? categories.find((item) => item.id === categoryId)?.name : "All objects")}</strong><span>{items.length} result{items.length === 1 ? "" : "s"}</span></div>
              {categoryId && <button className="category-settings-button" onClick={(event) => openCategorySettings(categories.find((item) => item.id === categoryId) ?? null, event.currentTarget)}>Category settings…</button>}
              {items.length === 0 ? <p className="catalogue-empty">No objects match this view.</p> : <div className="catalogue-grid">{items.map((item) => {
                const preview = item.images?.[0]?.data_url;
                return <article key={item.id}><div className={`catalogue-object-preview ${item.plan_shape === "ELLIPSE" ? "ellipse" : ""}`} style={{ "--object-colour": item.color_hex, backgroundImage: preview ? `url(${preview})` : undefined } as React.CSSProperties}><span />{item.stl_filename && <b>STL</b>}</div><div className="catalogue-object-body"><span className="catalogue-category-label">{item.category_name} · {item.subcategory}</span>{item.is_default && <span className="catalogue-default-badge">Built-in default · editable</span>}<h3>{item.name}</h3><p>{item.supplier} · {item.sku}</p><code>{formatLength(item.width_mm, displayUnits)} × {formatLength(item.depth_mm, displayUnits)} × {formatLength(item.height_mm, displayUnits)}</code><div className="catalogue-card-actions"><button onClick={(event) => beginEdit(item, event.currentTarget)}>Edit entry</button><button className="catalogue-insert" onClick={() => { onInsert(item); onClose(); }}>Add to room</button></div></div></article>;
              })}</div>}
            </>}
          </div>
        </div>

        {showForm && <div className="catalogue-form-backdrop"><form ref={supplierDialog} className="catalogue-form" role="dialog" aria-modal="true" aria-labelledby="supplier-catalogue-title" onSubmit={(event) => { event.preventDefault(); void saveEntry(); }}><div className="catalogue-form-heading"><div><span className="eyebrow">Supplier catalogue</span><h3 id="supplier-catalogue-title">{editingId ? "Modify entry" : "Add new entry"}</h3></div><button type="button" aria-label="Close supplier catalogue form" onClick={() => setShowForm(false)}>×</button></div><div className="catalogue-form-grid">
          <label className="field"><span>Category</span><select ref={supplierFirstControl} value={form.category_id} onChange={(event) => { const next = event.target.value; setForm((current) => ({ ...current, category_id: next, fixture_kind: CATEGORY_KINDS[next] })); }}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label className="field"><span>Colour</span><input type="color" value={form.color_hex} onChange={(event) => setField("color_hex", event.target.value)} /></label>
          <label className="field"><span>Colour HEX</span><input value={form.color_hex.toUpperCase()} pattern="#[0-9A-Fa-f]{6}" onChange={(event) => setField("color_hex", event.target.value.toUpperCase())} /></label>
          <label className="field"><span>Subcategory</span><input required value={form.subcategory} onChange={(event) => setField("subcategory", event.target.value)} /></label>
          <label className="field"><span>Floorplan shape</span><select value={form.plan_shape} onChange={(event) => setField("plan_shape", event.target.value as CatalogueItemInput["plan_shape"])}><option value="RECTANGLE">Rectangle / box</option><option value="ELLIPSE">Ellipse / cylinder</option></select></label>
          <label className="field span-two"><span>Object name</span><input value={form.name} onChange={(event) => setField("name", event.target.value)} /></label>
          <label className="field"><span>Supplier</span><input value={form.supplier} onChange={(event) => setField("supplier", event.target.value)} /></label>
          <label className="field"><span>Supplier SKU</span><input value={form.sku} onChange={(event) => setField("sku", event.target.value)} /></label>
          <label className="field"><span>Width {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput minMm={1} valueMm={form.width_mm} units={displayUnits} onMmChange={(value) => setField("width_mm", value)} /></label>
          <label className="field"><span>Depth {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput minMm={1} valueMm={form.depth_mm} units={displayUnits} onMmChange={(value) => setField("depth_mm", value)} /></label>
          <label className="field"><span>Height {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput minMm={1} valueMm={form.height_mm} units={displayUnits} onMmChange={(value) => setField("height_mm", value)} /></label>
          <label className="field span-two"><input type="checkbox" checked={useCategoryClearances} onChange={(event) => { if (event.target.checked) { setForm((current) => ({ ...current, side_clearance_mm: null, front_clearance_mm: null })); } else { setForm((current) => ({ ...current, side_clearance_mm: activeCategory?.default_side_clearance_mm ?? 0, front_clearance_mm: activeCategory?.default_front_clearance_mm ?? 0 })); } }} /><span>Use {activeCategory?.name ?? "category"} clearance defaults ({activeCategory?.default_side_clearance_mm ?? 0} mm side, {activeCategory?.default_front_clearance_mm ?? 0} mm front)</span></label>
          <label className="field"><span>Side clearance {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput minMm={0} valueMm={form.side_clearance_mm ?? activeCategory?.default_side_clearance_mm ?? 0} units={displayUnits} onMmChange={(value) => setField("side_clearance_mm", value)} disabled={useCategoryClearances} /><small>Overrides apply only to this entry.</small></label>
          <label className="field"><span>Front clearance {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput minMm={0} valueMm={form.front_clearance_mm ?? activeCategory?.default_front_clearance_mm ?? 0} units={displayUnits} onMmChange={(value) => setField("front_clearance_mm", value)} disabled={useCategoryClearances} /><small>Overrides apply only to this entry.</small></label>
          <div className="field span-two stl-import-field"><span>Optional 3D model</span><div><button type="button" onClick={() => stlInput.current?.click()}>{form.stl_filename ? "Replace STL" : "Import STL"}</button>{form.stl_filename && <><strong>{form.stl_filename}</strong><button type="button" className="remove-stl" onClick={() => setForm((current) => ({ ...current, stl_filename: null, stl_base64: null }))}>Remove</button></>}</div><small>The model is scaled to the width, depth and height entered above. Maximum 20 MB.</small><input ref={stlInput} hidden type="file" accept=".stl,model/stl,application/sla" onChange={(event) => { importStl(event.target.files?.[0]); event.target.value = ""; }} /></div>
          <div className="field span-two catalogue-picture-field">
            <span>Pictures ({form.images.length}/3)</span>
            <button type="button" disabled={picturePending || saving || form.images.length >= 3} onClick={() => imageInput.current?.click()}>{picturePending ? "Reading pictures…" : "Add pictures"}</button>
            <input ref={imageInput} hidden multiple disabled={picturePending || saving} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { importPictures(event.target.files); event.target.value = ""; }} />
            <div className="catalogue-picture-list">{form.images.map((picture, index) => <div key={`${picture.data_url.slice(-24)}-${index}`}><img src={picture.data_url} alt={picture.alt} /><label><span>Alt text</span><input required disabled={saving} value={picture.alt} onChange={(event) => setForm((current) => ({ ...current, images: current.images.map((item, itemIndex) => itemIndex === index ? { ...item, alt: event.target.value } : item) }))} /></label><div><button type="button" disabled={saving || picturePending || index === 0} onClick={() => setForm((current) => { const images = [...current.images]; [images[index - 1], images[index]] = [images[index], images[index - 1]]; return { ...current, images }; })}>Move up</button><button type="button" disabled={saving || picturePending} onClick={() => setForm((current) => ({ ...current, images: current.images.filter((_, itemIndex) => itemIndex !== index) }))}>Remove</button></div></div>)}</div>
            <small>Up to 3 JPEG, PNG or WebP pictures, maximum 500 KB each. Pictures never define fit geometry.</small>
          </div>
          <label className="field span-two"><span>Description</span><textarea value={form.description} onChange={(event) => setField("description", event.target.value)} /></label>
        </div>{error && <p className="inline-error">{error}</p>}<p className="catalogue-picture-status" role="status" aria-live="polite">{formStatus}</p><div className="catalogue-form-actions">{editingId && !items.find((item) => item.id === editingId)?.is_default && <button className="catalogue-archive" type="button" disabled={saving || picturePending} onClick={() => void archiveEntry()}>Archive</button>}<button type="button" disabled={saving} onClick={() => setShowForm(false)}>Cancel</button><button className="catalogue-insert" disabled={saving || picturePending} type="submit">{saving ? "Saving…" : editingId ? "Save changes" : "Create entry"}</button></div></form></div>}
        {settingsCategory && <div className="catalogue-form-backdrop"><form ref={settingsDialog} className="catalogue-form category-settings-form" role="dialog" aria-modal="true" aria-labelledby="category-settings-title" onSubmit={(event) => void saveCategoryDefaults(event)}><div className="catalogue-form-heading"><h3 id="category-settings-title">{settingsCategory.name} settings</h3><button type="button" aria-label="Close category settings" onClick={() => setSettingsCategory(null)}>×</button></div><p>These millimetre clearances apply whenever an item does not define its own override.</p><div className="catalogue-form-grid"><label className="field"><span>Default side clearance (mm)</span><input ref={settingsFirstControl} type="number" min="0" max="5000" value={settingsCategory.default_side_clearance_mm} onChange={(event) => setSettingsCategory({ ...settingsCategory, default_side_clearance_mm: Number(event.target.value) })} /></label><label className="field"><span>Default front clearance (mm)</span><input type="number" min="0" max="5000" value={settingsCategory.default_front_clearance_mm} onChange={(event) => setSettingsCategory({ ...settingsCategory, default_front_clearance_mm: Number(event.target.value) })} /></label></div><div className="catalogue-form-actions"><button type="button" onClick={() => setSettingsCategory(null)}>Cancel</button><button className="catalogue-insert" type="submit">Save defaults</button></div></form></div>}
        {error && !showForm && <p className="catalogue-error" aria-hidden={nestedDialogOpen || undefined} inert={nestedDialogOpen || undefined}>{error}</p>}
      </section>
    </div>
  );
}
