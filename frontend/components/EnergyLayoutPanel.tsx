"use client";
import { isInsulationSelectable } from "@/lib/energyCalculations";
import { useMemo, useState } from "react";
import type { Room } from "@/lib/types";
import type { HeatingProject } from "@/lib/heatingDocument";
import { type ConstructionAssembly, type EnergyProject, type ElementAssignment } from "@/lib/energyDocument";
import { calculateAssemblyUValue, energyResults, scenarioAssignments, type EnergyElement } from "@/lib/energyCalculations";
import { assemblyThickness, createElementAssemblyDraft, fabricTargetScore, resizeAssembly, setWallAssembly, wallThicknessForElement } from "@/lib/energyWallConstruction";
import { buildEnergyPdf } from "@/lib/energyExport";
import { WallLayersPreview } from "./WallLayersPreview";
import styles from "./HeatingLayoutPanel.module.css";
import ui from "./EnergyLayoutPanel.module.css";
import { NumberField } from "./EnergyNumberField";
import { WallLayersEditor } from "./WallLayersEditor";
import { removeEnergyScenario, renameEnergyScenario, saveEnergyScenarioAs } from "@/lib/energyScenarios";

export function EnergyLayoutPanel({ rooms, data, heating, onChange, onHeatingChange, selectedIds, onSelect, onUndo, onRedo, canUndo, canRedo, projectName }: { rooms: Room[]; data: EnergyProject; heating: HeatingProject; onChange: (data: EnergyProject) => void; onHeatingChange: (data: HeatingProject) => void; selectedIds: string[]; onSelect: (ids: string[]) => void; onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean; projectName: string }) {
  const [tab, setTab] = useState<"Walls" | "Floors" | "Roofs" | "Openings" | "Results">("Walls"), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [newScenarioName, setNewScenarioName] = useState(""), [scenarioNameDraft, setScenarioNameDraft] = useState<{ id: string; text: string } | null>(null);
  const [resultsSelection, setResultsSelection] = useState<string | undefined>();
  const [editor, setEditor] = useState<{ source: EnergyProject; draft: EnergyProject; assembly: ConstructionAssembly; element: EnergyElement; thickness: number } | null>(null);
  const result = useMemo(() => energyResults(rooms, heating, data), [rooms, heating, data]);
  const categories = { Walls: "wall", Floors: "floor", Roofs: "roof", Openings: "window" } as const;
  const selected = result.elements.find(e => selectedIds.includes(e.elementId));
  const category = selected?.category ?? (tab === "Results" ? "wall" : categories[tab]);
  const activeTab = tab === "Results" && resultsSelection === selectedIds[0] ? tab : category === "floor" ? "Floors" : category === "roof" ? "Roofs" : ["window", "door"].includes(category) ? "Openings" : "Walls";
  const walls = result.elements.filter(e => (["window", "door"].includes(category) ? ["window", "door"].includes(e.category) : e.category === category) && (isInsulationSelectable(e) || selectedIds.includes(e.elementId))), first = selected, assignments = scenarioAssignments(data);
  const elementName = category === "floor" ? "floor" : category === "roof" ? "roof" : ["window", "door"].includes(category) ? "opening" : "wall";
  const activeScenario = data.scenarios.find(s => s.scenarioId === data.activeScenarioId);
  const scenarioLabel = activeScenario?.name ?? "Existing Building";
  const editableScenarioName = scenarioNameDraft && scenarioNameDraft.id === activeScenario?.scenarioId ? scenarioNameDraft.text : activeScenario?.name ?? "";
  const assigned = assignments.find(a => a.elementId === first?.elementId), assembly = data.assemblies.find(a => a.assemblyId === assigned?.assemblyId);
  const scenarioOverride = activeScenario?.assignments.some(a => a.elementId === first?.elementId) ?? false;
  const shownThickness = first ? assembly ? assemblyThickness(assembly) : first.category === "wall" ? wallThicknessForElement(first, rooms) : 200 : 0;
  const construction = assembly ? calculateAssemblyUValue(assembly, data.materials) : null, score = fabricTargetScore(result.elements, data);
  const update = (next: EnergyProject) => { setError("");onChange(next); };
  const editOpeningPerformance = (patch: Partial<ElementAssignment>) => {
    if (!first) return;
    const assignment: ElementAssignment = { elementId: first.elementId, assemblyId: null, uValue: null, ...assigned, ...patch };
    const put = (values: ElementAssignment[]) => [...values.filter(a => a.elementId !== first.elementId), assignment];
    update(activeScenario ? { ...data, scenarios: data.scenarios.map(s => s.scenarioId === activeScenario.scenarioId ? { ...s, assignments: put(s.assignments) } : s) }
      : { ...data, existingAssignments: put(data.existingAssignments) });
  };
  const openLayerEditor = () => { if (first) { const draft = createElementAssemblyDraft(data, first, shownThickness); setEditor({ source: data, draft: draft.data, element: first, thickness: shownThickness, assembly: draft.assembly }); } };
  const saveScenario = () => { try { update(saveEnergyScenarioAs(data, newScenarioName || `Upgrade ${data.scenarios.length + 1}`));setNewScenarioName(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save scenario."); } };
  const renameScenario = () => { if (!activeScenario || editableScenarioName === activeScenario.name) return;try { update(renameEnergyScenario(data, activeScenario.scenarioId, editableScenarioName));setScenarioNameDraft(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not rename scenario.");setScenarioNameDraft(null); } };
  const edit = (a: ConstructionAssembly, draft = data) => { if (!first) return;const total = assemblyThickness(a);if (total < 1 || total > 2000) { setError("Overall wall thickness must be between 1 and 2000 mm.");return; }update(setWallAssembly(draft, first, { ...a, directUValue: null })); };
  async function exportPdf() { setBusy(true);try { const bytes = await buildEnergyPdf(rooms, heating, data, projectName), url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: "application/pdf" })), a = document.createElement("a");a.href = url;a.download = "energy-insulation-report.pdf";a.click();setTimeout(() => URL.revokeObjectURL(url), 30000); } catch (e) { setError(e instanceof Error ? e.message : "Export failed."); } finally { setBusy(false); } }
  return <div className={styles.panel + " " + ui.panel} role="region" aria-label="Energy & Insulation controls">
    <div className={ui.summaryRow}><p className={ui.buildingSummary}><strong>Overall heating loss: {(result.designW / 1000).toFixed(2)} kW</strong> · H {Math.round(result.coefficient.total)} W/K</p><div className={styles.actions}><button onClick={onUndo} disabled={!canUndo}>Undo</button><button onClick={onRedo} disabled={!canRedo}>Redo</button></div></div>
    <div className={ui.sectionNav}><div className={`${styles.tabs} ${ui.energyTabs}`} role="tablist" aria-label="Energy & Insulation tabs">{(["Walls", "Floors", "Roofs", "Openings", "Results"] as const).map(t => <button key={t} role="tab" aria-selected={t === activeTab} onClick={() => { setTab(t); if (t === "Results") setResultsSelection(selectedIds[0]); if (t !== "Results") { const target = result.elements.find(e => e.category === categories[t] || t === "Openings" && e.category === "door"); onSelect(target ? [target.elementId] : []); } }}>{t}</button>)}</div></div>
    {error && <p role="alert" className={styles.warning}>{error}</p>}
    {activeTab !== "Results" && <>
      <details className={ui.scenarioPanel}><summary>Construction scenarios · {scenarioLabel}</summary><section aria-label="Construction scenarios">
        <div><strong>Editing: {scenarioLabel}</strong></div>
        <label>Load construction scenario<select aria-label="Load construction scenario" value={data.activeScenarioId ?? ""} onChange={e => update({ ...data, activeScenarioId: e.target.value || null })}><option value="">Existing Building</option>{data.scenarios.map(s => <option key={s.scenarioId} value={s.scenarioId}>{s.name}</option>)}</select></label>
        <div className={ui.scenarioActions}><label>New scenario name<input value={newScenarioName} maxLength={80} placeholder={`Upgrade ${data.scenarios.length + 1}`} onChange={e => setNewScenarioName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveScenario(); }} /></label><button type="button" onClick={saveScenario} disabled={data.scenarios.length >= 100}>Save as new scenario</button></div>
        {activeScenario && <div className={ui.scenarioActions}><label>Rename active scenario<input value={editableScenarioName} maxLength={80} onChange={e => setScenarioNameDraft({ id: activeScenario.scenarioId, text: e.target.value })} onBlur={renameScenario} onKeyDown={e => { if (e.key === "Enter") { e.currentTarget.blur(); } }} /></label><button type="button" onClick={renameScenario}>Save name</button><button type="button" onClick={() => { if (window.confirm(`Delete scenario “${activeScenario.name}”? Existing Building and other scenarios will be kept.`)) update(removeEnergyScenario(data, activeScenario.scenarioId)); }}>Delete scenario</button></div>}
      </section></details>
      <label>Select {elementName}<select aria-label={`Select ${elementName}`} value={first?.elementId ?? ""} onChange={e => onSelect(e.target.value ? [e.target.value] : [])}><option value="">Select {elementName} on the plan or here…</option>{walls.map(e => <option key={e.elementId} value={e.elementId}>{e.label} · {e.boundary}</option>)}</select></label>
      {first && <div className={ui.constructionSection} key={first.elementId}>
        <div className={ui.wallSummary}><strong>{first.label} · {scenarioLabel}</strong>{activeScenario && <small>{scenarioOverride ? "This element has a construction override in this scenario." : "Inherited from Existing Building. Editing creates an override here only."}</small>}<div className={ui.wallMetrics}><span>{Number(shownThickness.toFixed(2))} mm</span><span>{first.areaM2.toFixed(1)} m²</span><span>{first.warnings.length || assigned?.uValue == null && (construction?.uValue == null || construction.estimated) ? "Estimated U" : "U"} {first.uValue.toFixed(3)} W/m²K</span><span>{Math.round(first.heatLossW)} W{construction?.uValue == null && assigned?.uValue == null ? " (estimated)" : ""}</span></div></div>
        {elementName === "opening" && <div className={styles.grid}><NumberField label="Opening overall U W/m²K" value={assigned?.uValue ?? null} min={.001} max={10} onChange={uValue => editOpeningPerformance({ uValue })} />{first.category === "window" && <NumberField label="Glazing g / SHGC (0–1)" value={assigned?.solarGainValue ?? null} min={0} max={1} onChange={solarGainValue => editOpeningPerformance({ solarGainValue })} />}</div>}
        {elementName === "opening" && <><label>Opening boundary<select value={assigned?.boundary ?? "Auto"} onChange={e => editOpeningPerformance({ boundary: e.target.value as ElementAssignment["boundary"] })}>{["Auto", "External", "Heated", "Unheated", "Adiabatic"].map(value => <option key={value}>{value}</option>)}</select></label><NumberField label="Opening adjacent temperature °C" value={assigned?.adjacentTemperatureC ?? null} min={-50} max={40} onChange={adjacentTemperatureC => editOpeningPerformance({ adjacentTemperatureC: adjacentTemperatureC ?? undefined })} /></>}
        {elementName !== "opening" && <><button className={`${styles.primary} ${ui.defineLayers}`} onClick={openLayerEditor}>Define {elementName} layers <span aria-hidden>›</span></button>
        <WallLayersPreview assembly={assembly ?? { assemblyId: first.elementId, name: first.label, category: first.category, rsi: first.category === "roof" ? .10 : first.category === "floor" ? .17 : .13, rse: .04, directUValue: null, notes: "", layers: [{ layerId: "undefined-wall", materialId: "undefined-wall", thicknessMm: shownThickness, resistanceOverride: null, position: "Within", upgrade: false, colorHex: "#c4b09b" }] }} materials={data.materials} />
        <details><summary>{elementName === "wall" ? "Wall thickness" : "Construction thickness"} & shared heating calculation</summary>
          <NumberField label={`Overall ${elementName} thickness mm`} value={shownThickness} min={1} max={2000} onChange={v => { if (v) { const draft = createElementAssemblyDraft(data, first, shownThickness); edit(resizeAssembly(draft.assembly, v), draft.data); } }} />
          <p>{assembly ? construction?.method : `No composition defined. U ${first.uValue.toFixed(2)} is a Heating Layout assumption, not a layer calculation.`}</p>
          <p>{elementName} loss = U × {first.areaM2.toFixed(2)} m² × {first.deltaTK.toFixed(1)} K.</p>
        </details></>}

      </div>}
    </>}
    {activeTab === "Results" && <>
      <h3>Overall results · {scenarioLabel}</h3><dl className={styles.totals}><dt>Overall heating loss</dt><dd>{(result.designW / 1000).toFixed(2)} kW</dd><dt>Floor area</dt><dd>{result.areaM2.toFixed(1)} m²</dd><dt>Heat-loss coefficient</dt><dd>{Math.round(result.coefficient.total)} W/K</dd><dt>Fabric target score</dt><dd>{score.score === null ? "Not set" : `${score.score}/100`}</dd><dt>Defined fabric coverage</dt><dd>{score.coveragePercent}%</dd></dl>
      <details><summary>Edit project U-value targets used in the score</summary>{Object.entries(data.targets).map(([key, v]) => <NumberField key={key} label={`${key} target U W/m²K`} value={v} min={.001} max={10} onChange={n => { if (n) update({ ...data, targets: { ...data.targets, [key]: n } }); }} />)}</details>
      <details><summary>Heat-loss breakdown by element & room</summary>{result.categories.map(c => <p key={c.category}>{c.category}: {(c.lossW / 1000).toFixed(2)} kW</p>)}<p>Ventilation: {(result.ventilationW / 1000).toFixed(2)} kW</p>
      {result.rooms.map(r => <p key={r.room.id}>{r.room.name}: {Math.round(r.loss.designW)} W · {r.loss.targetC}°C · ACH {r.loss.ach}</p>)}</details>
      <details><summary>Shared heating design assumptions</summary><NumberField label="External design temperature °C" value={heating.buildingSettings.externalDesignTemperatureC} min={-50} max={25} onChange={v => { if (v !== null) onHeatingChange({ ...heating, buildingSettings: { ...heating.buildingSettings, externalDesignTemperatureC: v } }); }} /><NumberField label="Building ACH" value={heating.buildingSettings.airChangeRate} max={10} onChange={v => { if (v !== null) onHeatingChange({ ...heating, buildingSettings: { ...heating.buildingSettings, airChangeRate: v } }); }} /></details>
      <button disabled={busy} onClick={() => void exportPdf()}>{busy ? "Exporting…" : "Export Energy Report PDF"}</button>{!result.verified && <p className={styles.warning}>Some fabric inputs are incomplete. Heating fallback assumptions are included in overall loss, not claimed as calculated layer values.</p>}
    </>}
    {editor && <WallLayersEditor source={editor.draft} initialAssembly={editor.assembly} element={editor.element} rooms={rooms} heating={heating} scenarioName={scenarioLabel} stale={editor.source !== data || editor.element.elementId !== first?.elementId || editor.element.geometrySignature !== first?.geometrySignature || editor.element.deltaTK !== first?.deltaTK || editor.element.areaM2 !== first?.areaM2 || editor.thickness !== shownThickness} onCancel={() => setEditor(null)} onCommit={next => { update(next);setEditor(null); }} />}
  </div>;
}
