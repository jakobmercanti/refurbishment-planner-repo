"use client";
import { useState } from "react";
import { useEnergyLayout } from "./EnergyLayoutContext";
import { NumberField } from "./EnergyNumberField";
import { parseEnergyProject, type ThermalMaterial } from "@/lib/energyDocument";
import styles from "./HeatingLayoutPanel.module.css";

/** Project database: the same persisted materials consumed by wall calculations. */
export function ThermalMaterialsLibrary({ search = "" }: { search?: string }) {
  const energy = useEnergyLayout();
  const [error, setError] = useState("");
  const [sampleThickness, setSampleThickness] = useState(100);
  function save(materials: ThermalMaterial[]) {
    try { energy.change(parseEnergyProject({ ...energy.data, materials })); setError(""); }
    catch { setError("Check the material values. Conductivity must be positive and resistance non-negative."); }
  }
  function edit(id: string, patch: Partial<ThermalMaterial>) {
    save(energy.data.materials.map(material => material.materialId === id ? { ...material, ...patch } : material));
  }
  const query = search.toLowerCase().trim();
  return <section className={styles.panel} aria-label="Thermal materials database">
    <div className={styles.sectionHeading}><h3>Materials · thermal library</h3><button onClick={() => save([...energy.data.materials, { materialId: crypto.randomUUID(), name: "New material", category: "Construction", lambda: null, resistance: null, density: null, vapourResistance: null, reference: "User-defined material; verify product data.", editable: true }])} disabled={energy.data.materials.length >= 300}>+ Add material</button></div>
    <p>Saved with this project and used by every wall referencing the material. Individual layer overrides remain independent.</p>
    {error && <p role="alert">{error}</p>}
    <details><summary>Conductivity, resistance & U-value</summary><p>λ is a material property. R depends on thickness: R = thickness / 1000 / λ. A fixed tested/cavity R overrides λ. A wall U-value also includes all other layers and surface resistances; a material has no universal U-value.</p><NumberField label="Sample thickness mm" value={sampleThickness} min={.1} max={3000} onChange={v => { if (v) setSampleThickness(v); }} /><p>The layer-only conductance below is 1/R at this sample thickness, not the full wall U-value.</p><p>Defaults are indicative, not certified installation values. Density, moisture, temperature and product grade matter. Cavity defaults assume an unventilated vertical air gap with ordinary surfaces, at least 25 mm deep.</p></details>
    {energy.data.materials.filter(m => `${m.name} ${m.category} ${m.reference}`.toLowerCase().includes(query)).map(m => {
      const r = m.resistance != null ? sampleThickness >= (m.resistanceMinThicknessMm ?? 0) && (m.resistanceReferenceThicknessMm == null || Math.abs(sampleThickness - m.resistanceReferenceThicknessMm) < .001) ? m.resistance : null : m.lambda ? sampleThickness / 1000 / m.lambda : null;
      const source = m.reference.match(/https:\/\/[^\s]+/)?.[0];
      return <details key={m.materialId}><summary>{m.name} · {m.resistance != null ? `R ${m.resistance}` : m.lambda != null ? `λ ${m.lambda}` : "Not set"}</summary>
        <div className={styles.grid}><label>Material name<input value={m.name} maxLength={2000} onChange={e => edit(m.materialId, { name: e.target.value })} /></label><label>Category<select value={m.category} onChange={e => edit(m.materialId, { category: e.target.value })}>{[...new Set(["Construction", "Insulation", "Masonry", m.category])].map(c => <option key={c}>{c}</option>)}</select></label>
          <NumberField label="Conductivity λ W/mK" value={m.lambda} min={.001} max={20} onChange={lambda => edit(m.materialId, { lambda })} /><NumberField label="Fixed layer resistance R m²K/W (optional)" value={m.resistance ?? null} max={100} onChange={resistance => edit(m.materialId, { resistance })} />
          <NumberField label={`Layer-only U / conductance W/m²K at ${sampleThickness} mm`} value={r && r > 0 ? 1 / r : null} min={.01} max={1000} onChange={v => edit(m.materialId, { resistance: v ? 1 / v : null, resistanceReferenceThicknessMm: v ? sampleThickness : null, resistanceMinThicknessMm: 0 })} />
          {m.resistance != null && <><NumberField label="Minimum thickness for fixed R mm" value={m.resistanceMinThicknessMm ?? 0} max={3000} onChange={v => edit(m.materialId, { resistanceMinThicknessMm: v ?? 0 })} /><NumberField label="Tested R applies at thickness mm (blank: any)" value={m.resistanceReferenceThicknessMm ?? null} min={.1} max={3000} onChange={v => edit(m.materialId, { resistanceReferenceThicknessMm: v })} /></>}
        </div>
        <p>At {sampleThickness} mm: R {r?.toFixed(3) ?? "Not set"} m²K/W · Layer-only conductance {r && r > 0 ? (1 / r).toFixed(3) : "Not set"} W/m²K</p>
        <label>Source & conditions<textarea value={m.reference} maxLength={2000} rows={3} onChange={e => edit(m.materialId, { reference: e.target.value })} /></label>{source && <a href={source} target="_blank" rel="noreferrer">Open thermal source ↗</a>}
      </details>;
    })}
  </section>;
}
