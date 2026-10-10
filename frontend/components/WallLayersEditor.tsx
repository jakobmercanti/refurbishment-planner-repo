"use client";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Popup } from "./Popup";
import { WallLayersPreview } from "./WallLayersPreview";
import { NumberField } from "./EnergyNumberField";
import { CONSTRUCTION_TEMPLATES, newAssembly, type ConstructionAssembly, type ConstructionLayer, type EnergyProject } from "@/lib/energyDocument";
import type { Room } from "@/lib/types";
import type { HeatingProject } from "@/lib/heatingDocument";
import { assignEnergyElements, energyElements, calculateAssemblyUValue, scenarioAssignments, type EnergyElement } from "@/lib/energyCalculations";
import { assemblyThickness, LAYER_COLOURS, minimumInsulationThickness, resizeAssembly, setWallAssembly } from "@/lib/energyWallConstruction";
import styles from "./HeatingLayoutPanel.module.css";
import ui from "./EnergyLayoutPanel.module.css";

/** Edits are local until Done: Cancel never changes geometry, heating or undo history. */
export function WallLayersEditor({ source, initialAssembly, element: first, rooms, heating, stale, onCancel, onCommit }: {
  source: EnergyProject; initialAssembly: ConstructionAssembly; element: EnergyElement; rooms: Room[]; heating: HeatingProject;
  stale: boolean; onCancel: () => void; onCommit: (data: EnergyProject) => void;
}) {
  const [data, setData] = useState(source), [assembly, setAssembly] = useState(initialAssembly);
  const [error, setError] = useState(""), [template, setTemplate] = useState(0);
  const [materialId, setMaterialId] = useState("pir-tw55"), [insulationLambda, setInsulationLambda] = useState<number | null>(null);
  const [targetMode, setTargetMode] = useState("U-value"), [powerTarget, setPowerTarget] = useState(100);
  const assigned = scenarioAssignments(data).find(a => a.elementId === first.elementId);
  const construction = calculateAssemblyUValue(assembly, data.materials), material = data.materials.find(m => m.materialId === materialId);
  const update = (next: EnergyProject) => { setError("");setData(next); };
  const edit = (next: ConstructionAssembly) => { const total = assemblyThickness(next);
    if (total < 1 || total > 2000) { setError("Overall wall thickness must be between 1 and 2000 mm.");return; }
    setError("");setAssembly({ ...next, directUValue: null });
  };
  const layerEdit = (id: string, patch: Partial<ConstructionLayer>) => edit({ ...assembly, layers: assembly.layers.map(l => l.layerId === id ? { ...l, ...patch } : l) });
  const thermal = useMemo(() => energyElements(rooms, heating, data).find(e => e.elementId === first.elementId) ?? first, [rooms, heating, data, first]);
  const targetU = targetMode === "U-value" ? data.targets.wall : thermal.areaM2 * thermal.deltaTK > 0 ? powerTarget / (thermal.areaM2 * thermal.deltaTK) : null;
  const chosenLambda = insulationLambda ?? material?.lambda ?? null;
  const suggested = targetU ? minimumInsulationThickness(assembly, data, chosenLambda, targetU) : null;
  if (typeof document === "undefined") return null;
  return createPortal(<div onKeyDown={event => { event.stopPropagation();if (event.key === "Escape") { event.preventDefault();onCancel(); } }}><Popup open className={"appearance-popup wall-layers-popup " + ui.popup}
    title="Define wall layers" message="" confirmLabel="Done" autoFocusTarget="content"
    confirmDisabled={stale || !!error} onCancel={onCancel} onConfirm={() => { if (!stale && !error) onCommit(setWallAssembly(data, first, assembly)); }}>
    <div className="appearance-popup-grid">
      <div className={"appearance-popup-form " + styles.panel}>
        <div className="appearance-object-heading"><h2>{first.label}</h2></div>
        <div className={ui.editorMetrics}><strong>{Number(assemblyThickness(assembly).toFixed(2))} mm total</strong><span>U {construction.uValue?.toFixed(3) ?? "Not set"} W/m²K</span><small>Wall heat loss: {construction.uValue === null ? "Not set" : `${Math.round(construction.uValue * thermal.areaM2 * thermal.deltaTK)} W`} · ΔT {thermal.deltaTK.toFixed(1)} K</small></div>
        {stale && <p role="alert" className={styles.warning}>The wall or project changed while editing. Cancel and reopen to use the latest model.</p>}
        {error && <p role="alert" className={styles.warning}>{error}</p>}
        <NumberField autoFocus label="Overall wall thickness mm" value={assemblyThickness(assembly)} min={1} max={2000} onChange={v => { if (v) edit(resizeAssembly(assembly, v)); }} />
        <details><summary>Starting composition</summary><label>Construction preset<select value={template} onChange={e => setTemplate(Number(e.target.value))}>{CONSTRUCTION_TEMPLATES.filter(t => t.category === "wall").map((t, i) => <option key={t.name} value={i}>{t.name}</option>)}</select></label>
          <div className={styles.actions}><button onClick={() => edit(resizeAssembly(newAssembly(CONSTRUCTION_TEMPLATES.filter(t => t.category === "wall")[template]), assemblyThickness(assembly)))}>Use preset layers</button><button onClick={() => edit(newAssembly({ name: first.label, category: "wall", materials: [["custom-0", assemblyThickness(assembly)]] }))}>Start custom wall</button></div>
          <small>Replaces only the layers in this draft. Presets are starting assumptions; confirm every material value.</small>
        </details>
        <><small>Outside → inside. Open a layer to edit its material and thickness.</small>
          {assembly.layers.map((l, i) => { const m = data.materials.find(m => m.materialId === l.materialId);return <details key={l.layerId} className={ui.layer} open={i === 0}><summary><span className={ui.swatch} style={{ background: l.colorHex ?? LAYER_COLOURS[i % LAYER_COLOURS.length] }} />Layer {i + 1} · {m?.name ?? "Custom material"} · {Number(l.thicknessMm.toFixed(2))} mm</summary>
            <label>Layer {i + 1} material<select value={l.materialId} onChange={e => layerEdit(l.layerId, { materialId: e.target.value, lambdaOverride: null, resistanceOverride: null })}>{data.materials.filter(m => m.category !== "Equivalent resistance").map(m => <option key={m.materialId} value={m.materialId}>{m.name}</option>)}</select></label>
            <div className={styles.grid}><NumberField label={`Layer ${i + 1} thickness mm`} value={l.thicknessMm} min={.1} max={2000} onChange={v => { if (v) layerEdit(l.layerId, { thicknessMm: v }); }} /><label>Layer {i + 1} colour<input type="color" style={{ height: 40, padding: 4 }} value={l.colorHex ?? LAYER_COLOURS[i % LAYER_COLOURS.length]} onChange={e => layerEdit(l.layerId, { colorHex: e.target.value })} /></label></div>
            <label>Layer {i + 1} installation position<select value={l.position} onChange={e => layerEdit(l.layerId, { position: e.target.value as ConstructionLayer["position"] })}>{["Outside", "Within", "Inside"].map(v => <option key={v}>{v}</option>)}</select></label>
            <details><summary>Thermal parameters & source</summary><div className={styles.grid}><NumberField label={`Layer ${i + 1} conductivity λ W/mK`} value={l.lambdaOverride ?? m?.lambda ?? null} min={.001} max={20} onChange={v => layerEdit(l.layerId, { lambdaOverride: v, resistanceOverride: null })} /><NumberField label={`Layer ${i + 1} entered resistance R (cavity / tested layer)`} value={l.resistanceOverride} max={100} onChange={v => layerEdit(l.layerId, { resistanceOverride: v })} /></div>
            <small>R {construction?.layers[i]?.resistance?.toFixed(3) ?? "Not set"} m²K/W · {m?.reference}</small></details>
            <div className={styles.actions}><button disabled={!i} onClick={() => { const layers = [...assembly.layers];[layers[i - 1], layers[i]] = [layers[i], layers[i - 1]];edit({ ...assembly, layers }); }}>Move layer {i + 1} up</button><button disabled={i === assembly.layers.length - 1} onClick={() => { const layers = [...assembly.layers];[layers[i], layers[i + 1]] = [layers[i + 1], layers[i]];edit({ ...assembly, layers }); }}>Move layer {i + 1} down</button><button disabled={assembly.layers.length === 1} onClick={() => edit({ ...assembly, layers: assembly.layers.filter(v => v.layerId !== l.layerId) })}>Remove layer {i + 1}</button></div>
          </details>; })}
          <button disabled={assembly.layers.length >= 100} onClick={() => edit({ ...assembly, layers: [...assembly.layers, { layerId: crypto.randomUUID(), materialId, thicknessMm: 25, resistanceOverride: null, position: "Inside", upgrade: true, colorHex: LAYER_COLOURS[assembly.layers.length % LAYER_COLOURS.length] }] })}>Add layer</button>
          <p><strong>Calculated U: {construction?.uValue?.toFixed(3) ?? "Not set — complete every λ or R"} W/m²K</strong></p>
          <details><summary>Calculation details & wall properties</summary><div className={styles.grid}><NumberField label="Inside surface resistance Rsi" value={assembly.rsi} max={10} onChange={v => { if (v !== null) edit({ ...assembly, rsi: v }); }} /><NumberField label="Outside surface resistance Rse" value={assembly.rse} max={10} onChange={v => { if (v !== null) edit({ ...assembly, rse: v }); }} /></div><p>R = thickness / 1000 / λ (or entered R); U = 1 / (Rsi + ΣR + Rse). Total R {construction?.totalR?.toFixed(3) ?? "Not set"}.</p><p>Wall loss = U × {thermal.areaM2.toFixed(2)} m² × {thermal.deltaTK.toFixed(1)} K. One-dimensional model; thermal bridges and moisture need professional assessment.</p><label>Wall boundary<select value={assigned?.boundary ?? "Auto"} onChange={e => update(assignEnergyElements(data, [{ ...assigned, elementId: first.elementId, assemblyId: assembly.assemblyId, uValue: null, geometrySignature: first.geometrySignature, boundary: e.target.value as "Auto" | "External" | "Heated" | "Unheated" | "Adiabatic" }]))}>{["Auto", "External", "Heated", "Unheated", "Adiabatic"].map(v => <option key={v}>{v}</option>)}</select></label><NumberField label="Adjacent temperature °C" value={assigned?.adjacentTemperatureC ?? null} min={-50} max={40} onChange={v => update(assignEnergyElements(data, [{ ...assigned, elementId: first.elementId, assemblyId: assembly.assemblyId, uValue: null, adjacentTemperatureC: v ?? undefined }]))} /></details>
          <details><summary>Find minimum additional insulation</summary><label>Insulation material<select value={materialId} onChange={e => { setMaterialId(e.target.value);setInsulationLambda(null); }}>{data.materials.filter(m => m.category === "Insulation").map(m => <option key={m.materialId} value={m.materialId}>{m.name}</option>)}</select></label>
          <NumberField label="Selected insulation conductivity λ W/mK" value={chosenLambda} min={.001} max={20} onChange={setInsulationLambda} /><small>Entered conductivity applies to this added insulation only, not other walls or the library.</small><label>Target type<select value={targetMode} onChange={e => setTargetMode(e.target.value)}><option>U-value</option><option>Wall power loss</option></select></label>
          {targetMode === "U-value" ? <NumberField label="Target wall U W/m²K" value={data.targets.wall} min={.001} max={10} onChange={v => { if (v) update({ ...data, targets: { ...data.targets, wall: v } }); }} /> : <NumberField label="Target wall power loss W at design temperature" value={powerTarget} min={.1} max={100000} onChange={v => { if (v) setPowerTarget(v); }} />}
          <p>{suggested === null ? "Complete the wall layers and insulation λ. A power target needs positive area and temperature difference." : suggested === 0 ? "This wall already meets your target." : `Minimum additional insulation: ${suggested} mm (λ ${chosenLambda}); target U ${targetU?.toFixed(3)} W/m²K.`}</p>
          <button disabled={!suggested || assembly.layers.length >= 100 || assemblyThickness(assembly) + suggested > 2000} onClick={() => { if (suggested) edit({ ...assembly, layers: [...assembly.layers, { layerId: crypto.randomUUID(), materialId, thicknessMm: suggested, lambdaOverride: chosenLambda, resistanceOverride: null, position: "Inside", upgrade: true, colorHex: "#e9c844" }] }); }}>Apply suggested insulation</button><small>Mathematical minimum for this serial-layer model, rounded up to 1 mm. Choose an available product thickness and confirm moisture, fire and installation suitability.</small></details>
        </>
        <details><summary>How thickness and heating stay connected</summary><p>Done saves the layers and their combined thickness to this floorplan wall and updates Heating Layout. Cancel discards the draft. Editing overall thickness scales layers proportionally; cavity/tested R stays fixed. Room boundaries do not move.</p><p>Missing λ or R leaves the calculated U-value Not set. Heating fallback assumptions remain clearly labelled. Targets are project choices, not regulatory approval.</p></details>
      </div>
      <div className={"appearance-popup-preview " + ui.editorPreview}>
        <div className="appearance-preview-heading"><strong>Live preview</strong><span>Updates as you edit</span></div>
        <WallLayersPreview assembly={assembly} materials={data.materials} appearanceControls />
      </div>
    </div>
  </Popup></div>, document.body);
}
