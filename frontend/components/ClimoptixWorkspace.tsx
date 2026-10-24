"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useViewerContextMenu } from "@/lib/viewerNavigation";
import { ClimoptixStudies } from "./ClimoptixStudies";
import { ClimoptixReview } from "./ClimoptixReview";
import { useCFDJobs } from "./useCFDJobs";
import { terminalJob } from "@/lib/climoptixJobs";
import type { CFDWorkerAdapter } from "@/lib/climoptixJobs";
import { CFD_PHASE_HELP, CFD_REFINEMENT_HELP } from "@/lib/climoptixHelp";
import { FloatingToolbar } from "./FloatingToolbar";
import {
  ClimoptixWindowMenu,
  CFD_WINDOWS,
  type CFDWindowId,
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
  newCFDScenario,
  ventSchema,
  type CFDScenario,
  type CFDSimulationGroup,
} from "@/lib/climoptixDocument";
import {
  downloadCFD,
  preparationInput,
  preparationRevision,
  prepareCFD,
  openfoamSettings,
  scenarioImport,
  type CFDReport,
} from "@/lib/climoptix";
import type { ProjectDocument } from "@/lib/projectDocument";
import { boundaryGroups, boundaryMembers, BOUNDARY_COLOURS, sameGroup, simulationGroups } from "@/lib/climoptixGroups";
import { WindowHelpButton } from "./WindowHelpButton";
import { WindowIcon } from "./WindowIcon";
import { ClimoptixViewer } from "./ClimoptixViewer";
import {
  BoundariesPanel,
  RefinementEditor,
  DomainPanel,
  EquipmentPanel,
  PhysicsPanel,
} from "./ClimoptixPanels";
import { ClimoptixSimulation, type SimulationTab } from "./ClimoptixSimulation";
import { ClimoptixVTKViewer } from "./ClimoptixVTKViewer";
import {
  ClimoptixConvergence,
  useConvergenceLogs,
} from "./ClimoptixConvergence";

const PHASES = [
  { id: "domain", label: "Domain" },
  { id: "equipment", label: "Equipment" },
  { id: "boundaries", label: "Boundaries" },
  { id: "physics", label: "Physics" },
  { id: "mesh", label: "Simulation" },
  { id: "review", label: "Review & export" },
] as const;
const EMPTY_SCENARIOS: CFDScenario[] = [];

const HELP = [
  {
    heading: "Your 3D workspace",
    text: "Use View to inspect the whole building, a room or a connected air volume. This does not change your simulation's seed room. Open and close the tabbed setup window from Toolbar or by right-clicking the background. Drag a titlebar to move a window and its edges to resize it.",
  },
  {
    heading: "One shared building",
    text: "Create a simulation and choose its seed room; preparation checks refresh automatically after committed changes. On phones and tablets, choose Simulations from Phase to create, group or select a simulation. On wider screens, use the Simulation selector and phase tabs. Thermal is inside Bounds; convergence is inside Solver → Monitor. Geometry, furniture and people come from the shared measured building in millimetres. File → Save includes simulations and their folders.",
  },
  {
    heading: "Connectivity is explicit",
    text: "Only permanent doorless passages and physical slab voids connect air regions. Doors and windows stop discovery at every open state. Their virtual caps can use an opening/pressure boundary; they are not automatically solid walls.",
  },
  {
    heading: "Prepare, inspect, export",
    text: "Choose global mesh settings in Domain, add Equipment, organize coloured surface groups in Bounds and review Physics. Solver contains Mesh, Run, Monitor and Post. Checks refresh automatically; Toolbar → Refresh checks is the manual retry. Preparation and Foamlib settings exports are handoffs, not runnable solver cases. Worker submission still performs its own fresh preflight.",
  },
  {
    heading: "No simulated results",
    text: "Without a connected worker, Mesh/Run stay disabled and no simulation results are computed. Connected jobs show only worker-reported progress. Imported real solver logs and VTK surface/slice files remain external, not verified results for this simulation. Counts are estimates. Review engineering assumptions before connecting a worker.",
  },
];
function DeleteStudy({
  name,
  count,
  opener,
  onCancel,
  onDelete,
}: {
  name: string;
  count?: number;
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
      if (!opener.isConnected) {
        document
          .querySelector<HTMLButtonElement>(
            ".cfx-study-tools button:not(:disabled)",
          )
          ?.focus();
      } else {
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
      aria-label={count === undefined ? "Delete CFD scenario" : "Clear all simulations"}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <header className="popup-titlebar">
        <span className="popup-icon">
          <WindowIcon title="Delete simulation" />
        </span>
        <strong>{count === undefined ? "Delete this simulation?" : "Delete all simulations?"}</strong>
        <div className="window-header-actions">
          <WindowHelpButton
            title="Delete CFD simulation"
            steps={[
              {
                heading: "Keep the building",
                text: "Delete removes only this simulation and its CFD settings. The shared building, assets and other simulations are unchanged. Cancel or Escape keeps the simulation; Undo can restore a deleted simulation.",
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
          {count === undefined ? `“${name}” and its CFD settings will be removed.` : `All ${count} simulations, including archived simulations, and their CFD settings will be removed.`} The shared building, assets and groups are kept. Undo can restore the simulations.
        </p>
      </div>
      <footer className="popup-actions">
        <button ref={cancel} onClick={onCancel}>
          Cancel
        </button>
        <button className="cfx-danger" onClick={onDelete}>
          {count === undefined ? "Delete simulation" : "Delete all simulations"}
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
  onChange: (scenarios: CFDScenario[], checkpoint?: boolean, groups?: CFDSimulationGroup[]) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onEditBuilding: () => void;
  workerAdapter?: CFDWorkerAdapter | null;
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
  workerAdapter = null,
}: Props) {
  const [selectedId, setSelectedId] = useState(""),
    [showArchived, setShowArchived] = useState(false);
  const [setupOpen, setSetupOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<CFDWindowId>("studies");
  const [setupFocus, setSetupFocus] = useState(0);
  const [viewTarget, setViewTarget] = useState<HTMLDivElement | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [boundsTab, setBoundsTab] = useState<"conditions" | "thermal">("conditions");
  const [boundaryGroup, setBoundaryGroup] = useState("all-surfaces");
  const [refinementEditor, setRefinementEditor] = useState<{
    studyId: string;
    id: string;
  } | null>(null);
  const [ventEditor, setVentEditor] = useState<{ studyId: string; id: string } | null>(null);
  const { entries: jobs, submit: submitJobs } = useCFDJobs(
    project,
    apiUrl,
    workerAdapter,
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const previewScenario = useMemo(
    () => newCFDScenario(project.projectId, "Building view"),
    [project.projectId],
  );
  const openPhase = (id: CFDWindowId) => {
    if (id === "view") { setViewOpen(true); return; }
    if (id === "thermal") setBoundsTab("thermal");
    if (id === "convergence") setSimulationTab("monitor");
    setActiveTab(id === "thermal" ? "boundaries" : id === "convergence" ? "mesh" : id);
    setSetupOpen(true);
    setSetupFocus((value) => value + 1);
  };
  const [selected, setSelected] = useState<string | null>(null),
    [reports, setReports] = useState<Record<string, CFDReport>>({});
  const [hash, setHash] = useState({ input: "", revision: "" }),
    [preparing, setPreparing] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState<{
      id: string;
      opener: HTMLButtonElement;
    } | null>(null);
  const [picking, setPicking] = useState<"supply" | "extract" | null>(null);
  const [editorReset, setEditorReset] = useState(0);
  const [clearing, setClearing] = useState<HTMLButtonElement | null>(null);
  const [preparationRetry, setPreparationRetry] = useState(0);
  const [preparationFailure, setPreparationFailure] = useState<{ input: string; message: string } | null>(null);
  const [simulationTab, setSimulationTab] = useState<SimulationTab>("mesh");
  const [showRefinements, setShowRefinements] = useState(true);
  const [inspection, setInspection] = useState<{ showRefinements: boolean; selected: string | null } | null>(null);
  const returnToSetup = () => {
    if (!inspection) return;
    setShowRefinements(inspection.showRefinements); setSelected(inspection.selected);
    setInspection(null); setSetupOpen(true); setSetupFocus(v => v + 1);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(".cfx-setup-window .floating-toolbar-titlebar")?.focus());
  };
  useEffect(() => {
    if (!inspection || !active) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector(":popover-open,[role=menu]")) return;
      if (event.target instanceof Element && event.target.closest("input,select,textarea,.floating-toolbar,dialog")) return;
      event.preventDefault(); returnToSetup();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  });
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
  const { logs, importLog, clearLog } = useConvergenceLogs();
  const openConvergence = () => openPhase("convergence");
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
  const preparationError = preparationFailure?.input === input ? preparationFailure.message : "";
  const busy = preparing !== "" && preparing === input;
  const activeReport = scenario ? (reports[scenario.id] ?? null) : null;
  const boundaryDisplay = useMemo(() => {
    if (!scenario || !activeReport) return [];
    const groups = boundaryGroups(scenario);
    return groups.map((g, i) => ({ id: g.id, name: g.name, colour: BOUNDARY_COLOURS[i % BOUNDARY_COLOURS.length],
      patchIds: boundaryMembers(g, groups, activeReport.patches).map(p => p.id) }));
  }, [scenario, activeReport]);
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
    const boundaryMembershipChanged =
      JSON.stringify(before?.boundaries.collections.map(g => [g.id, g.patchIds])) !==
      JSON.stringify(result.data.boundaries.collections.map(g => [g.id, g.patchIds]));
    const objectsChanged = JSON.stringify([before?.objectGroups, before?.objectCopies, before?.hiddenObjectIds]) !==
      JSON.stringify([result.data.objectGroups, result.data.objectCopies, result.data.hiddenObjectIds]);
    if (
      refinementEditor?.studyId === s.id &&
      !result.data.mesh.refinements.some((r) => r.id === refinementEditor.id)
    )
      setRefinementEditor(null);
    onChange(
      scenarios.map((v) => (v.id === s.id ? result.data : v)),
      checkpoint || devicesChanged || regionsChanged || boundaryMembershipChanged || objectsChanged,
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
    openPhase("thermal");
    if (!thermalReport || thermalStale || target !== scenario)
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
      "Thermal contract applied and saved with this simulation. Flow/scalar conditions are unchanged. No CFD run was performed.",
    );
  };
  const add = (group?: string) => {
    if (scenarios.length >= 100) {
      setError(
        "A project supports up to 100 simulations. Export and delete an unused simulation to free a slot; archiving keeps it in the project.",
      );
      return;
    }
    const s = newCFDScenario(
      project.projectId,
      `Simulation ${scenarios.length + 1}`,
    );
    onChange(
      [...scenarios, { ...s, group: group ?? scenario?.group ?? simulationGroups(scenarios, project.cfdSimulationGroups)[0]?.name ?? "General" }],
      true,
    );
    setSelectedId(s.id);
    openPhase("studies");
    setError("");
  };
  const validationTarget = useRef({ project, scenario, onChange, apiUrl });
  useEffect(() => { validationTarget.current = { project, scenario, onChange, apiUrl }; }, [project, scenario, onChange, apiUrl]);
  useEffect(() => {
    if (!active || !revision || !validationTarget.current.scenario) return;
    const controller = new AbortController();
    abort.current?.abort(); abort.current = controller;
    const timer = window.setTimeout(() => {
      const target = validationTarget.current, captured = target.scenario;
      if (!captured || preparationInput(target.project, captured) !== input) return;
      setPreparing(input);
      setPreparationFailure(null);
      void prepareCFD(target.apiUrl, target.project, captured, revision, controller.signal).then(value => {
        const now = current.current, live = now.scenarios.find(s => s.id === captured.id);
        if (controller.signal.aborted || !live || preparationInput(now.project, live) !== input) return;
        setReports(previous => ({ ...Object.fromEntries(Object.entries(previous).filter(([id]) => id !== captured.id).slice(-2)), [captured.id]: value }));
        validationTarget.current.onChange(now.scenarios.map(s => s.id === captured.id ? { ...s, validation: value.validation } : s));
      }).catch(reason => {
        if (!controller.signal.aborted) setPreparationFailure({ input, message: reason instanceof Error ? reason.message : "Preparation unavailable. Your simulation is saved locally." });
      }).finally(() => { if (!controller.signal.aborted) setPreparing(""); });
    }, 450);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [active, input, revision, preparationRetry, apiUrl]);
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
    setMessage("Reading simulation…");
    try {
      if (file.size > 4 * 1024 * 1024)
        throw new Error("Scenario JSON exceeds 4 MB.");
      if (scenarios.length >= 100)
        throw new Error("The project already has 100 simulations.");
      const text = await file.text();
      if (request !== importRead.current) return;
      const now = current.current;
      if (now.project.projectId !== project.projectId) return;
      if (now.scenarios.length >= 100)
        throw new Error("The project already has 100 simulations.");
      const imported = scenarioImport(JSON.parse(text), now.project.projectId);
      const groups = simulationGroups(now.scenarios, now.project.cfdSimulationGroups);
      if (groups.length >= 100 && !groups.some(g => sameGroup(g.name, imported.group)))
        throw new Error("The project already has 100 simulation groups. Remove an unused folder before importing a new group.");
      onChange([...now.scenarios, imported], true);
      setSelectedId(imported.id);
      setError("");
      setMessage(
        "Simulation imported. Source references were retained; validate to check them against this building.",
      );
    } catch (e) {
      if (request === importRead.current) {
        setError(e instanceof Error ? e.message : "Invalid simulation file.");
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
    setVentEditor({ studyId: scenario.id, id: vent.id });
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
  const available = (id: CFDWindowId) =>
    id === "studies" ||
    id === "view" ||
    (!!scenario && (id !== "results" || vtkFile?.studyId === scenario.id));
  const shownTab = available(activeTab) ? activeTab : "studies";
  const chooseTab = (id: CFDWindowId) => {
    setPicking(null);
    if (id === "thermal") openThermal();
    else openPhase(id);
  };
  const closeRefinementEditor = () => {
    setRefinementEditor(null);
    const target = [
      document.querySelector<HTMLSelectElement>(".cfx-phase-select select"),
      document.querySelector<HTMLButtonElement>(
        ".cfx-setup-tabs button[aria-selected=true]",
      ),
      document.querySelector<HTMLButtonElement>(
        ".cfx-view-selector button[aria-expanded]",
      ),
    ].find((node) => node?.getClientRects().length);
    target?.focus();
  };
  const closeEquipmentEditor = () => {
    const id = ventEditor?.id;
    setVentEditor(null);
    const target = [
      id ? document.querySelector<HTMLButtonElement>(`.cfx-reorder-item[data-item-id="${CSS.escape(`vent:${id}`)}"] .cfx-device-actions button`) : null,
      document.querySelector<HTMLSelectElement>(".cfx-phase-select select"),
      document.querySelector<HTMLButtonElement>(".cfx-setup-tabs button[aria-selected=true]"),
      document.querySelector<HTMLButtonElement>(".cfx-view-selector button[aria-expanded]"),
    ].find(node => node?.getClientRects().length);
    target?.focus();
  };
  const deletingStudy = scenarios.find((s) => s.id === deleting?.id);
  const boundsNavigation = (
<div className="cfx-bound-tabs" role="tablist" aria-label="Boundary setup"
              onKeyDown={event => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === "Home" ? "conditions" : event.key === "End" ? "thermal" : boundsTab === "conditions" ? "thermal" : "conditions";
                if (next === "thermal") openThermal(); else setBoundsTab("conditions");
                document.getElementById(`cfx-bounds-tab-${next}`)?.focus();
              }}>
              <button role="tab" id="cfx-bounds-tab-conditions" aria-controls="cfx-setup-panel-boundaries" aria-selected={boundsTab === "conditions"}
                tabIndex={boundsTab === "conditions" ? 0 : -1}
                onClick={() => setBoundsTab("conditions")}>Conditions</button>
              <button role="tab" id="cfx-bounds-tab-thermal" aria-controls="cfx-bounds-thermal" aria-selected={boundsTab === "thermal"}
                tabIndex={boundsTab === "thermal" ? 0 : -1}
                onClick={openThermal}>Thermal</button>
            </div>
  );
  const viewerMenu = useViewerContextMenu(target => !!target.closest(".cfx-viewport") && !target.closest(".floating-toolbar,dialog,[role=dialog],button,input,select,textarea,[role=menu]"), setContextMenu, () => setContextMenu(null));
  return (
    <section
      className="cfx-workspace"
      data-dock-workspace="climoptix"
      data-preparation-state={busy ? "checking" : error || preparationError ? "error" : stale ? "stale" : "checked"}
      data-preparation-stamp={activeReport?.validation.checkedAt}
      aria-label="Climoptix CFD workspace"
      onPointerMoveCapture={viewerMenu.onPointerMoveCapture}
      onPointerUpCapture={viewerMenu.onPointerUpCapture}
      onPointerCancelCapture={viewerMenu.onPointerCancelCapture}
      onPointerDownCapture={event => {
        viewerMenu.onPointerDownCapture(event);
        const target = event.target as Node;
        event.currentTarget.querySelectorAll<HTMLDetailsElement>(".cfx-row-menu[open]").forEach(menu => {
          if (!menu.contains(target)) menu.open = false;
        });
      }}
      onKeyDown={(event) => {
        const menu = event.target instanceof Element && event.target.closest<HTMLDetailsElement>(".cfx-row-menu[open]");
        if (event.key === "Escape" && menu) { event.preventDefault(); event.stopPropagation(); menu.open = false; menu.querySelector<HTMLElement>("summary")?.focus(); return; }
        if (
          event.key !== "Escape" ||
          (event.target instanceof Element &&
            event.target.closest("input,textarea,select,dialog,[role=menu]"))
        )
          return;
        const editor =
          event.target instanceof Element &&
          event.target.closest(".cfx-refinement-editor,.cfx-equipment-editor");
        if (editor) {
          event.preventDefault();
          event.stopPropagation();
          if (editor.classList.contains("cfx-equipment-editor")) closeEquipmentEditor();
          else closeRefinementEditor();
        } else if (
          event.target instanceof Element &&
          event.target.closest(".cfx-setup-window")
        ) {
          event.preventDefault();
          event.stopPropagation();
          setSetupOpen(false);
          setPicking(null);
          document
            .querySelector<HTMLButtonElement>(
              ".cfx-view-selector button[aria-expanded]",
            )
            ?.focus();
        }
      }}
      onContextMenu={viewerMenu.onContextMenu}
    >
      {active && (
        <ClimoptixWindowMenu
          target={menuTarget}
          context={contextMenu}
          onDismiss={() => setContextMenu(null)}
          selected={shownTab}
          setupOpen={setupOpen}
          available={available}
          onRefresh={() => setPreparationRetry(x => x + 1)}
          checking={busy}
          onToggle={chooseTab}
          onHideAll={() => {
            setSetupOpen(false);
            setPicking(null);
            setRefinementEditor(null);
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
          viewSettingsOpen={viewOpen}
          viewTarget={viewTarget}
          onViewSettings={setViewOpen}
          stale={stale}
          selected={selected}
          onSelect={(id) => {
            setSelected(id);
            if (id.startsWith("refinement:")) {
              openPhase("mesh");
              setSimulationTab("mesh");
            }
            if (
              setupOpen &&
              (id.startsWith("vent:") ||
                activeReport?.objects.some((obj) => obj.id === id))
            )
              openPhase("equipment");
          }}
          picking={!!picking}
          onHostPick={hostPick}
          onMoveVent={moveVent}
          canMoveVents={true}
          showSamplingPlanes={
            setupOpen && shownTab === "mesh" && simulationTab === "post"
          }
          showRefinements={showRefinements}
          onShowRefinements={setShowRefinements}
          onReturnToSetup={inspection ? returnToSetup : undefined}
          thermalSurfaces={thermalStale ? [] : (thermalReport?.surfaces ?? [])}
          thermalMetric={thermalMetric}
          thermalSelected={thermalSelected}
          boundaryGroups={setupOpen && shownTab === "boundaries" && boundsTab === "conditions" ? boundaryDisplay : []}
          boundarySelection={boundaryDisplay.some(g => g.id === boundaryGroup) ? boundaryGroup : "all-surfaces"}
          onThermalSelect={(id) => {
            setThermalSelected(id);
            openThermal();
          }}
        />
      )}
      {(setupOpen || inspection) && (
        <FloatingToolbar
          hidden={!setupOpen}
          title="Simulation setup"
          headerContent={<div className="cfx-header-simulation">
            <span className="cfx-header-current" title={scenario?.name}>{scenario?.name ?? "No simulations yet"}</span>
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
                  {!visible.length && <option value="">No simulations yet</option>}
                  {simulationGroups(scenarios, project.cfdSimulationGroups).map((group) => (
                    <optgroup key={group.id} label={group.name}>
                      {visible
                        .filter((s) => s.group.toLowerCase() === group.name.toLowerCase())
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                            {s.archived ? " · archived" : ""}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
            <span className={`cfx-state ${status.toLowerCase()}`} title={`Simulation status: ${status}`}>{status}</span>
          </div>}
          helpTitle="Climoptix CFD"
          helpSteps={[...CFD_PHASE_HELP[shownTab],
            ...(shownTab === "mesh" && simulationTab === "monitor" ? CFD_PHASE_HELP.convergence : []),
            ...(shownTab === "boundaries" && boundsTab === "thermal" ? CFD_PHASE_HELP.thermal : []), ...HELP]}
          className="cfx-setup-window"
          defaultPosition={{ x: 20, y: 72 }}
          initialSize={{ width: 1000, height: 720 }}
          maxHeight={1000}
          focusRequest={setupFocus}
          onClose={() => {
            setSetupOpen(false);
            setPicking(null);
          }}
        >
          <div className="cfx-setup">
            <header className="cfx-setup-heading">
              <label className="cfx-phase-select">
                <span className="cfx-phase-label">
                  <span>Phase</span>
                  <span className="cfx-active-study" title={scenario?.name}>
                    {scenario?.name ?? "No simulation selected"}
                  </span>
                </span>
                <select
                  aria-label="CFD phase"
                  value={shownTab}
                  onChange={(event) =>
                    chooseTab(event.target.value as CFDWindowId)
                  }
                >
                  {CFD_WINDOWS.map((item) => (
                    <option
                      key={item.id}
                      value={item.id}
                      disabled={!available(item.id)}
                    >
                      {item.tab}
                    </option>
                  ))}
                </select>
              </label>
            </header>
            {(error || preparationError) && <div className="cfx-feedback" role="alert"><span>{error || preparationError}</span>
              <button onClick={() => {
                if (error) { setError(""); if (error.startsWith("Changes not applied")) setEditorReset(x => x + 1); }
                else setPreparationRetry(x => x + 1);
              }}>{error.startsWith("Changes not applied") ? "Keep saved values" : error ? "Dismiss" : "Retry check"}</button></div>}
            <span className="sr-only" role="status">{message}</span>
            <div
              className="cfx-setup-tabs"
              role="tablist"
              aria-label="Climoptix setup"
            >
              {CFD_WINDOWS.map((item) => (
                <button
                  key={item.id}
                  role="tab"
                  id={`cfx-setup-tab-${item.id}`}
                  aria-controls={`cfx-setup-panel-${item.id}`}
                  aria-selected={shownTab === item.id}
                  disabled={!available(item.id)}
                  tabIndex={shownTab === item.id ? 0 : -1}
                  className={shownTab === item.id ? "active" : ""}
                  title={item.name}
                  onClick={() => chooseTab(item.id)}
                  onKeyDown={(event) => {
                    if (
                      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                        event.key,
                      )
                    )
                      return;
                    event.preventDefault();
                    const enabled = CFD_WINDOWS.filter((item) =>
                        available(item.id),
                      ),
                      index = enabled.findIndex((tab) => tab.id === item.id);
                    const next =
                      enabled[
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? enabled.length - 1
                            : (index +
                                (event.key === "ArrowRight" ? 1 : -1) +
                                enabled.length) %
                              enabled.length
                      ];
                    chooseTab(next.id);
                    document
                      .getElementById(`cfx-setup-tab-${next.id}`)
                      ?.focus();
                  }}
                >
                  {item.tab}
                </button>
              ))}
            </div>
            <section
              role="tabpanel"
              id="cfx-setup-panel-studies"
              aria-labelledby="cfx-setup-tab-studies"
              hidden={shownTab !== "studies"}
              className="cfx-setup-panel"
            >
              <ClimoptixStudies
                project={project}
                scenarios={scenarios}
                scenario={scenario}
                showArchived={showArchived}
                onShowArchived={setShowArchived}
                onSelect={(id) => {
                  setSelectedId(id);
                  setSelected(null);
                  setPicking(null);
                  setError("");
                  setMessage("");
                }}
                onChange={change}
                onOrder={(next, groups) => onChange(next, true, groups)}
                onAdd={add}
                onDelete={(id, opener) => setDeleting({ id, opener })}
                onClear={setClearing}
                onImport={(file) => void importScenario(file)}
                entries={jobs}
                worker={workerAdapter}
                onSubmit={(op, studies) => void submitJobs(op, studies)}
                onUndo={onUndo}
                onRedo={onRedo}
                canUndo={canUndo}
                canRedo={canRedo}
              />
            </section>
            {scenario &&
              PHASES.map((panel) => (
                <section
                  key={`${scenario.id}|${editorReset}|${panel.id}`}
                  role="tabpanel"
                  id={`cfx-setup-panel-${panel.id}`}
                  aria-labelledby={`cfx-setup-tab-${panel.id}`}
                  hidden={shownTab !== panel.id || (panel.id === "boundaries" && boundsTab !== "conditions")}
                  className="cfx-setup-panel"
                >
                  <section
                    className="cfx-inspector"
                    aria-label={`${panel.label} settings`}
                  >
                    {panel.id === "domain" && <h2>{panel.label}</h2>}
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
                        checked={!stale}
                        scenario={scenario}
                        report={activeReport}
                        selected={selected}
                        onSelect={setSelected}
                        onChange={change}
                        onPick={(role) => {
                          setPicking(role);
                          setSetupOpen(false);
                        }}
                        onEditSource={onEditBuilding}
                        onEditVent={id => setVentEditor({ studyId: scenario.id, id })}
                      />
                    )}
                    {panel.id === "boundaries" && (
                      <>
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
                          navigation={boundsTab === "conditions" ? boundsNavigation : undefined}
                          checked={!stale}
                          scenario={scenario}
                          report={activeReport}
                          selected={selected}
                          onSelect={setSelected}
                          onChange={change}
                          selectedGroup={boundaryGroup}
                          onSelectGroup={id => { setBoundaryGroup(id); setSelected(null); }}
                        />
                      </>
                    )}
                    {panel.id === "physics" && (
                      <div className="cfx-physics-fields"><PhysicsPanel scenario={scenario} onChange={change} /></div>
                    )}
                    {panel.id === "mesh" && (
                      <ClimoptixSimulation
                        connection={{
                          connected:
                            workerAdapter?.capabilities.connected ?? false,
                          canRun:
                            !!workerAdapter?.capabilities.connected &&
                            workerAdapter.capabilities.run &&
                            !(
                              jobs[scenario.id]?.dispatched &&
                              jobs[scenario.id].operation !== "run"
                            ),
                          blockedReason:
                            jobs[scenario.id]?.dispatched &&
                            jobs[scenario.id].operation !== "run"
                              ? "Recover the previous Mesh submission from Simulations first"
                              : undefined,
                          busy:
                            !!jobs[scenario.id]?.submitting ||
                            (!!jobs[scenario.id]?.job &&
                              !terminalJob(jobs[scenario.id].job!)),
                          onRun: () => {
                            void submitJobs("run", [scenario]);
                            openPhase("studies");
                          },
                        }}
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
                          openPhase("results");
                          setVTKFile({
                            studyId: scenario.id,
                            file,
                            token: crypto.randomUUID(),
                          });
                        }}
                        onEditRefinement={(id) =>
                          setRefinementEditor({ studyId: scenario.id, id })
                        }
                        onShowRefinements={() => {
                          setInspection({ showRefinements, selected });
                          setShowRefinements(true);
                          setSetupOpen(false);
                          setRefinementEditor(null);
                          setSelected((value) =>
                            value?.startsWith("refinement:") ? value : null,
                          );
                        }}
                        onConvergence={openConvergence}
                        convergence={
                          shownTab === "mesh" &&
                          simulationTab === "monitor" && (
                            <ClimoptixConvergence
                              name={scenario.name}
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
                    {panel.id === "review" && <ClimoptixReview scenario={scenario} report={activeReport} revision={revision} stale={stale} blocked={!!error}
                      onChange={change} onImport={file => void importScenario(file)} onExport={exportScenario} onError={setError}
                      onRefresh={() => setPreparationRetry(x => x + 1)} onInspect={jump} />}
                  </section>
                </section>
              ))}
            {scenario && (
              <>
                <section
                  role="tabpanel"
                  id="cfx-bounds-thermal"
                  aria-labelledby="cfx-bounds-tab-thermal"
                  hidden={shownTab !== "boundaries" || boundsTab !== "thermal"}
                  className="cfx-setup-panel cfx-thermal-panel"
                >
                  {thermalOpen && (
                    <>
                    <div className="cfx-inline-toolbar cfx-thermal-navigation">{boundsTab === "thermal" && boundsNavigation}</div>
                    <ThermalEnvelopeWindow
                      embedded
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
                      onRequest={(calculate) =>
                        void calculateThermal(calculate)
                      }
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
                      onClose={() => setBoundsTab("conditions")}
                    />
                    </>
                  )}
                </section>
                <section
                  role="tabpanel"
                  id="cfx-setup-panel-results"
                  aria-labelledby="cfx-setup-tab-results"
                  hidden={shownTab !== "results"}
                  className="cfx-setup-panel"
                >
                  {active && vtkFile?.studyId === scenario.id && (
                    <ClimoptixVTKViewer
                      key={vtkFile.token}
                      file={vtkFile.file}
                      onClose={() => {
                        setVTKFile(null);
                        openPhase("mesh");
                      }}
                    />
                  )}
                </section>
              </>
            )}
          </div>
        </FloatingToolbar>
      )}
      {active && viewOpen && <FloatingToolbar title="View properties" className="cfx-view-window" defaultPosition={{ x: 900, y: 80 }}
        initialSize={{ width: 340, height: 320 }} onClose={() => setViewOpen(false)} helpSteps={CFD_PHASE_HELP.view}>
        <div ref={setViewTarget} />
      </FloatingToolbar>}
      {active && scenario && ventEditor?.studyId === scenario.id && scenario.vents.some(v => v.id === ventEditor.id) &&
        <FloatingToolbar title="Edit equipment" className="cfx-equipment-editor" initialSize={{ width: 620, height: 650 }}
          defaultPosition={{ x: 260, y: 88 }} bringToFront onClose={closeEquipmentEditor} helpSteps={CFD_PHASE_HELP.equipment}>
          <section className="cfx-inspector" aria-label="Equipment editor">
            <EquipmentPanel key={`${scenario.id}:${ventEditor.id}`} editor scenario={scenario} report={activeReport}
              selected={`vent:${ventEditor.id}`} onSelect={setSelected} onChange={change} onPick={setPicking} onEditSource={onEditBuilding} />
            <button onClick={closeEquipmentEditor}>Done</button>
          </section>
        </FloatingToolbar>}
      {picking && (
        <div className="cfx-placement">
          <span>
            Click a validated planar host to place the {picking} vent.
          </span>
          <button
            onClick={() => {
              setPicking(null);
              openPhase("equipment");
            }}
          >
            Cancel placement
          </button>
        </div>
      )}
      {active && scenario && refinementEditor?.studyId === scenario.id && (
        <FloatingToolbar
          title="Edit refinement"
          helpSteps={CFD_REFINEMENT_HELP}
          className="cfx-refinement-editor"
          defaultPosition={{ x: 250, y: 100 }}
          initialSize={{ width: 600, height: 620 }}
          maxHeight={850}
          bringToFront
          onClose={closeRefinementEditor}
        >
          <section className="cfx-inspector" aria-label="Refinement editor">
            <RefinementEditor
              key={`${scenario.id}:${refinementEditor.id}`}
              scenario={scenario}
              report={activeReport}
              id={refinementEditor.id}
              onChange={change}
            />
            <button onClick={closeRefinementEditor}>Done</button>
          </section>
        </FloatingToolbar>
      )}
      {deleting && deletingStudy && (
        <DeleteStudy
          name={deletingStudy.name}
          opener={deleting.opener}
          onCancel={() => setDeleting(null)}
          onDelete={() => {
            const entry = jobs[deletingStudy.id];
            if (entry?.submitting || entry?.dispatched || (entry?.job && !terminalJob(entry.job))) {
              setDeleting(null); setError("Resolve the active or unknown worker submission before deleting this simulation."); return;
            }
            clearLog(deletingStudy.id);
            onChange(
              scenarios.filter((s) => s.id !== deletingStudy.id),
              true,
            );
            setDeleting(null);
            if (scenario?.id === deletingStudy.id) setSelectedId("");
            setReports((previous) =>
              Object.fromEntries(
                Object.entries(previous).filter(
                  ([id]) => id !== deletingStudy.id,
                ),
              ),
            );
          }}
        />
      )}
      {clearing && <DeleteStudy name="" count={scenarios.length} opener={clearing} onCancel={() => setClearing(null)} onDelete={() => {
        if (scenarios.some(s => { const entry = jobs[s.id]; return entry?.submitting || entry?.dispatched || (entry?.job && !terminalJob(entry.job)); })) {
          setClearing(null); setError("Resolve active or unknown worker submissions before clearing simulations."); return;
        }
        scenarios.forEach(s => clearLog(s.id));
        importRead.current++;
        abort.current?.abort(); exportAbort.current?.abort(); setExporting(false);
        thermalAbort.current?.abort();
        onChange([], true);
        setClearing(null); setSelectedId(""); setSelected(null); setPicking(null);
        setRefinementEditor(null); setVentEditor(null); setReports({}); setThermalReports({});
        setVTKFile(null); setThermalTask({ studyId: "", busy: false, error: "" });
        setError(""); setMessage(""); openPhase("studies");
      }} />}
    </section>
  );
}
