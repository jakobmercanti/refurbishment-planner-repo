"use client";

import { useEffect, useMemo, useState } from "react";
import { assetRepository } from "@/lib/assetRepository";
import type { AssetClassification, AssetDefinition, AssetInstance } from "@/lib/projectDocument";
import type { CatalogueCategory, CatalogueItem } from "@/lib/types";
import { AddCustomAssetDialog } from "@/components/AddCustomAssetDialog";

type View = "library" | "add";
type SubcategoryOptions = { categoryId: string; values: string[] };

export function LocalAssetLibrary({ assets, instances, apiUrl, onImport, onChange, onClose }: {
  assets: AssetDefinition[];
  instances: AssetInstance[];
  apiUrl: string;
  onImport: (asset: AssetDefinition) => void;
  onChange: (instances: AssetInstance[]) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>("library");
  const [categories, setCategories] = useState<CatalogueCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoryError, setCategoryError] = useState("");
  const [categoryId, setCategoryId] = useState("custom");
  const [subcategory, setSubcategory] = useState("General");
  const [subcategoryOptions, setSubcategoryOptions] = useState<SubcategoryOptions>({ categoryId: "", values: [] });
  const categoryOptions = useMemo(() => [...categories, { id: "custom", name: "Custom", description: "Personal assets without a built-in category.", item_count: 0, default_side_clearance_mm: 0, default_front_clearance_mm: 0 }], [categories]);
  const selectedCategory = categoryOptions.find(category => category.id === categoryId);
  const selectedSubcategories = subcategoryOptions.categoryId === categoryId ? subcategoryOptions.values : [];
  const subcategoriesLoading = categoryId !== "custom" && categoryId !== "" && subcategoryOptions.categoryId !== categoryId;
  const classification: AssetClassification = {
    categoryId,
    categoryName: selectedCategory?.name ?? "Custom",
    subcategory: subcategory.trim(),
  };

  useEffect(() => {
    let mounted = true;
    const base = apiUrl.replace(/\/+$/, "");
    void fetch(`${base}/catalog/categories`)
      .then(response => response.ok ? response.json() as Promise<CatalogueCategory[]> : Promise.reject(new Error("Catalogue categories are unavailable.")))
      .then(value => { if (mounted) { setCategories(value); setCategoriesLoading(false); } })
      .catch(reason => { if (mounted) { setCategoryError(reason instanceof Error ? reason.message : "Catalogue categories are unavailable."); setCategoriesLoading(false); } });
    return () => { mounted = false; };
  }, [apiUrl]);

  useEffect(() => {
    if (!categoryId || categoryId === "custom") return;
    let mounted = true;
    const query = new URLSearchParams({ category_id: categoryId });
    const base = apiUrl.replace(/\/+$/, "");
    void fetch(`${base}/catalog/items?${query.toString()}`)
      .then(response => response.ok ? response.json() as Promise<CatalogueItem[]> : Promise.reject(new Error("Subcategories are unavailable.")))
      .then(items => {
        if (!mounted) return;
        const values = [...new Set(items.map(item => item.subcategory.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        setSubcategoryOptions({ categoryId, values });
        setSubcategory(current => values.includes(current) ? current : values[0] ?? "General");
      })
      .catch(reason => { if (mounted) setCategoryError(reason instanceof Error ? reason.message : "Subcategories are unavailable."); });
    return () => { mounted = false; };
  }, [apiUrl, categoryId]);

  async function add(file?: File) {
    if (!file) return;
    if (!classification.categoryId || !classification.subcategory) { setError("Choose a category and subcategory first."); return; }
    setBusy(true); setError("");
    try { onImport(await assetRepository.importLocalAsset(file, undefined, undefined, classification)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Model import failed."); }
    finally { setBusy(false); }
  }

  function selectCategory(nextId: string) {
    setCategoryId(nextId);
    setSubcategory(nextId === "custom" ? "General" : "");
    setError("");
    setCategoryError("");
  }

  return <div className="modal-backdrop catalogue-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-dialog local-assets" role="dialog" aria-modal="true" aria-labelledby="local-assets-title" onKeyDown={event => { if (event.key === "Escape") onClose(); }}>
      <header className="local-assets-header">
        <div><span className="eyebrow">MY 3D MODELS</span><h2 id="local-assets-title">My 3D models</h2></div>
        <div className="local-asset-actions">
          <button type="button" className="local-asset-action" onClick={() => { setView(current => current === "library" ? "add" : "library"); setError(""); }}>
            {view === "library" ? "Add custom 3D asset…" : "Back to models"}
          </button>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close models">×</button>
        </div>
      </header>

      <div className="local-assets-content">
        <p className="local-assets-intro">Your personal models stay with your planner and can also be backed up to your private account. They are visual-only and never added to the shared built-in catalogue or used as fit evidence.</p>
        <div className="local-asset-classification" aria-label="Personal asset category">
          <label>Category
            <select value={categoryId} disabled={categoriesLoading} onChange={event => selectCategory(event.target.value)}>
              {!categoriesLoading && !selectedCategory && <option value="" disabled>Select category</option>}
              {categoryOptions.map(category => <option value={category.id} key={category.id}>{category.name}</option>)}
            </select>
          </label>
          {categoryId === "custom" ? <label>Subcategory
            <input value={subcategory} maxLength={120} onChange={event => setSubcategory(event.target.value)} placeholder="e.g. Workshop furniture" />
          </label> : <label>Subcategory
            <select value={subcategory} disabled={!categoryId || subcategoriesLoading || selectedSubcategories.length === 0} onChange={event => setSubcategory(event.target.value)}>
              {subcategoriesLoading ? <option value="">Loading subcategories…</option> : selectedSubcategories.length ? selectedSubcategories.map(value => <option value={value} key={value}>{value}</option>) : <option value="General">General</option>}
            </select>
          </label>}
        </div>
        {categoryError && <p className="local-asset-taxonomy-note" role="status">Catalogue taxonomy could not be refreshed. “Custom” remains available; database categories need the catalogue service.</p>}

        {view === "add" ? <AddCustomAssetDialog
          classification={classification}
          onImport={onImport}
        /> : <>
          <section className="local-glb-import">
            <div><strong>Import a GLB model</strong><p>Self-contained GLB, up to 50 MB. The file stays in this browser until you choose to back up your project.</p></div>
            <label className="local-asset-file">Choose GLB file
              <input aria-label="Import GLB" type="file" accept=".glb,model/gltf-binary" disabled={busy} onChange={event => { void add(event.target.files?.[0]); event.target.value = ""; }} />
            </label>
          </section>
          {busy && <p className="local-asset-status" role="status">Checking model…</p>}
          {error && <p className="custom-asset-error" role="alert">{error}</p>}
          {assets.length ? <div className="local-asset-list" aria-label="Personal models">
            {assets.map(asset => <article className="local-asset-card" key={asset.assetId}>
              <div className="local-asset-card-heading"><div><span>{asset.categoryName ?? categoryOptions.find(category => category.id === (asset.categoryId ?? "custom"))?.name ?? "Custom"} · {asset.subcategory ?? "General"}</span><strong>{asset.name}</strong></div>
                <code>{Object.values(asset.computedBoundsMm).map(value => Math.round(value)).join(" × ")} mm</code></div>
              {asset.declaredDimensionsMm && <p>Declared size: {asset.declaredDimensionsMm.width} × {asset.declaredDimensionsMm.depth} × {asset.declaredDimensionsMm.height} mm ({asset.dimensionAuthority ?? "unverified"})</p>}
              <button type="button" className="local-asset-secondary" onClick={() => onChange([...instances, { instanceId: crypto.randomUUID(), assetId: asset.assetId, assetVersion: 1, positionMm: { x: 1000, y: 1000, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }])}>Place in 3D</button>
            </article>)}
          </div> : <div className="local-asset-empty"><strong>No personal models yet</strong><span>Import a GLB, add a free STL, or generate a model from photos.</span></div>}
          {instances.length > 0 && <section className="local-asset-placements"><h3>Placed in this project</h3>
            {instances.map((instance, index) => <fieldset key={instance.instanceId}>
              <legend>{index + 1}. {assets.find(asset => asset.assetId === instance.assetId)?.name ?? "3D model"}</legend>
              <div className="local-asset-placement-fields">{(["x", "y", "z"] as const).map(axis => <label key={axis}>{axis.toUpperCase()} (mm)<input type="number" value={instance.positionMm[axis]} min={-100000} max={100000} onChange={event => { if (!event.target.value) return; const value = Number(event.target.value); if (Number.isFinite(value)) onChange(instances.map(item => item.instanceId === instance.instanceId ? { ...item, positionMm: { ...item.positionMm, [axis]: value } } : item)); }} /></label>)}
                <label>Rotation (°)<input type="number" value={instance.rotationDeg.z} onChange={event => onChange(instances.map(item => item.instanceId === instance.instanceId ? { ...item, rotationDeg: { ...item.rotationDeg, z: Number(event.target.value) || 0 } } : item))} /></label>
                <label>Scale<input type="number" min="0.001" max="1000" step="0.1" value={instance.scale.x} onChange={event => { const value = Number(event.target.value); if (value > 0 && value <= 1000) onChange(instances.map(item => item.instanceId === instance.instanceId ? { ...item, scale: { x: value, y: value, z: value } } : item)); }} /></label>
                <button type="button" className="local-asset-remove" onClick={() => onChange(instances.filter(item => item.instanceId !== instance.instanceId))}>Remove placement</button>
              </div>
            </fieldset>)}
          </section>}
        </>}
      </div>
    </section>
  </div>;
}
