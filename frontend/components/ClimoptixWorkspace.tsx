"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FloatingToolbar } from "./FloatingToolbar";
import {
  ClimoptixWindowMenu,
  CFD_WINDOWS,
  type CFDWindowId,
  type CFDWindowVisibility,
} from "./ClimoptixWindowMenu";
import { projectFloors } from "@/lib/buildingDocument";
import {
  thermalSetupSchema,
  type ThermalMetric,
  type ThermalPackage,
  type ThermalSurface,
} from "@/lib/thermalDocument";
import { requestThermal } from "@/lib/thermalClient";
import { ThermalEnvelopeWindow } from "./ThermalEnvelopeWindow";
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
import { WindowIcon } from "./WindowIcon";
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
import {
  ClimoptixConvergence,
  ClimoptixConvergenceWindow,
  useConvergenceLogs,
} from "./ClimoptixConvergence";

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
    heading: "Your 3D workspace",
    text: "Use View to inspect the whole building, a room or a connected air volume. This does not change your study's seed room. Open, hide and reopen floating windows from Toolbar or by right-clicking the background. Drag a titlebar to move a window and its edges to resize it.",
  },
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
  opener,
  onCancel,
  onDelete,
}: {
  name: string;
  opener: HTMLButtonElement;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    cancel.current?.focus();
    return () => {
      dialog?.close();
      if (opener.isConnected) {
        const target = opener.disabled
          ? opener.parentElement?.querySelector<HTMLButtonElement>(
              "button:not(:disabled)",
            )
          : opener;
        target?.focus();
      }
    };
  }, [opener]);
  return (
    <dialog
      className="popup cfx-confirm"
      ref={ref}
      aria-label="Delete CFD scenario"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <header className="popup-titlebar">
        <span className="popup-icon">
          <WindowIcon title="Delete study" />
        </span>
        <strong>Delete this study?</strong>
        <div className="window-header-actions">
          <WindowHelpButton
            title="Delete CFD study"
            steps={[
              {
                heading: "Keep the building",
                text: "Delete removes only this study and its CFD settings. The shared building, assets and other studies are unchanged. Cancel or Escape keeps the study; Undo can restore a deleted study.",
              },
            ]}
          />
          <button
            className="popup-close"
            aria-label="Close dialog"
            title="Close dialog"
            onClick={onCancel}
          >
            ×
          </button>
        </div>
      </header>
      <div className="popup-content">
        <p>
          “{name}” and its CFD settings will be removed. The shared building and
          assets are kept. Undo can restore the study.
        </p>
      </div>
      <footer className="popup-actions">
        <button ref={cancel} onClick={onCancel}>
          Cancel
        </button>
        <button className="cfx-danger" onClick={onDelete}>
          Delete study
        </button>
      </footer>
    </dialog>
  );
}
interface Props {
  active: boolean;
  project: ProjectDocument;
  apiUrl: string;
  menuTarget: HTMLElement | null;
  onChange: (scenarios: CFDScenario[], checkpoint?: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onEditBuilding: () => void;
  onEditInsulation?: (
    surface: ThermalSurface,
    constructionScenario: string | null,
  ) => void;
}
export function ClimoptixWorkspace({
  active,
  project,
  apiUrl,
  menuTarget,
  onChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onEditBuilding,
  onEditInsulation,
}: Props) {
  const [selectedId, setSelectedId] = useState(""),
    [showArchived, setShowArchived] = useState(false);
  const [windows, setWindows] = useState<CFDWindowVisibility>(
    () =>
      Object.fromEntries(
        CFD_WINDOWS.map((w) => [
          w.id,
          w.id === "studies" ||
            (w.id === "domain" &&
              !!project.cfdScenarios?.some((s) => !s.archived)),
        ]),
      ) as CFDWindowVisibility,
  );
  const [windowFocus, setWindowFocus] = useState<
    Partial<Record<CFDWindowId, number>>
  >({});
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [resultsOpen, setResultsOpen] = useState(false);
  const previewScenario = useMemo(
    () => newCFDScenario(project.projectId, "Building view"),
    [project.projectId],
  );
  const openPhase = (id: Phase) => {
    setWindows((previous) => ({ ...previous, [id]: true }));
    setWindowFocus((previous) => ({
      ...previous,
      [id]: (previous[id] ?? 0) + 1,
    }));
  };
  const [selected, setSelected] = useState<string | null>(null),
    [reports, setReports] = useState<Record<string, CFDReport>>({});
  const [hash, setHash] = useState({ input: "", revision: "" }),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState<HTMLButtonElement | null>(null);
  const [picking, setPicking] = useState<"supply" | "extract" | null>(null),
    [diagnosticFilter, setDiagnosticFilter] = useState("all");
  const [editorReset, setEditorReset] = useState(0);
  const [simulationTab, setSimulationTab] = useState<SimulationTab>("mesh");
  const [showRefinements, setShowRefinements] = useState(true);
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [thermalOpen, setThermalOpen] = useState(false);
  const [thermalReports, setThermalReports] = useState<
    Record<string, ThermalPackage>
  >({});
  const [thermalTask, setThermalTask] = useState({
    studyId: "",
    busy: false,
    error: "",
  });
  const [thermalMetric, setThermalMetric] = useState<ThermalMetric>("off");
  const [thermalSelected, setThermalSelected] = useState<string | null>(null);
  const thermalAbort = useRef<AbortController | null>(null);
  const thermalOpener = useRef<HTMLButtonElement | null>(null);
  const [monitorFocus, setMonitorFocus] = useState(0);
  const monitorOpener = useRef<HTMLButtonElement | null>(null);
  const { logs, importLog, clearLog } = useConvergenceLogs();
  const openConvergence = () => {
    if (document.activeElement instanceof HTMLButtonElement)
      monitorOpener.current = document.activeElement;
    setMonitorOpen(true);
    setMonitorFocus((value) => value + 1);
  };
  const closeConvergence = () => {
    setMonitorOpen(false);
    if (monitorOpener.current?.isConnected) monitorOpener.current.focus();
  };
  const [exporting, setExporting] = useState(false);
  const [vtkFile, setVTKFile] = useState<{
    studyId: string;
    token: string;
    file: File;
  } | null>(null);
  const { scenarios, visible, scenario, input } = useMemo(() => {
    const scenarios = project.cfdScenarios ?? EMPTY_SCENARIOS;
    const visible = scenarios.filter((s) => showArchived || !s.archived);
    const scenario = visible.find((s) => s.id === selectedId) ?? visible[0];
    return {
      scenarios,
      visible,
      scenario,
      input: scenario ? preparationInput(project, scenario) : "",
    };
  }, [project, selectedId, showArchived]);
  const revision = hash.input === input ? hash.revision : "";
  const activeReport = scenario ? (reports[scenario.id] ?? null) : null;
  const stale =
    !activeReport ||
    !revision ||
    activeReport.validation.clientRevision !== revision;
  const current = useRef({ project, scenarios });
  useEffect(() => {
    current.current = { project, scenarios };
  }, [project, scenarios]);
  const abort = useRef<AbortController | null>(null);
  const exportAbort = useRef<AbortController | null>(null);
  const importRead = useRef(0);
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
  useEffect(
    () => () => {
      abort.current?.abort();
      exportAbort.current?.abort();
      thermalAbort.current?.abort();
      importRead.current++;
    },
    [],
  );
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
  const thermalReport = scenario ? (thermalReports[scenario.id] ?? null) : null;
  const thermalBusy = thermalTask.studyId === scenario?.id && thermalTask.busy;
  const thermalError =
    thermalTask.studyId === scenario?.id ? thermalTask.error : "";
  const thermalStale =
    !thermalReport || !revision || thermalReport.sourceRevision !== revision;
  const calculateThermal = useCallback(
    async (calculate: boolean, target = scenario) => {
      if (!target?.seed) return;
      thermalAbort.current?.abort();
      const controller = new AbortController();
      thermalAbort.current = controller;
      setThermalTask({ studyId: target.id, busy: true, error: "" });
      const captured = preparationInput(project, target);
      try {
        const token = await preparationRevision(captured);
        const result = await requestThermal(
          apiUrl,
          project,
          target,
          token,
          calculate,
          controller.signal,
        );
        const live = current.current.scenarios.find((s) => s.id === target.id);
        if (
          controller.signal.aborted ||
          !live ||
          preparationInput(current.current.project, live) !== captured
        )
          return;
        setThermalReports((values) => ({ ...values, [target.id]: result }));
        if (!calculate && result.surfaces.length) setThermalMetric("missing");
      } catch (reason) {
        if (!controller.signal.aborted)
          setThermalTask({
            studyId: target.id,
            busy: false,
            error:
              reason instanceof Error
                ? reason.message
                : "Thermal preparation failed.",
          });
      } finally {
        if (!controller.signal.aborted)
          setThermalTask((task) =>
            task.studyId === target.id ? { ...task, busy: false } : task,
          );
      }
    },
    [apiUrl, project, scenario],
  );
  const previouslyActive = useRef(active);
  useEffect(() => {
    const returning = active && !previouslyActive.current;
    previouslyActive.current = active;
    if (returning && thermalOpen) void calculateThermal(false);
  }, [active, thermalOpen, calculateThermal]);
  const openThermal = () => {
    if (!scenario) return;
    if (document.activeElement instanceof HTMLButtonElement)
      thermalOpener.current = document.activeElement;
    const setup = scenario.thermalEnvelope ?? thermalSetupSchema.parse({});
    const insulationScenarios = Object.fromEntries(
      projectFloors(project).map((f) => [
        f.id,
        Object.hasOwn(setup.insulationScenarios, f.id)
          ? setup.insulationScenarios[f.id]
          : (f.content.energyLayout?.activeScenarioId ?? null),
      ]),
    );
    const target =
      !scenario.thermalEnvelope ||
      JSON.stringify(insulationScenarios) !==
        JSON.stringify(setup.insulationScenarios)
        ? { ...scenario, thermalEnvelope: { ...setup, insulationScenarios } }
        : scenario;
    if (target !== scenario) change(target, true);
    setThermalOpen(true);
    void calculateThermal(false, target);
  };
  const applyThermal = () => {
    if (!scenario || thermalStale || !thermalReport?.validation.applyReady)
      return;
    const snapshot = {
      schemaVersion: 1 as const,
      caseHash: thermalReport.caseHash,
      sourceRevision: thermalReport.sourceRevision,
      createdAt: new Date().toISOString(),
      package: structuredClone(thermalReport),
    };
    const next = {
      ...scenario,
      thermalSnapshots: [
        snapshot,
        ...(scenario.thermalSnapshots ?? []).filter(
          (s) => s.caseHash !== snapshot.caseHash,
        ),
      ].slice(0, 3),
    };
    if (
      (scenario.thermalSnapshots?.length ?? 0) >= 3 &&
      !scenario.thermalSnapshots?.some(
        (s) => s.caseHash === snapshot.caseHash,
      ) &&
      !window.confirm(
        "Three thermal contracts are stored. Applying will replace the oldest history. Export it first if you need to retain it. Continue?",
      )
    )
      return;
    if (
      new TextEncoder().encode(
        JSON.stringify({
          ...project,
          cfdScenarios: scenarios.map((s) => (s.id === scenario.id ? next : s)),
        }),
      ).byteLength >
      8 * 1024 * 1024
    ) {
      setThermalTask({
        studyId: scenario.id,
        busy: false,
        error:
          "This applied history would exceed the 8 MB project limit. Export the contract, then remove an older thermal history before applying.",
      });
      return;
    }
    change(next, true);
    setMessage(
      "Thermal contract applied and saved with this study. Flow/scalar conditions are unchanged. No CFD run was performed.",
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
    setWindows((previous) => ({ ...previous, studies: false }));
    openPhase("domain");
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
    const controller = new AbortController();
    exportAbort.current = controller;
    const captured = input,
      studyId = scenario.id;
    setExporting(true);
    setError("");
    try {
      const zip = await openfoamSettings(
        apiUrl,
        project,
        scenario,
        revision,
        controller.signal,
      );
      if (controller.signal.aborted) return;
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
      if (!controller.signal.aborted)
        setError(
          e instanceof Error ? e.message : "OpenFOAM settings export failed.",
        );
    } finally {
      if (!controller.signal.aborted) setExporting(false);
    }
  };
  const importScenario = async (file: File) => {
    const request = ++importRead.current;
    setError("");
    setMessage("Reading study…");
    try {
      if (file.size > 4 * 1024 * 1024)
        throw new Error("Scenario JSON exceeds 4 MB.");
      if (scenarios.length >= 100)
        throw new Error("The project already has 100 studies.");
      const text = await file.text();
      if (request !== importRead.current) return;
      const now = current.current;
      if (now.project.projectId !== project.projectId) return;
      if (now.scenarios.length >= 100)
        throw new Error("The project already has 100 studies.");
      const imported = scenarioImport(JSON.parse(text), now.project.projectId);
      onChange([...now.scenarios, imported], true);
      setSelectedId(imported.id);
      setError("");
      setMessage(
        "Study imported. Source references were retained; validate to check them against this building.",
      );
    } catch (e) {
      if (request === importRead.current) {
        setError(e instanceof Error ? e.message : "Invalid study file.");
        setMessage("");
      }
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
    openPhase("equipment");
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
      openPhase("equipment");
      return;
    }
    openPhase(
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
  const visibility = {
    ...windows,
    thermal: thermalOpen,
    convergence: monitorOpen,
    results: resultsOpen && vtkFile?.studyId === scenario?.id,
  };
  const available = (id: CFDWindowId) =>
    id === "studies" ||
    id === "view" ||
    (!!scenario && (id !== "results" || vtkFile?.studyId === scenario.id));
  const toggleWindow = (id: CFDWindowId) => {
    if (id === "thermal") {
      if (thermalOpen) setThermalOpen(false);
      else openThermal();
    } else if (id === "convergence") {
      if (monitorOpen) closeConvergence();
      else openConvergence();
    } else if (id === "results") setResultsOpen(!resultsOpen);
    else {
      setWindows((previous) => ({ ...previous, [id]: !previous[id] }));
      setWindowFocus((previous) => ({
        ...previous,
        [id]: (previous[id] ?? 0) + 1,
      }));
    }
    setPicking(null);
  };
  return (
    <section
      className="cfx-workspace"
      aria-label="Climoptix CFD workspace"
      onContextMenu={(event) => {
        if (
          (event.target as Element).closest(
            ".floating-toolbar, button, input, select, textarea",
          )
        )
          return;
        event.preventDefault();
        setContextMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      {active && (
        <ClimoptixWindowMenu
          target={menuTarget}
          context={contextMenu}
          onDismiss={() => setContextMenu(null)}
          visible={visibility}
          available={available}
          onToggle={toggleWindow}
          onHideAll={() => {
            setWindows(
              (previous) =>
                Object.fromEntries(
                  Object.keys(previous).map((id) => [id, false]),
                ) as CFDWindowVisibility,
            );
            setThermalOpen(false);
            setMonitorOpen(false);
            setResultsOpen(false);
            setPicking(null);
          }}
        />
      )}
      {active && (
        <ClimoptixViewer
          key={project.projectId}
          project={project}
          scenario={scenario ?? previewScenario}
          report={activeReport}
          active={active}
          apiUrl={apiUrl}
          viewSettingsOpen={windows.view}
          viewFocus={windowFocus.view ?? 0}
          onViewSettings={(show) =>
            setWindows((previous) => ({ ...previous, view: show }))
          }
          stale={stale}
          selected={selected}
          onSelect={(id) => {
            setSelected(id);
            if (id.startsWith("refinement:")) {
              openPhase("mesh");
              setSimulationTab("mesh");
            }
            if (
              id.startsWith("vent:") ||
              activeReport?.objects.some((obj) => obj.id === id)
            )
              openPhase("equipment");
          }}
          picking={!!picking}
          onHostPick={hostPick}
          onMoveVent={moveVent}
          canMoveVents={true}
          showSamplingPlanes={windows.mesh && simulationTab === "post"}
          showRefinements={showRefinements}
          onShowRefinements={setShowRefinements}
          thermalSurfaces={thermalStale ? [] : (thermalReport?.surfaces ?? [])}
          thermalMetric={thermalMetric}
          thermalSelected={thermalSelected}
          onThermalSelect={(id) => {
            setThermalSelected(id);
            setThermalOpen(true);
          }}
        />
      )}
      {windows.studies && (
        <FloatingToolbar
          title="Studies"
          helpTitle="Climoptix CFD"
          helpSteps={HELP}
          defaultPosition={{ x: 16, y: 72 }}
          initialSize={{ width: 390 }}
          maxHeight={650}
          focusRequest={windowFocus.studies}
          onClose={() =>
            setWindows((previous) => ({ ...previous, studies: false }))
          }
        >
          <div className="cfx-inspector">
            <div className="cfx-inspector-heading">
              <span className="cfx-provider">
                Preparation only · solver not connected
              </span>
            </div>
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
                disabled={!scenario}
                onClick={openConvergence}
                aria-expanded={monitorOpen && !!scenario}
              >
                Convergence
              </button>
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
                  scenario &&
                  change({ ...scenario, archived: !scenario.archived })
                }
              >
                {scenario?.archived ? "Unarchive" : "Archive"}
              </button>
              <button
                disabled={!scenario}
                className="cfx-danger"
                onClick={(e) => setDeleting(e.currentTarget)}
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

            {scenario ? (
              <CFDText
                label="Study name"
                value={scenario.name}
                onChange={(name) => change({ ...scenario, name })}
              />
            ) : (
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
                  Create a study to prepare connected air volumes, vents,
                  occupants and engineering conditions. Your floorplan stays
                  authoritative; no solver results are invented.
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
            )}
          </div>
        </FloatingToolbar>
      )}
      {scenario && (
        <>
          {PHASES.map(
            (panel, i) =>
              windows[panel.id] && (
                <FloatingToolbar
                  key={panel.id}
                  title={panel.label}
                  defaultPosition={{ x: 430 + i * 24, y: 72 + i * 24 }}
                  initialSize={{ width: 470, height: 620 }}
                  maxHeight={720}
                  focusRequest={windowFocus[panel.id]}
                  onClose={() => {
                    setWindows((previous) => ({
                      ...previous,
                      [panel.id]: false,
                    }));
                    if (panel.id === "equipment") setPicking(null);
                  }}
                >
                  <section
                    className="cfx-inspector"
                    key={`${scenario.id}|${editorReset}`}
                    aria-label={`${panel.label} settings`}
                  >
                    <div className="cfx-inspector-heading">
                      <h2>{panel.label}</h2>
                      <span className={`cfx-state ${status.toLowerCase()}`}>
                        {status}
                      </span>
                    </div>
                    {panel.id === "domain" && (
                      <DomainPanel
                        project={project}
                        scenario={scenario}
                        report={activeReport}
                        onChange={change}
                      />
                    )}
                    {panel.id === "equipment" && (
                      <EquipmentPanel
                        scenario={scenario}
                        report={activeReport}
                        selected={selected}
                        onSelect={setSelected}
                        onChange={change}
                        onPick={(role) => {
                          setPicking(role);
                        }}
                        onEditSource={onEditBuilding}
                      />
                    )}
                    {panel.id === "boundaries" && (
                      <>
                        <button className="cfx-primary" onClick={openThermal}>
                          Thermal Envelope &amp; Solar Conditions
                        </button>
                        {scenario.thermalSnapshots?.length ? (
                          <p className="cfx-notice">
                            Thermal handoff stored ·{" "}
                            {thermalStale
                              ? "refresh to verify current sources"
                              : "current source revision"}
                            . Contract only, not executed.
                          </p>
                        ) : null}
                        <BoundariesPanel
                          scenario={scenario}
                          report={activeReport}
                          selected={selected}
                          onSelect={setSelected}
                          onChange={change}
                        />
                      </>
                    )}
                    {panel.id === "physics" && (
                      <PhysicsPanel scenario={scenario} onChange={change} />
                    )}
                    {panel.id === "mesh" && (
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
                          setResultsOpen(true);
                          setVTKFile({
                            studyId: scenario.id,
                            file,
                            token: crypto.randomUUID(),
                          });
                        }}
                        onShowRefinements={() => {
                          setShowRefinements(true);
                          setSelected((value) =>
                            value?.startsWith("refinement:") ? value : null,
                          );
                        }}
                        onConvergence={openConvergence}
                        convergence={
                          monitorOpen ? (
                            <p className="cfx-caption">
                              The convergence window is open. You can keep
                              working while inspecting the log.
                            </p>
                          ) : (
                            <ClimoptixConvergence
                              state={logs.get(scenario.id)}
                              onImport={(file) =>
                                void importLog(scenario.id, file)
                              }
                              onClear={() => clearLog(scenario.id)}
                            />
                          )
                        }
                      />
                    )}
                    {panel.id === "review" && (
                      <>
                        <p className="cfx-intro">
                          Validate the current source and setup. A preparation
                          manifest may contain blocking diagnostics; surface
                          export is included only when all geometry checks pass.
                          Neither is a runnable solver case.
                        </p>
                        <label>
                          Study notes
                          <textarea
                            value={scenario.description}
                            maxLength={2000}
                            onChange={(e) =>
                              change({
                                ...scenario,
                                description: e.target.value,
                              })
                            }
                          />
                        </label>
                        <div className="cfx-actions">
                          <button onClick={exportScenario}>
                            Export study JSON
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
                                  e instanceof Error
                                    ? e.message
                                    : "Export failed.",
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
                              <dd>
                                {activeReport.validation.configurationHash}
                              </dd>
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
                            onChange={(e) =>
                              setDiagnosticFilter(e.target.value)
                            }
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
                </FloatingToolbar>
              ),
          )}
          {thermalOpen && (
            <ThermalEnvelopeWindow
              key={scenario.id}
              project={project}
              scenario={scenario}
              apiUrl={apiUrl}
              report={thermalReport}
              busy={thermalBusy}
              error={
                thermalError ||
                (error.startsWith("Changes not applied") ? error : "")
              }
              stale={thermalStale}
              metric={thermalMetric}
              onMetric={setThermalMetric}
              selected={thermalSelected}
              onSelect={setThermalSelected}
              onChange={change}
              onRequest={(calculate) => void calculateThermal(calculate)}
              onApply={applyThermal}
              onEditInsulation={(face) => {
                if (onEditInsulation)
                  onEditInsulation(
                    face,
                    scenario.thermalEnvelope?.insulationScenarios[
                      face.floorId
                    ] ?? null,
                  );
                else onEditBuilding();
              }}
              onClose={() => {
                setThermalOpen(false);
                if (thermalOpener.current?.isConnected)
                  thermalOpener.current.focus();
              }}
            />
          )}

          {active && resultsOpen && vtkFile?.studyId === scenario.id && (
            <FloatingToolbar
              title="Imported results"
              defaultPosition={{ x: 170, y: 100 }}
              initialSize={{ width: 850, height: 650 }}
              maxHeight={850}
              onClose={() => setResultsOpen(false)}
            >
              <ClimoptixVTKViewer
                key={vtkFile.token}
                file={vtkFile.file}
                onClose={() => {
                  setVTKFile(null);
                  setResultsOpen(false);
                }}
              />
            </FloatingToolbar>
          )}
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
                  {message || "Local autosave · mm geometry / SI physics"}
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
          opener={deleting}
          onCancel={() => setDeleting(null)}
          onDelete={() => {
            clearLog(scenario.id);
            onChange(
              scenarios.filter((s) => s.id !== scenario.id),
              true,
            );
            setDeleting(null);
            setSelectedId("");
            setReports((previous) =>
              Object.fromEntries(
                Object.entries(previous).filter(([id]) => id !== scenario.id),
              ),
            );
          }}
        />
      )}
      {active && monitorOpen && scenario && (
        <ClimoptixConvergenceWindow
          studyName={scenario.name}
          state={logs.get(scenario.id)}
          focusRequest={monitorFocus}
          onImport={(file) => void importLog(scenario.id, file)}
          onClear={() => clearLog(scenario.id)}
          onClose={closeConvergence}
        />
      )}
    </section>
  );
}
