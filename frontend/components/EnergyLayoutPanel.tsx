"use client";
import { useMemo, useState } from "react";
import type { Room } from "@/lib/types";
import type { HeatingProject } from "@/lib/heatingDocument";
import { ENERGY_DISCLAIMER, newAssembly, type ConstructionAssembly, type EnergyProject } from "@/lib/energyDocument";
import { calculateAssemblyUValue, energyResults, scenarioAssignments, type EnergyElement } from "@/lib/energyCalculations";
import { assemblyThickness, fabricTargetScore, resizeAssembly, setWallAssembly, wallThicknessForElement } from "@/lib/energyWallConstruction";
import { buildEnergyPdf } from "@/lib/energyExport";
import { WallLayersPreview } from "./WallLayersPreview";
import styles from "./HeatingLayoutPanel.module.css";
import ui from "./EnergyLayoutPanel.module.css";
import { NumberField } from "./EnergyNumberField";
import { WallLayersEditor } from "./WallLayersEditor";

export function EnergyLayoutPanel({ rooms, data, heating, onChange, onHeatingChange, selectedIds, onSelect, onUndo, onRedo, canUndo, canRedo, projectName }: { rooms: Room[]; data: EnergyProject; heating: HeatingProject; onChange: (data: EnergyProject) => void; onHeatingChange: (data: HeatingProject) => void; selectedIds: string[]; onSelect: (ids: string[]) => void; onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean; projectName: string }) {
  const [tab, setTab] = useState<"Walls" | "Results">("Walls"), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{ source: EnergyProject; assembly: ConstructionAssembly; element: EnergyElement; thickness: number } | null>(null);
  const result = useMemo(() => energyResults(rooms, heating, data), [rooms, heating, data]);
  const walls = result.elements.filter(e => e.category === "wall"), first = walls.find(e => selectedIds.includes(e.elementId)), assignments = scenarioAssignments(data);
  const assigned = assignments.find(a => a.elementId === first?.elementId), assembly = data.assemblies.find(a => a.assemblyId === assigned?.assemblyId);
  const construction = assembly ? calculateAssemblyUValue(assembly, data.materials) : null, score = fabricTargetScore(result.elements, data);
  const update = (next: EnergyProject) => { setError("");onChange(next); };
  const edit = (a: ConstructionAssembly) => { if (!first) return;const total = assemblyThickness(a);if (total < 1 || total > 2000) { setError("Overall wall thickness must be between 1 and 2000 mm.");return; }update(setWallAssembly(data, first, { ...a, directUValue: null })); };
  async function exportPdf() { setBusy(true);try { const bytes = await buildEnergyPdf(rooms, heating, data, projectName), url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: "application/pdf" })), a = document.createElement("a");a.href = url;a.download = "energy-insulation-report.pdf";a.click();setTimeout(() => URL.revokeObjectURL(url), 30000); } catch (e) { setError(e instanceof Error ? e.message : "Export failed."); } finally { setBusy(false); } }
  return <div className={styles.panel + " " + ui.panel} role="region" aria-label="Energy & Insulation controls">
    <div className={styles.actions}><label><input type="checkbox" checked={data.enabled} onChange={e => update({ ...data, enabled: e.target.checked, display: { ...data.display, walls: true, labels: true, heatLoss: true } })} /> Energy overlay</label><button onClick={onUndo} disabled={!canUndo}>Undo energy</button><button onClick={onRedo} disabled={!canRedo}>Redo energy</button></div>
    <p className={ui.buildingSummary}><strong>Overall heating loss: {(result.designW / 1000).toFixed(2)} kW</strong> · H {Math.round(result.coefficient.total)} W/K</p>
    <div className={styles.tabs} role="tablist" aria-label="Energy & Insulation tabs">{(["Walls", "Results"] as const).map(t => <button key={t} role="tab" aria-selected={t === tab} onClick={() => setTab(t)}>{t}</button>)}</div>
    {error && <p role="alert" className={styles.warning}>{error}</p>}
    {tab === "Walls" && <>
      <label>Select wall<select aria-label="Select wall" value={first?.elementId ?? ""} onChange={e => onSelect(e.target.value ? [e.target.value] : [])}><option value="">Select a wall on the plan or here…</option>{walls.map(e => <option key={e.elementId} value={e.elementId}>{e.label} · {e.boundary}</option>)}</select></label>
      {!first && <p>Click a coloured wall to edit its construction. Dimensions come from the floorplan.</p>}
      {first && <div key={first.elementId}>
        <div className={ui.wallSummary}><strong>{first.label}</strong><div className={ui.wallMetrics}><span>{Number(wallThicknessForElement(first, rooms).toFixed(2))} mm</span><span>{first.areaM2.toFixed(1)} m²</span><span>U {construction?.uValue != null ? construction.uValue.toFixed(3) : assigned?.uValue != null ? assigned.uValue.toFixed(3) : "Not set"} W/m²K</span><span>{Math.round(first.heatLossW)} W{construction?.uValue == null && assigned?.uValue == null ? " (estimated)" : ""}</span></div></div>
        <WallLayersPreview assembly={assembly ?? { assemblyId: first.elementId, name: first.label, category: "wall", rsi: .13, rse: .04, directUValue: null, notes: "", layers: [{ layerId: "undefined-wall", materialId: "undefined-wall", thicknessMm: wallThicknessForElement(first, rooms), resistanceOverride: null, position: "Within", upgrade: false, colorHex: "#c4b09b" }] }} materials={data.materials} />
        <div className={ui.wallActions}><button className={styles.primary} onClick={() => setEditor({ source: data, element: first, thickness: wallThicknessForElement(first, rooms), assembly: structuredClone(assembly ?? newAssembly({ name: first.label, category: "wall", materials: [["custom-0", wallThicknessForElement(first, rooms)]] })) })}>Define layers <span aria-hidden>›</span></button><small>{assembly ? `${assembly.layers.length} layers · edit materials, thickness & insulation targets` : "No layers defined yet · choose a preset or build your own"}</small></div>
        <details><summary>Wall thickness & shared heating calculation</summary>
          <NumberField label="Overall wall thickness mm" value={wallThicknessForElement(first, rooms)} min={1} max={2000} onChange={v => { if (v && assembly) edit(resizeAssembly(assembly, v));else if (v) edit(newAssembly({ name: first.label, category: "wall", materials: [["custom-0", v]] })); }} />
          <small>Overall thickness stays linked to the floorplan and scales existing layers proportionally. Room boundaries do not move. Use Define layers for individual thicknesses.</small>
          <p>{assembly ? construction?.method : `No composition defined. U ${first.uValue.toFixed(2)} is a Heating Layout assumption, not a layer calculation.`}</p>
          <p>Wall loss = U × {first.areaM2.toFixed(2)} m² × {first.deltaTK.toFixed(1)} K. Heating Layout uses the saved wall construction.</p>
        </details>

      </div>}
      {data.scenarios.length > 0 && <details><summary>Saved construction scenario</summary><select aria-label="Building scenario" value={data.activeScenarioId ?? ""} onChange={e => update({ ...data, activeScenarioId: e.target.value || null })}><option value="">Existing Building</option>{data.scenarios.map(s => <option key={s.scenarioId} value={s.scenarioId}>{s.name}</option>)}</select><small>Other saved scenarios are retained.</small></details>}
    </>}
    {tab === "Results" && <>
      <h3>Overall results</h3><dl className={styles.totals}><dt>Overall heating loss</dt><dd>{(result.designW / 1000).toFixed(2)} kW</dd><dt>Floor area</dt><dd>{result.areaM2.toFixed(1)} m²</dd><dt>Heat-loss coefficient</dt><dd>{Math.round(result.coefficient.total)} W/K</dd><dt>Fabric target score</dt><dd>{score.score === null ? "Not set" : `${score.score}/100`}</dd><dt>Defined fabric coverage</dt><dd>{score.coveragePercent}%</dd></dl>
      <details><summary>How the score is calculated</summary><small>Score = area-weighted min(1, your target U / actual U) × 100 for explicitly defined exposed fabric. 100 means your selected targets are met, not an EPC or annual energy score. Undefined elements are excluded; coverage shows how much fabric is assessed.</small></details>
      <details><summary>Edit project U-value targets used in the score</summary>{Object.entries(data.targets).map(([key, v]) => <NumberField key={key} label={`${key} target U W/m²K`} value={v} min={.001} max={10} onChange={n => { if (n) update({ ...data, targets: { ...data.targets, [key]: n } }); }} />)}</details>
      <details><summary>Heat-loss breakdown by element & room</summary>{result.categories.map(c => <p key={c.category}>{c.category}: {(c.lossW / 1000).toFixed(2)} kW</p>)}<p>Ventilation: {(result.ventilationW / 1000).toFixed(2)} kW</p>
      {result.rooms.map(r => <p key={r.room.id}>{r.room.name}: {Math.round(r.loss.designW)} W · {r.loss.targetC}°C · ACH {r.loss.ach}</p>)}</details>
      <details><summary>Shared heating design assumptions</summary><NumberField label="External design temperature °C" value={heating.buildingSettings.externalDesignTemperatureC} min={-50} max={25} onChange={v => { if (v !== null) onHeatingChange({ ...heating, buildingSettings: { ...heating.buildingSettings, externalDesignTemperatureC: v } }); }} /><NumberField label="Building ACH" value={heating.buildingSettings.airChangeRate} max={10} onChange={v => { if (v !== null) onHeatingChange({ ...heating, buildingSettings: { ...heating.buildingSettings, airChangeRate: v } }); }} /><small>Shared with Heating Layout; room overrides remain respected.</small></details>
      <details><summary>Official UK U-value guidance</summary><p>Select your nation and applicable edition. New-build, extension and renovation requirements differ; check transitional provisions. These links do not certify this model.</p>
      <p><a href="https://www.gov.uk/government/publications/conservation-of-fuel-and-power-approved-document-l" target="_blank" rel="noreferrer">England — Approved Document L and applicable editions</a></p><p><a href="https://www.gov.wales/approved-document-l-conservation-fuel-and-power" target="_blank" rel="noreferrer">Wales — Approved Document L</a></p><p><a href="https://www.gov.scot/collections/building-standards/" target="_blank" rel="noreferrer">Scotland — Technical Handbooks, Section 6</a></p><p><a href="https://www.finance-ni.gov.uk/articles/building-regulations-technical-booklets" target="_blank" rel="noreferrer">Northern Ireland — Technical Booklet F1 and amendments</a></p></details>
      <button disabled={busy} onClick={() => void exportPdf()}>{busy ? "Exporting…" : "Export Energy Report PDF"}</button>{!result.verified && <p className={styles.warning}>Some fabric inputs are incomplete. Heating fallback assumptions are included in overall loss, not claimed as calculated layer values.</p>}
    </>}
    <details className={styles.disclaimer}><summary>Planning assumptions & limitations</summary><p>{ENERGY_DISCLAIMER}</p></details>
    {editor && <WallLayersEditor source={editor.source} initialAssembly={editor.assembly} element={editor.element} rooms={rooms} heating={heating} stale={editor.source !== data || editor.element.elementId !== first?.elementId || editor.element.geometrySignature !== first?.geometrySignature || editor.element.deltaTK !== first?.deltaTK || editor.element.areaM2 !== first?.areaM2 || editor.thickness !== wallThicknessForElement(editor.element, rooms)} onCancel={() => setEditor(null)} onCommit={next => { update(next);setEditor(null); }} />}
  </div>;
}
