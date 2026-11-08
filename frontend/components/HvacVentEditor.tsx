"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useHvac } from "./HvacContext";
import { FloatingToolbar } from "./FloatingToolbar";
import { EquipmentPanel } from "./ClimoptixEquipment";
import { CFDNumber } from "./CFDFields";
import { newCFDScenario } from "@/lib/climoptixDocument";
import { hvacConditionsSchema, hvacErrorMessage, updateVentDevice, type HvacOperatingScenario, type VentDevice } from "@/lib/hvacDocument";
import { useHvacHostReport } from "./useHvacHostReport";
import { flowFromDisplay, flowToDisplay } from "@/lib/hvacCalculations";
import styles from "./HeatingLayoutPanel.module.css";

/** The same canonical vent editor opens from either floorplan viewer or the workbench. */
export function HvacVentEditor() {
  const ctx = useHvac()!, hvac = ctx.project.hvac;
  const device = hvac?.devices.find(d => d.vent.id === ctx.editVentId);
  const [operationId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const [opener] = useState(() => typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => () => { if (opener?.isConnected && opener.getClientRects().length) opener.focus({ preventScroll: true }); }, [opener]);
  const hosts = useHvacHostReport(device?.floorId, device?.roomId), report = hosts.report;
  if (!hvac || !device || typeof document === "undefined") return null;
  const scenario = { ...newCFDScenario(ctx.project.projectId, "Shared vent editor"), id: "hvac-editor", seed: { floorId: device.floorId, roomId: device.roomId }, vents: [device.vent] };
  const operating: HvacOperatingScenario = hvac.scenarios.find(op=>op.id===hvac.activeScenarioId&&op.floorId===device.floorId&&op.roomId===device.roomId) ?? hvac.scenarios.find(op=>op.floorId===device.floorId&&op.roomId===device.roomId) ?? {id:operationId,name:"Nominal operation",floorId:device.floorId,roomId:device.roomId,conditions:hvacConditionsSchema.parse({}),ventOverrides:{},heaterOverrides:{}};
  const override = operating.ventOverrides[device.vent.id] ?? {};
  const flowUnit = ctx.flowUnit ?? "L/s";
  const control = device.vent.control;
  const flowLabel = {
    volumeFlow: `volume flow (${flowUnit})`,
    massFlow: "mass flow (kg/s)",
    velocity: "face velocity (m/s)",
    pressure: "relative pressure (Pa)",
  }[control];
  const saveOverrides = (ventOverrides: HvacOperatingScenario["ventOverrides"]) => {
    try {
      const next = { ...operating, ventOverrides };
      const scenarios = hvac.scenarios.some(scenario => scenario.id === next.id)
        ? hvac.scenarios.map(scenario => scenario.id === next.id ? next : scenario)
        : [...hvac.scenarios, next];
      ctx.commit({ ...hvac, activeScenarioId: next.id, scenarios });
      setError("");
    } catch (cause) {
      setError(hvacErrorMessage(cause));
    }
  };
  const operation = (patch: Partial<typeof override>) => saveOverrides({
    ...operating.ventOverrides,
    [device.vent.id]: { ...override, ...patch },
  });
  const apply = (patch: Partial<VentDevice>) => {
    try {
      ctx.commit(updateVentDevice(hvac, device.vent.id, patch)); setError("");
    } catch (e) { setError(hvacErrorMessage(e)); }
  };
  return createPortal(<FloatingToolbar title={`Edit vent · ${device.vent.name}`} className="hvac-vent-editor" defaultPosition={{ x: 180, y: 90 }} initialSize={{ width: 620 }} maxHeight={760} bringToFront onClose={() => ctx.editVent(null)}>
    <div className={styles.panel}>
      <label><input type="checkbox" checked={device.enabled} onChange={e => apply({ enabled: e.target.checked })} />Enabled in design</label>
      {hosts.loading && <p role="status">Checking measured host faces…</p>}
      {hosts.error && <div><p role="alert" className={styles.warning}>{hosts.error}</p><button onClick={hosts.retry}>Retry host checks</button></div>}
      <EquipmentPanel scenario={scenario} report={report} selected={`vent:${device.vent.id}`} onSelect={() => {}} onChange={next => { const vent = next.vents[0], host = report?.patches.find(p => p.id === vent.host.patchId); apply({ vent, ...(host ? { floorId: host.floorId, roomId: host.roomId } : {}) }); }} onPick={() => {}} onEditSource={() => {}} editor placement checked={false} editorDone={() => ctx.editVent(null)}
        ventFlowFields={device.vent.role === "supply" ? <CFDNumber label="Outdoor-air fraction (0–1)" min={0} max={1} value={device.outdoorAirFraction} onChange={outdoorAirFraction => apply({ outdoorAirFraction })} /> : <label>Outlet air path<select aria-label="Outlet air path" value={device.extractKind} onChange={e => apply({ extractKind: e.target.value as "exhaust" | "return" })}><option value="exhaust">Outdoor exhaust</option><option value="return">Return to air handler</option></select></label>}
        editorSections={<details><summary>Operating scenario overrides</summary>
        <p>These inputs apply to {operating.name}; design values are retained.</p>
        <CFDNumber label={device.vent.role === "supply" ? "Scenario supply temperature (°C)" : "Scenario backflow temperature (°C)"} value={(override.temperatureK??device.vent.temperatureK)-273.15} onChange={value=>operation({temperatureK:value+273.15})}/>
        <CFDNumber convert={false} label={`Scenario ${flowLabel}`} value={control==="volumeFlow"?flowToDisplay(override.valueSI??device.vent.valueSI,flowUnit):override.valueSI??device.vent.valueSI} onChange={value=>operation({valueSI:control==="volumeFlow"?flowFromDisplay(value,flowUnit):value})}/>
        <label><input type="checkbox" checked={override.enabled??device.enabled} onChange={event=>operation({enabled:event.target.checked})}/>Operating in this scenario</label>
        <button disabled={!operating.ventOverrides[device.vent.id]} onClick={() => {
          const overrides = { ...operating.ventOverrides };
          delete overrides[device.vent.id];
          saveOverrides(overrides);
        }}>Use design values</button>
      </details>} />
      {error && <p role="alert" className={styles.warning}>{error}</p>}
    </div>
  </FloatingToolbar>, document.body);
}
