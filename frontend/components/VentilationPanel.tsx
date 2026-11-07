"use client";
import { conventionalHvac } from "@/lib/hvacHeating";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useHvac } from "./HvacContext";


import { saveHvacCalculations } from "@/lib/hvacExport";
import { CFDNumber } from "./CFDFields";

import { WindowHelpButton } from "./WindowHelpButton";
import { projectFloors } from "@/lib/buildingDocument";
import { newCFDScenario, ventSchema } from "@/lib/climoptixDocument";
import { preparationInput, preparationRevision, prepareCFD, type CFDReport } from "@/lib/climoptix";
import { hvacBoundaryPackage, resolveHvacScenario } from "@/lib/hvacBridge";
import { hvacConditionsSchema, hvacErrorMessage, hvacSchema, newHvacProject, operatingVents, removeVent, reorderHvacRoomVents, type HvacConditions, type HvacOperatingScenario, type HvacProject } from "@/lib/hvacDocument";
import { useHvacHostReport } from "./useHvacHostReport";
import { scrollWorkbenchToStart } from "@/lib/workbenchNavigation";
import { EquipmentListRow, equipmentListStyles } from "./EquipmentListRow";
import { CFDReorderList } from "./CFDReorderList";
import { CFDRowMenu } from "./CFDRowMenu";
import { duplicateObjectEntry, objectEntries } from "@/lib/climoptixObjectGroups";
import styles from "./HeatingLayoutPanel.module.css";

export function HeatingVentilationTabs({ children }: { children: ReactNode }) {
  const ctx = useHvac();
  if (!ctx) return children;
  return <div className={`${styles.panel} ${styles.hvacWorkbench}`}>
    <nav className={`${styles.tabs} ${styles.hvacTabs}`} role="tablist" aria-label="HVAC workbench">
      {(["Heating", "Ventilation"] as const).map((tab, index) => <button key={tab} id={`hvac-tab-${tab}`} type="button" role="tab" aria-selected={ctx.tab === tab} aria-controls={`hvac-panel-${tab}`} tabIndex={ctx.tab === tab ? 0 : -1} onClick={e => { ctx.setTab(tab); scrollWorkbenchToStart(e.currentTarget); }} onKeyDown={e => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) { e.preventDefault(); const next = e.key === "Home" ? "Heating" : e.key === "End" ? "Ventilation" : index === 0 ? "Ventilation" : "Heating"; ctx.setTab(next); document.getElementById(`hvac-tab-${next}`)?.focus({ preventScroll: true }); scrollWorkbenchToStart(e.currentTarget); }
      }}>{tab}</button>)}
    </nav>
    <div role="tabpanel" id="hvac-panel-Heating" aria-labelledby="hvac-tab-Heating" hidden={ctx.tab !== "Heating"}><HeatingOperatingStatus />{children}</div>
    <div role="tabpanel" id="hvac-panel-Ventilation" aria-labelledby="hvac-tab-Ventilation" hidden={ctx.tab !== "Ventilation"}>{ctx.tab === "Ventilation" && <VentilationPanel />}</div>
  </div>;
}
function HeatingOperatingStatus() {
  const ctx = useHvac(), hvac = ctx?.project.hvac, operating = hvac?.scenarios.find(s => s.id === hvac.activeScenarioId);
  if (!ctx || !hvac || !operating || !Object.keys(operating.heaterOverrides).length) return null;
  return <details><summary>HVAC operating overrides · {operating.name}</summary><p>Design ratings and geometry below are retained. Conventional Ventilation and its linked CFD case use these operating overrides.</p>
    {Object.entries(operating.heaterOverrides).map(([id, op]) => <p key={id}>{id}: {op.enabled ? op.actualW === null ? "Heating output model" : `${op.actualW} W effective room input` : "Off"}</p>)}
    <button onClick={() => ctx.commit({ ...hvac, scenarios: hvac.scenarios.map(s => s.id === operating.id ? { ...s, heaterOverrides: {} } : s) })}>Reset heater scenario overrides</button>
  </details>;
}
const show = (n: number | null, digits = 2) => n === null ? "Unknown" : n.toFixed(digits);
export function VentilationPanel() {
  const ctx = useHvac()!;
  const { project } = ctx;
  const hvac = useMemo(() => project.hvac ?? newHvacProject(), [project.hvac]);
  const floors = projectFloors(project), floor = floors.find(f => f.id === project.building?.activeFloorId) ?? floors[0];
  const [roomId, setRoomId] = useState(ctx.focus?.floorId === floor.id ? ctx.focus.roomId : floor.content.rooms[0]?.id ?? "");
  const room = floor.content.rooms.find(r => r.id === roomId) ?? floor.content.rooms[0];
  const fallback = useMemo<HvacOperatingScenario>(() => ({ id: crypto.randomUUID(), name: "Nominal operation", floorId: floor.id, roomId: room?.id ?? "unassigned", conditions: hvacConditionsSchema.parse({ outdoorC: floor.content.heatingLayout?.buildingSettings.externalDesignTemperatureC ?? -3 }), ventOverrides: {}, heaterOverrides: {} }), [floor.id, floor.content.heatingLayout?.buildingSettings.externalDesignTemperatureC, room?.id]);
  const operating = hvac.scenarios.find(s => s.id === hvac.activeScenarioId && s.floorId === floor.id && s.roomId === room?.id) ?? hvac.scenarios.find(s => s.floorId === floor.id && s.roomId === room?.id) ?? fallback;
  const devices = operatingVents(hvac, operating).filter(d => d.floorId === floor.id && d.roomId === room?.id);
  const selected = ctx.selectedVentId, setSelected = ctx.selectVent;
  const selectedRoomId = hvac.devices.find(d => d.vent.id === selected && d.floorId === floor.id)?.roomId;
  useEffect(() => { if (selectedRoomId) queueMicrotask(() => setRoomId(selectedRoomId)); }, [selectedRoomId]);
  useEffect(() => { if (ctx.focus?.floorId === floor.id) queueMicrotask(() => setRoomId(ctx.focus!.roomId)); }, [ctx.focus, floor.id]);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [calculatedInputs, setCalculatedInputs] = useState("");
  const [checked, setChecked] = useState<{ report: CFDReport; input: string; geometryKey: string; apiUrl: string } | null>(null);
  const request = useRef<AbortController | null>(null);
  const preview = useMemo(() => ({ ...newCFDScenario(project.projectId, "HVAC room preview"), id: "hvac-preview", seed: room ? { floorId: floor.id, roomId: room.id } : null, vents: devices.filter(d => d.enabled).map(d => d.vent) }), [project.projectId, floor.id, room, devices]);
  const input = preparationInput(project, preview), current = useRef(input);
  useEffect(() => () => request.current?.abort(), [input, ctx.apiUrl]);
  const hosts = useHvacHostReport(floor.id, room?.id);

  useEffect(() => { current.current = input; }, [input]);
  const sourceStamp = JSON.stringify({ project, floorId: floor.id, roomId: room?.id, operatingId: operating.id }), latestStamp = useRef(sourceStamp);
  useEffect(() => { latestStamp.current = sourceStamp; }, [sourceStamp]);
  const currentFaces = checked?.geometryKey === ctx.geometryKey && checked.apiUrl === ctx.apiUrl && checked.input === input;
  const report = currentFaces ? checked.report : hosts.report;
  function commit(next: HvacProject) { try { ctx.commit(hvacSchema.parse(next)); setError(""); } catch (e) { setError(hvacErrorMessage(e)); } }
  function saveScenario(next: HvacOperatingScenario) { commit({ ...hvac, activeScenarioId: next.id, scenarios: [...hvac.scenarios.filter(s => s.id !== next.id), next] }); }
  function conditions(patch: Partial<HvacConditions>) { saveScenario({ ...operating, conditions: { ...operating.conditions, ...patch } }); }
  async function checkGeometry() {
    request.current?.abort(); const abort = new AbortController(); request.current = abort; setBusy(true); setError("");
    const captured = input;
    try { const revision = await preparationRevision(captured); const result = await prepareCFD(ctx.apiUrl, project, preview, revision, abort.signal);
      if (!abort.signal.aborted && current.current === captured) { setChecked({ report: result, input: captured, geometryKey: ctx.geometryKey, apiUrl: ctx.apiUrl }); ctx.setGeometryReport(result); }
    } catch (e) { if (!abort.signal.aborted && current.current === captured) setError(e instanceof Error ? e.message : "Geometry checks unavailable."); }
    finally { if (request.current === abort) setBusy(false); }
  }
  function add(role: "supply" | "extract", extractKind: "exhaust" | "return" = "exhaust") {
    if (!room) return;
    const host = report?.patches.find(p => p.roomId === room.id && p.floorId === floor.id && p.hostable && p.host);
    const vent = ventSchema.parse({ id: crypto.randomUUID(), name: `${role === "supply" ? "Supply" : extractKind === "return" ? "Return" : "Extract"} ${hvac.devices.length + 1}`, role, control: role === "extract" ? "pressure" : "volumeFlow", valueSI: role === "extract" ? 0 : 0.05, temperatureK: operating.conditions.supplyC + 273.15, host: { patchId: host?.id ?? "unassigned" } });
    commit({ ...hvac, devices: [...hvac.devices, { vent, floorId: floor.id, roomId: room.id, outdoorAirFraction: 1, extractKind, enabled: true }] }); setSelected(vent.id);
  }
  function moveVent(id: string, boundary: number) {
    if (!room) return;
    try {
      const next = reorderHvacRoomVents({ ...project, hvac }, floor.id, room.id, id.replace(/^vent:/, ""), boundary);
      if (next.hvac !== hvac) ctx.commit(next.hvac!, next.cfdScenarios);
      setError("");
    } catch (e) { setError(hvacErrorMessage(e)); }
  }
  // Include disabled devices in the same list, with their design geometry.
  const listEntries = objectEntries({ ...preview, vents: devices.map(d => d.vent) }, []).map((entry, index) => {
    const device = devices[index];
    return { ...entry, detail: `${entry.detail}${!device.enabled ? " · Off" : device.extractKind === "return" ? " · Return" : ""}${operating.ventOverrides[entry.sourceId] ? " · Scenario override" : ""}` };
  });
  let result: ReturnType<typeof conventionalHvac> | null = null, calculationError = "";
  try { if (room) result = conventionalHvac({ ...project, hvac }, operating); } catch (e) { calculationError = e instanceof Error ? e.message : "Calculation unavailable."; }
  const snapshot = hvac.snapshots.find(s => s.operatingScenarioId === operating.id);
  const snapshotCurrent = snapshot ? (() => { try { const old = project.cfdScenarios?.find(s => s.id === snapshot.caseId); return !!old && JSON.parse(snapshot.boundaryJson).sourceInput === hvacBoundaryPackage(project, old).sourceInput; } catch { return false; } })() : false;
  async function preflight() {
    if (!room) return;
    if (!ctx.cfdAvailable) { ctx.navigateCFD(); return; }
    request.current?.abort(); const abort = new AbortController(); request.current = abort; setBusy(true); setError("");
    try {
      const scenario = { ...newCFDScenario(project.projectId, `${operating.name} · HVAC`), seed: { floorId: floor.id, roomId: room.id } };
      const nextHvac = hvacSchema.parse({ ...hvac, activeScenarioId: operating.id, scenarios: [...hvac.scenarios.filter(s => s.id !== operating.id), operating], bindings: { ...hvac.bindings, [scenario.id]: { operatingScenarioId: operating.id, deviceIds: devices.map(d => d.vent.id), editMode: "design", overrides: {} } } });
      const nextProject = { ...project, hvac: nextHvac }, resolved = resolveHvacScenario(nextProject, scenario);
      const hash = await preparationRevision(preparationInput(nextProject, resolved));
      let prepared = await prepareCFD(ctx.apiUrl, nextProject, resolved, hash, abort.signal);
      const includedIds = hvac.devices.filter(d => prepared.domain.regions.some(r => r.included && r.floorId === d.floorId && r.id === d.roomId)).map(d => d.vent.id);
      if (includedIds.some(id => !nextHvac.bindings[scenario.id].deviceIds.includes(id))) {
        nextHvac.bindings[scenario.id].deviceIds = includedIds;
        prepared = await prepareCFD(ctx.apiUrl, nextProject, resolveHvacScenario(nextProject, scenario), await preparationRevision(preparationInput(nextProject, scenario)), abort.signal);
      }
      nextHvac.bindings[scenario.id].scopeRooms = prepared.domain.regions.filter(r => r.included).map(r => ({ floorId: r.floorId, roomId: r.id }));
      nextHvac.bindings[scenario.id].scopeSeed = scenario.seed;
      const pkg = hvacBoundaryPackage(nextProject, scenario, prepared);
      const inputHash = await preparationRevision(pkg.sourceInput);
      if (abort.signal.aborted || latestStamp.current !== sourceStamp) return;
      nextHvac.snapshots = [{ caseId: scenario.id, operatingScenarioId: operating.id, createdAt: new Date().toISOString(), inputHash, boundaryJson: JSON.stringify(pkg) }, ...nextHvac.snapshots].slice(0, 5);
      ctx.commit(nextHvac, [...(project.cfdScenarios ?? []), scenario]);
      ctx.navigateCFD(scenario.id);
    } catch (e) { if (!abort.signal.aborted && latestStamp.current === sourceStamp) setError(e instanceof Error ? e.message : "CFD preflight unavailable."); }
    finally { if (request.current === abort) setBusy(false); }
  }


  return <section className={styles.panel} aria-label="Ventilation controls">
    <div className={styles.roomPickerHeading}><strong>Room ventilation</strong><WindowHelpButton title="Conventional HVAC" steps={[{ heading: "Shared devices", text: "Vents use one project identity in Heating/Ventilation and CFD. Permanent edits update both immediately. Scenario overrides retain design values. Face placement, dragging and obstruction checks use the existing CFD geometry editor." }, { heading: "Sensible zone balance", text: "Steady, well-mixed zone approximation: ACH = flow × 3600 / volume. Sensible gain = density × cp × flow × (supply − room). Envelope U×A, infiltration, gains and room-effective heating are counted once. Radiant exchange is lumped over the room, not instantly resolved in local air. Humidity, latent load, diffuser throw and compliance are outside this model." }]} /></div>
    <div className={`${styles.grid} ${styles.hvacContext}`}>
      <label>Measured room · {floor.name}<select aria-label="Ventilation room" value={room?.id ?? ""} onChange={e => { request.current?.abort(); setBusy(false); setRoomId(e.target.value); setSelected(null); }}>{floor.content.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <label>Operating scenario<select aria-label="HVAC operating scenario" value={operating.id} onChange={e => commit({ ...hvac, activeScenarioId: e.target.value })}>{!hvac.scenarios.some(s => s.id === operating.id) && <option value={operating.id}>{operating.name}</option>}{hvac.scenarios.filter(s => s.floorId === floor.id && s.roomId === room?.id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    </div>
    {!room && <p role="status">Draw a closed measured room first.</p>}
    <p className={styles.note}>{devices.filter(d => d.vent.role === "supply").length} supply · {devices.filter(d => d.vent.role === "extract" && d.extractKind === "exhaust").length} extract · {devices.filter(d => d.extractKind === "return").length} return · {hvac.devices.length} in project. Other rooms remain saved.</p>
    <div className={`${styles.actions} ${styles.hvacToolbar}`}><button disabled={!ctx.canUndo} onClick={ctx.undo}>Undo HVAC</button><button disabled={!ctx.canRedo} onClick={ctx.redo}>Redo HVAC</button><button aria-label={busy ? "Checking…" : "Check room geometry"} disabled={!room || busy} onClick={checkGeometry}>{busy ? "Checking…" : "Check geometry"}</button></div>
    <details open><summary>Vents &amp; layout</summary>
      <div className={styles.actionGrid}><button disabled={!room || !report?.patches.some(p => p.hostable && p.host && p.roomId === room.id && p.floorId === floor.id) || hvac.devices.length >= 500} onClick={() => add("supply")}>Add supply inlet</button><button disabled={!room || !report?.patches.some(p => p.hostable && p.host && p.roomId === room.id && p.floorId === floor.id) || hvac.devices.length >= 500} onClick={() => add("extract")}>Add extract/outlet</button><button disabled={!room || !report?.patches.some(p => p.hostable && p.host && p.roomId === room.id && p.floorId === floor.id) || hvac.devices.length >= 500} onClick={() => add("extract", "return")}>Add return</button></div>
      {!devices.length && <p>Add an inlet, check the room geometry, then select its host face. Pressure outlets have no prescribed flow before CFD solving.</p>}
      <div className={`${styles.hvacList} ${equipmentListStyles.collection}`}>
        <CFDReorderList items={listEntries} label="Room vents" scope={`hvac-vents:${project.projectId}:${floor.id}:${room?.id}`} onMove={moveVent}>
          {(entry, index) => <EquipmentListRow name={entry.name} detail={entry.detail} selected={selected === entry.sourceId} onSelect={() => setSelected(entry.sourceId)}
            onEdit={() => { setSelected(entry.sourceId); ctx.editVent(entry.sourceId); }} duplicateDisabled={hvac.devices.length >= 500}
            onDuplicate={() => {
              const source = hvac.devices.find(d => d.vent.id === entry.sourceId)!;
              const copy = duplicateObjectEntry({ ...preview, vents: hvac.devices.map(d => d.vent) }, entry, []);
              if (!copy) return;
              const vent = copy.scenario.vents.at(-1)!;
              commit({ ...hvac, devices: [...hvac.devices, { ...source, vent }] }); setSelected(vent.id); ctx.editVent(vent.id);
            }}
            onDelete={() => { commit(removeVent(hvac, entry.sourceId)); if (selected === entry.sourceId) setSelected(null); }}
            menu={<CFDRowMenu label={`Move ${entry.name}`}>
              <button disabled={index === 0} onClick={() => moveVent(entry.id, 0)}>Move to top</button>
              <button disabled={index === 0} onClick={() => moveVent(entry.id, index - 1)}>Move up</button>
              <button disabled={index === listEntries.length - 1} onClick={() => moveVent(entry.id, index + 2)}>Move down</button>
              <button disabled={index === listEntries.length - 1} onClick={() => moveVent(entry.id, listEntries.length)}>Move to bottom</button>
            </CFDRowMenu>} />}
        </CFDReorderList>
      </div>
      {hosts.loading && !currentFaces && <p role="status">Checking measured host faces…</p>}
      {hosts.error && !currentFaces && <div>{hosts.error !== error && <p role="alert" className={styles.warning}>{hosts.error}</p>}<button onClick={hosts.retry}>Retry host checks</button></div>}
      {report && <p>{currentFaces ? "Geometry checked" : checked ? "Inputs changed — recheck geometry" : "Measured host faces ready"}. Drag shared vents in the main 2D or 3D floorplan; use each vent’s Edit button for its host, coordinates and operating settings.</p>}
    </details>
    <details><summary>Room air &amp; design conditions</summary>
      <label>Scenario name<input maxLength={100} value={operating.name} onChange={e => { if (e.target.value.trim()) saveScenario({ ...operating, name: e.target.value }); }} /></label>
      <label>New editable starting point<select aria-label="New HVAC scenario preset" value="" onChange={e => { const name = e.target.value; saveScenario({ ...operating, id: crypto.randomUUID(), name, conditions: { ...operating.conditions, ...(name === "Summer cooling" ? { outdoorC: 32, roomC: 25, supplyC: 16 } : name === "Winter heating" ? { outdoorC: -3, roomC: 20, supplyC: 30 } : name === "High occupancy" ? { occupants: 10 } : {}) } }); }}><option value="" disabled>Create scenario…</option>{["Nominal operation", "High occupancy", "Summer cooling", "Winter heating", "Custom"].map(n => <option key={n}>{n}</option>)}</select></label>
      <div className={styles.grid}>{([
        ["roomC", "Room setpoint (°C)"], ["outdoorC", "Outdoor dry bulb (°C)"], ["supplyC", "Required-flow supply temperature (°C)"],
        ["infiltrationM3S", "Infiltration (m³/s)"], ["occupants", "Occupants"], ["sensibleWPerson", "Sensible heat per person (W)"], ["equipmentW", "Equipment & lighting (W)"], ["solarW", "Transmitted solar gain (W)"], ["targetACH", "Target total ACH (1/h)"], ["litresPerson", "Outdoor design rate (L/s/person)"], ["litresM2", "Outdoor design rate (L/s/m²)"],
      ] as const).map(([key, label]) => <CFDNumber key={key} label={label} value={operating.conditions[key]} onChange={v => conditions({ [key]: v })} />)}</div>
      <label><input type="checkbox" checked={operating.conditions.includeHeating} onChange={e => conditions({ includeHeating: e.target.checked })} />Include enabled Heating devices once</label>
      <button onClick={() => saveScenario({ ...operating, ventOverrides: {}, heaterOverrides: {} })}>Reset scenario overrides</button>
    </details>
    <details open><summary>Calculations · live well-mixed sensible balance</summary>
      <p>Measured floor area × clear wall height; roof slope/void volume requires checked CFD geometry. Envelope U-values and adjacent temperatures come from Heating / Insulation. No legal compliance threshold is assumed.</p>
      {calculationError && <p role="alert">{calculationError}</p>}
      {result && <>
        <div className={styles.tableScroll}><table className={styles.hvacTable} aria-label="Ventilation calculations"><thead><tr><th scope="col">Metric</th><th scope="col">Value</th></tr></thead><tbody>{[
          ["Total supply ACH", `${show(result.supplyACH)} h⁻¹`], ["Outdoor-air ACH", `${show(result.outdoorACH)} h⁻¹`],
          ["Room volume", `${show(result.volumeM3)} m³`], ["Total supply", `${show(result.supplyM3S === null ? null : result.supplyM3S * 1000)} L/s`], ["Outdoor supply", `${show(result.outdoorM3S === null ? null : result.outdoorM3S * 1000)} L/s`], ["Recirculated supply", `${show(result.recirculatedM3S === null ? null : result.recirculatedM3S * 1000)} L/s`], ["Exhaust ACH", `${show(result.exhaustACH)} h⁻¹`], ["Return flow", `${show(result.returnM3S === null ? null : result.returnM3S * 1000)} L/s`],
          ["Target-ACH flow", `${show(result.targetFlowM3S * 1000)} L/s`], ["People + area outdoor design flow", `${show(result.occupancyFlowM3S * 1000)} L/s`], ["Supply sensible gain / loss", `${show(result.ventilationW, 0)} W`], ["Envelope gain / loss", `${show(result.conductionW, 0)} W`], ["Infiltration gain / loss", `${show(result.infiltrationW, 0)} W`], ["People / equipment / solar", `${show(result.peopleW, 0)} / ${show(result.equipmentW, 0)} / ${show(result.solarW, 0)} W`], ["Room-effective Heating", result.heatingKnown ? `${show(result.heatingW, 0)} W` : `Unknown (${show(result.heatingW, 0)} W known subtotal)`],
          ["Additional heating / cooling needed", `${show(result.requiredHeatingW, 0)} / ${show(result.requiredCoolingW, 0)} W`], ["Residual at setpoint (+ gain)", `${show(result.residualW, 1)} W`], ["Equilibrium with specified operation", `${show(result.equilibriumC)} °C`], ["Free-floating, mechanical systems off", `${show(result.freeFloatingC)} °C`], ["Required sensible supply", `${show(result.requiredFlowM3S === null ? null : result.requiredFlowM3S * 1000)} L/s`], ["Outdoor conditioning to chosen supply", `${show(result.freshAirConditioningW, 0)} W`],
        ].map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td>{value}</td></tr>)}</tbody></table></div>
        <details><summary>Face velocity &amp; validation ({result.warnings.length})</summary>{result.streams.map(s => <p key={s.device.vent.id}>{s.device.vent.name}: free area {s.areaM2.toFixed(4)} m² · face velocity {show(s.faceVelocityMS)} m/s</p>)}{result.warnings.map(w => <p key={w} className={styles.warning}>{w}</p>)}</details>
      </>}
    </details>
    <details><summary>Advanced &amp; validation</summary><div className={styles.grid}><CFDNumber label="Air density (kg/m³)" value={operating.conditions.densityKgM3} onChange={densityKgM3 => conditions({ densityKgM3 })} /><CFDNumber label="Specific heat cp (J/kg K)" value={operating.conditions.cpJKgK} onChange={cpJKgK => conditions({ cpJKgK })} /></div><p>Supplies use positive prescribed flow. Extract and return are separate air paths. A pressure outlet has unknown flow. Recirculation never counts as outdoor fresh air. Solar/equipment values are scenario inputs; latent loads and humidity are not calculated. Fan energy requires a duct resistance model and is unavailable.</p>{hvac.migrationWarnings.map(w => <p key={w}>{w}</p>)}</details>
    {error && <p role="alert" className={styles.warning}>{error}</p>}
    <p role="status">{snapshot ? snapshotCurrent ? "Synced with CFD snapshot" : "CFD case outdated — inputs changed; create a new case" : "Live calculations · no CFD snapshot yet"}{calculatedInputs === sourceStamp ? " · Calculation inputs checked" : ""}</p>
    <div className={styles.actionGrid}><button className={styles.primary} disabled={!room || busy} onClick={() => { setError(calculationError); if (!calculationError && result) setCalculatedInputs(sourceStamp); }}>Update calculations</button><button disabled={!room || busy} onClick={preflight}>Evaluate in CFD</button><button disabled={!result} onClick={() => { void saveHvacCalculations({ operating, result }).catch(e => setError(hvacErrorMessage(e, "Could not save calculations."))); }}>Export calculations</button></div>

  </section>;
}
