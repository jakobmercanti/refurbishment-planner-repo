"use client";

import { useEffect, useMemo, useState } from "react";
import { MACRO_CATEGORY_ORDER, macroCategoryDisplay, macroCategoryForCategoryId, type MacroCategoryId } from "@/lib/catalogueTaxonomy";
import type { AssetClassification, AssetDefinition, AssetInstance } from "@/lib/projectDocument";
import type { CatalogueCategory, CatalogueItem } from "@/lib/types";
import { AddCustomAssetDialog } from "@/components/AddCustomAssetDialog";

export function LocalAssetLibrary({ assets, instances, apiUrl, onImport, onChange, onClose }: {
  assets: AssetDefinition[];
  instances: AssetInstance[];
  apiUrl: string;
  onImport: (asset: AssetDefinition) => void;
  onChange: (instances: AssetInstance[]) => void;
  onClose: () => void;
}) {
  const [categories, setCategories] = useState<CatalogueCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [electricalSubcategories, setElectricalSubcategories] = useState<string[]>([]);
  const [electricalSubcategoriesLoading, setElectricalSubcategoriesLoading] = useState(false);
  const [electricalSubcategory, setElectricalSubcategory] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [macroCategoryId, setMacroCategoryId] = useState<MacroCategoryId | "custom">("bathroom");
  const [databaseCategoryId, setDatabaseCategoryId] = useState("");
  const [customSubcategory, setCustomSubcategory] = useState("General");
  const categoriesByMacro = useMemo(() => {
    const grouped = new Map<MacroCategoryId, CatalogueCategory[]>();
    categories.forEach(category => {
      const macroId = macroCategoryForCategoryId(category.id);
      grouped.set(macroId, [...(grouped.get(macroId) ?? []), category]);
    });
    return grouped;
  }, [categories]);
  const availableMacroCategories = MACRO_CATEGORY_ORDER.filter(id => (categoriesByMacro.get(id)?.length ?? 0) > 0);
  const activeMacroCategory = macroCategoryId === "custom" || availableMacroCategories.includes(macroCategoryId)
    ? macroCategoryId
    : availableMacroCategories[0] ?? "custom";
  const isElectricalCategory = activeMacroCategory === "electrical";
  const databaseCategories = activeMacroCategory === "custom" ? [] : categoriesByMacro.get(activeMacroCategory) ?? [];
  const selectedDatabaseCategory = databaseCategories.find(category => category.id === databaseCategoryId) ?? databaseCategories[0];
  const databaseCategoryById = useMemo(() => new Map(categories.map(category => [category.id, category])), [categories]);
  const classification: AssetClassification = {
    categoryId: activeMacroCategory === "custom" ? "custom" : selectedDatabaseCategory?.id ?? "",
    categoryName: activeMacroCategory === "custom" ? "Custom" : macroCategoryDisplay(activeMacroCategory),
    subcategory: activeMacroCategory === "custom" ? customSubcategory.trim() : isElectricalCategory ? electricalSubcategory : selectedDatabaseCategory?.name ?? "",
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
    if (!isElectricalCategory || !selectedDatabaseCategory) {
      setElectricalSubcategories([]);
      setElectricalSubcategory("");
      setElectricalSubcategoriesLoading(false);
      return;
    }
    const controller = new AbortController();
    const base = apiUrl.replace(/\/+$/, "");
    setElectricalSubcategoriesLoading(true);
    void fetch(base + "/catalog/items?category_id=" + encodeURIComponent(selectedDatabaseCategory.id), { signal: controller.signal })
      .then(response => response.ok ? response.json() as Promise<CatalogueItem[]> : Promise.reject(new Error("Electrical catalogue items are unavailable.")))
      .then(items => {
        if (controller.signal.aborted) return;
        const subcategories = [...new Set(items.map(item => item.subcategory.trim()).filter(Boolean))]
          .sort((left, right) => left.localeCompare(right));
        setElectricalSubcategories(subcategories);
        setElectricalSubcategory(current => subcategories.includes(current) ? current : subcategories[0] ?? "");
        setCategoryError("");
      })
      .catch(reason => {
        if (!controller.signal.aborted) {
          setElectricalSubcategories([]);
          setElectricalSubcategory("");
          setCategoryError(reason instanceof Error ? reason.message : "Electrical catalogue items are unavailable.");
        }
      })
      .finally(() => { if (!controller.signal.aborted) setElectricalSubcategoriesLoading(false); });
    return () => controller.abort();
  }, [apiUrl, isElectricalCategory, selectedDatabaseCategory?.id]);

  function selectMacroCategory(nextId: string) {
    setMacroCategoryId(nextId === "custom" ? "custom" : nextId as MacroCategoryId);
    setDatabaseCategoryId("");
    setCategoryError("");
  }

  return <div className="modal-backdrop catalogue-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-dialog local-assets" role="dialog" aria-modal="true" aria-labelledby="local-assets-title" onKeyDown={event => { if (event.key === "Escape") onClose(); }}>
      <header className="local-assets-header">
        <div><span className="eyebrow">MY 3D MODELS</span><h2 id="local-assets-title">My 3D models</h2></div>
        <div className="local-asset-actions">
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close models">×</button>
        </div>
      </header>

      <div className="local-assets-content">
        <p className="local-assets-intro">Your personal models stay with your planner and can also be backed up to your private account. They are visual-only and never added to the shared built-in catalogue or used as fit evidence.</p>
        <div className="local-asset-classification" aria-label="Personal asset category">
          <label>Category
            <select value={activeMacroCategory} disabled={categoriesLoading} onChange={event => selectMacroCategory(event.target.value)}>
              {availableMacroCategories.map(categoryId => <option value={categoryId} key={categoryId}>{macroCategoryDisplay(categoryId)}</option>)}
              <option value="custom">Custom</option>
            </select>
          </label>
          {activeMacroCategory === "custom" ? <label>Subcategory
            <input value={customSubcategory} maxLength={120} onChange={event => setCustomSubcategory(event.target.value)} placeholder="e.g. Workshop furniture" />
          </label> : <label>Subcategory
            <select
              aria-label="Catalogue subcategory"
              value={isElectricalCategory ? electricalSubcategory : selectedDatabaseCategory?.id ?? ""}
              disabled={categoriesLoading || databaseCategories.length === 0 || (isElectricalCategory && (electricalSubcategoriesLoading || electricalSubcategories.length === 0))}
              onChange={event => isElectricalCategory ? setElectricalSubcategory(event.target.value) : setDatabaseCategoryId(event.target.value)}
            >
              {isElectricalCategory
                ? electricalSubcategories.length
                  ? electricalSubcategories.map(subcategory => <option value={subcategory} key={subcategory}>{subcategory}</option>)
                  : <option value="">{electricalSubcategoriesLoading ? "Loading subcategories…" : "No subcategories available"}</option>
                : databaseCategories.length
                  ? databaseCategories.map(category => <option value={category.id} key={category.id}>{category.name}</option>)
                  : <option value="">No subcategories available</option>}
            </select>
          </label>}
        </div>
        {categoryError && <p className="local-asset-taxonomy-note" role="status">Catalogue taxonomy could not be refreshed. “Custom” remains available; database categories need the catalogue service.</p>}

        <AddCustomAssetDialog
          classification={classification}
          onImport={onImport}
        />
          {assets.length ? <div className="local-asset-list" aria-label="Personal models">
            {assets.map(asset => <article className="local-asset-card" key={asset.assetId}>
              <div className="local-asset-card-heading"><div><span>{asset.categoryName ?? databaseCategoryById.get(asset.categoryId ?? "")?.name ?? "Custom"} · {asset.subcategory ?? "General"}</span><strong>{asset.name}</strong></div>
                <code>{Object.values(asset.computedBoundsMm).map(value => Math.round(value)).join(" × ")} mm</code></div>
              {asset.declaredDimensionsMm && <p>Declared size: {asset.declaredDimensionsMm.width} × {asset.declaredDimensionsMm.depth} × {asset.declaredDimensionsMm.height} mm ({asset.dimensionAuthority ?? "unverified"})</p>}
              <button type="button" className="local-asset-secondary" onClick={() => onChange([...instances, { instanceId: crypto.randomUUID(), assetId: asset.assetId, assetVersion: 1, positionMm: { x: 1000, y: 1000, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }])}>Place in 3D</button>
            </article>)}
          </div> : <div className="local-asset-empty"><strong>No personal models yet</strong><span>Import a 3D model or generate one from photos.</span></div>}
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
      </div>
    </section>
  </div>;
}
