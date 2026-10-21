"use client";

import { useEffect, useRef, useState } from "react";
import {
  cfdScenarioSchema,
  duplicateCFDScenario,
  newCFDScenario,
  ventSchema,
  type CFDScenario,
} from "@/lib/climoptixDocument";
import {
  downloadCFD,
  preparationInput,
  preparationPackage,
  preparationSummary,
  preparationRevision,
  prepareCFD,
  openfoamSettings,
  scenarioImport,
  type CFDReport,
} from "@/lib/climoptix";
import type { ProjectDocument } from "@/lib/projectDocument";
import { WindowHelpButton } from "./WindowHelpButton";
import { ClimoptixViewer } from "./ClimoptixViewer";
import {
  BoundariesPanel,
  CFDText,
  DomainPanel,
  EquipmentPanel,
  PhysicsPanel,
} from "./ClimoptixPanels";
import { ClimoptixSimulation, type SimulationTab } from "./ClimoptixSimulation";
import { ClimoptixVTKViewer } from "./ClimoptixVTKViewer";

const PHASES = [
  { id: "domain", label: "Domain", hint: "Connected air volume" },
  { id: "equipment", label: "Equipment", hint: "Vents, objects & people" },
  { id: "boundaries", label: "Boundaries", hint: "Named surface conditions" },
  { id: "physics", label: "Physics", hint: "Air, heat & CO₂" },
  { id: "mesh", label: "Simulation", hint: "Mesh · Run · Post-processing" },
  { id: "review", label: "Review & export", hint: "Preflight & handoff" },
] as const;
const EMPTY_SCENARIOS: CFDScenario[] = [];
type Phase = (typeof PHASES)[number]["id"];
const HELP = [
  {
    heading: "One shared building",
    text: "Create a study, choose a seed room, then Validate & refresh. Geometry, furniture and people come from your existing project in millimetres; Climoptix does not maintain a second building. File → Save includes all studies.",
  },
  {
    heading: "Connectivity is explicit",
    text: "Only permanent doorless passages and physical slab voids connect air regions. Doors and windows stop discovery at every open state. Their virtual caps can use an opening/pressure boundary; they are not automatically solid walls.",
  },
  {
    heading: "Prepare, inspect, export",
    text: "Add vents and review surface conditions and physics. Simulation contains Mesh, Run and Post-processing tabs: define coloured refinement regions, resource/run settings and named slices. Validate after setup changes. Preparation and optional Foamlib settings exports are handoffs, not runnable solver cases.",
  },
  {
    heading: "No simulated results",
    text: "No mesher, solver or job service is connected, so Play remains disabled and no study results are computed. You can inspect imported real solver logs and VTK surface/slice files; these remain external, not verified results for this study. Counts are estimates. Review engineering assumptions before connecting a worker.",
  },
];
function DeleteStudy({
  name,
  onCancel,
  onDelete,
}: {
  name: string;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      className="cfx-confirm"
      ref={ref}
      aria-label="Delete CFD scenario"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2>Delete this study?</h2>
      <p>
        “{name}” and its CFD settings will be removed. The shared building and
        assets are kept. Undo can restore the study.
      </p>
      <div className="cfx-actions">
        <button onClick={onCancel}>Cancel</button>
        <button className="cfx-danger" onClick={onDelete}>
          Delete study
        </button>
      </div>
    </dialog>
  );
}
interface Props {
  active: boolean;
  project: ProjectDocument;
  apiUrl: string;
  view: "2D" | "3D";
  onView: (v: "2D" | "3D") => void;
  onChange: (scenarios: CFDScenario[], checkpoint?: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onEditBuilding: () => void;
}
export function ClimoptixWorkspace({
  active,
  project,
  apiUrl,
  view,
  onView,
  onChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onEditBuilding,
}: Props) {
  const [selectedId, setSelectedId] = useState(""),
    [phase, setPhase] = useState<Phase>("domain"),
    [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<string | null>(null),
    [reports, setReports] = useState<Record<string, CFDReport>>({});
  const [hash, setHash] = useState({ input: "", revision: "" }),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState(false);
  const [picking, setPicking] = useState<"supply" | "extract" | null>(null),
    [diagnosticFilter, setDiagnosticFilter] = useState("all");
  const [editorReset, setEditorReset] = useState(0);
  const [simulationTab, setSimulationTab] = useState<SimulationTab>("mesh");
  const [exporting, setExporting] = useState(false);
  const [vtkFile, setVTKFile] = useState<{
    studyId: string;
    token: string;
    file: File;
  } | null>(null);
  const scenarios = project.cfdScenarios ?? EMPTY_SCENARIOS,
    visible = scenarios.filter((s) => showArchived || !s.archived);
  const scenario = visible.find((s) => s.id === selectedId) ?? visible[0];
  const input = scenario ? preparationInput(project, scenario) : "";
  const revision = hash.input === input ? hash.revision : "";
  const activeReport = scenario ? (reports[scenario.id] ?? null) : null;
  const stale =
    !activeReport ||
    !revision ||
    activeReport.validation.clientRevision !== revision;
  const current = useRef({ project, scenario, input, scenarios });
  useEffect(() => {
    current.current = { project, scenario, input, scenarios };
  }, [project, scenario, input, scenarios]);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (input)
      void preparationRevision(input).then((revision) => {
        if (!cancelled) setHash({ input, revision });
      });
    return () => {
      cancelled = true;
    };
  }, [input]);
  useEffect(() => () => abort.current?.abort(), []);
  const change = (s: CFDScenario, checkpoint = false) => {
    const result = cfdScenarioSchema.safeParse({
      ...s,
      updatedAt: new Date().toISOString(),
    });
    if (!result.success) {
      setError(
        "Changes not applied: " +
          result.error.issues
            .map((i) => i.message)
            .slice(0, 3)
            .join(" "),
      );
      return;
    }
    setError("");
    setMessage("");
    const before = scenarios.find((v) => v.id === s.id);
    // Adding/removing a device and a completed drag are discrete operations,
    // not keystrokes to coalesce into an earlier modelling change.
    const devicesChanged =
      JSON.stringify(before?.vents.map((v) => v.id)) !==
      JSON.stringify(result.data.vents.map((v) => v.id));
    const regionsChanged =
      JSON.stringify(before?.mesh.refinements.map((r) => r.id)) !==
      JSON.stringify(result.data.mesh.refinements.map((r) => r.id));
    onChange(
      scenarios.map((v) => (v.id === s.id ? result.data : v)),
      checkpoint || devicesChanged || regionsChanged,
    );
  };
  const add = () => {
    if (scenarios.length >= 100) {
      setError(
        "A project supports up to 100 studies. Export and delete an unused study to free a slot; archiving keeps it in the project.",
      );
      return;
    }
    const s = newCFDScenario(
      project.projectId,
      `Ventilation study ${scenarios.length + 1}`,
    );
    onChange([...scenarios, s], true);
    setSelectedId(s.id);
    setPhase("domain");
    setError("");
  };
  const validate = async () => {
    if (!scenario || busy || !revision) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError("");
    setMessage("Checking measured geometry, connectivity and setup…");
    const capturedInput = input,
      capturedId = scenario.id;
    try {
      const value = await prepareCFD(
        apiUrl,
        project,
        scenario,
        revision,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const now = current.current,
        original = now.scenarios.find((s) => s.id === capturedId);
      if (
        !original ||
        preparationInput(now.project, original) !== capturedInput
      ) {
        setMessage(
          "Setup changed during preparation. Validate again; the older response was not applied.",
        );
        return;
      }
      setReports((previous) => ({
        ...Object.fromEntries(
          Object.entries(previous)
            .filter(([id]) => id !== capturedId)
            .slice(-2),
        ),
        [capturedId]: value,
      }));
      onChange(
        now.scenarios.map((s) =>
          s.id === capturedId ? { ...s, validation: value.validation } : s,
        ),
      );
      setMessage(
        value.validation.errors
          ? `${value.validation.errors} blocking issue(s). Review diagnostics before exporting a surface.`
          : `Preparation checked · ${value.validation.warnings} warning(s). No solver has run.`,
      );
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Preparation service unavailable. Your local study is safe.",
        );
        setMessage("");
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  const exportScenario = () => {
    if (scenario)
      downloadCFD(
        new Blob([JSON.stringify(scenario, null, 2)], {
          type: "application/json",
        }),
        `${scenario.name}.scenario.json`,
      );
  };
  const exportOpenFOAM = async () => {
    if (!scenario || stale || exporting) return;
    const captured = input,
      studyId = scenario.id;
    setExporting(true);
    setError("");
    try {
      const zip = await openfoamSettings(apiUrl, project, scenario, revision);
      const now = current.current,
        original = now.scenarios.find((s) => s.id === studyId);
      if (!original || preparationInput(now.project, original) !== captured) {
        setMessage(
          "Setup changed during export. Validate again; the older settings were not downloaded.",
        );
        return;
      }
      downloadCFD(zip, `${scenario.name}-openfoam-settings.zip`);
      setMessage(
        "Foamlib settings exported. This is a configuration handoff, not a runnable OpenFOAM case.",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "OpenFOAM settings export failed.",
      );
    } finally {
      setExporting(false);
    }
  };
  const importScenario = async (file: File) => {
    try {
      if (file.size > 4 * 1024 * 1024)
        throw new Error("Scenario JSON exceeds 4 MB.");
      if (scenarios.length >= 100)
        throw new Error("The project already has 100 studies.");
      const imported = scenarioImport(
        JSON.parse(await file.text()),
        project.projectId,
      );
      const now = current.current;
      if (now.project.projectId !== project.projectId) return;
      onChange([...now.scenarios, imported], true);
      setSelectedId(imported.id);
      setError("");
      setMessage(
        "Study imported. Source references were retained; validate to check them against this building.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid study file.");
    }
  };
  const hostPick = (patchId: string, u: number, v: number) => {
    if (!scenario || !picking) return;
    const vent = ventSchema.parse({
      id: crypto.randomUUID(),
      name: picking === "supply" ? "Supply vent" : "Extract vent",
      role: picking,
      host: { patchId, u, v },
    });
    change({ ...scenario, vents: [...scenario.vents, vent] });
    setSelected(`vent:${vent.id}`);
    setPicking(null);
    setPhase("equipment");
  };
  const moveVent = (id: string, u: number, v: number) => {
    if (scenario)
      change(
        {
          ...scenario,
          vents: scenario.vents.map((vent) =>
            vent.id === id ? { ...vent, host: { ...vent.host, u, v } } : vent,
          ),
        },
        true,
      );
  };
  const jump = (objectId: string | null, group: string) => {
    const device = objectId
      ? scenario?.vents.find((v) => v.id === objectId)
      : undefined;
    const object = objectId
      ? activeReport?.objects.find((v) => v.id === objectId)
      : undefined;
    if (objectId) setSelected(device ? `vent:${objectId}` : objectId);
    if (device || object) {
      setPhase("equipment");
      return;
    }
    setPhase(
      group === "vents"
        ? "equipment"
        : group === "boundaries"
          ? "boundaries"
          : group === "physics" || group === "outputs"
            ? "physics"
            : group === "mesh" || group === "resources"
              ? "mesh"
              : "domain",
    );
  };
  const status = busy
    ? "Checking…"
    : scenario?.validation && scenario.validation.clientRevision !== revision
      ? "Stale"
      : activeReport && !stale
        ? activeReport.state
        : "Draft";
  const diagnostics =
    activeReport?.diagnostics.filter(
      (d) => diagnosticFilter === "all" || d.severity === diagnosticFilter,
    ) ?? [];
  return (
    <section className="cfx-workspace" aria-label="Climoptix CFD workspace">
      <header className="cfx-heading">
        <div>
          <span className="cfx-eyebrow">CLIMOPTIX CFD</span>
          <h1>Prepare indoor airflow</h1>
        </div>
        <span
          className="cfx-provider"
          title="No mesher, CFD solver or job service is connected."
        >
          Preparation only · solver not connected
        </span>
        <WindowHelpButton title="Climoptix CFD" steps={HELP} />
      </header>
      <div className="cfx-studybar">
        <label>
          Study
          <select
            aria-label="CFD scenario"
            value={scenario?.id ?? ""}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setSelected(null);
              setError("");
              setMessage("");
              setPicking(null);
            }}
          >
            {!visible.length && <option value="">No studies yet</option>}
            {visible.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.archived ? " · archived" : ""}
              </option>
            ))}
          </select>
        </label>
        <button onClick={add}>New study</button>
        <button
          disabled={!scenario || scenarios.length >= 100}
          onClick={() => {
            if (scenario) {
              const copy = duplicateCFDScenario(scenario);
              onChange([...scenarios, copy], true);
              setSelectedId(copy.id);
            }
          }}
        >
          Duplicate
        </button>
        <button
          disabled={!scenario}
          onClick={() =>
            scenario && change({ ...scenario, archived: !scenario.archived })
          }
        >
          {scenario?.archived ? "Unarchive" : "Archive"}
        </button>
        <button
          disabled={!scenario}
          className="cfx-danger"
          onClick={() => setDeleting(true)}
        >
          Delete
        </button>
        <label className="cfx-check">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Archived
        </label>
        <div className="cfx-history">
          <button disabled={!canUndo} onClick={onUndo}>
            Undo
          </button>
          <button disabled={!canRedo} onClick={onRedo}>
            Redo
          </button>
        </div>
      </div>
      {!scenario ? (
        <div className="cfx-welcome">
          {error && (
            <p role="alert" className="cfx-error">
              {error}
            </p>
          )}
          <span className="cfx-eyebrow">
            ONE BUILDING. INDEPENDENT STUDIES.
          </span>
          <h2>Start with the space you already designed.</h2>
          <p>
            Create a study to prepare connected air volumes, vents, occupants
            and engineering conditions. Your floorplan stays authoritative; no
            solver results are invented.
          </p>
          <div className="cfx-actions">
            <button className="cfx-primary" onClick={add}>
              Create first study
            </button>
            <label className="cfx-file">
              Import study
              <input
                aria-label="Import CFD scenario"
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void importScenario(f);
                }}
              />
            </label>
          </div>
        </div>
      ) : (
        <>
          <div className="cfx-body">
            <nav className="cfx-phases" aria-label="CFD preparation phases">
              {PHASES.map((p, i) => (
                <button
                  key={p.id}
                  aria-current={phase === p.id ? "step" : undefined}
                  className={phase === p.id ? "active" : ""}
                  onClick={() => {
                    setPhase(p.id);
                    setPicking(null);
                  }}
                >
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{p.label}</strong>
                    <small>{p.hint}</small>
                  </div>
                </button>
              ))}
            </nav>
            <section
              className="cfx-inspector"
              key={editorReset}
              aria-label={`${PHASES.find((p) => p.id === phase)!.label} settings`}
            >
              <div className="cfx-inspector-heading">
                <h2>{PHASES.find((p) => p.id === phase)!.label}</h2>
                <span className={`cfx-state ${status.toLowerCase()}`}>
                  {status}
                </span>
              </div>
              <CFDText
                label="Study name"
                value={scenario.name}
                onChange={(name) => change({ ...scenario, name })}
              />
              {phase === "domain" && (
                <DomainPanel
                  project={project}
                  scenario={scenario}
                  report={activeReport}
                  onChange={change}
                />
              )}
              {phase === "equipment" && (
                <EquipmentPanel
                  scenario={scenario}
                  report={activeReport}
                  selected={selected}
                  onSelect={setSelected}
                  onChange={change}
                  onPick={(role) => {
                    setPicking(role);
                    onView("3D");
                  }}
                  onEditSource={onEditBuilding}
                />
              )}
              {phase === "boundaries" && (
                <BoundariesPanel
                  scenario={scenario}
                  report={activeReport}
                  selected={selected}
                  onSelect={setSelected}
                  onChange={change}
                />
              )}
              {phase === "physics" && (
                <PhysicsPanel scenario={scenario} onChange={change} />
              )}
              {phase === "mesh" && (
                <ClimoptixSimulation
                  tab={simulationTab}
                  onTab={setSimulationTab}
                  scenario={scenario}
                  report={activeReport}
                  onChange={change}
                  selected={selected}
                  onSelect={setSelected}
                  onExport={() => void exportOpenFOAM()}
                  exporting={exporting}
                  exportDisabled={
                    stale || !!activeReport?.validation.errors || !!error
                  }
                  onVTK={(file) => {
                    setVTKFile({
                      studyId: scenario.id,
                      file,
                      token: crypto.randomUUID(),
                    });
                    onView("3D");
                  }}
                />
              )}
              {phase === "review" && (
                <>
                  <p className="cfx-intro">
                    Validate the current source and setup. A preparation
                    manifest may contain blocking diagnostics; surface export is
                    included only when all geometry checks pass. Neither is a
                    runnable solver case.
                  </p>
                  <label>
                    Study notes
                    <textarea
                      value={scenario.description}
                      maxLength={2000}
                      onChange={(e) =>
                        change({ ...scenario, description: e.target.value })
                      }
                    />
                  </label>
                  <div className="cfx-actions">
                    <button onClick={exportScenario}>Export study JSON</button>
                    <label className="cfx-file">
                      Import study
                      <input
                        aria-label="Import CFD scenario"
                        type="file"
                        accept=".json,application/json"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (f) void importScenario(f);
                        }}
                      />
                    </label>
                    <button
                      className="cfx-primary"
                      disabled={stale || !!error}
                      onClick={() => {
                        try {
                          if (activeReport)
                            downloadCFD(
                              preparationPackage(
                                scenario,
                                activeReport,
                                revision,
                              ),
                              `${scenario.name}.climoptix.zip`,
                            );
                        } catch (e) {
                          setError(
                            e instanceof Error ? e.message : "Export failed.",
                          );
                        }
                      }}
                    >
                      Export preparation ZIP
                    </button>
                    <button
                      disabled={stale || !!error}
                      onClick={() => {
                        try {
                          if (activeReport)
                            downloadCFD(
                              new Blob(
                                [
                                  preparationSummary(
                                    scenario,
                                    activeReport,
                                    revision,
                                  ),
                                ],
                                { type: "text/plain;charset=utf-8" },
                              ),
                              `${scenario.name}-preflight.txt`,
                            );
                        } catch (e) {
                          setError(
                            e instanceof Error
                              ? e.message
                              : "Report export failed.",
                          );
                        }
                      }}
                    >
                      Download settings &amp; preflight
                    </button>
                  </div>
                  {activeReport && (
                    <>
                      <dl className="cfx-provenance">
                        <dt>Geometry SHA-256</dt>
                        <dd>{activeReport.validation.sourceHash}</dd>
                        <dt>Configuration SHA-256</dt>
                        <dd>{activeReport.validation.configurationHash}</dd>
                        <dt>Checked</dt>
                        <dd>
                          {new Date(
                            activeReport.validation.checkedAt,
                          ).toLocaleString()}
                        </dd>
                        <dt>Surface</dt>
                        <dd>
                          {activeReport.surface.exportable
                            ? `${activeReport.surface.triangleCount} boundary triangles · STL in metres`
                            : `Blocked · ${activeReport.surface.badEdges} non-manifold/open edges`}
                        </dd>
                      </dl>
                      <h3>Provider limitations</h3>
                      <ul>
                        {activeReport.limitations.map((v) => (
                          <li key={v}>{v}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  <h3>Preflight diagnostics</h3>
                  <label>
                    Severity
                    <select
                      aria-label="CFD diagnostic severity"
                      value={diagnosticFilter}
                      onChange={(e) => setDiagnosticFilter(e.target.value)}
                    >
                      <option value="all">All</option>
                      <option value="error">Blocking errors</option>
                      <option value="warning">Warnings</option>
                      <option value="info">Information</option>
                    </select>
                  </label>
                  {diagnostics.map((d, i) => (
                    <article
                      className={`cfx-diagnostic ${d.severity}`}
                      key={`${d.code}:${d.objectId}:${i}`}
                    >
                      <strong>
                        {d.severity.toUpperCase()} · {d.group}
                      </strong>
                      <p>{d.message}</p>
                      <small>{d.repair}</small>
                      {d.objectId && (
                        <button onClick={() => jump(d.objectId, d.group)}>
                          Inspect {d.objectId}
                        </button>
                      )}
                    </article>
                  ))}
                  {!activeReport && (
                    <p>Validate to generate the diagnostic report.</p>
                  )}
                </>
              )}
            </section>
            {active &&
            phase === "mesh" &&
            simulationTab === "post" &&
            vtkFile?.studyId === scenario.id ? (
              <ClimoptixVTKViewer
                key={vtkFile.token}
                file={vtkFile.file}
                onClose={() => setVTKFile(null)}
              />
            ) : (
              active && (
                <ClimoptixViewer
                  key={`${scenario.id}|${scenario.seed?.floorId ?? ""}`}
                  project={project}
                  scenario={scenario}
                  report={activeReport}
                  view={view}
                  stale={stale}
                  selected={selected}
                  onSelect={(id) => {
                    setSelected(id);
                    if (id.startsWith("refinement:")) {
                      setPhase("mesh");
                      setSimulationTab("mesh");
                    }
                    if (
                      id.startsWith("vent:") ||
                      activeReport?.objects.some((obj) => obj.id === id)
                    )
                      setPhase("equipment");
                  }}
                  onSeed={(floorId, roomId) => {
                    if (phase === "domain")
                      change({ ...scenario, seed: { floorId, roomId } });
                    else setSelected(roomId);
                  }}
                  picking={!!picking}
                  onHostPick={hostPick}
                  onMoveVent={moveVent}
                  canMoveVents={phase === "equipment"}
                  showSamplingPlanes={
                    phase === "mesh" && simulationTab === "post"
                  }
                />
              )
            )}
          </div>
          <footer className="cfx-statusbar">
            <div>
              {error ? (
                <span role="alert" className="cfx-error">
                  {error}{" "}
                  <button
                    onClick={() => {
                      setError("");
                      setEditorReset((x) => x + 1);
                    }}
                  >
                    Dismiss · keep saved values
                  </button>
                </span>
              ) : (
                <span role="status">
                  {message ||
                    "Local autosave · numbers apply on Enter or leaving the field · mm geometry / SI physics"}
                </span>
              )}
            </div>
            <button
              className="cfx-primary"
              disabled={
                busy || !revision || error.startsWith("Changes not applied")
              }
              onClick={() => void validate()}
            >
              {busy ? "Checking…" : "Validate & refresh"}
            </button>
            {picking && (
              <button onClick={() => setPicking(null)}>Cancel placement</button>
            )}
          </footer>
        </>
      )}
      {deleting && scenario && (
        <DeleteStudy
          name={scenario.name}
          onCancel={() => setDeleting(false)}
          onDelete={() => {
            onChange(
              scenarios.filter((s) => s.id !== scenario.id),
              true,
            );
            setDeleting(false);
            setSelectedId("");
            setReports((previous) =>
              Object.fromEntries(
                Object.entries(previous).filter(([id]) => id !== scenario.id),
              ),
            );
          }}
        />
      )}
    </section>
  );
}
