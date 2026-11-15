"use client";

import { meshPreset, type CFDScenario } from "@/lib/climoptixDocument";
import type { CFDReport } from "@/lib/climoptix";
import { backgroundCellCount } from "@/lib/climoptixWorkflow";
import { projectFloors } from "@/lib/buildingDocument";
import type { ProjectDocument } from "@/lib/projectDocument";
import { CFDNumber, CFDVector, labelFor } from "./CFDFields";

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
  const mesh = scenario.mesh;
  const bounds = report?.domain.boundsMm;
  const baseCells = bounds ? backgroundCellCount(bounds, mesh) : null;
  const roomNames = new Map(report?.domain.regions.map(room => [room.id, room.name]));
  const floorName = (id: string) => floors.find(floor => floor.id === id)?.name ?? "Unresolved floor";
  return (
    <section data-cfx-collapse-root className="cfx-domain-panel">
      <details open><summary>Seed &amp; connected domain</summary>
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
      </details><details open><summary>Mesh settings</summary>
      <MeshSettings scenario={scenario} onChange={onChange} />
      <details data-section-help>
        <summary>Mesh origin &amp; alignment</summary>
        <fieldset><legend>Origin (mm)</legend>
          <CFDVector label="Origin" unit="mm" value={mesh.originMm}
            onChange={([x, y, z]) => onChange({ ...scenario, mesh: { ...mesh, originMm: [x, y, z] } })} />
        </fieldset>
        <fieldset><legend>Alignment (°)</legend>
          <CFDVector label="Rotation about" unit="°" value={[...(mesh.alignmentXYDeg ?? [0, 0]), mesh.alignmentDeg]}
            min={-360} max={360}
            onChange={([x, y, z]) => onChange({ ...scenario, mesh: { ...mesh, alignmentXYDeg: x || y ? [x, y] : undefined, alignmentDeg: z } })} />
        </fieldset>
        <p className="cfx-caption">The background grid rotates about the origin in X, Y, Z order. Measured rooms and boundary conditions keep their building coordinates.</p>
      </details>
      <div className="cfx-metrics cfx-base-cell-estimate">
        <div><small>Predicted cells before refinement</small>
          <strong>{baseCells?.toLocaleString() ?? "Check domain first"}</strong></div>
      </div>
      {baseCells !== null && baseCells > mesh.maxCells && <p className="cfx-error" role="status">The background grid exceeds the cell budget. Increase Base Cell or adjust the origin and alignment.</p>}
      </details>
      {report && (
        <details open><summary>Connectivity &amp; passages</summary>
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
              .map(floorName)
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
                  {floorName(r.floorId)}
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
          {report.domain.portals.map((p, index) => (
            <div className="cfx-notice" key={p.id}>
              <strong>
                {labelFor(p.kind)} {index + 1} · {p.traversed ? "Connected" : "Stops connectivity"}
              </strong>
              <small>
                {p.reason}{p.rooms.length > 0 && ` · ${p.rooms.map(id => roomNames.get(id) ?? "Unresolved room").join(" ↔ ")}`}
              </small>
            </div>
          ))}
          {report.domain.slabVoids.map((v, index) => (
            <div key={v.id} className="cfx-notice">
              <strong>Slab opening {index + 1}</strong>
              <small>{roomNames.get(v.lower) ?? "Lower room"} ↔ {roomNames.get(v.upper) ?? "Upper room"}</small>
            </div>
          ))}
        </details>
      )}
    </section>
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
                      alignmentXYDeg: scenario.mesh.alignmentXYDeg,
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
