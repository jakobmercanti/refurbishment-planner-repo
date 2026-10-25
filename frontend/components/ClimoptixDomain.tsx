"use client";

import { meshPreset, type CFDScenario } from "@/lib/climoptixDocument";
import type { CFDReport } from "@/lib/climoptix";
import { projectFloors } from "@/lib/buildingDocument";
import type { ProjectDocument } from "@/lib/projectDocument";
import { CFDNumber, Parameters, labelFor } from "./CFDFields";

export function DomainPanel({
  project,
  scenario,
  report,
  onChange,
}: {
  project: ProjectDocument;
  scenario: CFDScenario;
  report: CFDReport | null;
  onChange: (s: CFDScenario) => void;
}) {
  const floors = projectFloors(project),
    floor = floors.find((f) => f.id === scenario.seed?.floorId) ?? floors[0];
  return (
    <>
      <div className="cfx-grid cfx-domain-seed">
      <label>
        Seed floor
        <select
          aria-label="Seed floor"
          value={floor.id}
          onChange={(e) => {
            const f = floors.find((f) => f.id === e.target.value)!;
            onChange({
              ...scenario,
              seed: f.content.rooms[0]
                ? { floorId: f.id, roomId: f.content.rooms[0].id }
                : null,
            });
          }}
        >
          {floors.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Seed room
        <select
          aria-label="Seed room"
          value={scenario.seed?.roomId ?? ""}
          onChange={(e) =>
            onChange({
              ...scenario,
              seed: e.target.value
                ? { floorId: floor.id, roomId: e.target.value }
                : null,
            })
          }
        >
          <option value="">Choose a room…</option>
          {floor.content.rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      </div>
      {!floor.content.rooms.length && (
        <p className="cfx-notice">No measured enclosed rooms on this floor.</p>
      )}
      <h3>Mesh settings</h3>
      <MeshSettings scenario={scenario} onChange={onChange} />
      <details>
        <summary>Mesh origin &amp; alignment</summary>
        <Parameters value={scenario.mesh} omit={Object.keys(scenario.mesh).filter(k => !["originMm", "alignmentDeg"].includes(k))}
          onChange={mesh => onChange({ ...scenario, mesh: mesh as typeof scenario.mesh })} />
        <p className="cfx-caption">Domain extents follow the measured, connected rooms. Origin and alignment position the mesh grid; they do not resize the building.</p>
      </details>
      {report && (
        <>
          <div className="cfx-metrics">
            <div>
              <small>Connected rooms</small>
              <strong>{report.domain.includedRoomIds.length}</strong>
            </div>
            <div>
              <small>
                {report.surface.closed
                  ? "Last checked air volume"
                  : "Unverified signed volume"}
              </small>
              <strong>{report.domain.volumeM3.toFixed(2)} m³</strong>
            </div>
          </div>
          <h3>Connectivity inspector</h3>
          <p className="cfx-caption">
            Connected floors:{" "}
            {report.domain.floorIds
              .map((id) => floors.find((f) => f.id === id)?.name ?? id)
              .join(", ") || "None"}
          </p>
          {report.domain.boundsMm && (
            <p className="cfx-caption">
              Last checked bounds (X × Y × Z):{" "}
              {report.domain.boundsMm[0]
                .map((v, i) => Math.round(report.domain.boundsMm![1][i] - v))
                .join(" × ")}{" "}
              mm
            </p>
          )}
          <ul className="cfx-inspector-list">
            {report.domain.regions.map((r) => (
              <li key={r.id}>
                <strong>{r.name}</strong>
                <span>
                  {r.included ? "Included" : "Excluded · disconnected"} ·{" "}
                  {floors.find((f) => f.id === r.floorId)?.name ?? r.floorId}
                </span>
                <small>
                  Elevation {r.baseMm} mm · ceiling{" "}
                  {r.ceilingRangeMm
                    .map((v) => Math.round(v - r.baseMm))
                    .join("–")}{" "}
                  mm
                </small>
              </li>
            ))}
          </ul>
          <h3>Passages &amp; stops</h3>
          {report.domain.portals.map((p) => (
            <div className="cfx-notice" key={p.id}>
              <strong>
                {p.traversed ? "↔ Connected" : "STOP"} · {p.kind}
              </strong>
              <small>
                {p.reason} · {p.rooms.join(" ↔ ")}
              </small>
            </div>
          ))}
          {report.domain.slabVoids.map((v) => (
            <div key={v.id} className="cfx-notice">
              ↕ Physical slab void · {v.id}
            </div>
          ))}
        </>
      )}
    </>
  );
}
function MeshSettings({
  scenario,
  onChange,
}: {
  scenario: CFDScenario;
  onChange: (s: CFDScenario) => void;
}) {
  return (
    <div className="cfx-grid cfx-adaptive-grid">
      <label>
        Mesh intent preset
        <select
          aria-label="Mesh intent preset"
          value={scenario.mesh.preset}
          onChange={(e) =>
            onChange({
              ...scenario,
              mesh:
                e.target.value === "Custom"
                  ? { ...scenario.mesh, preset: "Custom" }
                  : {
                      ...meshPreset(
                        e.target.value as typeof scenario.mesh.preset,
                      ),
                      refinements: scenario.mesh.refinements,
                      originMm: scenario.mesh.originMm,
                      alignmentDeg: scenario.mesh.alignmentDeg,
                    },
            })
          }
        >
          {["Draft", "Standard", "Fine", "Custom"].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
        {(
          [
            "baseCellMm",
            "minCellMm",
            "maxCellMm",
            "targetCells",
            "maxCells",
          ] as const
        ).map((key) => (
          <CFDNumber
            key={key}
            label={labelFor(key)}
            value={scenario.mesh[key]}
            onChange={(v) =>
              onChange({
                ...scenario,
                mesh: { ...scenario.mesh, preset: "Custom", [key]: v },
              })
            }
          />
        ))}
    </div>
  );
}
