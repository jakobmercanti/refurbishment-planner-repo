"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { getEngineeringUnitsSnapshot, getServerEngineeringUnitsSnapshot, parseEngineeringUnits, subscribeEngineeringUnits } from "@/lib/appPreferences";
import { ClimoptixObjects } from "./ClimoptixObjects";
import { WindowHelpButton } from "./WindowHelpButton";
import { CFDCollapseAll } from "./CFDCollapseAll";
import { objectGroups } from "@/lib/climoptixObjectGroups";
import { assetOverrideSchema, changeVentControl, ventSchema, type CFDScenario, type CFDVent } from "@/lib/climoptixDocument";
import type { CFDPatch, CFDReport, Vec3 } from "@/lib/climoptix";
import { CFDNumber, CFDText, Parameters, labelFor } from "./CFDFields";
import { ventCenter } from "@/lib/climoptixPreview";
import { ventHostAtCoordinates } from "@/lib/ventPlacement";
import { useHvac } from "./HvacContext";
import { hvacBoundaryPackage } from "@/lib/hvacBridge";
import type { FlowUnit } from "@/lib/cfdUnits";

function VentPositionFields({ vent, hosts, position, onChange }: {
  vent: CFDVent;
  hosts: readonly CFDPatch[];
  position: Vec3 | null;
  onChange: (host: CFDVent["host"]) => void;
}) {
  const [draft, setDraft] = useState(() => position?.map(value => String(Number(value.toFixed(2)))) ?? ["", "", ""]);
  const [error, setError] = useState("");
  return <form className="cfx-vent-position" onSubmit={event => {
    event.preventDefault();
    const point = draft.map(value => value.trim() ? Number(value) : NaN) as Vec3;
    const host = ventHostAtCoordinates(vent, hosts, point);
    if (!host) { setError("Enter a centre on a measured wall, floor or ceiling with room for this vent."); return; }
    onChange(host);
    setError("");
  }}>
    <div className="cfx-grid cfx-three cfx-vent-axes">
      {["X", "Y", "Z"].map((axis, index) => <label key={axis}>{axis} (mm)
        <input type="number" step="any" required aria-label={`Vent ${axis} (mm)`} value={draft[index]}
          onChange={event => { setError(""); setDraft(draft.map((value, i) => i === index ? event.target.value : value)); }} />
      </label>)}
    </div>
    <div className="cfx-vent-position-actions">
      <small>Enter the centre on a wall, floor or ceiling. Z is height above the building origin.</small>
      <button type="submit" disabled={!hosts.length}>Apply position</button>
    </div>
    {error && <p role="alert" className="cfx-error">{error}</p>}
  </form>;
}

export function EquipmentPanel({
  scenario,
  report,
  selected,
  onSelect,
  onChange,
  onPick,
  onEditSource,
  onEditVent,
  editor = false,
  checked = true,
  placement = false,
  editorDone,
  ventFlowFields,
  editorSections,
}: {
  scenario: CFDScenario;
  report: CFDReport | null;
  selected: string | null;
  onSelect: (id: string) => void;
  onChange: (s: CFDScenario) => void;
  onPick: (role: "supply" | "extract", ventId?: string) => void;
  onEditSource: () => void;
  onEditVent?: (id: string) => void;
  editor?: boolean;
  checked?: boolean;
  placement?: boolean;
  editorDone?: () => void;
  ventFlowFields?: (advanced: boolean) => ReactNode;
  editorSections?: ReactNode;
}) {
  const hvacContext = useHvac();
  const unitPreference = useSyncExternalStore(subscribeEngineeringUnits, getEngineeringUnitsSnapshot, getServerEngineeringUnitsSnapshot);
  const [flowOverride, setFlowUnit] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const flowUnit = hvacContext?.flowUnit ?? flowOverride ?? parseEngineeringUnits(unitPreference).cfdFlowUnit ?? "L/s";
  const selectedObjectId =
    report?.patches.find((p) => p.kind === "object" && p.id === selected)
      ?.sourceId ?? selected;
  const vent =
    scenario.vents.find((v) => `vent:${v.id}` === selected) ??
    scenario.vents[0];
  const hosts = report?.patches.filter((p) => p.hostable && p.host) ?? [];
  const hostFrame = hosts.find(p => p.id === vent?.host.patchId)?.host;
  const position = vent && hostFrame ? ventCenter(vent, hostFrame) : null;
  const edit = (v: CFDVent) =>
    onChange({
      ...scenario,
      vents: scenario.vents.map((a) => (a.id === v.id ? v : a)),
    });
  const add = (role: "supply" | "extract", groupId?: string) => {
    if (scenario.vents.length >= 500) return;
    const v = ventSchema.parse({
      id: crypto.randomUUID(),
      name: role === "supply" ? "Supply vent" : "Extract vent",
      role,
      host: { patchId: hosts[0]?.id ?? "unassigned" },
    });
    const next = { ...scenario, vents: [...scenario.vents, v] };
    onChange({ ...next, ...(groupId ? { objectGroups: objectGroups(next).map(g => g.id === groupId ? { ...g, memberIds: [...g.memberIds, `vent:${v.id}`] } : g) } : {}) });
    onSelect(`vent:${v.id}`);
    onEditVent?.(v.id);
  };
  const derived = report?.vents.find((v) => v.id === vent?.id);
  const flowFactor = flowUnit === "L/s" ? 1000 : flowUnit === "m³/h" ? 3600 : 1;
  const renderObject = (objectId: string) => {
    const copy = scenario.objectCopies?.find(o => o.id === objectId);
    const original = report?.objects.find(o => o.id === objectId) ?? report?.objects.find(o => o.id === copy?.sourceObjectId);
    if (!original) return <p role="status">Preparing object…</p>;
    const obj = copy ? { ...original, id: copy.id, name: copy.name } : original;
        const override =
          scenario.assetOverrides.find((v) => v.objectId === obj.id) ??
          assetOverrideSchema.parse({ objectId: obj.id, mode: obj.mode });
        const apply = (v: typeof override) =>
          onChange({
            ...scenario,
            assetOverrides: [
              ...scenario.assetOverrides.filter((x) => x.objectId !== obj.id),
              v,
            ],
          });
        const sharedHeater = hvacContext?.project.hvac?.bindings[scenario.id] ? hvacBoundaryPackage(hvacContext.project, scenario).heaters.find(h => h.id === obj.id) : null;
        return (
          <section className="cfx-card" data-cfx-collapse-root>
            <header className="cfx-inline-toolbar"><h3>{obj.name}</h3><WindowHelpButton title="Object proxy" steps={[{ heading: "Measured proxy", text: obj.profile ? `Catalogue proxy: ${obj.profile}` : "No eligible catalogue proxy. Exclude this asset or explicitly review a conservative box." }, ...(obj.assumptions ?? []).map(text => ({ heading: "Proxy assumption", text }))]} /><CFDCollapseAll/></header>
            <details open><summary>Treatment &amp; physical inputs</summary>
            {copy && <CFDText key={copy.id} label="CFD object name" value={copy.name} maxLength={120} onChange={name => onChange({ ...scenario, objectCopies: scenario.objectCopies!.map(o => o.id === copy.id ? { ...o, name } : o) })} />}
            {!obj.profile &&
              !scenario.assetOverrides.some((v) => v.objectId === obj.id) && (
                <button onClick={() => apply({ ...override, mode: "none" })}>
                  Confirm excluded
                </button>
              )}
            <div className="cfx-grid">
              <label>
                CFD treatment
                <select
                  value={override.mode}
                  disabled={!!sharedHeater}
                  onChange={(e) =>
                    apply({
                      ...override,
                      mode: e.target.value as typeof override.mode,
                    })
                  }
                >
                  <option value="none">Excluded</option>
                  <option value="solidProxy">Solid proxy</option>
                  <option value="sourceOnly">Source only</option>
                  <option value="porousProxy" disabled>
                    Porous · not connected
                  </option>
                </select>
              </label>
              <CFDNumber
                label={`Heat · ${obj.name} (W)`}
                value={override.heatW}
                disabled={!!sharedHeater}
                onChange={(heatW) => apply({ ...override, heatW })}
              />
              <CFDNumber
                label={`CO₂ · ${obj.name} (m³/s)`}
                value={override.co2M3S}
                disabled={!!sharedHeater}
                onChange={(co2M3S) => apply({ ...override, co2M3S })}
              />
              <CFDNumber
                label={`Count · ${obj.name}`}
                value={override.count}
                disabled={!!sharedHeater}
                onChange={(count) => apply({ ...override, count })}
              />
            </div>
            {sharedHeater && <p className="cfx-notice">Shared Heating output. Change its operating watts in Shared HVAC design &amp; operation, or open Heating to edit design geometry/ratings.</p>}
            {!sharedHeater && <Parameters
              value={override}
              omit={[
                "objectId",
                "mode",
                "heatW",
                "co2M3S",
                "count",
                "temperatureK",
              ]}
              onChange={(v) => apply(v as typeof override)}
            />}
            <label className="cfx-check">
              <input
                type="checkbox"
                disabled={!!sharedHeater}
                checked={override.temperatureK !== null}
                onChange={(e) =>
                  apply({
                    ...override,
                    temperatureK: e.target.checked ? 293.15 : null,
                  })
                }
              />
              Prescribed surface temperature
            </label>
            {override.temperatureK !== null && (
              <CFDNumber
                label={`Surface temperature · ${obj.name} (K)`}
                value={override.temperatureK}
                onChange={(temperatureK) =>
                  apply({ ...override, temperatureK })
                }
              />
            )}
            </details>
          </section>
        );

  };
  if (!editor) return <ClimoptixObjects scenario={scenario} objects={report?.objects ?? []} selected={selectedObjectId ?? null}
    onSelect={onSelect} onChange={onChange} onAdd={add} onPick={() => onPick("supply")} onEditVent={onEditVent}
    onEditSource={onEditSource} renderObject={renderObject} canAdd={scenario.vents.length < 500} canPlace={!!hosts.length && scenario.vents.length < 500} checked={checked} />;
  return (
    <>
      {editor && vent && (
        <section className="cfx-card cfx-vent-settings" data-cfx-collapse-root>
          <header className="cfx-inline-toolbar"><label className="cfx-check cfx-vent-advanced"><input type="checkbox" checked={advanced} onChange={event => setAdvanced(event.target.checked)} />Advanced mode</label><CFDCollapseAll wholeWindow={!!editorDone}/>{editorDone && <button type="button" onClick={editorDone}>Done</button>}</header>
          <details open><summary>Position &amp; size</summary>
          <CFDText
            label="Vent name"
            value={vent.name}
            onChange={(name) => edit({ ...vent, name })}
          />
          <div className="cfx-grid">
            <label>
              Role
              <select
                value={vent.role}
                onChange={(e) =>
                  edit({ ...vent, role: e.target.value as CFDVent["role"] })
                }
              >
                <option value="supply">Supply</option>
                <option value="extract">Extract</option>
              </select>
            </label>
            <label>
              Shape
              <select
                value={vent.shape}
                onChange={(e) =>
                  edit({ ...vent, shape: e.target.value as CFDVent["shape"] })
                }
              >
                <option value="rectangle">Rectangle</option>
                <option value="circle">Circle</option>
              </select>
            </label>
          </div>
          {advanced && <label>
            Host face
            <select
              aria-label="Vent host face"
              value={vent.host.patchId}
              onChange={(e) =>
                edit({
                  ...vent,
                  host: { ...vent.host, patchId: e.target.value },
                })
              }
            >
              {!hosts.some((h) => h.id === vent.host.patchId) && (
                <option value={vent.host.patchId}>
                  Missing host · reassign
                </option>
              )}
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label ?? labelFor(h.kind)} ·{" "}
                  {report?.domain.regions.find((r) => r.id === h.roomId)
                    ?.name ?? h.roomId}
                </option>
              ))}
            </select>
          </label>}
          {!hostFrame && <p className="cfx-notice" role="status">Vent has no measured mounting surface. Drag it onto a surface, enter a position, or use Advanced mode to choose a host face.</p>}
          {!placement && <button disabled={!hosts.length} onClick={() => onPick(vent.role, vent.id)}>Place this vent on face…</button>}
          <VentPositionFields key={`${vent.id}:${vent.host.patchId}:${position?.join(",")}`} vent={vent} hosts={hosts} position={position} onChange={host => edit({ ...vent, host })} />
          <div className="cfx-grid">
            {vent.shape === "rectangle" ? (
              <>
                <CFDNumber
                  label="Vent width (mm)"
                  value={vent.widthMm}
                  onChange={(widthMm) => edit({ ...vent, widthMm })}
                />
                <CFDNumber
                  label="Vent height (mm)"
                  value={vent.heightMm}
                  onChange={(heightMm) => edit({ ...vent, heightMm })}
                />
              </>
            ) : (
              <CFDNumber
                label="Vent diameter (mm)"
                value={vent.diameterMm}
                onChange={(diameterMm) => edit({ ...vent, diameterMm })}
              />
            )}
            {advanced && <><CFDNumber
              label="Host U (0–1)"
              value={vent.host.u}
              onChange={(u) => edit({ ...vent, host: { ...vent.host, u } })}
            />
            <CFDNumber
              label="Host V (0–1)"
              value={vent.host.v}
              onChange={(v) => edit({ ...vent, host: { ...vent.host, v } })}
            />
            <CFDNumber
              label="Vent rotation (°)"
              value={vent.rotationDeg}
              onChange={(rotationDeg) => edit({ ...vent, rotationDeg })}
            />
            <CFDNumber
              label="Open area fraction (0–1)"
              value={vent.openAreaFraction}
              onChange={(openAreaFraction) =>
                edit({ ...vent, openAreaFraction })
              }
            /></>}
          </div>
          </details>
          <details open><summary>Flow &amp; thermal conditions</summary>
          {ventFlowFields?.(advanced)}
          <label>
            Controlling quantity
            <select
              aria-label="Vent controlling quantity"
              value={vent.control}
              onChange={(e) =>
                edit(changeVentControl(vent, e.target.value as CFDVent["control"]))
              }
            >
              <option value="volumeFlow">Volume flow</option>
              <option value="massFlow">Mass flow (kg/s)</option>
              <option value="velocity">Mean velocity (m/s)</option>
              <option value="pressure">Pressure (Pa)</option>
            </select>
          </label>
          <small>Changing the quantity resets its value and clears saved flow overrides for this vent. Check the operating value below.</small>
          <div className="cfx-grid cfx-vent-flow-row">
          {vent.control === "volumeFlow" && (
            <label>
              Flow display unit
              <select
                aria-label="Flow display unit"
                value={flowUnit}
                onChange={(e) => { setFlowUnit(e.target.value); hvacContext?.setFlowUnit(e.target.value as FlowUnit); }}
              >
                {["L/s", "m³/h", "m³/s"].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </label>
          )}
          <CFDNumber
            convert={false}
            label={
              vent.control === "volumeFlow"
                ? `Volume flow (${flowUnit})`
                : vent.control === "massFlow"
                  ? "Mass flow (kg/s)"
                  : vent.control === "velocity"
                    ? "Mean velocity (m/s)"
                    : "Relative pressure (Pa)"
            }
            value={
              vent.valueSI * (vent.control === "volumeFlow" ? flowFactor : 1)
            }
            onChange={(v) =>
              edit({
                ...vent,
                valueSI: v / (vent.control === "volumeFlow" ? flowFactor : 1),
              })
            }
          />
          </div>
          <div className="cfx-grid">
            <CFDNumber
              label="Supply / inflow temperature (K)"
              value={vent.temperatureK}
              onChange={(temperatureK) => edit({ ...vent, temperatureK })}
            />
            {advanced && <CFDNumber
              label="Inflow CO₂ (ppm)"
              value={vent.co2Ppm}
              onChange={(co2Ppm) => edit({ ...vent, co2Ppm })}
            />}
          </div>
          {advanced && derived && (
            <p className="cfx-notice">
              Actual {derived.actualAreaM2.toPrecision(4)} m² · effective{" "}
              {derived.effectiveAreaM2.toPrecision(4)} m²
              {derived.meanVelocityMS !== null && (
                <> · {derived.meanVelocityMS.toPrecision(3)} m/s</>
              )}
            </p>
          )}
          </details>
          {advanced && <details className="cfx-vent-expert">
            <summary>
              Jet, discharge, grouping &amp; placement constraints
            </summary>
            <Parameters
              value={vent}
              omit={[
                "id",
                "name",
                "role",
                "shape",
                "host",
                "widthMm",
                "heightMm",
                "diameterMm",
                "rotationDeg",
                "openAreaFraction",
                "control",
                "valueSI",
                "temperatureK",
                "co2Ppm",
                "optimization",
              ]}
              onChange={(v) => edit(v as CFDVent)}
            />
            <details className="cfx-vent-optimisation">
              <summary>Optimisation</summary>
              <label className="cfx-check"><input type="checkbox" checked={vent.optimization.locked}
                onChange={event => edit({ ...vent, optimization: { ...vent.optimization, locked: event.target.checked } })} />Lock position for future optimisation</label>
              <div className="cfx-grid">
                <CFDNumber label="Maximum displacement (mm)" value={vent.optimization.maxDisplacementMm} min={0}
                  onChange={maxDisplacementMm => edit({ ...vent, optimization: { ...vent.optimization, maxDisplacementMm } })} />
                <CFDNumber label="Minimum vent spacing (mm)" value={vent.optimization.minSpacingMm} min={0}
                  onChange={minSpacingMm => edit({ ...vent, optimization: { ...vent.optimization, minSpacingMm } })} />
              </div>
              <Parameters value={vent.optimization} omit={["locked", "maxDisplacementMm", "minSpacingMm"]}
                onChange={optimization => edit({ ...vent, optimization: optimization as CFDVent["optimization"] })} />
            </details>
          </details>}
          {advanced && editorSections}
        </section>
      )}
    </>
  );
}
