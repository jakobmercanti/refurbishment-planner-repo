"use client";
import { conventionalHvac } from "@/lib/hvacHeating";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useHvac } from "./HvacContext";
import { EquipmentPanel } from "./ClimoptixEquipment";
import { ventCenter } from "@/lib/climoptixPreview";
import { saveHvacCalculations } from "@/lib/hvacExport";
import { CFDNumber } from "./CFDFields";
import { flowFromDisplay, flowToDisplay } from "@/lib/hvacCalculations";
import { WindowHelpButton } from "./WindowHelpButton";
import { projectFloors } from "@/lib/buildingDocument";
import { cfdScenarioSchema, newCFDScenario, ventSchema, type CFDScenario } from "@/lib/climoptixDocument";
import { downloadCFD, preparationInput, preparationRevision, prepareCFD, type CFDReport } from "@/lib/climoptix";
import { hvacBoundaryPackage, hvacControlLabel, hvacModelLabel, resolveHvacScenario, type HvacCfdBoundaryPackage } from "@/lib/hvacBridge";
import { hvacConditionsSchema, hvacErrorMessage, hvacSchema, newHvacProject, operatingVents, removeVent, type HvacConditions, type HvacOperatingScenario, type HvacProject } from "@/lib/hvacDocument";
import { HvacVentPlan } from "./HvacVentPlan";
import styles from "./HeatingLayoutPanel.module.css";

export function HeatingVentilationTabs({ children }: { children: ReactNode }) {
  const ctx = useHvac();
  if (!ctx) return children;
  return <div className={`${styles.panel} ${styles.hvacWorkbench}`}>
    <nav className={`${styles.tabs} ${styles.hvacTabs}`} role="tablist" aria-label="HVAC workbench">
      {(["Heating", "Ventilation"] as const).map((tab, index) => <button key={tab} id={`hvac-tab-${tab}`} type="button" role="tab" aria-selected={ctx.tab === tab} aria-controls={`hvac-panel-${tab}`} tabIndex={ctx.tab === tab ? 0 : -1} onClick={() => ctx.setTab(tab)} onKeyDown={e => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) { e.preventDefault(); const next = e.key === "Home" ? "Heating" : e.key === "End" ? "Ventilation" : index === 0 ? "Ventilation" : "Heating"; ctx.setTab(next); document.getElementById(`hvac-tab-${next}`)?.focus(); }
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
  const [checked, setChecked] = useState<{ report: CFDReport; input: string; geometryKey: string } | null>(null);
  const [handoff, setHandoff] = useState<{ hvac: HvacProject; scenario: CFDScenario; pkg: HvacCfdBoundaryPackage; report: CFDReport; hash: string; sourceStamp: string } | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const preview = useMemo(() => ({ ...newCFDScenario(project.projectId, "HVAC room preview"), id: "hvac-preview", seed: room ? { floorId: floor.id, roomId: room.id } : null, vents: devices.filter(d => d.enabled).map(d => d.vent) }), [project.projectId, floor.id, room, devices]);
  const input = preparationInput(project, preview), current = useRef(input);
  const { ensureGeometry, geometryKey } = ctx;
  const hostRoomId = room?.id;
  useEffect(() => {
    let cancelled = false;
    if (hostRoomId) void ensureGeometry({ floorId: floor.id, roomId: hostRoomId }).then(report => { if (!cancelled && report) setChecked({ report, input: "hosts-only", geometryKey }); }).catch(e => { if (!cancelled) setError(hvacErrorMessage(e)); });
    return () => { cancelled = true; };
  }, [ensureGeometry, geometryKey, floor.id, hostRoomId]);

  useEffect(() => { current.current = input; }, [input]);
  const sourceStamp = JSON.stringify({ project, floorId: floor.id, roomId: room?.id, operatingId: operating.id }), latestStamp = useRef(sourceStamp);
  useEffect(() => { latestStamp.current = sourceStamp; }, [sourceStamp]);
  const report = checked?.geometryKey === ctx.geometryKey ? checked.report : ctx.geometryReport, currentFaces = checked?.input === input;
  function commit(next: HvacProject) { try { ctx.commit(hvacSchema.parse(next)); setError(""); } catch (e) { setError(hvacErrorMessage(e)); } }
  function saveScenario(next: HvacOperatingScenario) { commit({ ...hvac, activeScenarioId: next.id, scenarios: [...hvac.scenarios.filter(s => s.id !== next.id), next] }); }
  function conditions(patch: Partial<HvacConditions>) { saveScenario({ ...operating, conditions: { ...operating.conditions, ...patch } }); }
  function editVents(next: CFDScenario) {
    try {
      const parsed = cfdScenarioSchema.parse(next);
      const all = structuredClone(hvac);
      for (const vent of parsed.vents) {
        const existing = all.devices.find(d => d.vent.id === vent.id), host = report?.patches.find(p => p.id === vent.host.patchId);
        if (existing) {
          const flowChanged = existing.vent.valueSI !== vent.valueSI, temperatureChanged = existing.vent.temperatureK !== vent.temperatureK;
          existing.vent = vent; if (host) { existing.roomId = host.roomId; existing.floorId = host.floorId; }
          const op = all.scenarios.find(s => s.id === operating.id), override = op?.ventOverrides[vent.id];
          if (override) { if (flowChanged) delete override.valueSI; if (temperatureChanged) delete override.temperatureK; if (!Object.keys(override).length) delete op!.ventOverrides[vent.id]; }
        }
      }
      commit(all);
    } catch (e) { setError(hvacErrorMessage(e, "Invalid vent inputs.")); }
  }
  async function checkGeometry() {
    request.current?.abort(); const abort = new AbortController(); request.current = abort; setBusy(true); setError("");
    const captured = input;
    try { const revision = await preparationRevision(captured); const result = await prepareCFD(ctx.apiUrl, project, preview, revision, abort.signal);
      if (!abort.signal.aborted && current.current === captured) { setChecked({ report: result, input: captured, geometryKey: ctx.geometryKey }); ctx.setGeometryReport(result); }
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "Geometry checks unavailable."); }
    finally { if (request.current === abort) setBusy(false); }
  }
  function add(role: "supply" | "extract", extractKind: "exhaust" | "return" = "exhaust") {
    if (!room) return;
    const host = report?.patches.find(p => p.roomId === room.id && p.floorId === floor.id && p.hostable && p.host);
    const vent = ventSchema.parse({ id: crypto.randomUUID(), name: `${role === "supply" ? "Supply" : extractKind === "return" ? "Return" : "Extract"} ${hvac.devices.length + 1}`, role, control: role === "extract" ? "pressure" : "volumeFlow", valueSI: role === "extract" ? 0 : 0.05, temperatureK: operating.conditions.supplyC + 273.15, host: { patchId: host?.id ?? "unassigned" } });
    commit({ ...hvac, devices: [...hvac.devices, { vent, floorId: floor.id, roomId: room.id, outdoorAirFraction: 1, extractKind, enabled: true }] }); setSelected(vent.id);
  }
  let result: ReturnType<typeof conventionalHvac> | null = null, calculationError = "";
  try { if (room) result = conventionalHvac({ ...project, hvac }, operating); } catch (e) { calculationError = e instanceof Error ? e.message : "Calculation unavailable."; }
  const snapshot = hvac.snapshots.find(s => s.operatingScenarioId === operating.id);
  const snapshotCurrent = snapshot ? (() => { try { const old = project.cfdScenarios?.find(s => s.id === snapshot.caseId); return !!old && JSON.parse(snapshot.boundaryJson).sourceInput === hvacBoundaryPackage(project, old).sourceInput; } catch { return false; } })() : false;
  async function preflight() {
    if (!room) return;
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
      const pkg = hvacBoundaryPackage(nextProject, scenario, prepared);
      nextHvac.bindings[scenario.id].scopeRooms = prepared.domain.regions.filter(r => r.included).map(r => ({ floorId: r.floorId, roomId: r.id }));
      nextHvac.bindings[scenario.id].scopeSeed = scenario.seed;
      if (!abort.signal.aborted && latestStamp.current === sourceStamp) setHandoff({ hvac: nextHvac, scenario, pkg, report: prepared, hash, sourceStamp });
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "CFD preflight unavailable."); }
    finally { if (request.current === abort) setBusy(false); }
  }
  const selectedDevice = devices.find(d => d.vent.id === selected);
  const flowUnit = ctx.flowUnit ?? "L/s";
  return <section className={styles.panel} aria-label="Ventilation controls">
    <div className={styles.roomPickerHeading}><strong>Room ventilation</strong><WindowHelpButton title="Conventional HVAC" steps={[{ heading: "Shared devices", text: "Vents use one project identity in Heating/Ventilation and CFD. Permanent edits update both immediately. Scenario overrides retain design values. Face placement, dragging and obstruction checks use the existing CFD geometry editor." }, { heading: "Sensible zone balance", text: "Steady, well-mixed zone approximation: ACH = flow × 3600 / volume. Sensible gain = density × cp × flow × (supply − room). Envelope U×A, infiltration, gains and room-effective heating are counted once. Radiant exchange is lumped over the room, not instantly resolved in local air. Humidity, latent load, diffuser throw and compliance are outside this model." }]} /></div>
    <div className={`${styles.grid} ${styles.hvacContext}`}>
      <label>Measured room · {floor.name}<select aria-label="Ventilation room" value={room?.id ?? ""} onChange={e => { request.current?.abort(); setBusy(false); setRoomId(e.target.value); setSelected(null); setHandoff(null); }}>{floor.content.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <label>Operating scenario<select aria-label="HVAC operating scenario" value={operating.id} onChange={e => commit({ ...hvac, activeScenarioId: e.target.value })}>{!hvac.scenarios.some(s => s.id === operating.id) && <option value={operating.id}>{operating.name}</option>}{hvac.scenarios.filter(s => s.floorId === floor.id && s.roomId === room?.id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    </div>
    {!room && <p role="status">Draw a closed measured room first.</p>}
    <p className={styles.note}>{devices.filter(d => d.vent.role === "supply").length} supply · {devices.filter(d => d.vent.role === "extract" && d.extractKind === "exhaust").length} extract · {devices.filter(d => d.extractKind === "return").length} return · {hvac.devices.length} in project. Other rooms remain saved.</p>
    <div className={`${styles.actions} ${styles.hvacToolbar}`}><button disabled={!ctx.canUndo} onClick={ctx.undo}>Undo HVAC</button><button disabled={!ctx.canRedo} onClick={ctx.redo}>Redo HVAC</button><button disabled={!room || busy} onClick={checkGeometry}>{busy ? "Checking…" : "Check room geometry"}</button></div>
    <details open><summary>Vents &amp; layout</summary>
      <div className={styles.actionGrid}><button disabled={!room || !report?.patches.some(p => p.hostable && p.host && p.roomId === room.id && p.floorId === floor.id) || hvac.devices.length >= 500} onClick={() => add("supply")}>Add supply inlet</button><button disabled={!room || !report?.patches.some(p => p.hostable && p.host && p.roomId === room.id && p.floorId === floor.id) || hvac.devices.length >= 500} onClick={() => add("extract")}>Add extract/outlet</button><button disabled={!room || !report?.patches.some(p => p.hostable && p.host && p.roomId === room.id && p.floorId === floor.id) || hvac.devices.length >= 500} onClick={() => add("extract", "return")}>Add return</button></div>
      {!devices.length && <p>Add an inlet, check the room geometry, then select its host face. Pressure outlets have no prescribed flow before CFD solving.</p>}
      <div className={styles.hvacList}>{devices.map((d, i) => <div key={d.vent.id} className={styles.hvacRow}>
        <button aria-pressed={selected === d.vent.id} onClick={() => setSelected(d.vent.id)}>{d.vent.name} · {d.enabled ? d.vent.role === "supply" ? "Supply" : d.extractKind : "Off"}{operating.ventOverrides[d.vent.id] ? " · Scenario override" : " · Design"}</button>
        <div className={styles.actions}><button aria-label={`Edit ${d.vent.name}`} onClick={() => { setSelected(d.vent.id); ctx.editVent(d.vent.id); }}>Edit</button><button aria-label={`Duplicate ${d.vent.name}`} onClick={() => { const copy = structuredClone(hvac.devices.find(v => v.vent.id === d.vent.id)!); copy.vent.id = crypto.randomUUID(); copy.vent.name = `${copy.vent.name.slice(0, 114)} copy`; commit({ ...hvac, devices: [...hvac.devices, copy] }); setSelected(copy.vent.id); }}>Duplicate</button>
        <button disabled={i === 0} aria-label={`Move ${d.vent.name} up`} onClick={() => { const all = [...hvac.devices], a = all.findIndex(v => v.vent.id === d.vent.id), b = all.findIndex(v => v.vent.id === devices[i - 1].vent.id); [all[a], all[b]] = [all[b], all[a]]; commit({ ...hvac, devices: all }); }}>↑</button>
        <button aria-label={`Remove ${d.vent.name}`} onClick={() => { if (window.confirm(`Remove ${d.vent.name} from the shared design and all workbenches? You can Undo.`)) { commit(removeVent(hvac, d.vent.id)); if (selected === d.vent.id) setSelected(null); } }}>Remove</button></div>
      </div>)}</div>
      <div className={styles.tableScroll}><table className={styles.hvacTable} aria-label="Vent positions"><thead><tr><th>Vent / host</th><th>X / Y / Z (mm)</th><th>Host U</th><th>Host V</th><th>Settings</th></tr></thead><tbody>{devices.map(d => {
        const host = report?.patches.find(p => p.id === d.vent.host.patchId), canonical = hvac.devices.find(v => v.vent.id === d.vent.id)!;
        const position = host?.host ? ventCenter(d.vent, host.host).map(n => n.toFixed(0)).join(" / ") : "Assign host";
        const move = (patch: Partial<typeof canonical.vent.host>) => editVents({ ...preview, vents: [ { ...canonical.vent, host: { ...canonical.vent.host, ...patch } } ] });
        return <tr key={d.vent.id}><td>{d.vent.name}<small>{host?.label ?? d.vent.host.patchId}</small></td><td>{position}</td><td><CFDNumber convert={false} label={`${d.vent.name} host U`} value={d.vent.host.u} onChange={u => move({ u })} /></td><td><CFDNumber convert={false} label={`${d.vent.name} host V`} value={d.vent.host.v} onChange={v => move({ v })} /></td><td><button aria-label={`Edit parameters for ${d.vent.name}`} onClick={() => ctx.editVent(d.vent.id)}>Edit</button></td></tr>;
      })}</tbody></table></div>
      {selectedDevice && <>
        <label><input type="checkbox" checked={hvac.devices.find(d => d.vent.id === selected)?.enabled ?? true} onChange={e => commit({ ...hvac, devices: hvac.devices.map(d => d.vent.id === selected ? { ...d, enabled: e.target.checked } : d) })} />Enabled in design</label>
        <div className={styles.ventEditor}>
        <EquipmentPanel scenario={{ ...preview, vents: devices.map(d => hvac.devices.find(v => v.vent.id === d.vent.id)!.vent) }} report={report} selected={`vent:${selected}`} onSelect={id => setSelected(id.replace(/^vent:/, ""))} onChange={editVents} onPick={() => { void preflight(); }} onEditSource={() => ctx.setTab("Heating")} editor placement checked={currentFaces} />
        {selectedDevice.vent.role === "supply" && <CFDNumber label="Outdoor-air fraction (0–1)" min={0} max={1} value={selectedDevice.outdoorAirFraction} onChange={outdoorAirFraction => commit({ ...hvac, devices: hvac.devices.map(d => d.vent.id === selected ? { ...d, outdoorAirFraction } : d) })} />}
        {selectedDevice.vent.role === "extract" && <label>Outlet air path<select aria-label="Outlet air path" value={selectedDevice.extractKind} onChange={e => commit({ ...hvac, devices: hvac.devices.map(d => d.vent.id === selected ? { ...d, extractKind: e.target.value as "exhaust" | "return" } : d) })}><option value="exhaust">Outdoor exhaust</option><option value="return">Return to air handler</option></select></label>}
        </div>
        <details><summary>Scenario override · retain design flow and temperature</summary>
          <CFDNumber label={selectedDevice.vent.role === "supply" ? "Scenario supply temperature (°C)" : "Scenario backflow temperature (°C)"} value={selectedDevice.vent.temperatureK - 273.15} onChange={v => saveScenario({ ...operating, ventOverrides: { ...operating.ventOverrides, [selected!]: { ...operating.ventOverrides[selected!], temperatureK: v + 273.15 } } })} />
          <CFDNumber convert={false} label={`Scenario ${selectedDevice.vent.control === "volumeFlow" ? `volume flow (${flowUnit})` : selectedDevice.vent.control === "massFlow" ? "mass flow (kg/s)" : selectedDevice.vent.control === "velocity" ? "face velocity (m/s)" : "relative pressure (Pa)"}`} value={selectedDevice.vent.control === "volumeFlow" ? flowToDisplay(selectedDevice.vent.valueSI, flowUnit) : selectedDevice.vent.valueSI} onChange={value => saveScenario({ ...operating, ventOverrides: { ...operating.ventOverrides, [selected!]: { ...operating.ventOverrides[selected!], valueSI: selectedDevice.vent.control === "volumeFlow" ? flowFromDisplay(value, flowUnit) : value } } })} />
          <label><input type="checkbox" checked={selectedDevice.enabled} onChange={e => saveScenario({ ...operating, ventOverrides: { ...operating.ventOverrides, [selected!]: { ...operating.ventOverrides[selected!], enabled: e.target.checked } } })} />Operating in this scenario</label>
          <button onClick={() => { const overrides = { ...operating.ventOverrides }; delete overrides[selected!]; saveScenario({ ...operating, ventOverrides: overrides }); }}>Use design values</button>
        </details>
      </>}
      {report && <p>{currentFaces ? "Geometry checked" : "Inputs changed — recheck geometry"}. Drag shared vents in the main 2D or 3D floorplan; edit exact host coordinates in the positions table.</p>}
      {room && <HvacVentPlan room={room} devices={devices} report={report} selected={selected} onSelect={setSelected} sourceStamp={sourceStamp} onMove={(id,u,v,baseline) => {
        if (baseline !== latestStamp.current) { setError("The project changed while dragging. Existing edits retained; retry the move."); return; }
        commit({ ...hvac, devices: hvac.devices.map(d => d.vent.id === id ? { ...d, vent: { ...d.vent, host: { ...d.vent.host, u, v } } } : d) });
      }} />}
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
    {handoff && <details open aria-label="HVAC CFD preflight"><summary>CFD preflight · {operating.name}</summary>
      <p>New case: {handoff.scenario.name}. Existing runs are preserved. Connected volume: {handoff.report.domain.includedRoomIds.length} room(s), {handoff.report.domain.volumeM3.toFixed(2)} m³. Doors/windows stop discovery.</p>
      {handoff.report.domain.includedRoomIds.length !== 1 && <p className={styles.warning}>CFD includes connected rooms; the conventional calculation above evaluates this selected room only. Review additional loads and devices before solving.</p>}
      {handoff.pkg.vents.map(v => <p key={v.id}>{v.parameters.name} · {v.role === "supply" ? "Supply" : v.role === "return" ? "Return" : "Exhaust"} · {hvacControlLabel(v.parameters.control)} · {show(v.volumeFlowM3S, 4)} m³/s · {show(v.temperatureK)} K · {show(v.areaM2, 4)} m²{v.control === "pressure" ? ` · ${v.parameters.valueSI} Pa` : ""}<small>Device {v.id}</small></p>)}
      {handoff.pkg.conditions && <p>Room {handoff.pkg.conditions.roomC}°C · outside {handoff.pkg.conditions.outdoorC}°C · density {handoff.pkg.conditions.densityKgM3} kg/m³ · cp {handoff.pkg.conditions.cpJKgK} J/kg K. {handoff.pkg.envelope.length} envelope surface records retained in the boundary package.</p>}
      {handoff.pkg.heaters.map(h => <p key={`${h.floorId}:${h.id}`}>{h.name} · {h.inDomain ? "Included" : "Out of domain"} · {h.enabled ? show(h.watts, 0) + " W" : "Off"} · {hvacModelLabel(h.model)}</p>)}
      {handoff.pkg.warnings.map(w => <p key={w} className={styles.warning}>{w}</p>)}
      {handoff.report.diagnostics.map((d, i) => <p key={i}>{d.severity}: {d.message}</p>)}
      <div className={styles.actions}><button onClick={() => downloadCFD(new Blob([JSON.stringify(handoff.pkg, null, 2)], { type: "application/json" }), "hvac-cfd-boundaries.json")}>Export boundary package</button>
      <button onClick={async () => { try { if (handoff.sourceStamp !== latestStamp.current) throw new Error("Inputs changed. Repeat preflight."); const hash = await preparationRevision(handoff.pkg.sourceInput); if (handoff.sourceStamp !== latestStamp.current) throw new Error("Inputs changed. Repeat preflight."); const next = { ...handoff.hvac, snapshots: [{ caseId: handoff.scenario.id, operatingScenarioId: operating.id, createdAt: new Date().toISOString(), inputHash: hash, boundaryJson: JSON.stringify(handoff.pkg) }, ...handoff.hvac.snapshots].slice(0, 5) }; ctx.commit(next, [...(project.cfdScenarios ?? []), handoff.scenario]); ctx.navigateCFD(handoff.scenario.id); } catch (e) { setError(e instanceof Error ? e.message : "Could not save CFD handoff."); } }}>Create new case &amp; open in CFD</button><button onClick={() => setHandoff(null)}>Cancel preflight</button></div>
    </details>}
  </section>;
}
