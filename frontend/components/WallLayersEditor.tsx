"use client";
import { Fragment, useMemo, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { Popup } from "./Popup";
import { withLayerColours } from "@/lib/energyLayerColours";
import { WallLayersPreview } from "./WallLayersPreview";
import { NumberField } from "./EnergyNumberField";
import { WindowHelpButton } from "./WindowHelpButton";
import { CONSTRUCTION_TEMPLATES, newAssembly, type ConstructionAssembly, type ConstructionLayer, type EnergyProject } from "@/lib/energyDocument";
import type { Room } from "@/lib/types";
import type { HeatingProject } from "@/lib/heatingDocument";
import { assignEnergyElements, energyElements, calculateAssemblyUValue, scenarioAssignments, type EnergyElement } from "@/lib/energyCalculations";
import { assemblyThickness, insertConstructionLayer, reorderConstructionLayer, LAYER_COLOURS, minimumInsulationThickness, resizeAssembly, setWallAssembly } from "@/lib/energyWallConstruction";
import styles from "./HeatingLayoutPanel.module.css";
import ui from "./EnergyLayoutPanel.module.css";

/** Edits are local until Done: Cancel never changes geometry, heating or undo history. */
export function WallLayersEditor({ source, initialAssembly, element: first, rooms, heating, scenarioName, stale, onCancel, onCommit }: {
  source: EnergyProject; initialAssembly: ConstructionAssembly; element: EnergyElement; rooms: Room[]; heating: HeatingProject;
  scenarioName: string;
  stale: boolean; onCancel: () => void; onCommit: (data: EnergyProject) => void;
}) {
  const [data, setData] = useState(source), [assembly, setAssembly] = useState(() => withLayerColours(initialAssembly));
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [draggingLayerId, setDraggingLayerId] = useState<string | null>(null);
  const [dropBoundary, setDropBoundary] = useState<number | null>(null);
  const [error, setError] = useState(""), [template, setTemplate] = useState(0);
  const [materialId, setMaterialId] = useState("pir-tw55"), [insulationLambda, setInsulationLambda] = useState<number | null>(null);
  const [targetMode, setTargetMode] = useState("U-value"), [powerTarget, setPowerTarget] = useState(100);
  const category = first.category === "floor" ? "floor" : first.category === "roof" ? "roof" : "wall";
  const label = category === "wall" ? "Wall" : category === "floor" ? "Floor" : "Roof";
  const assigned = scenarioAssignments(data).find(a => a.elementId === first.elementId);
  const construction = calculateAssemblyUValue(assembly, data.materials), material = data.materials.find(m => m.materialId === materialId);
  const update = (next: EnergyProject) => { setError("");setData(next); };
  const edit = (next: ConstructionAssembly) => { const total = assemblyThickness(next);
    if (total < 1 || total > 2000) { setError("Overall construction thickness must be between 1 and 2000 mm.");return; }
    setError("");setAssembly({ ...next, directUValue: null });
  };
  const layerEdit = (id: string, patch: Partial<ConstructionLayer>) => {
    edit({ ...assembly, layers: assembly.layers.map(l => {
      if (l.layerId !== id) return l;
      const thermalChange = "materialId" in patch && patch.materialId !== l.materialId || "lambdaOverride" in patch && (patch.lambdaOverride ?? null) !== (l.lambdaOverride ?? null) || "resistanceOverride" in patch && patch.resistanceOverride !== l.resistanceOverride;
      return { ...l, ...(thermalChange ? { resistanceSource: undefined } : {}), ...patch };
    }) });
  };
  const hoverBoundary = (event: DragEvent, boundary: number) => {
    if (!draggingLayerId) return;
    event.preventDefault();event.dataTransfer.dropEffect = "move";setDropBoundary(boundary);
  };
  const dropAt = (event: DragEvent, boundary: number) => {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain");
    if (id && id === draggingLayerId) edit(insertConstructionLayer(assembly, id, boundary));
    setDraggingLayerId(null);setDropBoundary(null);
  };
  const insertionSlot = (boundary: number) => <div className={ui.layerInsertion} data-layer-insertion={boundary} data-active={dropBoundary === boundary} onDragOver={event => hoverBoundary(event, boundary)} onDrop={event => dropAt(event, boundary)} aria-hidden="true" />;
  const thermal = useMemo(() => energyElements(rooms, heating, data).find(e => e.elementId === first.elementId) ?? first, [rooms, heating, data, first]);
  const targetU = targetMode === "U-value" ? data.targets[category] : thermal.areaM2 * thermal.deltaTK > 0 ? powerTarget / (thermal.areaM2 * thermal.deltaTK) : null;
  const chosenLambda = insulationLambda ?? material?.lambda ?? null;
  const suggested = targetU ? minimumInsulationThickness(assembly, data, chosenLambda, targetU) : null;
  if (typeof document === "undefined") return null;
  return createPortal(<div onKeyDown={event => { event.stopPropagation();if (event.key === "Escape") { event.preventDefault();onCancel(); } }}><Popup open dockable className={"appearance-popup wall-layers-popup " + ui.popup}
    title={`Define ${category} layers`} message="" confirmLabel="Done" autoFocusTarget="content"
    confirmDisabled={stale || !!error} onCancel={onCancel} onConfirm={() => { if (!stale && !error) onCommit(setWallAssembly(data, first, assembly)); }}>
    <div className="appearance-popup-grid">
      <div className={"appearance-popup-form " + styles.panel}>
        <div className="appearance-object-heading"><h2>{first.label}</h2><small>Editing construction in: {scenarioName}</small></div>
        <div className={ui.editorMetrics}><strong>{Number(assemblyThickness(assembly).toFixed(2))} mm total</strong><span>{construction.estimated ? "Estimated U" : "U"} {construction.uValue?.toFixed(3) ?? "Not set"} W/m²K</span><small>{label} heat loss: {construction.uValue === null ? "Not set" : `${Math.round(construction.uValue * thermal.areaM2 * thermal.deltaTK)} W`} · ΔT {thermal.deltaTK.toFixed(1)} K</small></div>
        {stale && <p role="alert" className={styles.warning}>The construction or project changed while editing. Cancel and reopen to use the latest model.</p>}
        {error && <p role="alert" className={styles.warning}>{error}</p>}
        <details className={ui.startingComposition}><summary>Starting composition</summary><label>Construction preset<select value={template} onChange={e => setTemplate(Number(e.target.value))}>{CONSTRUCTION_TEMPLATES.filter(t => t.category === category).map((t, i) => <option key={t.name} value={i}>{t.name}</option>)}</select></label>
          <div className={styles.actions}><button onClick={() => edit(resizeAssembly(newAssembly(CONSTRUCTION_TEMPLATES.filter(t => t.category === category)[template]), assemblyThickness(assembly)))}>Use preset layers</button><button onClick={() => {
            const customId = "custom-build-up";
            if (!data.materials.some(m => m.materialId === customId)) update({ ...data, materials: [...data.materials, { materialId: customId, name: "Custom material — properties required", category: "Custom", lambda: null, density: null, vapourResistance: null, reference: "Enter the actual material conductivity or tested layer resistance.", editable: true }] });
            edit(newAssembly({ name: first.label, category, materials: [[customId, assemblyThickness(assembly)]] }));
          }}>Start custom {category}</button></div>
        </details>
        <>
          <div className={ui.layerList} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropBoundary(null); }}>
          {assembly.layers.map((l, i) => { const m = data.materials.find(m => m.materialId === l.materialId);return <Fragment key={l.layerId}>{insertionSlot(i)}<section className={ui.layer} data-layer-id={l.layerId} onDragOver={event => { const box = event.currentTarget.getBoundingClientRect();hoverBoundary(event, i + (event.clientY >= box.top + box.height / 2 ? 1 : 0)); }} onDrop={event => { const box = event.currentTarget.getBoundingClientRect();dropAt(event, i + (event.clientY >= box.top + box.height / 2 ? 1 : 0)); }}>
            <div className={ui.layerRow}>
              <button type="button" className={ui.layerGrip} draggable aria-label={`Reorder layer ${i + 1}`} title="Drag to reorder; Arrow Up/Down also moves this layer" onDragStart={event => { event.dataTransfer.setData("text/plain", l.layerId);event.dataTransfer.effectAllowed = "move";setDraggingLayerId(l.layerId); }} onDragEnd={() => { setDraggingLayerId(null);setDropBoundary(null); }} onKeyDown={event => { const target = event.key === "ArrowUp" ? assembly.layers[i - 1] : event.key === "ArrowDown" ? assembly.layers[i + 1] : null;if (target) { event.preventDefault();edit(reorderConstructionLayer(assembly, l.layerId, target.layerId)); } }}>⠿</button>
              <strong><span className={ui.swatch} style={{ background: l.colorHex ?? LAYER_COLOURS[i % LAYER_COLOURS.length] }} />Layer {i + 1} · {m?.name ?? "Custom material"} · {Number(l.thicknessMm.toFixed(2))} mm</strong>
              <div className={ui.layerActions}><button type="button" aria-label={`Edit layer ${i + 1}`} aria-expanded={editingLayerId === l.layerId} aria-controls={`layer-fields-${l.layerId}`} onClick={() => setEditingLayerId(editingLayerId === l.layerId ? null : l.layerId)}>{editingLayerId === l.layerId ? "Close edit" : "Edit"}</button><button type="button" aria-label={`Delete layer ${i + 1}`} disabled={assembly.layers.length === 1} title={assembly.layers.length === 1 ? "Keep at least one construction layer" : undefined} onClick={() => { edit({ ...assembly, layers: assembly.layers.filter(v => v.layerId !== l.layerId) });if (editingLayerId === l.layerId) setEditingLayerId(null); }}>Delete</button></div>
            </div>
            {editingLayerId === l.layerId && <div id={`layer-fields-${l.layerId}`} className={ui.layerFields}>
            <label>Layer {i + 1} material<select autoFocus value={l.materialId} onChange={e => layerEdit(l.layerId, { materialId: e.target.value, lambdaOverride: null, resistanceOverride: null })}>{data.materials.filter(m => m.category !== "Equivalent resistance" || m.materialId === l.materialId).map(m => <option key={m.materialId} value={m.materialId}>{m.name}</option>)}</select></label>
            <NumberField label={`Layer ${i + 1} thickness mm`} value={l.thicknessMm} min={.1} max={2000} onChange={v => { if (v) layerEdit(l.layerId, { thicknessMm: v }); }} />
            <label className={ui.layerColour}>Layer {i + 1} colour<input type="color" value={l.colorHex ?? LAYER_COLOURS[i % LAYER_COLOURS.length]} onChange={e => layerEdit(l.layerId, { colorHex: e.target.value })} /></label>
            <label>Layer {i + 1} installation position<select value={l.position} onChange={e => layerEdit(l.layerId, { position: e.target.value as ConstructionLayer["position"] })}>{["Outside", "Within", "Inside"].map(v => <option key={v}>{v}</option>)}</select></label>
            <details><summary className={ui.layerHelpSummary}>Thermal parameters<WindowHelpButton title={`Layer ${i + 1} thermal parameters & source`} steps={[
              { heading: m?.name ?? "Layer material", text: m?.reference || "No reference supplied. Confirm the product's declared thermal properties." },
              { heading: "Conductivity or resistance", text: "Enter conductivity λ in W/mK, or an explicit resistance R in m²K/W for a cavity or tested layer. Entered R takes precedence. Defaults come from Library → Materials; edits here affect only this element, not the library." },
              ...(m?.category === "Equivalent resistance" ? [{ heading: "Retained existing construction", text: "This layer preserves the original whole-element U-value as R = 1/U. Its measured thickness is for geometry and preview only; it does not imply a concrete or other material. Its R already includes surface films, so the assembly's Rsi and Rse start at zero. Add new insulation as separate layers. A Heating estimate remains estimated until you replace it with confirmed properties." }] : []),
            ]} /></summary><div className={ui.layerThermal}><NumberField label={`Layer ${i + 1} conductivity λ W/mK`} value={l.lambdaOverride ?? m?.lambda ?? null} min={.001} max={20} onChange={v => layerEdit(l.layerId, { lambdaOverride: v, resistanceOverride: null })} /><NumberField label={`Layer ${i + 1} entered resistance R m²K/W`} value={l.resistanceOverride ?? (l.lambdaOverride == null ? m?.resistance : null) ?? null} max={100} onChange={v => layerEdit(l.layerId, { resistanceOverride: v })} /></div>
            <small>Layer R: {construction?.layers[i]?.resistance?.toFixed(3) ?? "Not set"} m²K/W</small></details>
            </div>}
          </section></Fragment>; })}{insertionSlot(assembly.layers.length)}</div>
          <button disabled={assembly.layers.length >= 100} onClick={() => edit({ ...assembly, layers: [...assembly.layers, { layerId: crypto.randomUUID(), materialId, thicknessMm: 25, resistanceOverride: null, position: "Inside", upgrade: true, colorHex: LAYER_COLOURS[assembly.layers.length % LAYER_COLOURS.length] }] })}>Add layer</button>
          <p><strong>{construction.estimated ? "Estimated U" : "Calculated U"}: {construction?.uValue?.toFixed(3) ?? "Not set — complete every λ or R"} W/m²K</strong></p>
          <details><summary>Calculation details & {category} properties</summary><div className={styles.grid}><NumberField label="Inside surface resistance Rsi" value={assembly.rsi} max={10} onChange={v => { if (v !== null) edit({ ...assembly, rsi: v }); }} /><NumberField label="Outside surface resistance Rse" value={assembly.rse} max={10} onChange={v => { if (v !== null) edit({ ...assembly, rse: v }); }} /></div><p>R = thickness / 1000 / λ (or entered R); U = 1 / (Rsi + ΣR + Rse). Total R {construction?.totalR?.toFixed(3) ?? "Not set"}.</p><p>{label} loss = U × {thermal.areaM2.toFixed(2)} m² × {thermal.deltaTK.toFixed(1)} K. One-dimensional model; thermal bridges and moisture need professional assessment.</p><label>{label} boundary<select value={assigned?.boundary ?? "Auto"} onChange={e => update(assignEnergyElements(data, [{ ...assigned, elementId: first.elementId, assemblyId: assembly.assemblyId, uValue: null, geometrySignature: first.geometrySignature, boundary: e.target.value as "Auto" | "External" | "Heated" | "Unheated" | "Adiabatic" | "Ground" }]))}>{(category === "floor" ? ["Auto", "Ground", "External", "Heated", "Unheated", "Adiabatic"] : ["Auto", "External", "Heated", "Unheated", "Adiabatic"]).map(v => <option key={v}>{v}</option>)}</select></label><NumberField label="Adjacent temperature °C" value={assigned?.adjacentTemperatureC ?? null} min={-50} max={40} onChange={v => update(assignEnergyElements(data, [{ ...assigned, elementId: first.elementId, assemblyId: assembly.assemblyId, uValue: null, adjacentTemperatureC: v ?? undefined }]))} /></details>
          <details><summary className={ui.layerHelpSummary}>Find minimum additional insulation<WindowHelpButton title="Minimum additional insulation" steps={[
            { heading: "Choose the target", text: "Choose an insulation material and a target U-value or element power loss at the design temperature. The conductivity applies to the added insulation only, not other elements or the library. A power target needs a positive area and temperature difference." },
            { heading: "Apply and review", text: "The result is a mathematical minimum for this serial-layer model, rounded up to 1 mm. Apply explicitly, choose an available product thickness, and confirm moisture, fire and installation suitability. Targets are project choices, not regulatory approval. A retained estimated baseline still needs verification." },
          ]} /></summary><label>Insulation material<select value={materialId} onChange={e => { setMaterialId(e.target.value);setInsulationLambda(null); }}>{data.materials.filter(m => m.category === "Insulation").map(m => <option key={m.materialId} value={m.materialId}>{m.name}</option>)}</select></label>
          <NumberField label="Selected insulation conductivity λ W/mK" value={chosenLambda} min={.001} max={20} onChange={setInsulationLambda} /><label>Target type<select value={targetMode} onChange={e => setTargetMode(e.target.value)}><option>U-value</option><option>Element power loss</option></select></label>
          {targetMode === "U-value" ? <NumberField label={`Target ${category} U W/m²K`} value={data.targets[category]} min={.001} max={10} onChange={v => { if (v) update({ ...data, targets: { ...data.targets, [category]: v } }); }} /> : <NumberField label={`Target ${category} power loss W at design temperature`} value={powerTarget} min={.1} max={100000} onChange={v => { if (v) setPowerTarget(v); }} />}
          <p>{suggested === null ? "Complete the construction layers and insulation λ. A power target needs positive area and temperature difference." : suggested === 0 ? "This construction already meets your target." : `Minimum additional insulation: ${suggested} mm (λ ${chosenLambda}); target U ${targetU?.toFixed(3)} W/m²K.`}</p>
          <button disabled={!suggested || assembly.layers.length >= 100 || assemblyThickness(assembly) + suggested > 2000} onClick={() => { if (suggested) edit({ ...assembly, layers: [...assembly.layers, { layerId: crypto.randomUUID(), materialId, thicknessMm: suggested, lambdaOverride: chosenLambda, resistanceOverride: null, position: "Inside", upgrade: true, colorHex: "#e9c844" }] }); }}>Apply suggested insulation</button></details>
        </>
      </div>
      <div className={"appearance-popup-preview " + ui.editorPreview}>
        <div className="appearance-preview-heading"><strong>Live preview</strong><span>Updates as you edit</span></div>
        <WallLayersPreview assembly={assembly} materials={data.materials} appearanceControls />
      </div>
    </div>
  </Popup></div>, document.body);
}
