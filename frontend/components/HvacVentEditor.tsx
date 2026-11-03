"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useHvac } from "./HvacContext";
import { FloatingToolbar } from "./FloatingToolbar";
import { EquipmentPanel } from "./ClimoptixEquipment";
import { CFDNumber } from "./CFDFields";
import { newCFDScenario } from "@/lib/climoptixDocument";
import { hvacErrorMessage, hvacSchema, type VentDevice } from "@/lib/hvacDocument";
import type { CFDReport } from "@/lib/climoptix";
import styles from "./HeatingLayoutPanel.module.css";

/** The same canonical vent editor opens from either floorplan viewer or the workbench. */
export function HvacVentEditor() {
  const ctx = useHvac()!, hvac = ctx.project.hvac;
  const device = hvac?.devices.find(d => d.vent.id === ctx.editVentId);
  const [checked, setChecked] = useState<{ key: string; report: CFDReport } | null>(null), [error, setError] = useState("");
  const { ensureGeometry, geometryKey } = ctx;
  const floorId = device?.floorId, roomId = device?.roomId;
  useEffect(() => {
    let cancelled = false;
    if (floorId && roomId) void ensureGeometry({ floorId, roomId }).then(report => { if (!cancelled && report) setChecked({ key: geometryKey, report }); }).catch(e => { if (!cancelled) setError(hvacErrorMessage(e)); });
    return () => { cancelled = true; };
  }, [ensureGeometry, geometryKey, floorId, roomId]);
  if (!hvac || !device || typeof document === "undefined") return null;
  const report = checked?.key === ctx.geometryKey ? checked.report : null;
  const scenario = { ...newCFDScenario(ctx.project.projectId, "Shared vent editor"), id: "hvac-editor", seed: { floorId: device.floorId, roomId: device.roomId }, vents: [device.vent] };
  const apply = (patch: Partial<VentDevice>) => {
    try {
      const next = hvacSchema.parse({ ...hvac, devices: hvac.devices.map(d => d.vent.id === device.vent.id ? { ...d, ...patch } : d) });
      // Only the current room operation follows a design edit; independent scenarios retain their overrides.
      const operating = next.scenarios.find(s => s.id === next.activeScenarioId && s.floorId === device.floorId && s.roomId === device.roomId) ?? next.scenarios.find(s => s.floorId === device.floorId && s.roomId === device.roomId);
      if (patch.vent && operating) {
        const override = operating.ventOverrides[device.vent.id];
        if (override) {
          if (patch.vent.valueSI !== device.vent.valueSI) delete override.valueSI;
          if (patch.vent.temperatureK !== device.vent.temperatureK) delete override.temperatureK;
          if (!Object.keys(override).length) delete operating.ventOverrides[device.vent.id];
        }
      }
      ctx.commit(next); setError("");
    } catch (e) { setError(hvacErrorMessage(e)); }
  };
  return createPortal(<FloatingToolbar title={`Edit vent · ${device.vent.name}`} className="hvac-vent-editor" defaultPosition={{ x: 180, y: 90 }} initialSize={{ width: 620 }} maxHeight={760} bringToFront onClose={() => ctx.editVent(null)}>
    <div className={styles.panel}>
      <label><input type="checkbox" checked={device.enabled} onChange={e => apply({ enabled: e.target.checked })} />Enabled in design</label>
      {!report && <p role="status">Checking measured host faces…</p>}
      <EquipmentPanel scenario={scenario} report={report} selected={`vent:${device.vent.id}`} onSelect={() => {}} onChange={next => { const vent = next.vents[0], host = report?.patches.find(p => p.id === vent.host.patchId); apply({ vent, ...(host ? { floorId: host.floorId, roomId: host.roomId } : {}) }); }} onPick={() => {}} onEditSource={() => {}} editor placement checked={false} />
      {device.vent.role === "supply" ? <CFDNumber label="Outdoor-air fraction (0–1)" min={0} max={1} value={device.outdoorAirFraction} onChange={outdoorAirFraction => apply({ outdoorAirFraction })} /> : <label>Outlet air path<select aria-label="Outlet air path" value={device.extractKind} onChange={e => apply({ extractKind: e.target.value as "exhaust" | "return" })}><option value="exhaust">Outdoor exhaust</option><option value="return">Return to air handler</option></select></label>}
      <p>Edits update the shared design in Heating/Ventilation and linked CFD cases. Recheck geometry before CFD export or execution.</p>
      {error && <p role="alert" className={styles.warning}>{error}</p>}
      <button onClick={() => ctx.editVent(null)}>Done</button>
    </div>
  </FloatingToolbar>, document.body);
}
