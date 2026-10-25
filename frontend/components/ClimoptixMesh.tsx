"use client";

import { CFDReorderList } from "./CFDReorderList";
import { insertAtBoundary } from "@/lib/climoptixStudies";
import { type CFDScenario } from "@/lib/climoptixDocument";
import type { CFDReport } from "@/lib/climoptix";
import { refinementLevel, refinementColour, refinementCell } from "@/lib/climoptixWorkflow";
import { CFDNumber, CFDText, CFDVector, Parameters } from "./CFDFields";

export function MeshPanel({
  scenario,
  report,
  onChange,
  selected,
  onSelect,
  onShowRefinements,
  onEditRefinement,
}: {
  scenario: CFDScenario;
  report: CFDReport | null;
  onChange: (s: CFDScenario) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onShowRefinements: () => void;
  onEditRefinement: (id: string) => void;
}) {
  const regions = scenario.mesh.refinements,
    region =
      regions.find((r) => `refinement:${r.id}` === selected);
  return (
    <>
      <header className="cfx-inline-toolbar cfx-refinement-toolbar">
        <h3>Local refinement regions</h3>
        <button
        disabled={regions.length >= 200}
        onClick={() => {
          const bounds = report?.domain.boundsMm;
          const names = new Set(regions.map((region) => region.name));
          let number = regions.length + 1;
          while (names.has(`Refinement ${number}`)) number++;
          const next = {
            id: crypto.randomUUID(),
            name: `Refinement ${number}`,
            shape: "box" as const,
            centerMm: bounds
              ? (bounds[0].map((v, i) => (v + bounds[1][i]) / 2) as [
                  number,
                  number,
                  number,
                ])
              : ([0, 0, 0] as [number, number, number]),
            sizeMm: [1000, 1000, 1000] as [number, number, number],
            objectId: null,
            level: 2,
            cellMm: scenario.mesh.baseCellMm / 4,
          };
          onChange({
            ...scenario,
            mesh: {
              ...scenario.mesh,
              preset: "Custom",
              minCellMm: Math.min(
                scenario.mesh.minCellMm,
                scenario.mesh.baseCellMm / 4,
              ),
              refinements: [...regions, next],
            },
          });
          onSelect(`refinement:${next.id}`);
          onEditRefinement(next.id);
        }}
      >
        Add refinement region
      </button>
        <button disabled={!regions.length} onClick={onShowRefinements}>View refinements in 3D</button>
        <small className="cfx-mesh-estimate">{report ? `Estimate · ${report.meshRecipe.estimate.rangeCells.map(v => v.toLocaleString()).join("–")} cells` : "Estimate pending"}</small>
      </header>
      <CFDReorderList
        items={regions}
        label="Refinement regions"
        scope={`refinements:${scenario.id}`}
        onMove={(id, boundary) =>
          onChange({
            ...scenario,
            mesh: {
              ...scenario.mesh,
              refinements: insertAtBoundary(regions, id, boundary),
            },
          })
        }
      >
        {(r, index) => {
          const level = refinementLevel(scenario.mesh.baseCellMm, r);
          return (
            <div
              className={`cfx-refinement-row ${region?.id === r.id ? "selected" : ""}`}
            >
              <span
                className="cfx-level-swatch"
                style={{ background: refinementColour(level) }}
                aria-hidden="true"
              />
              <button
                className="cfx-refinement-name"
                onClick={() => onSelect(`refinement:${r.id}`)}
                aria-label={`Select ${r.name}`}
              >
                <strong>{r.name}</strong>
                <small>
                  Level {level} ·{" "}
                  {refinementCell(scenario.mesh.baseCellMm, r).toLocaleString()}{" "}
                  mm · {r.shape === "box" ? "Cuboid" : r.shape}
                </small>
              </button>
              <div className="cfx-refinement-actions">
                <button
                  aria-label={`Edit ${r.name}`}
                  onClick={() => {
                    onSelect(`refinement:${r.id}`);
                    onEditRefinement(r.id);
                  }}
                >
                  Edit
                </button>
                <button
                  disabled={regions.length >= 200}
                  aria-label={`Duplicate ${r.name}`}
                  onClick={() => {
                    const names = new Set(regions.map((value) => value.name));
                    let name: string,
                      number = 1;
                    do {
                      const suffix = ` copy${number === 1 ? "" : ` ${number}`}`;
                      // Keep an emoji/surrogate pair intact at the name limit.
                      const stem = r.name
                        .slice(0, 120 - suffix.length)
                        .replace(/[\uD800-\uDBFF]$/, "");
                      name = `${stem}${suffix}`;
                      number++;
                    } while (names.has(name));
                    const copy = {
                      ...structuredClone(r),
                      id: crypto.randomUUID(),
                      name,
                    };
                    onChange({
                      ...scenario,
                      mesh: {
                        ...scenario.mesh,
                        refinements: [...regions, copy],
                      },
                    });
                    onSelect(`refinement:${copy.id}`);
                  }}
                >
                  Duplicate
                </button>
                <button
                  aria-label={`Delete ${r.name}`}
                  onClick={() => {
                    onChange({
                      ...scenario,
                      mesh: {
                        ...scenario.mesh,
                        refinements: regions.filter((v) => v.id !== r.id),
                      },
                    });
                    if (region?.id === r.id) {
                      const next = regions[index + 1] ?? regions[index - 1];
                      onSelect(next ? `refinement:${next.id}` : null);
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        }}
      </CFDReorderList>
      {!regions.length && (
        <p className="cfx-caption">No local refinement regions.</p>
      )}
      <details>
        <summary>Refinements, layers, tolerances &amp; quality intent</summary>
        <Parameters
          value={scenario.mesh}
          omit={[
            "preset",
            "baseCellMm",
            "minCellMm",
            "maxCellMm",
            "targetCells",
            "maxCells",
            "refinements",
          ]}
          onChange={(v) =>
            onChange({
              ...scenario,
              mesh: { ...v, preset: "Custom" } as typeof scenario.mesh,
            })
          }
        />
      </details>
    </>
  );
}

/** Live, study-scoped fields for the separate floating refinement editor. */
export function RefinementEditor({
  scenario,
  report,
  id,
  onChange,
}: {
  scenario: CFDScenario;
  report: CFDReport | null;
  id: string;
  onChange: (s: CFDScenario) => void;
}) {
  const regions = scenario.mesh.refinements;
  const region = regions.find((r) => r.id === id);
  const solids =
    report?.objects.filter(
      (o) => o.mode === "solidProxy" && o.verticesMm.length,
    ) ?? [];
  const editRegion = (next: NonNullable<typeof region>) =>
    onChange({
      ...scenario,
      mesh: {
        ...scenario.mesh,
        preset: "Custom",
        refinements: regions.map((r) => (r.id === next.id ? next : r)),
      },
    });
  if (!region)
    return (
      <p>
        This refinement was removed. Close the editor or choose another region.
      </p>
    );
  return (
    <section className="cfx-card">
      <CFDText
        label="Refinement name"
        value={region.name}
        onChange={(name) => editRegion({ ...region, name })}
      />
      <div className="cfx-grid">
        <label>
          Region shape
          <select
            aria-label="Refinement shape"
            value={region.shape}
            onChange={(e) => {
              const shape = e.target.value as typeof region.shape;
              editRegion({
                ...region,
                shape,
                sizeMm:
                  shape === "sphere"
                    ? [region.sizeMm[0], region.sizeMm[0], region.sizeMm[0]]
                    : region.sizeMm,
                objectId:
                  shape === "object"
                    ? (solids[0]?.id ?? null)
                    : region.objectId,
              });
            }}
          >
            <option value="box">Cuboid</option>
            <option value="sphere">Sphere</option>
            <option value="object" disabled={!solids.length}>
              Object extents
            </option>
          </select>
        </label>
        <label>
          snappyHexMesh refinement level
          <select
            aria-label="Refinement level"
            value={region.level ?? "custom"}
            onChange={(e) => {
              const level =
                e.target.value === "custom" ? null : Number(e.target.value);
              const cellMm =
                level === null
                  ? region.cellMm
                  : scenario.mesh.baseCellMm / 2 ** level;
              onChange({
                ...scenario,
                mesh: {
                  ...scenario.mesh,
                  preset: "Custom",
                  minCellMm: Math.min(scenario.mesh.minCellMm, cellMm),
                  refinements: regions.map((r) =>
                    r.id === region.id ? { ...region, level, cellMm } : r,
                  ),
                },
              });
            }}
          >
            {Array.from({ length: 11 }, (_, level) => (
              <option key={level} value={level}>
                Level {level} ·{" "}
                {(scenario.mesh.baseCellMm / 2 ** level).toLocaleString()} mm
              </option>
            ))}
            <option value="custom">Custom cell size</option>
          </select>
        </label>
        {region.level === null ? (
          <>
            <CFDNumber
              label="Refinement cell size (mm)"
              value={region.cellMm}
              onChange={(cellMm) => editRegion({ ...region, cellMm })}
            />
            <p className="cfx-caption">
              Target {region.cellMm.toLocaleString()} mm rounds to level{" "}
              {refinementLevel(scenario.mesh.baseCellMm, region)} · nominal{" "}
              {refinementCell(
                scenario.mesh.baseCellMm,
                region,
              ).toLocaleString()}{" "}
              mm.
            </p>
          </>
        ) : (
          <p className="cfx-caption">
            Level {region.level} · nominal{" "}
            {refinementCell(scenario.mesh.baseCellMm, region).toLocaleString()}{" "}
            mm
          </p>
        )}
      </div>
      {region.shape === "object" ? (
        <label>
          Source object
          <select
            aria-label="Refinement object"
            value={region.objectId ?? ""}
            onChange={(e) =>
              editRegion({ ...region, objectId: e.target.value || null })
            }
          >
            {!solids.some((o) => o.id === region.objectId) && (
              <option value={region.objectId ?? ""}>
                Missing solid · reassign
              </option>
            )}
            {solids.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <CFDVector label="Refinement centre" unit="mm" value={region.centerMm}
            onChange={value => editRegion({ ...region, centerMm: value as [number, number, number] })} />
          {region.shape === "sphere" ? (
            <CFDNumber
              label="Refinement diameter (mm)"
              value={region.sizeMm[0]}
              onChange={(d) => editRegion({ ...region, sizeMm: [d, d, d] })}
            />
          ) : (
            <CFDVector label="Refinement size" unit="mm" value={region.sizeMm}
              onChange={value => editRegion({ ...region, sizeMm: value as [number, number, number] })} />
          )}
        </>
      )}
    </section>
  );
}
