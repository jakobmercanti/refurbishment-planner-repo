"use client";
import type { CFDReport } from "@/lib/climoptix";

const status = { applied: "Mapped", off: "Off", outside: "Outside domain", incomplete: "Needs input", unassigned: "Not mapped" };
const inventory = { boiler: "Boiler ratings supply the water circuit; they are not added as room heat.", pipe: "Distribution pipes have no declared room-side heat-loss model; no extra heat is invented.", manifold: "Manifolds distribute loop flow; their water power is not added again as room heat.", exclusion: "Exclusions remove heated floor coverage; they are not thermal sources." };
const kindLabel: Record<string, string> = { radiator: "Radiator / room heater", ufh: "Underfloor heating", people: "People gains", equipment: "Equipment gains", solar: "Solar gain", infiltration: "Infiltration" };
export function SharedBoundaryCapture({ report, checked }: { report: CFDReport | null; checked: boolean }) {
  const audit = checked ? report?.sharedBoundaryAudit : null;
  return <details className="cfx-card" aria-label="Shared boundary capture" open><summary>Shared boundary capture</summary>
    {!checked ? <p className="cfx-caption" role="status">Boundary inputs changed or checks are pending. Rechecking the current source data before showing mapped conditions.</p> : !audit ? <p className="cfx-notice">The preparation service has not returned shared boundary capture. Update the service before relying on heating or insulation mapping.</p> : <>
      <p role="status">{audit.state === "complete" ? "Shared boundary mapping checked" : "Shared boundary mapping needs review"} · {audit.sources.filter(s => s.status === "applied").length} heat source(s) mapped · {audit.envelope.filter(s => s.status === "applied").length} fabric region(s) mapped.</p>
      <details open><summary>Heating &amp; ventilation source inputs · {audit.sources.length}</summary>{audit.sources.map(s => <div key={s.id} className="cfx-card">
        <strong>{s.name} · {kindLabel[s.kind] ?? s.kind} · {status[s.status]}</strong>
        <p>{s.kind === "infiltration" ? "Airflow needs opening placement" : s.watts === null ? "Room watts need review" : `${s.watts.toFixed(1)} W declared`} · {s.appliedW.toFixed(1)} W mapped · {s.areaM2.toFixed(3)} m² checked surface</p><p className="cfx-caption">{s.message}</p>
      </div>)}</details>
      <details><summary>Insulation boundary regions · {audit.envelope.length}</summary>{audit.envelope.map(s => <div key={s.id} className="cfx-card">
        <strong>{s.name} · {status[s.status]}</strong>
        <p>{s.areaM2.toFixed(3)} m² · U {s.uWm2K === null ? "not assigned" : s.uWm2K.toFixed(4)} W/m²K{s.coefficientWm2K === null ? "" : ` · outward coefficient ${s.coefficientWm2K.toFixed(4)} W/m²K`}{s.ambientK === null ? "" : ` · ambient ${(s.ambientK - 273.15).toFixed(1)}°C`}</p><p className="cfx-caption">{s.message}</p>
      </div>)}</details>
      {!!audit.inventory.length && <details><summary>Other Heating elements</summary>{audit.inventory.map(i => <p key={`${i.floorId}:${i.kind}`}>{i.count} {i.kind}(s) · {inventory[i.kind]}</p>)}</details>}
      <p className="cfx-caption">Flux is positive into air. Radiator watts are distributed once over exposed proxy area. UFH watts apply only to checked tube-spacing coverage. Insulation Robin coefficients remove declared Rsi once. Thermal solving still requires a compatible energy adapter.</p>
    </>}
  </details>;
}
