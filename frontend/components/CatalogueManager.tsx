"use client";

import { useEffect, useRef, useState } from "react";
import type { CatalogueCategory, CatalogueItem } from "@/lib/types";

interface CatalogueManagerProps { apiUrl: string; open: boolean; opener: HTMLElement | null; onClose: () => void; }

const KINDS: Record<string, "SHOWER" | "BASIN" | "TOILET" | "FURNITURE"> = {
  showers: "SHOWER", basins: "BASIN", toilets: "TOILET", storage: "FURNITURE",
};

function trapFocus(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((element) => element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0]; const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

export function CatalogueManager({ apiUrl, open, opener, onClose }: CatalogueManagerProps) {
  const [categories, setCategories] = useState<CatalogueCategory[]>([]);
  const [status, setStatus] = useState<string>("");
  const [pending, setPending] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [form, setForm] = useState({ source_url: "", page: "", category_id: "storage", subcategory: "General", fixture_kind: "FURNITURE", supplier: "", fallback_name: "", fallback_sku: "", width_mm: 600, depth_mm: 450, height_mm: 850, color_hex: "#B99B77", plan_shape: "RECTANGLE" });

  useEffect(() => {
    if (!open) return;
    openerRef.current = opener?.isConnected ? opener : null;
    closeRef.current?.focus();
    fetch(`${apiUrl}/catalog/categories`).then((response) => response.ok ? response.json() : Promise.reject()).then(setCategories).catch(() => setStatus("Catalogue categories are unavailable."));
    return () => { openerRef.current?.focus(); };
  }, [apiUrl, open, opener]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;
  const set = (key: string, value: string | number) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setPending(true); setStatus("Fetching and checking website catalogue…");
    try {
      const response = await fetch(`${apiUrl}/catalog/import-website`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const payload = await response.json() as { imported?: CatalogueItem[]; skipped?: string[]; detail?: string };
      if (!response.ok) throw new Error(payload.detail ?? "Website import failed.");
      const imported = payload.imported?.length ?? 0; const skipped = payload.skipped?.length ?? 0;
      setStatus(`${imported} item${imported === 1 ? "" : "s"} imported${skipped ? `; ${skipped} skipped` : ""}.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Website import failed."); }
    finally { setPending(false); }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="catalogue-manager-modal" role="dialog" aria-modal="true" aria-labelledby="catalogue-manager-title" onKeyDown={trapFocus}>
      <header><div><span className="eyebrow">Catalogue administration</span><h2 id="catalogue-manager-title">Object catalogue manager</h2></div><button ref={closeRef} className="modal-close" aria-label="Close catalogue manager" onClick={onClose}>×</button></header>
      <h3>Import from website</h3><p>The server reads Product JSON-LD when available. Enter verified fallback geometry in millimetres; website images and text never determine fit dimensions.</p>
      <form onSubmit={(event) => void submit(event)} className="catalogue-manager-form">
        <label className="field span-two"><span>Website / source URL</span><input required type="url" value={form.source_url} onChange={(event) => set("source_url", event.target.value)} placeholder="https://supplier.example" /></label>
        <label className="field span-two"><span>Page or path</span><input value={form.page} onChange={(event) => set("page", event.target.value)} placeholder="products/bathroom" /></label>
        <label className="field"><span>Category</span><select value={form.category_id} onChange={(event) => { const category_id = event.target.value; setForm((current) => ({ ...current, category_id, fixture_kind: KINDS[category_id] })); }}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label className="field"><span>Subcategory</span><input required value={form.subcategory} onChange={(event) => set("subcategory", event.target.value)} /></label>
        <label className="field"><span>Supplier</span><input required value={form.supplier} onChange={(event) => set("supplier", event.target.value)} /></label>
        <label className="field"><span>Fallback SKU</span><input required value={form.fallback_sku} onChange={(event) => set("fallback_sku", event.target.value)} /></label>
        <label className="field span-two"><span>Fallback item name</span><input required value={form.fallback_name} onChange={(event) => set("fallback_name", event.target.value)} /></label>
        {(["width_mm", "depth_mm", "height_mm"] as const).map((key) => <label className="field" key={key}><span>{key.replace("_mm", "").replace(/^./, (letter) => letter.toUpperCase())} (mm)</span><input required min="1" max="20000" type="number" value={form[key]} onChange={(event) => set(key, Number(event.target.value))} /></label>)}
        <label className="field"><span>Colour HEX</span><input required pattern="#[0-9A-Fa-f]{6}" value={form.color_hex} onChange={(event) => set("color_hex", event.target.value.toUpperCase())} /></label>
        <label className="field"><span>Floorplan shape</span><select value={form.plan_shape} onChange={(event) => set("plan_shape", event.target.value)}><option value="RECTANGLE">Rectangle / box</option><option value="ELLIPSE">Ellipse / cylinder</option></select></label>
        <div className="catalogue-manager-actions span-two"><button type="button" onClick={onClose}>Close</button><button className="primary" type="submit" disabled={pending}>{pending ? "Importing…" : "Import from website"}</button></div>
      </form><p className="catalogue-manager-status" role="status" aria-live="polite">{status}</p>
    </section>
  </div>;
}
