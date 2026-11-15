"use client";

import { useState } from "react";
import type { CFDScenario } from "@/lib/climoptixDocument";
import { hvacConditionsSchema, hvacErrorMessage, type HvacOperatingScenario, type HvacProject } from "@/lib/hvacDocument";
import type { SharedHeater } from "@/lib/hvacHeating";
import { CFDNumber } from "./CFDFields";
import { useHvac } from "./HvacContext";

const NEW_SCENARIO = "__new-scenario__";

export function SharedHvacCFD({ scenario, onEditSource }: { scenario: CFDScenario; onEditSource: () => void }) {
  const ctx = useHvac(), hvac = ctx?.project.hvac, link = hvac?.bindings[scenario.id];
  const [newName, setNewName] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (!ctx || !hvac || !link) return null;

  const operating = hvac.scenarios.find(s => s.id === link.operatingScenarioId);
  const room = scenario.seed ?? operating;
  const roomScenarios = hvac.scenarios.filter(s => s.id === operating?.id || s.floorId === room?.floorId && s.roomId === room?.roomId);
  const selectScenario = (id: string | null, scenarios = hvac.scenarios) => {
    try {
      ctx.commit({
        ...hvac, scenarios, activeScenarioId: id ?? hvac.activeScenarioId,
        bindings: { ...hvac.bindings, [scenario.id]: { ...link, operatingScenarioId: id, editMode: id ? "override" : "design", overrides: {} } },
      });
      setNewName(null);
      setError("");
    } catch (cause) { setError(hvacErrorMessage(cause)); }
  };
  const createScenario = () => {
    const name = newName?.trim();
    if (!room || !name) { setError("Enter a scenario title for the selected room."); return; }
    const source = operating?.floorId === room.floorId && operating.roomId === room.roomId ? operating : undefined;
    const created: HvacOperatingScenario = {
      id: crypto.randomUUID(), name, floorId: room.floorId, roomId: room.roomId,
      conditions: source ? structuredClone(source.conditions) : hvacConditionsSchema.parse({}),
      ventOverrides: source ? structuredClone(source.ventOverrides) : {},
      heaterOverrides: source ? structuredClone(source.heaterOverrides) : {},
    };
    selectScenario(created.id, [...hvac.scenarios, created]);
  };
  const openSource = (tab: "Heating" | "Ventilation") => {
    try {
      if (operating && hvac.activeScenarioId !== operating.id) ctx.commit({ ...hvac, activeScenarioId: operating.id });
      const selected = hvac.devices.find(d => d.vent.id === ctx.selectedVentId && scenario.vents.some(v => v.id === d.vent.id));
      const target = selected ?? room;
      if (target) ctx.focusRoom(target, selected?.vent.id);
      ctx.setTab(tab);
      ctx.requestHeating();
      onEditSource();
    } catch (cause) { setError(hvacErrorMessage(cause)); }
  };

  return <details open className="cfx-card" aria-label="Shared HVAC devices">
    <summary>Shared HVAC design &amp; operation</summary>
    <label>Shared operating scenario
      <select aria-label="CFD shared operating scenario" value={newName === null ? link.operatingScenarioId ?? "" : NEW_SCENARIO} onChange={event => {
        if (event.target.value === NEW_SCENARIO) { setNewName(""); setError(""); }
        else selectScenario(event.target.value || null);
      }}>
        <option value="">Case air settings · shared design</option>
        {roomScenarios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        <option value={NEW_SCENARIO} disabled={!room || hvac.scenarios.length >= 100}>New scenario...</option>
      </select>
    </label>
    {newName !== null && <form onSubmit={event => { event.preventDefault(); createScenario(); }}>
      <label>Scenario title<input value={newName} required maxLength={100} onChange={event => setNewName(event.target.value)} /></label>
      <div className="cfx-equal-actions">
        <button type="submit">Create scenario</button>
        <button type="button" onClick={() => { setNewName(null); setError(""); }}>Cancel</button>
      </div>
    </form>}
    <div className="cfx-equal-actions">
      <button onClick={() => openSource("Ventilation")}>Open ventilation</button>
      <button onClick={() => openSource("Heating")}>Open heating</button>
    </div>
    {error && <p role="alert" className="cfx-error">{error}</p>}
  </details>;
}

export function CFDSharedHeaterSettings({ heater, scenarioId }: { heater: SharedHeater; scenarioId: string }) {
  const ctx = useHvac(), hvac = ctx?.project.hvac;
  const operating = hvac?.scenarios.find(s => s.id === hvac.bindings[scenarioId]?.operatingScenarioId);
  const [error, setError] = useState("");
  const override = operating?.heaterOverrides[heater.id];
  const save = (value: HvacOperatingScenario["heaterOverrides"][string] | null) => {
    if (!ctx || !hvac || !operating) return;
    const heaterOverrides = { ...operating.heaterOverrides };
    if (value) heaterOverrides[heater.id] = value;
    else delete heaterOverrides[heater.id];
    const next: HvacProject = { ...hvac, scenarios: hvac.scenarios.map(s => s.id === operating.id ? { ...s, heaterOverrides } : s) };
    try { ctx.commit(next); setError(""); }
    catch (cause) { setError(hvacErrorMessage(cause)); }
  };

  return <details open><summary>{heater.name} · operating output</summary>
    {operating ? <>
      <label className="cfx-check">
        <input type="checkbox" checked={override?.enabled ?? true} onChange={event => save({ enabled: event.target.checked, actualW: override?.actualW ?? null })} />
        Enabled in {operating.name}
      </label>
      <CFDNumber label="Scenario effective output (W)" value={override?.actualW ?? heater.watts ?? 0} min={0}
        onChange={actualW => save({ enabled: override?.enabled ?? true, actualW })} />
      <button disabled={!override} onClick={() => save(null)}>Use Heating output</button>
    </> : <p>{heater.watts === null ? "Heating output is unavailable." : `Heating output · ${heater.watts.toFixed(1)} W`} Select a shared operating scenario to edit it.</p>}
    {error && <p role="alert" className="cfx-error">{error}</p>}
  </details>;
}
