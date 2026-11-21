"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useViewerContextMenu } from "@/lib/viewerNavigation";
import { ClimoptixStudies } from "./ClimoptixStudies";
import { ClimoptixReview } from "./ClimoptixReview";
import { useCFDPreparation } from "./useCFDPreparation";
import { useCFDThermal } from "./useCFDThermal";
import { ClimoptixDeleteStudy } from "./ClimoptixDeleteStudy";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { useCFDJobs } from "./useCFDJobs";
import { useRailwayCFDWorker } from "./useRailwayCFDWorker";
import { ClimoptixWorkerMonitor } from "./ClimoptixWorkerMonitor";
import { CFDWorkbenchStatus } from "./CFDWorkbenchStatus";
import { diagnosticTarget } from "@/lib/climoptixDiagnostics";
import { CFDJobProgress } from "./CFDJobProgress";
import { RESULT_AXES, resultPlaneAxis, useCFDPlaneStepper, type ResultAxis } from "./useCFDPlaneStepper";
import { useCFDPlaneRanges } from "./useCFDPlaneRanges";
import { CFDResultLegend, DEFAULT_RESULT_APPEARANCE, type SceneResultMetadata } from "./CFDSceneResult";
import { RESULT_PALETTES, type ResultPalette } from "@/lib/cfdResultPalette";
import { CFDLegendStyleSelect, type CFDLegendStyle } from "./CFDLegendStyle";
import { copyHvacAsAirflow, requiresHvacThermalExecution, resolveHvacScenario } from "@/lib/hvacBridge";
import { commitHvacCFD, hvacErrorMessage, type HvacDomainScope } from "@/lib/hvacDocument";
import { SharedHvacCFD } from "./SharedHvacCFD";
import { SharedBoundaryCapture } from "./SharedBoundaryCapture";
import { useHvac } from "./HvacContext";
import { CFDPointProbeControls, useCFDPointProbe } from "./CFDPointProbeControls";
import { completedRunReference, prepareWorkerSubmission, simulationLimitReached, terminalJob, workerConfigurationIssue, workerInput, type CFDOperation } from "@/lib/climoptixJobs";
import type { CFDWorkerAdapter } from "@/lib/climoptixJobs";
import { CFD_PHASE_HELP, CFD_REFINEMENT_HELP, CFD_SETUP_HELP } from "@/lib/climoptixHelp";
import { FloatingToolbar } from "./FloatingToolbar";
import { CFDWindowControls, CFDWindowSections } from "./CFDCollapseAll";
import {
  ClimoptixWindowMenu,
  CFD_WINDOWS,
  type CFDWindowId,
} from "./ClimoptixWindowMenu";
import { projectFloors } from "@/lib/buildingDocument";
import {
  defaultThermalSetup, initializeThermalSetup,
  type ThermalMetric,
} from "@/lib/thermalDocument";
import { ThermalEnvelopeWindow } from "./ThermalEnvelopeWindow";
import {
  cfdScenarioSchema,
  newCFDScenario,
  ventSchema,
  type CFDScenario,
  type CFDVent,
  type CFDSimulationGroup,
} from "@/lib/climoptixDocument";
import {
  downloadCFD,
  defaultCFDSetup,
  prepareCFD,
  preparationInput,
  preparationRevision,
  openfoamSettings,
  scenarioImport,
} from "@/lib/climoptix";
import type { ProjectDocument } from "@/lib/projectDocument";
import { boundaryGroups, boundaryMembership, BOUNDARY_COLOURS, sameGroup, simulationGroups } from "@/lib/climoptixGroups";
import { ClimoptixViewer } from "./ClimoptixViewer";
import { BoundariesPanel } from "./ClimoptixBoundaries";
import { RefinementEditor } from "./ClimoptixMesh";
import { DomainPanel } from "./ClimoptixDomain";
import { EquipmentPanel } from "./ClimoptixEquipment";
import { PhysicsPanel } from "./ClimoptixPhysics";
import { ClimoptixSimulation, type SimulationTab } from "./ClimoptixSimulation";
import { ClimoptixResults, type ResultsView } from "./ClimoptixResults";
import { useCFDMeshInspection } from "./useCFDMeshInspection";
import { CFDMeshInspectionPanel } from "./CFDMeshInspectionPanel";
import { readOpenFOAMSettings } from "@/lib/cfdSettingsImport";
import { ClimoptixAdjoint } from "./ClimoptixAdjoint";
import {
  ClimoptixConvergence,
  useConvergenceLogs,
} from "./ClimoptixConvergence";

const PHASES = [
  { id: "equipment", label: "Equipment" },
  { id: "boundaries", label: "Boundaries" },
  { id: "physics", label: "Physics" },
  { id: "mesh", label: "Simulation" },
] as const;
const BOUNDS_TABS = [["equipment", "Objects"], ["conditions", "Conditions"], ["thermal", "Thermal"]] as const;
const EMPTY_SCENARIOS: CFDScenario[] = [];
const ignoreSceneMetadata=()=>{};

interface Props {
  openRequest?: { id: string; nonce: string } | null;
  openingNames: ReadonlyMap<string, string>;
  active: boolean;
  project: ProjectDocument;
  apiUrl: string;
  menuTarget: HTMLElement | null;
  onChange: (scenarios: CFDScenario[], checkpoint?: boolean, groups?: CFDSimulationGroup[], domain?: HvacDomainScope, copiedFrom?: Record<string, string>) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onEditBuilding: () => void;
  onSelectScenario?: (id: string) => void;
  workerAdapter?: CFDWorkerAdapter | null;
}
export function ClimoptixWorkspace({
  openRequest,
  openingNames,
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
  onSelectScenario,
  workerAdapter: providedWorker,
}: Props) {
  const hvacContext = useHvac();
  const remoteWorker = useRailwayCFDWorker(active && providedWorker === undefined, apiUrl);
  const workerAdapter = providedWorker === undefined ? remoteWorker.adapter : providedWorker;
  const [localSelectedId, setLocalSelectedId] = useState(""),
    [showArchived, setShowArchived] = useState(false);
  const [setupOpen, setSetupOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<CFDWindowId>("studies");
  const [setupFocus, setSetupFocus] = useState(0);
  const [viewTarget, setViewTarget] = useState<HTMLDivElement | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [resultsView,setResultsView] = useState<ResultsView>("summary");
  const [boundsTab, setBoundsTab] = useState<typeof BOUNDS_TABS[number][0]>("conditions");
  useEffect(() => { if (openRequest) queueMicrotask(() => { setLocalSelectedId(openRequest.id); setActiveTab("boundaries"); setBoundsTab("equipment"); setSetupOpen(true); setSetupFocus(n => n + 1); }); }, [openRequest]);
  const [defaultPlaneRequest, setDefaultPlaneRequest] = useState<{ jobId: string; nonce: string }>();
  const [issuesRequest, setIssuesRequest] = useState(0);
  const [boundaryGroup, setBoundaryGroup] = useState("all-surfaces");
  const [refinementEditor, setRefinementEditor] = useState<{
    studyId: string;
    id: string;
  } | null>(null);
  const [boundarySurfaceRequest, setBoundarySurfaceRequest] = useState<{ studyId: string; id: string; nonce: string } | null>(null);
  const [ventEditor, setVentEditor] = useState<{ studyId: string; id: string } | null>(null);
  const { entries: jobs, submit: submitJobs, forgetResults } = useCFDJobs(
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
    if (id === "thermal" || id === "equipment" || id === "boundaries")
      setBoundsTab(id === "boundaries" ? "conditions" : id);
    if (id === "convergence") setResultsView("monitor");
    if (id === "domain" || id === "adjoint") setSimulationTab(id === "domain" ? "mesh" : "adjoint");
    if (id === "review" || id === "results") setResultsView(id === "review" ? "review" : "summary");
    setActiveTab(id === "thermal" || id === "equipment" ? "boundaries"
      : id === "domain" || id === "adjoint" ? "mesh" : id === "review" || id === "convergence" ? "results" : id);
    setSetupOpen(true);
    setSetupFocus((value) => value + 1);
  };
  const [selected, setSelected] = useState<string | null>(null);
  const [highlightedDiagnostic, setHighlightedDiagnostic] = useState<string | null>(null);
  const selectObject = (id: string | null) => { setSelected(id); hvacContext?.selectVent(id?.startsWith("vent:") ? id.slice(5) : null); if (id?.startsWith("refinement:")) setShowRefinements(true); };
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState<{
      id: string;
      opener: HTMLButtonElement;
    } | null>(null);
  const [picking, setPicking] = useState<{ role: "supply" | "extract"; ventId: string; studyId: string; draft: CFDVent; returnEditor: boolean } | null>(null);
  const [editorReset, setEditorReset] = useState(0);
  const [clearing, setClearing] = useState<HTMLButtonElement | null>(null);
  const [creating, setCreating] = useState<{ group?: string; studyId: string; opener: HTMLButtonElement } | null>(null);
  const [limitDialog, setLimitDialog] = useState<HTMLButtonElement | null>(null);
  const [resetting, setResetting] = useState(false);
  const defaultAbort = useRef<AbortController | null>(null);
  const [simulationTab, setSimulationTab] = useState<SimulationTab>("mesh");
  const [showRefinements, setShowRefinements] = useState(true);
  const [inspection, setInspection] = useState<{ showRefinements: boolean; selected: string | null } | null>(null);
  const returnToSetup = () => {
    if (!inspection) return;
    setShowRefinements(inspection.showRefinements);
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
  const [thermalMetric, setThermalMetric] = useState<ThermalMetric>("off");
  const [thermalSelected, setThermalSelected] = useState<string | null>(null);
  const { logs, importLog, clearLog } = useConvergenceLogs();
  const [exporting, setExporting] = useState(false);
  const [vtkFile, setVTKFile] = useState<{
    studyId: string;
    token: string;
    file: File;
    provenance?: string;
    jobId?: string;
  } | null>(null);
  const [mainResult,setMainResult]=useState<{studyId:string;file:File;input:string;jobId?:string;historical?:boolean}|null>(null);
  const [mainResultLayers,setMainResultLayers]=useState<NonNullable<typeof mainResult>[]>([]);
  const [mainResultField,setMainResultField]=useState("");
  const [mainResultVisible,setMainResultVisible]=useState(true);
  const [onlyResultPlanes,setOnlyResultPlanes]=useState(false);
  const [hiddenResultAxes, setHiddenResultAxes] = useState<ResultAxis[]>([]);
  const [resultPalette, setResultPalette] = useState<ResultPalette>("spectrum");
  const [resultAppearance, setResultAppearance] = useState(DEFAULT_RESULT_APPEARANCE);
  const [showResultMesh, setShowResultMesh] = useState(false);
  const [legendStyle, setLegendStyle] = useState<CFDLegendStyle>("horizontal");
  const [manualResultScale, setManualResultScale] = useState(false);
  const [scaleMin, setScaleMin] = useState("");
  const [scaleMax, setScaleMax] = useState("");
  const [resultFitRequest, setResultFitRequest] = useState(0);
  const [selectedResultPlane, setSelectedResultPlane] = useState<File | null>(null);
  const [samplingPreviewStudy, setSamplingPreviewStudy] = useState<string | null>(null);
  const [mainResultMetadata,setMainResultMetadata]=useState<SceneResultMetadata>({fields:[],error:""});
  const selectedId = project.hvac?.activeScenarioId ?? localSelectedId;
  const setSelectedId = (id: string) => {
    onSelectScenario?.(id);
    setLocalSelectedId(id);
  };
  const { scenarios, visible, scenario, input } = useMemo(() => {
    const scenarios = (project.cfdScenarios ?? EMPTY_SCENARIOS).map(s => resolveHvacScenario(project, s));
    const visible = scenarios.filter((s) => showArchived || !s.archived);
    const scenario = visible.find((s) => s.id === selectedId) ?? visible[0];
    return {
      scenarios,
      visible,
      scenario,
      input: scenario ? preparationInput(project, scenario) : "",
    };
  }, [project, selectedId, showArchived]);
  const currentWorkerInput = useMemo(() => scenario ? workerInput(project, scenario) : "", [project, scenario]);
  const currentJob = scenario ? jobs[scenario.id] : undefined;
  const meshInspection = useCFDMeshInspection({adapter: remoteWorker.adapter, apiUrl, projectId: project.projectId,
    studyId: scenario?.id, input: currentWorkerInput, entry: currentJob, hasDomain: !!scenario?.seed,
    active: active && setupOpen && activeTab === "results" && resultsView === "mesh"});
  const recoveringRun = currentJob?.dispatched && currentJob.operation === "run";
  const runShowsLimit = !currentJob?.dispatched && simulationLimitReached(workerAdapter);
  const runConfigurationIssue = scenario && !currentJob?.dispatched ? workerConfigurationIssue(project, scenario, workerAdapter) : undefined;
  const runWorkerIssue = !recoveringRun && workerAdapter?.capabilities.connected && !workerAdapter.capabilities.run
    ? runShowsLimit ? "You’ve used all five simulations. Select Mesh or Run for details." : workerAdapter.capabilities.reason : undefined;
  const currentVTKFile=vtkFile&&scenario&&vtkFile.studyId===scenario.id&&vtkFile.jobId===jobs[scenario.id]?.job?.id?vtkFile:null;
  const currentSceneLayers = mainResultLayers.filter(item => item.studyId === scenario?.id
    && item.jobId === currentJob?.job?.id && item.input === currentWorkerInput && !!item.historical === !!mainResult?.historical);
  const currentPlane = currentSceneLayers.find(item => item === mainResult);
  const activeAxis = resultPlaneAxis(currentPlane?.file.name ?? "");
  const axisPlanes = RESULT_AXES.map(axis => activeAxis === axis ? currentPlane
    : currentSceneLayers.findLast(item => resultPlaneAxis(item.file.name) === axis));
  const shownAxisPlanes = axisPlanes.filter(item => item && !hiddenResultAxes.includes(resultPlaneAxis(item.file.name)!));
  const resultField = mainResultMetadata.fields.find(field => field.key === mainResultField) ?? mainResultMetadata.fields[0];
  const validManualRange = scaleMin.trim() !== "" && scaleMax.trim() !== ""
    && Number.isFinite(Number(scaleMin)) && Number.isFinite(Number(scaleMax)) && Number(scaleMin) < Number(scaleMax);
  const mainProbe=useCFDPointProbe(active&&!!currentPlane&&mainResultVisible&&!meshInspection.scene, [mainResultField,currentWorkerInput,mainResultVisible]);
  const placement = picking?.studyId === scenario?.id ? picking : null;
  const placementScenario = scenario && placement ? { ...scenario, vents: scenario.vents.some(v => v.id === placement.ventId)
    ? scenario.vents.map(v => v.id === placement.ventId ? placement.draft : v) : [...scenario.vents, placement.draft] } : scenario;
  const preparation = useCFDPreparation({ active, apiUrl, input, project, scenario, scenarios,
    onValidated: (report, scenarioId) => onChange(
      scenarios.map(s => s.id === scenarioId ? { ...s, validation: report.validation } : s),
      false, undefined, { scenarioId, rooms: report.domain.regions.filter(r => r.included).map(r => ({ floorId: r.floorId, roomId: r.id })) },
    ),
  });
  const { report: activeReport, revision, busy, stale, error: preparationError, refresh: refreshPreparation } = preparation;
  const thermal = useCFDThermal({ active, open: thermalOpen && !!scenario?.thermalEnvelope?.sunEnabled && activeTab === "boundaries" && boundsTab === "thermal",
    apiUrl, project, scenario, scenarios, input, revision });
  const { report: thermalReport, busy: thermalBusy, error: thermalError, stale: thermalStale } = thermal;
  const boundaryDisplay = useMemo(() => {
    if (!scenario || !activeReport) return [];
    const groups = boundaryGroups(scenario);
    const membership = boundaryMembership(groups, activeReport.patches);
    return groups.map((g, i) => ({ id: g.id, name: g.name, colour: BOUNDARY_COLOURS[i % BOUNDARY_COLOURS.length],
      patchIds: (membership.get(g.id) ?? []).map(p => p.id) }));
  }, [scenario, activeReport]);
  const setHvacGeometry = hvacContext?.setGeometryReport;
  useEffect(() => { if (active && activeReport && !stale) queueMicrotask(() => setHvacGeometry?.(activeReport)); }, [active, activeReport, stale, setHvacGeometry]);
  const current = useRef({ project, scenarios, jobs, onChange });
  useEffect(() => {
    current.current = { project, scenarios, jobs, onChange };
  }, [project, scenarios, jobs, onChange]);
  const exportAbort = useRef<AbortController | null>(null);
  const importRead = useRef(0);
  useEffect(
    () => () => {
      exportAbort.current?.abort();
      defaultAbort.current?.abort();
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
    try {
      onChange(
        scenarios.map((v) => (v.id === s.id ? result.data : v)),
        checkpoint || devicesChanged || regionsChanged || boundaryMembershipChanged || objectsChanged,
      );
    } catch (cause) { setError(hvacErrorMessage(cause, "Invalid shared HVAC operation; previous inputs retained.")); }
  };
  const openThermal = () => {
    if (!scenario) return;
    const setup = initializeThermalSetup(scenario.thermalEnvelope);
    const target = setup !== scenario.thermalEnvelope ? { ...scenario, thermalEnvelope: setup } : scenario;
    if (target !== scenario) change(target, true);
    setThermalOpen(true);
    setThermalMetric(setup.sunEnabled ? "solar" : "off");
    openPhase("thermal");
  };
  const clearLoadedResults = () => {
    setVTKFile(null);
    setMainResult(null);
    setMainResultLayers([]);
    setMainResultField("");
    setMainResultMetadata({ fields: [], error: "" });
    setOnlyResultPlanes(false);
    setMainResultVisible(true);
    setSamplingPreviewStudy(null);
  };
  const submitFromWorkspace = async (operation: CFDOperation, studies: CFDScenario[], opener: HTMLButtonElement) => {
    if (defaultAbort.current) return;
    const recovery = studies.some(study => jobs[study.id]?.dispatched && jobs[study.id]?.operation === operation);
    if (!recovery && simulationLimitReached(workerAdapter)) {
      setLimitDialog(opener);
      return;
    }
    if (await submitJobs(operation, studies)) {
      setLimitDialog(opener);
      remoteWorker.refresh();
    }
  };
  const applyDefaults = async (original: CFDScenario, adding = false, previousStudyId?: string) => {
    if (defaultAbort.current || resetting) return;
    const controller = new AbortController(); defaultAbort.current = controller;
    setResetting(true); setError(""); setMessage("Checking measured geometry and preparing a starter ventilation setup…");
    const restoring = !adding ? scenario : undefined;
    const stamp = (p: ProjectDocument) => JSON.stringify([preparationInput(p, original),
      p.cfdScenarios?.map(s => ({ ...s, validation: undefined, updatedAt: undefined })), p.cfdSimulationGroups,
      p.hvac?.devices, p.hvac?.scenarios,
      Object.entries(p.hvac?.bindings ?? {}).map(([id, binding]) => [id, { ...binding, scopeRooms: undefined, scopeSeed: undefined }])]);
    const captured = stamp(project);
    const checkedCurrent = () => {
      const now = current.current;
      if (now.scenarios.length >= 100 && adding) throw new Error("The project already has 100 simulations.");
      if (now.project.projectId !== project.projectId || stamp(now.project) !== captured)
        throw new Error("The building or simulation changed during setup. Retry with the current settings.");
      return now;
    };
    try {
      const hasRoom = projectFloors(project).some(floor => floor.content.rooms.length);
      const next = adding && !hasRoom ? original : await defaultCFDSetup(apiUrl, project, original, controller.signal);
      const report = adding && !hasRoom ? null : await prepareCFD(apiUrl, project, next,
        await preparationRevision(preparationInput(project, next)), controller.signal);
      const rooms = report?.domain.regions.filter(region => region.included).map(region => ({ floorId: region.floorId, roomId: region.id })) ?? [];
      if (report && (!rooms.length || report.validation.errors || !report.surface.exportable)) {
        const issue = report.diagnostics.find(diagnostic => diagnostic.severity === "error");
        throw new Error(issue?.message ?? "The measured building does not have a closed air volume. Review the domain in Setup.");
      }
      let now = checkedCurrent();
      const scope = report ? { scenarioId: restoring?.id ?? next.id, rooms, analysisMode: "airflow" as const } : undefined;
      const hasDesign = now.project.hvac?.devices.some(device => rooms.some(room => room.floorId === device.floorId && room.roomId === device.roomId));
      const retainedPhysics = restoring ? resolveHvacScenario(now.project, restoring).physics : next.physics;
      const starter = { ...next, id: restoring?.id ?? next.id, name: restoring?.name ?? next.name,
        thermalEnvelope: restoring?.thermalEnvelope ? defaultThermalSetup() : next.thermalEnvelope,
        group: restoring?.group ?? next.group,
        physics: { ...next.physics, densityKgM3: retainedPhysics.densityKgM3, heatCapacityJKgK: retainedPhysics.heatCapacityJKgK,
          referenceTemperatureK: retainedPhysics.referenceTemperatureK, outdoorTemperatureK: retainedPhysics.outdoorTemperatureK },
        vents: hasDesign ? restoring?.vents ?? [] : [...restoring?.vents ?? [], ...next.vents.map(vent => ({ ...vent, id: `${next.id}:${vent.id}` }))] };
      const nextStudies = (all: CFDScenario[]) => restoring
        ? all.map(study => study.id === restoring.id ? starter : study)
        : [...all, starter];
      if (scope && !hasDesign) {
        const candidate = commitHvacCFD(now.project, nextStudies(now.scenarios), scope);
        const stored = candidate.cfdScenarios?.find(study => study.id === starter.id);
        if (!stored) throw new Error("The starter simulation could not be prepared.");
        await prepareWorkerSubmission(apiUrl, candidate, stored, "run", controller.signal, undefined, workerAdapter);
        now = checkedCurrent();
      }
      const affected = adding ? (previousStudyId ? [previousStudyId] : []) : restoring ? [restoring.id] : [];
      if (affected.some(id => { const entry = now.jobs[id]; return entry?.submitting || entry?.dispatched || (entry?.job && !terminalJob(entry.job)); }))
        throw new Error("Resolve the active or unknown worker submission before deleting results.");
      if (!adding) {
        // Fail closed unless the previous workbench is recoverable.
        const key = `climoptix:before-restore:${project.projectId}`;
        const backup = JSON.stringify({ projectId: project.projectId, savedAt: new Date().toISOString(), scenarios: now.scenarios, groups: now.project.cfdSimulationGroups ?? [] });
        try {
          window.localStorage.setItem(key, backup);
          if (window.localStorage.getItem(key) !== backup) throw new Error("Backup mismatch");
        } catch { throw new Error("The CFD backup could not be saved. Nothing was replaced. Free browser storage or download your project before retrying."); }
        downloadCFD(new Blob([JSON.stringify(now.project, null, 2)], { type: "application/json" }), `${now.project.name}-before-restore.project.json`);
      }
      if (affected.length) {
        if (workerAdapter?.capabilities.connected && workerAdapter.clearResults) {
          await workerAdapter.clearResults(project.projectId, affected, controller.signal);
          forgetResults(affected);
        } else if (affected.some(id => now.jobs[id]?.job && now.jobs[id].job?.phase !== "Stale")) {
          throw new Error("Connect a CFD worker that supports result deletion before replacing this simulation.");
        }
        affected.forEach(clearLog);
      }
      controller.signal.throwIfAborted();
      now = checkedCurrent();
      onChange(nextStudies(now.scenarios), true, undefined, scope);
      clearLoadedResults();
      setSelectedId(starter.id); setSelected(null); setVentEditor(null); setRefinementEditor(null); setPicking(null);
      setEditorReset(value => value + 1); openPhase("studies");
      setMessage(!adding && hasDesign ? "Default simulation settings restored. The shared HVAC design was kept." :
        !report ? "New simulation created. Draw an enclosed room to prepare it." : hasDesign
        ? "New simulation linked to the shared vents in this domain."
        : "Starter setup saved with a shared inlet and outlet. Review the checks before running.");
    } catch (reason) { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : "Default reset failed. Nothing was replaced."); setMessage(""); } }
    finally { if (defaultAbort.current === controller) { defaultAbort.current = null; setResetting(false); } }
  };
  const add = (group?: string, previousStudyId?: string) => {
    if (scenarios.length >= 100) {
      setError(
        "A project supports up to 100 simulations. Export and delete an unused simulation to free a slot; archiving keeps it in the project.",
      );
      return;
    }
    const names = new Set(scenarios.map(study => study.name.toLowerCase()));
    let number = scenarios.length + 1;
    while (names.has(`simulation ${number}`)) number++;
    const s = newCFDScenario(project.projectId, `Simulation ${number}`);
    s.group = group ?? scenario?.group ?? simulationGroups(scenarios, project.cfdSimulationGroups)[0]?.name ?? "General";
    void applyDefaults(s, true, previousStudyId);
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
  const importOpenFOAM = async (file: File) => {
    if (!scenario || scenario.archived || resetting) return;
    const request = ++importRead.current, source = workerInput(project, scenario), studyId = scenario.id;
    setError(""); setMessage("Reading OpenFOAM settings…");
    try {
      const imported = await readOpenFOAMSettings(file, scenario);
      if (request !== importRead.current) return;
      const now = current.current, live = now.scenarios.find(item => item.id === studyId);
      if (now.project.projectId !== project.projectId || !live || workerInput(now.project, live) !== source)
        throw new Error("The simulation changed while reading settings. Retry the import.");
      const entry = now.jobs[studyId];
      if (entry?.submitting || entry?.dispatched || entry?.job && !terminalJob(entry.job))
        throw new Error("Wait for the active worker job before importing settings.");
      const incoming = cfdScenarioSchema.parse({...live, mesh:imported.mesh, physics:imported.physics, resources:imported.resources,
        outputs:imported.outputs, postProcessing:imported.postProcessing, thermalEnvelope:imported.thermalEnvelope,
        thermalSnapshots:undefined, validation:null, updatedAt:new Date().toISOString()});
      now.onChange(now.scenarios.map(item => item.id === studyId ? incoming : item), true);
      setMessage("OpenFOAM settings imported. Review checks before computing.");
    } catch (cause) {
      if (request === importRead.current) { setError(cause instanceof Error ? cause.message : "Invalid settings ZIP."); setMessage(""); }
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
    if (!placement) return;
    setPicking({ ...placement, draft: { ...placement.draft, host: { patchId, u, v } } });
    selectObject(`vent:${placement.ventId}`);
  };
  const startPlacement = (role: "supply" | "extract", ventId?: string) => {
    if (!scenario) return;
    const existing = scenario.vents.find(v => v.id === ventId);
    const draft = existing ? structuredClone(existing) : ventSchema.parse({ id: crypto.randomUUID(), name: role === "supply" ? "Supply vent" : "Extract vent", role, host: { patchId: "unassigned" } });
    setPicking({ role, ventId: draft.id, studyId: scenario.id, draft, returnEditor: !!ventEditor });
    selectObject(`vent:${draft.id}`);
    setVentEditor(null); setSetupOpen(false); setViewOpen(false); setRefinementEditor(null); setInspection(null);
  };
  const finishPlacement = (commit: boolean) => {
    if (!placement || !scenario) { setPicking(null); return; }
    if (commit && placementScenario) change(placementScenario, true);
    setPicking(null);
    if (placement.returnEditor) setVentEditor({ studyId: scenario.id, id: placement.ventId });
    openPhase("equipment");
  };
  const moveVent = (id: string, u: number, v: number, patchId?:string) => {
    if (placement?.ventId === id) { setPicking({ ...placement, draft: { ...placement.draft, host: { patchId:patchId??placement.draft.host.patchId, u, v } } }); return; }
    if (scenario)
      change(
        {
          ...scenario,
          vents: scenario.vents.map((vent) =>
              vent.id === id ? { ...vent, host: { patchId:patchId??vent.host.patchId, u, v } } : vent,
          ),
        },
        true,
      );
  };
  const focusScenePlane = (item: NonNullable<typeof mainResult>) => {
    const axis = resultPlaneAxis(item.file.name);
    if (axis) setHiddenResultAxes(previous => previous.filter(value => value !== axis));
    if (item !== mainResult) {
      setMainResult(item);
      setMainResultMetadata(current => current.error ? {...current, error:""} : current);
    }
    selectObject(null);
    setSelectedResultPlane(item.file);
  };
  const showScenePlane=(file:File,{replace=false,historical=false}: {replace?:boolean;historical?:boolean}={})=>{
    if(!scenario)return;
    const axis = resultPlaneAxis(file.name);
    const replacesActive = replace && axis === activeAxis;
    const pinned = currentSceneLayers.filter(item => !!item.historical === historical);
    const next=[...pinned.filter(item=>item.file.name!==file.name&&(!replacesActive||item!==currentPlane)),{studyId:scenario.id,file,input:currentWorkerInput,jobId:currentJob?.job?.id,historical}];
    if(next.length>8||next.reduce((sum,item)=>sum+item.file.size,0)>64*1024**2){setMainResultMetadata({fields:[],error:"Load at most eight building planes totalling 64 MB. Unload a plane before adding more."});return;}
    if (!currentPlane) setHiddenResultAxes([]);
    mainProbe.pick(null);
    setMainResultLayers(next);
    focusScenePlane(next.at(-1)!);
    setMainResultVisible(true);
    if (historical && !replace) setResultFitRequest(value => value + 1);
  };
  const mainStack=useCFDPlaneStepper(remoteWorker.adapter,currentJob?.job,currentPlane?.file,
    file=>showScenePlane(file,{replace:true,historical:currentPlane?.historical}),!meshInspection.scene);
  const useManualRange = manualResultScale && validManualRange;
  const planeRanges = useCFDPlaneRanges(remoteWorker.adapter, currentJob?.job, mainStack.result,
    [...currentSceneLayers.map(item => item.file), ...mainStack.buffered],
    active && !!currentPlane && mainResultVisible && !useManualRange);
  const resultRange: [number,number] | undefined = useManualRange ? [Number(scaleMin), Number(scaleMax)]
    : resultField && planeRanges.ranges?.get(resultField.key);
  const planeDisplay = {field:resultField?.key??mainResultField,palette:resultPalette,
    range:resultRange ?? [0,0] as [number,number],appearance:resultAppearance};
  const toggleResultAxis = (axis: ResultAxis, visible: boolean) => {
    const layer = axisPlanes[RESULT_AXES.indexOf(axis)];
    mainProbe.pick(null);
    if (visible) {
      if (layer) focusScenePlane(layer);
      else void mainStack.chooseAxis(axis);
    } else {
      const replacement = shownAxisPlanes.find(item => item && item !== layer);
      if (layer === currentPlane && !replacement) return;
      if (layer === currentPlane && replacement) focusScenePlane(replacement);
      setHiddenResultAxes(previous => [...previous, axis]);
    }
  };
  const unloadScenePlane=(file?:File)=>{
    // Result files can be downloaded again. Match the pinned layer by name and
    // simulation, not only by the transient browser File object.
    const matches=(item:typeof mainResult)=>!!item&&item.studyId===scenario?.id&&(!file||item.file.name===file.name);
    const next=mainResultLayers.filter(item=>!matches(item));
    setMainResultLayers(next);
    mainProbe.pick(null);
    if(matches(mainResult)){
      const replacement = next.find(item=>item.studyId===scenario?.id) ?? null;
      if (replacement) focusScenePlane(replacement);
      else { setMainResult(null);setMainResultField("");setMainResultMetadata({fields:[],error:""}); }
      if (!replacement) setOnlyResultPlanes(false);
    }
  };
  const jump = (objectId: string | null, group: string) => {
    const device = objectId
      ? scenario?.vents.find((v) => v.id === objectId)
      : undefined;
    const object = objectId
      ? activeReport?.objects.find((v) => v.id === objectId)
      : undefined;
    if (objectId && scenario) {
      const target = diagnosticTarget(objectId, scenario, activeReport);
      selectObject(device ? `vent:${objectId}` : target?.refinementId ? `refinement:${target.refinementId}` : target?.patchIds?.[0] ?? objectId);
    }
    if (group === "boundaries" && objectId && scenario) {
      const id = diagnosticTarget(objectId, scenario, activeReport)?.patchIds?.[0] ?? objectId;
      if (activeReport?.patches.some(patch => patch.id === id && patch.kind !== "supply" && patch.kind !== "extract")) {
        setBoundsTab("conditions");
        setBoundarySurfaceRequest({ studyId: scenario.id, id, nonce: crypto.randomUUID() });
      }
    }
    if (device || object) {
      openPhase("equipment");
      return;
    }
    if (group === "solver") {
      openPhase("mesh");
      setSimulationTab("run");
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
  const canCopyToAirflow = (study: CFDScenario) => !!(hvacContext && study.seed && project.hvac?.bindings[study.id]
    && requiresHvacThermalExecution(project, study));
  function createAirflowCopy(study: CFDScenario) {
    if (!hvacContext || !canCopyToAirflow(study)) return;
    try {
      const copy = copyHvacAsAirflow(project, study);
      hvacContext.commit(copy.hvac, [...(project.cfdScenarios ?? []), copy.scenario]);
      setSelectedId(copy.scenario.id);
      setSelected(null);
      setError("");
      openPhase("studies");
      setMessage("Airflow copy ready to check and run. It uses the shared vent geometry and flow settings.");
    } catch (cause) { setError(hvacErrorMessage(cause)); }
  }
  const reviewIssues = (id = scenario?.id) => {
    if (!id) return;
    if (id !== scenario?.id) { setError(""); setMessage(""); }
    setSelectedId(id); setSelected(null); setPicking(null);
    setIssuesRequest(value => value + 1);
    if (!error && !preparationError) refreshPreparation();
    openPhase("review");
  };
  const available = (id: CFDWindowId) =>
    id === "studies" ||
    id === "view" ||
    !!scenario;
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
  const chooseBoundsTab = (id: typeof boundsTab) => {
    setPicking(null);
    if (id === "thermal") openThermal();
    else setBoundsTab(id);
  };
  const viewerMenu = useViewerContextMenu(target => !!target.closest(".cfx-viewport") && !target.closest(".floating-toolbar,dialog,[role=dialog],button,input,select,textarea,[role=menu]"), setContextMenu, () => setContextMenu(null));
  return (
    <section
      className="cfx-workspace"
      data-dock-workspace="climoptix"
      data-cfx-probe-scope
      data-preparation-state={busy ? "checking" : error || preparationError ? "error" : stale ? "stale" : "checked"}
      data-preparation-stamp={activeReport?.validation.checkedAt}
      aria-label="Climoptix CFD workspace"
      onPointerMoveCapture={viewerMenu.onPointerMoveCapture}
      onPointerUpCapture={viewerMenu.onPointerUpCapture}
      onPointerCancelCapture={viewerMenu.onPointerCancelCapture}
      onPointerDownCapture={event => {
        viewerMenu.onPointerDownCapture(event);
        if (event.button === 0 && selected?.startsWith("refinement:") && event.target instanceof Element &&
            event.target.closest(".cfx-setup-window") && !event.target.closest(".cfx-refinement-row,input,select,textarea"))
          setSelected(null);
        const target = event.target as Node;
        if (!meshInspection.scene && event.button === 0 && mainProbe.reading?.sample && target instanceof Element && !target.closest(".cfx-viewport"))
          mainProbe.pick(null);
        event.currentTarget.querySelectorAll<HTMLDetailsElement>(".cfx-row-menu[open]").forEach(menu => {
          if (!menu.contains(target)) menu.open = false;
        });
      }}
      onKeyDown={(event) => {
        if (meshInspection.scene && event.key === "Escape" && !(event.target instanceof Element && event.target.closest("input,select,textarea,dialog"))) {
          event.preventDefault(); event.stopPropagation(); meshInspection.exit(); return;
        }
        if (meshInspection.scene) return;
        if((event.key==="ArrowUp"||event.key==="ArrowDown")&&currentPlane&&mainResultVisible&&!event.altKey&&!event.ctrlKey&&!event.metaKey&&event.target instanceof Element&&event.target.closest(".cfx-viewport,.cfx-building-results")&&!event.target.closest("input,select,textarea,button,[contenteditable=true]")){
          event.preventDefault();event.stopPropagation();void mainStack.step(event.key==="ArrowUp"?1:-1);return;
        }
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
          if (editor.classList.contains("cfx-placement-editor")) finishPlacement(false);
          else if (editor.classList.contains("cfx-equipment-editor")) closeEquipmentEditor();
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
          meshInspection={meshInspection.scene}
          onMeshInspectionError={meshInspection.fail}
          key={project.projectId}
          project={project}
          scenario={placementScenario ?? previewScenario}
          report={activeReport}
          active={active}
          apiUrl={apiUrl}
          resultOverlay={currentPlane&&mainResultVisible&&!placement?{...planeDisplay,file:currentPlane.file,onMetadata:setMainResultMetadata,probing:mainProbe.mode,onProbe:mainProbe.pick,selected:!selected&&selectedResultPlane===currentPlane.file,showMesh:showResultMesh}:undefined}
          resultLegend={mainResultVisible && currentPlane && resultField && resultRange && legendStyle !== "hidden" && !placement
            ? <CFDResultLegend name={resultField.name} range={resultRange} palette={resultPalette} vertical={legendStyle === "vertical"}/> : undefined}
          additionalResultOverlays={mainResultVisible&&!placement&&activeAxis?shownAxisPlanes.flatMap(item=>item&&item!==currentPlane?[{...planeDisplay,file:item.file,onMetadata:ignoreSceneMetadata,probing:mainProbe.mode,onProbe:mainProbe.pick,showMesh:showResultMesh}]:[]):undefined}
          bufferedResultOverlays={currentPlane&&mainResultVisible&&!placement?mainStack.buffered.map(file=>({...planeDisplay,file,onMetadata:ignoreSceneMetadata,visible:false})):undefined}
          resultSample={mainProbe.reading?.sample ?? undefined}
          onClearResultSample={()=>mainProbe.pick(null)}
          resultFitRequest={resultFitRequest}
          viewSettingsOpen={viewOpen}
          viewTarget={viewTarget}
          onViewSettings={setViewOpen}
          stale={stale}
          selected={selected}
          diagnosticHighlight={setupOpen && shownTab === "results" && resultsView === "review" && scenario && !stale
            ? diagnosticTarget(highlightedDiagnostic, scenario, activeReport) : undefined}
          onSelect={(id) => {
            mainProbe.pick(null);
            setSelectedResultPlane(null);
            setThermalSelected(null);
            setHighlightedDiagnostic(null);
            if (!id) setBoundaryGroup("");
            selectObject(id);
            if (!id || !scenario) return;
            if (id.startsWith("refinement:")) {
              if (setupOpen) { openPhase("mesh"); setSimulationTab("mesh"); }
              return;
            }
            if (id.startsWith("probe:")) {
              if (setupOpen && shownTab === "mesh") setSimulationTab("post");
              return;
            }
            if (setupOpen && (id.startsWith("vent:") || activeReport?.objects.some(object => object.id === id))) openPhase("equipment");
          }}
          onInspectPatch={id => {
            if (!scenario) return;
            const patch = activeReport?.patches.find(surface => surface.id === id);
            const ventId = id.startsWith("vent:") ? id.slice(5) : activeReport?.vents.find(vent => vent.patchId === id)?.id;
            if (ventId && scenario.vents.some(vent => vent.id === ventId)) {
              selectObject("vent:" + ventId);
              openPhase("equipment");
              setVentEditor({ studyId: scenario.id, id: ventId });
            } else if (patch && patch.kind !== "supply" && patch.kind !== "extract") {
              setBoundsTab("conditions");
              openPhase("boundaries");
              setBoundarySurfaceRequest({ studyId: scenario.id, id, nonce: crypto.randomUUID() });
            }
          }}
          picking={placement?.draft ?? false}
          onHostPick={hostPick}
          onMoveVent={moveVent}
          onMoveProbe={(index,point)=>{if(scenario&&scenario.outputs.probesMm[index]&&point.every(value=>Number.isFinite(value)&&Math.abs(value)<=1e7))change({...scenario,outputs:{...scenario.outputs,probesMm:scenario.outputs.probesMm.map((old,i)=>i===index?point:old)}},true);}}
          resultReady={!!mainResultMetadata.fields.length}
          onlyResults={onlyResultPlanes} onOnlyResults={setOnlyResultPlanes} resultsVisible={mainResultVisible} onResultsVisible={setMainResultVisible}
          onSelectResultFile={file=>{const found=currentSceneLayers.find(item=>item.file===file);if(found)focusScenePlane(found);}}
          onRemoveResultFile={unloadScenePlane}
          onResultContextMenuOpen={()=>setContextMenu(null)}
          canMoveVents={true}
          showSamplingPlanes={
            setupOpen && shownTab === "mesh" && simulationTab === "post" && !stale && samplingPreviewStudy === scenario?.id
          }
          showRefinements={showRefinements}
          onShowRefinements={setShowRefinements}
          onReturnToSetup={inspection ? returnToSetup : undefined}
          thermalSurfaces={thermalStale ? [] : (thermalReport?.surfaces ?? [])}
          thermalMetric={scenario?.thermalEnvelope?.sunEnabled ? thermalMetric : "off"}
          thermalSun={scenario?.thermalEnvelope?.sunEnabled && thermalOpen && activeTab === "boundaries" && boundsTab === "thermal" && !thermalStale ? thermalReport?.sun : null}
          thermalSelected={thermalSelected}
          boundaryGroups={setupOpen && shownTab === "boundaries" && boundsTab === "conditions" ? boundaryDisplay : []}
          boundarySelection={boundaryGroup}
          onThermalSelect={(id) => {
            setThermalSelected(id);
            if (id && (!thermalOpen || activeTab !== "boundaries" || boundsTab !== "thermal")) openThermal();
          }}
        />
      )}
      {(active || setupOpen || inspection) && (
        <FloatingToolbar
          hidden={!active || !setupOpen}
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
            <button type="button" className="cfx-refresh-checks" aria-label="Refresh checks" disabled={!scenario || busy || resetting}
              data-field-help="Recheck this study’s geometry and preparation diagnostics. Also refresh the connected worker’s run eligibility."
              onClick={() => { refreshPreparation(); remoteWorker.refresh(); }}>
              <span aria-hidden="true" className="cfx-refresh-icon">↻</span>
              <span className="cfx-refresh-label">Refresh checks</span>
            </button>
          </div>}
          helpTitle="Climoptix CFD"
          helpSteps={[...CFD_PHASE_HELP[shownTab], ...CFD_SETUP_HELP]}
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
          <div className="cfx-setup cfx-window-sections" data-cfx-collapse-root>
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
            <CFDWindowControls>
              {shownTab === "results" && scenario && <h2>{`Results · ${scenario.name}`}</h2>}
              {scenario ? <CFDWorkbenchStatus checking={busy} stale={stale} report={activeReport} failure={error || preparationError}
                limitReached={runShowsLimit}
                runIssue={currentJob?.error || runWorkerIssue || runConfigurationIssue}
                showFailure onIssues={() => reviewIssues()}
                onDismissFailure={() => { setError(""); setEditorReset(v => v + 1); }} /> :
                <h2>{CFD_WINDOWS.find(item => item.id === shownTab)?.tab}</h2>}
            </CFDWindowControls>
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
                onOrder={(next, groups, copies) => { try { onChange(next, true, groups, undefined, copies); } catch (cause) { setError(hvacErrorMessage(cause)); } }}
                onAdd={(group, opener) => {
                  if (scenario) setCreating({ group, opener, studyId: scenario.id });
                  else add(group);
                }}
                onDelete={(id, opener) => setDeleting({ id, opener })}
                onClear={setClearing}
                onReset={() => { const starter = newCFDScenario(project.projectId, "Simulation 1"); starter.seed = scenario?.seed ?? null; void applyDefaults(starter); }}
                resetting={resetting}
                onImport={(file) => void importScenario(file)}
                entries={jobs}
                onOpenResults={(id, jobId) => {
                  setSelectedId(id);
                  setPicking(null);
                  selectObject(null);
                  setError("");
                  setDefaultPlaneRequest(jobId ? {jobId,nonce:crypto.randomUUID()} : undefined);
                  openPhase("results");
                }}
                onOpenMesh={id => {
                  setSelectedId(id); setPicking(null); setDefaultPlaneRequest(undefined);
                  openPhase("results"); setResultsView("mesh");
                }}
                worker={workerAdapter}
                onSubmit={(op, studies, opener) => void submitFromWorkspace(op, studies, opener)}
                onUndo={onUndo}
                onRedo={onRedo}
                canUndo={canUndo}
                canRedo={canRedo}
              />
            </section>
            {scenario && shownTab === "boundaries" && (
              <div className="cfx-bound-tabs" role="tablist" aria-label="Boundary setup">
                {BOUNDS_TABS.map(([id, label], index) => (
                  <button key={id} type="button" role="tab" id={"cfx-bounds-tab-" + id}
                    aria-controls={id === "thermal" ? "cfx-bounds-thermal" : "cfx-setup-panel-" + (id === "conditions" ? "boundaries" : id)}
                    aria-selected={boundsTab === id} tabIndex={boundsTab === id ? 0 : -1}
                    onClick={() => chooseBoundsTab(id)}
                    onKeyDown={event => {
                      const count = BOUNDS_TABS.length;
                      const next = event.key === "Home" ? 0 : event.key === "End" ? count - 1
                        : event.key === "ArrowLeft" ? (index - 1 + count) % count
                        : event.key === "ArrowRight" ? (index + 1) % count : -1;
                      if (next < 0) return;
                      event.preventDefault();
                      const [target] = BOUNDS_TABS[next];
                      chooseBoundsTab(target);
                      document.getElementById("cfx-bounds-tab-" + target)?.focus();
                    }}>{label}</button>
                ))}
              </div>
            )}
            {scenario &&
              PHASES.map((panel) => (
                <section
                  key={`${scenario.id}|${editorReset}|${panel.id}`}
                  role="tabpanel"
                  id={`cfx-setup-panel-${panel.id}`}
                  aria-labelledby={panel.id === "equipment" ? "cfx-bounds-tab-equipment" : panel.id === "boundaries" ? "cfx-bounds-tab-conditions" : `cfx-setup-tab-${panel.id}`}
                  hidden={panel.id === "equipment" || panel.id === "boundaries"
                    ? shownTab !== "boundaries" || boundsTab !== (panel.id === "equipment" ? "equipment" : "conditions")
                    : shownTab !== panel.id}
                  className="cfx-setup-panel"
                >
                  <section
                    className="cfx-inspector"
                    aria-label={`${panel.label} settings`}
                  >
                    {panel.id === "equipment" && (
                      <><EquipmentPanel
                        checked={!stale}
                        scenario={scenario}
                        report={activeReport}
                        selected={selected}
                        onSelect={selectObject}
                        onChange={change}
                        onPick={startPlacement}
                        onEditSource={onEditBuilding}
                        onEditVent={id => setVentEditor({ studyId: scenario.id, id })}
                      />
                      <SharedHvacCFD scenario={scenario} onEditSource={onEditBuilding} />
                      </>
                    )}
                    {panel.id === "boundaries" && (
                      <>
                        <BoundariesPanel
                          openingNames={openingNames}
                          sharedCapture={<>
                            {scenario.sharedBoundaries && <SharedBoundaryCapture report={activeReport} checked={!stale && !busy} />}
                          </>}
                          project={project}
                          checked={!stale}
                          scenario={scenario}
                          report={activeReport}
                          selected={selected}
                          onSelect={selectObject}
                          onChange={change}
                          surfaceRequest={boundarySurfaceRequest?.studyId === scenario.id && boundarySurfaceRequest.id === selected ? boundarySurfaceRequest : null}
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
                        domain={<DomainPanel project={project} scenario={scenario} report={activeReport} onChange={change}/>}
                        optimisation={<ClimoptixAdjoint key={scenario.id} project={project} scenario={scenario} report={activeReport} revision={revision} checked={!stale&&!busy&&!preparationError}
                apiUrl={apiUrl} active={setupOpen&&shownTab==="mesh"&&simulationTab==="adjoint"} selected={selected} onSelect={selectObject} onChange={change} onNavigate={openPhase}
                workerConnected={!!workerAdapter?.capabilities.connected} baselineRunId={completedRunReference(jobs[scenario.id],currentWorkerInput)}/>}
                        connection={{
                          connected:
                            workerAdapter?.capabilities.connected ?? false,
                          canRun:
                            !!workerAdapter?.capabilities.connected &&
                            (runShowsLimit || !runConfigurationIssue && (workerAdapter.capabilities.run || !!recoveringRun)) &&
                            !(
                              jobs[scenario.id]?.dispatched &&
                              jobs[scenario.id].operation !== "run"
                            ),
                          blockedReason:
                            runConfigurationIssue ?? (jobs[scenario.id]?.dispatched &&
                            jobs[scenario.id].operation !== "run"
                              ? "Recover the previous Mesh submission from Simulations first"
                              : runWorkerIssue || (workerAdapter?.capabilities.connected === false ? workerAdapter.capabilities.reason : undefined)),
                          busy:
                            resetting || !!jobs[scenario.id]?.submitting ||
                            (!!jobs[scenario.id]?.job &&
                              !terminalJob(jobs[scenario.id].job!)),
                          onIssues: () => reviewIssues(),
                          onAirflowCopy: canCopyToAirflow(scenario) ? () => createAirflowCopy(scenario) : undefined,
                          onRun: (opener) => {
                            if (defaultAbort.current) return;
                            void submitFromWorkspace("run", [scenario], opener);
                            if (!runShowsLimit) openPhase("studies");
                          },
                        }}
                        tab={simulationTab}
                        onTab={setSimulationTab}
                        samplingPreview={samplingPreviewStudy === scenario.id}
                        onSamplingPreview={show => setSamplingPreviewStudy(show ? scenario.id : null)}
                        scenario={scenario}
                        report={activeReport}
                        onChange={change}
                        selected={selected}
                        onSelect={selectObject}
                        onExport={() => void exportOpenFOAM()}
                        onImport={file => void importOpenFOAM(file)}
                        exporting={exporting}
                        exportDisabled={
                          stale || !!activeReport?.validation.errors || !!error
                        }
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

                        jobProgress={<CFDJobProgress name={scenario.name} job={jobs[scenario.id]?.job} operation={jobs[scenario.id]?.operation}
                          pending={jobs[scenario.id]?.submitting?"Checking & submitting…":jobs[scenario.id]?.dispatched?"Submission status unknown":undefined}/>}
                      />
                    )}
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
                    <div className="cfx-thermal-inline">
                    <ThermalEnvelopeWindow key={scenario.id} scenario={scenario} apiUrl={apiUrl}
                      report={!thermalStale ? thermalReport : null} busy={thermalBusy} error={thermalError}
                      metric={thermalMetric} onMetric={setThermalMetric} onChange={change} />
                    </div>
                  )}
                </section>
                <section
                  role="tabpanel"
                  id="cfx-setup-panel-results"
                  aria-labelledby="cfx-setup-tab-results"
                  hidden={shownTab !== "results"}
                  className="cfx-setup-panel"
                >
                  {active && (
                    <ClimoptixResults
                        monitor={
                          shownTab === "results" && setupOpen &&
                          resultsView === "monitor" && (
                            remoteWorker.adapter && jobs[scenario.id]?.job ? <ClimoptixWorkerMonitor
                              key={`${remoteWorker.adapter.namespace}:${jobs[scenario.id].job!.id}`} adapter={remoteWorker.adapter} job={jobs[scenario.id].job!}
                              name={scenario.name} older={jobs[scenario.id].input !== currentWorkerInput}
                              onVTK={(file, buildingPlane) => {
                                const entry = jobs[scenario.id];
                                const job = entry?.job;
                                if (!job) return;
                                const older = entry.input !== currentWorkerInput;
                                setVTKFile({ studyId: scenario.id, file, token: crypto.randomUUID(), jobId: job.id,
                                  provenance: "Authenticated worker job " + job.id + " · pinned revision " + job.clientRevision.slice(0,12) + " · p in m²/s²" + (older ? " · older setup" : "") });
                                if (!buildingPlane) openPhase("results");
                                else showScenePlane(file, {historical:older});
                              }} /> : <ClimoptixConvergence
                              name={scenario.name}
                              state={logs.get(scenario.id)}
                              onImport={(file) =>
                                void importLog(scenario.id, file)
                              }
                              onClear={() => clearLog(scenario.id)}
                            />
                          )
                        }
                      mesh={<CFDMeshInspectionPanel inspection={meshInspection} onOpenMeshSetup={() => { meshInspection.exit(); openPhase("mesh"); setSimulationTab("mesh"); }}/>}
                      view={resultsView} onViewChange={setResultsView}
                      review={<ClimoptixReview openingNames={openingNames} key={`${scenario.id}:${issuesRequest}`} workerConnected={!!workerAdapter?.capabilities.connected} scenario={scenario} report={activeReport} revision={revision} stale={stale} blocked={!!error} issuesRequest={issuesRequest} submissionError={shownTab === "results" && resultsView === "review" ? currentJob?.error : undefined} configurationIssue={runConfigurationIssue} workerIssue={runWorkerIssue} onAirflowCopy={runConfigurationIssue && canCopyToAirflow(scenario) ? () => createAirflowCopy(scenario) : undefined}
                      preparationIssue={error || preparationError} onChange={change} onImport={file => void importScenario(file)} onExport={exportScenario} onError={setError}
                      onRefresh={() => refreshPreparation()} onInspect={jump} onHighlight={setHighlightedDiagnostic} />}
                      key={`${scenario.id}:${jobs[scenario.id]?.job?.id??"external"}:${currentVTKFile?.token??"none"}`}
                      adapter={remoteWorker.adapter} job={jobs[scenario.id]?.job} report={activeReport}
                      projectId={project.projectId}
                      active={shownTab === "results" && setupOpen}
                      older={!!jobs[scenario.id]?.job && jobs[scenario.id].input !== currentWorkerInput}
                      initialFile={currentVTKFile?.file}
                      initialProvenance={currentVTKFile?.provenance}
                      sceneFiles={mainResultLayers.filter(item=>item.studyId===scenario.id&&item.jobId===jobs[scenario.id]?.job?.id&&item.input===currentWorkerInput).map(item=>item.file)}
                      sceneError={mainResult?.studyId===scenario.id&&mainResult.jobId===jobs[scenario.id]?.job?.id?mainResultMetadata.error:undefined}
                      onUnloadScene={unloadScenePlane}
                      onScene={(file, historical) => showScenePlane(file, {historical})}
                      defaultPlaneRequest={defaultPlaneRequest?.jobId === currentJob?.job?.id ? defaultPlaneRequest?.nonce : undefined}
                      onDefaultPlaneHandled={() => setDefaultPlaneRequest(undefined)}
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
      {active && viewOpen && <FloatingToolbar title="View properties" className="cfx-view-window" defaultPosition={{ x: 900, y: 144 }}
        initialSize={{ width: 440 }} onClose={() => setViewOpen(false)} helpSteps={CFD_PHASE_HELP.view}>
        <div ref={setViewTarget} />
      </FloatingToolbar>}
      {active&&mainResult&&mainResult.studyId===scenario?.id&&mainResult.jobId===currentJob?.job?.id&&<FloatingToolbar title="Building result display" className="cfx-building-results" defaultPosition={{x:1060,y:170}} initialSize={{width:400,height:620}} onClose={()=>unloadScenePlane()}>
        <CFDWindowSections>
        <details open><summary>Plane selection &amp; display</summary>
        <label>Loaded plane<select aria-label="Building 3D plane" disabled={mainStack.busy} value={mainResult.file.name} onChange={event=>{const next=currentSceneLayers.find(item=>item.file.name===event.target.value);if(next){mainProbe.pick(null);focusScenePlane(next);}}}>{mainResultLayers.filter(item=>item.studyId===scenario?.id).map(item=><option key={item.file.name} value={item.file.name}>{item.file.name}</option>)}</select></label>
        {mainResult.input!==currentWorkerInput?<p className="cfx-error" role="alert">Setup changed. This pinned result is hidden to avoid overlaying a different building. Inspect the original job separately.</p>:<>
        <label>Result field<select aria-label="Building result field" value={resultField?.key??""} onChange={event=>setMainResultField(event.target.value)}>{mainResultMetadata.fields.map(field=><option key={field.key} value={field.key}>{field.name} · {field.key.startsWith("cell:")?"cell":"point"}</option>)}</select></label>
        <fieldset className="cfx-result-axes">
          <legend>Visible plane normals</legend>
          {RESULT_AXES.map((axis, index) => {
            const shown = !!axisPlanes[index] && !hiddenResultAxes.includes(axis);
            return <label key={axis} className="cfx-check"><input type="checkbox" checked={shown}
              disabled={mainStack.busy || (shown ? shownAxisPlanes.length === 1 && activeAxis === axis : !axisPlanes[index] && !mainStack.availableAxes.includes(axis))}
              onChange={event=>toggleResultAxis(axis,event.target.checked)}/>{axis}</label>;
          })}
        </fieldset>
        <label>Arrow keys move<select disabled={mainStack.busy || !shownAxisPlanes.length} value={activeAxis??""}
          data-field-help="With focus in the 3D view, use Up and Down to load the adjacent solved slice along this axis."
          onChange={event=>{const item=axisPlanes[RESULT_AXES.indexOf(event.target.value as ResultAxis)];if(item){mainProbe.pick(null);focusScenePlane(item);}}}>
          {!activeAxis&&<option value="">Current plane</option>}
          {shownAxisPlanes.map(item=>{const axis=resultPlaneAxis(item!.file.name);return <option key={axis} value={axis}>{axis}</option>;})}
        </select></label>
        <div className="cfx-equal-actions"><button disabled={!mainStack.previous} onClick={()=>void mainStack.step(-1)}>Previous 3D plane</button><button disabled={!mainStack.next} onClick={()=>void mainStack.step(1)}>Next 3D plane</button></div>
        {mainStack.busy&&<p role="status">Loading sampled plane…</p>}
        {mainStack.error&&<p role="alert" className="cfx-error">{mainStack.error}</p>}
        <div className="cfx-result-visibility">
          <label className="cfx-check"><input type="checkbox" checked={onlyResultPlanes} onChange={event=>setOnlyResultPlanes(event.target.checked)}/>Planes only</label>
          <label className="cfx-check"><input type="checkbox" checked={mainResultVisible} onChange={event=>setMainResultVisible(event.target.checked)}/>Show planes</label>
          <CFDPointProbeControls probe={mainProbe} checkbox/>
        </div>
        </>}
        {mainResultMetadata.error&&<p className="cfx-error" role="alert">{mainResultMetadata.error}</p>}
        </details>
        <details><summary>Plane appearance</summary>
          <div className="cfx-plane-toggles">
          <label className="cfx-check"><input type="checkbox" checked={resultAppearance.edges}
            onChange={event=>setResultAppearance({...resultAppearance,edges:event.target.checked})}
            data-field-help="Show each plane’s perimeter. The selected plane retains its orange outline."/>Plane edges</label>
          <label className="cfx-check"><input type="checkbox" checked={showResultMesh && !!mainResultMetadata.meshSection}
            disabled={!mainResultMetadata.meshSection} onChange={event=>setShowResultMesh(event.target.checked)}
            data-field-help={mainResultMetadata.meshSection ? "Show the solver mesh cells cut by the displayed planes." : "This result does not include native mesh sections."}/>Show mesh</label>
          </div>
          <label>Edge opacity · {resultAppearance.edgeOpacity}%<input type="range" min={0} max={100} step={5}
            value={resultAppearance.edgeOpacity} disabled={!resultAppearance.edges}
            onChange={event=>setResultAppearance({...resultAppearance,edgeOpacity:event.target.valueAsNumber})}/></label>
          <label>Directional shading · {resultAppearance.shading}%<input type="range" min={0} max={60} step={5}
            value={resultAppearance.shading}
            data-field-help="Darken planes according to their orientation to make overlapping slices easier to distinguish. Set to zero to match the legend colours exactly."
            onChange={event=>setResultAppearance({...resultAppearance,shading:event.target.valueAsNumber})}/></label>
        </details>
        <details open><summary>Legend &amp; colour scale</summary>
          <CFDLegendStyleSelect value={legendStyle} onChange={setLegendStyle} />
          <label>Colour palette<select value={resultPalette} onChange={event=>setResultPalette(event.target.value as ResultPalette)}>{Object.entries(RESULT_PALETTES).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          <label>Scale<select data-field-help="Auto keeps the selected field’s minimum and maximum across every retained plane. The same range applies while browsing visible planes." value={manualResultScale?"manual":"auto"} onChange={event=>setManualResultScale(event.target.value==="manual")}><option value="auto">Auto · all planes</option><option value="manual">Manual range</option></select></label>
          {!useManualRange && mainResultVisible && currentPlane && !resultRange && !planeRanges.error && !mainStack.resultError &&
            <p role="status">Reading the colour range across all result planes…</p>}
          {!useManualRange && mainStack.resultError && <p role="alert" className="cfx-error">
            {mainStack.resultError} <button type="button" onClick={mainStack.retryResult}>Retry result manifest</button>
          </p>}
          {!useManualRange && planeRanges.error && <p role="alert" className="cfx-error">
            {planeRanges.error} <button type="button" onClick={planeRanges.retry}>Retry colour range</button>
          </p>}
          {manualResultScale&&<>
            <div className="cfx-equal-actions">
              <label>Minimum<input type="number" step="any" value={scaleMin} onChange={event=>setScaleMin(event.target.value)} /></label>
              <label>Maximum<input type="number" step="any" value={scaleMax} onChange={event=>setScaleMax(event.target.value)} /></label>
            </div>
            {!validManualRange&&<p role="status">Enter a minimum below the maximum to replace the automatic scale.</p>}
          </>}
        </details>
        </CFDWindowSections>
      </FloatingToolbar>}
      {active && scenario && ventEditor?.studyId === scenario.id && scenario.vents.some(v => v.id === ventEditor.id) &&
        <FloatingToolbar title="Edit equipment" className="cfx-equipment-editor" initialSize={{ width: 620, height: 650 }}
          defaultPosition={{ x: 260, y: 88 }} bringToFront onClose={closeEquipmentEditor} helpSteps={CFD_PHASE_HELP.equipment}>
          <CFDWindowSections><section className="cfx-inspector" aria-label="Equipment editor">
            <EquipmentPanel key={`${scenario.id}:${ventEditor.id}`} editor scenario={scenario} report={activeReport}
              selected={`vent:${ventEditor.id}`} onSelect={selectObject} onChange={change} onPick={startPlacement} onEditSource={onEditBuilding} />
            <button onClick={closeEquipmentEditor}>Done</button>
          </section></CFDWindowSections>
        </FloatingToolbar>}
      {active && placement && placementScenario && <FloatingToolbar title="Place vent" className="cfx-equipment-editor cfx-placement-editor"
        initialSize={{ width: 420, height: 600 }} defaultPosition={{ x: 24, y: 100 }} bringToFront onClose={() => finishPlacement(false)}
        footer={<footer className="cfx-placement-actions" aria-label="Vent placement actions">
          <button className="cfx-primary" disabled={!activeReport?.patches.some(p => p.host && p.id === placement.draft.host.patchId)} onClick={() => finishPlacement(true)}>OK</button>
          <button onClick={() => finishPlacement(false)}>Cancel</button>
        </footer>}>
        <CFDWindowSections><section className="cfx-inspector" aria-label="Vent placement editor">
          <p role="status">Click another wall, floor or ceiling to move the vent there. Drag the orange vent to position it. Changes are a preview until you choose OK.</p>
          <EquipmentPanel editor placement scenario={placementScenario} report={activeReport} selected={`vent:${placement.ventId}`} onSelect={selectObject}
            onChange={next => { const draft = next.vents.find(v => v.id === placement.ventId); if (draft && ventSchema.safeParse(draft).success) setPicking({ ...placement, draft }); }} onPick={startPlacement} onEditSource={onEditBuilding} />
        </section></CFDWindowSections>
      </FloatingToolbar>}
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
          <CFDWindowSections><section className="cfx-inspector" aria-label="Refinement editor">
            <RefinementEditor
              key={`${scenario.id}:${refinementEditor.id}`}
              scenario={scenario}
              report={activeReport}
              id={refinementEditor.id}
              onChange={change}
            />
            <button onClick={closeRefinementEditor}>Done</button>
          </section></CFDWindowSections>
        </FloatingToolbar>
      )}
      {deleting && deletingStudy && (
        <ClimoptixDeleteStudy
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
            preparation.remove(deletingStudy.id);
            thermal.remove(deletingStudy.id);
          }}
        />
      )}
      {limitDialog && <ConfirmationDialog title="Simulation limit reached" opener={limitDialog}
        fallbackFocus=".cfx-study-actions button"
        message={<>You reached your limit of a total of 5 simulations, send us a message at <a href="mailto:info@climoptix.com">info@climoptix.com</a> to get a quote for the commercial version</>}
        onCancel={() => setLimitDialog(null)} />}
      {creating && <ConfirmationDialog title="Create a new simulation?" confirmLabel="Create simulation" opener={creating.opener}
        message={`This clears the loaded results and permanently deletes saved results for “${scenarios.find(study => study.id === creating.studyId)?.name ?? "the current simulation"}”. Undo can restore setup edits. Deleted result files cannot be recovered.`}
        onCancel={() => setCreating(null)} onConfirm={() => { add(creating.group, creating.studyId); setCreating(null); }} />}
      {clearing && <ClimoptixDeleteStudy name="" count={scenarios.length} opener={clearing} onCancel={() => setClearing(null)} onDelete={() => {
        if (scenarios.some(s => { const entry = jobs[s.id]; return entry?.submitting || entry?.dispatched || (entry?.job && !terminalJob(entry.job)); })) {
          setClearing(null); setError("Resolve active or unknown worker submissions before clearing simulations."); return;
        }
        scenarios.forEach(s => clearLog(s.id));
        importRead.current++;
        preparation.clear(); exportAbort.current?.abort(); setExporting(false);
        thermal.clear(); defaultAbort.current?.abort();
        onChange([], true, []);
        setClearing(null); setSelectedId(""); setSelected(null); setPicking(null);
        setRefinementEditor(null); setVentEditor(null);
        setVTKFile(null);
        setError(""); setMessage(""); openPhase("studies");
      }} />}
    </section>
  );
}
