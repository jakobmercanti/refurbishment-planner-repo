"use client";

import { useState, useSyncExternalStore } from "react";
import { getEngineeringUnitsSnapshot, getServerEngineeringUnitsSnapshot, parseEngineeringUnits, subscribeEngineeringUnits } from "@/lib/appPreferences";
import { ClimoptixObjects } from "./ClimoptixObjects";
import { WindowHelpButton } from "./WindowHelpButton";
import { CFDCollapseAll } from "./CFDCollapseAll";
import { objectGroups } from "@/lib/climoptixObjectGroups";
import { assetOverrideSchema, ventSchema, type CFDScenario, type CFDVent } from "@/lib/climoptixDocument";
import type { CFDReport } from "@/lib/climoptix";
import { CFDNumber, CFDText, Parameters, labelFor } from "./CFDFields";
import { ventCenter } from "@/lib/climoptixPreview";

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
}) {
  const unitPreference = useSyncExternalStore(subscribeEngineeringUnits, getEngineeringUnitsSnapshot, getServerEngineeringUnitsSnapshot);
  const [flowOverride, setFlowUnit] = useState<string | null>(null);
  const flowUnit = flowOverride ?? parseEngineeringUnits(unitPreference).cfdFlowUnit ?? "L/s";
  const selectedObjectId =
    report?.patches.find((p) => p.kind === "object" && p.id === selected)
      ?.sourceId ?? selected;
  const vent =
    scenario.vents.find((v) => `vent:${v.id}` === selected) ??
    scenario.vents[0];
  const hosts = report?.patches.filter((p) => p.hostable && p.host) ?? [];
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
                onChange={(heatW) => apply({ ...override, heatW })}
              />
              <CFDNumber
                label={`CO₂ · ${obj.name} (m³/s)`}
                value={override.co2M3S}
                onChange={(co2M3S) => apply({ ...override, co2M3S })}
              />
              <CFDNumber
                label={`Count · ${obj.name}`}
                value={override.count}
                onChange={(count) => apply({ ...override, count })}
              />
            </div>
            <Parameters
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
            />
            <label className="cfx-check">
              <input
                type="checkbox"
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
          <header className="cfx-inline-toolbar"><h3>Vent settings</h3><CFDCollapseAll/></header>
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
          <label>
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
          </label>
          {!hosts.some(h => h.id === vent.host.patchId) && <p className="cfx-notice" role="status">Unassigned vent · choose a seed room in Domain and resolve preparation checks, then select a validated host face here. This draft cannot be submitted or exported as a runnable case.</p>}
          {!placement && <button disabled={!hosts.length} onClick={() => onPick(vent.role, vent.id)}>Place this vent on face…</button>}
          {placement && (() => {
            const host = hosts.find(p => p.id === vent.host.patchId)?.host;
            return host ? <output aria-label="Live vent coordinates" className="cfx-notice">Position (mm): {ventCenter(vent, host).map((v, axis) => `${["X", "Y", "Z"][axis]} ${v.toFixed(1)}`).join(" · ")}</output> : <p>Choose a host face in the 3D view.</p>;
          })()}
          <div className="cfx-grid">
            <CFDNumber
              label="Host U (0–1)"
              value={vent.host.u}
              onChange={(u) => edit({ ...vent, host: { ...vent.host, u } })}
            />
            <CFDNumber
              label="Host V (0–1)"
              value={vent.host.v}
              onChange={(v) => edit({ ...vent, host: { ...vent.host, v } })}
            />
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
            />
          </div>
          </details>
          <details open><summary>Flow &amp; thermal conditions</summary>
          <label>
            Controlling quantity
            <select
              aria-label="Vent controlling quantity"
              value={vent.control}
              onChange={(e) =>
                edit({ ...vent, control: e.target.value as CFDVent["control"] })
              }
            >
              <option value="volumeFlow">Volume flow</option>
              <option value="massFlow">Mass flow (kg/s)</option>
              <option value="velocity">Mean velocity (m/s)</option>
              <option value="pressure">Pressure (Pa)</option>
            </select>
          </label>
          {vent.control === "volumeFlow" && (
            <label>
              Flow display unit
              <select
                aria-label="Flow display unit"
                value={flowUnit}
                onChange={(e) => setFlowUnit(e.target.value)}
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
          <div className="cfx-grid">
            <CFDNumber
              label="Supply / inflow temperature (K)"
              value={vent.temperatureK}
              onChange={(temperatureK) => edit({ ...vent, temperatureK })}
            />
            <CFDNumber
              label="Inflow CO₂ (ppm)"
              value={vent.co2Ppm}
              onChange={(co2Ppm) => edit({ ...vent, co2Ppm })}
            />
          </div>
          {derived && (
            <p className="cfx-notice">
              Actual {derived.actualAreaM2.toPrecision(4)} m² · effective{" "}
              {derived.effectiveAreaM2.toPrecision(4)} m²
              {derived.meanVelocityMS !== null && (
                <> · {derived.meanVelocityMS.toPrecision(3)} m/s</>
              )}
            </p>
          )}
          </details>
          <details>
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
              ]}
              onChange={(v) => edit(v as CFDVent)}
            />
            <small className="cfx-caption">Optimization: metadata only</small>
          </details>
        </section>
      )}
    </>
  );
}
