"use client";
import { electricalPlacement } from "@/lib/electricalAssets";
import { BuildingControls, type BuildingView, type FloorOpeningTool } from "@/components/BuildingControls";
import { activeFloor, buildingOf, projectFloors, resetBuildingOutline, selectFloor, updateFloor, type FloorOpening, type RoofConfiguration } from "@/lib/buildingDocument";
import { projectScope } from "@/lib/projectScope";
import type { ProjectDocument } from "@/lib/projectDocument";
import { validateFloorOpening } from "@/lib/buildingGeometry";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import styles from "./planner-guide.module.css";
import { useCompactWorkspace } from "@/lib/useCompactWorkspace";
import { useLocalProject } from "@/lib/useLocalProject";
import { PlannerPrivacyDialog } from "@/components/PlannerPrivacyDialog";
import { AccountDialog } from "@/components/AccountDialog";
import { AccountStatusButton } from "@/components/AccountStatusButton";
import { LocalAssetLibrary } from "@/components/LocalAssetLibrary";
import starterDemo from "@/lib/starterDemo.json";
import { EngineeringViewer } from "@/components/EngineeringViewer";
import { ApplicationMenuBar } from "@/components/ApplicationMenuBar";
import { CatalogueBrowser } from "@/components/CatalogueBrowser";
import { CatalogueManager } from "@/components/CatalogueManager";
import { UiTheme, type SoftwareUi } from "@/components/UiTheme";
import { CatalogueFixtureEditor } from "@/components/CatalogueFixtureEditor";
import { ViewerOpeningEditor } from "@/components/ViewerOpeningEditor";
import { FullFloorplanEditor } from "@/components/FullFloorplanEditor";
import { FloatingToolbar, positionedToolbarDock } from "@/components/FloatingToolbar";
import { PersonEditor } from "@/components/PersonEditor";
import { PlannerBuildWorkspace } from "@/components/PlannerBuildWorkspace";
import { ClimoptixWorkspace } from "@/components/ClimoptixWorkspace";
import { useClimoptixAccess } from "@/components/useClimoptixAccess";
import { usePlannerBuildView } from "@/lib/plannerBuildView";
import { constrainObstacleToRoom, requiresWallMount, DEFAULT_OBSTACLE_WALL_LOCK, obstacleFitsInRoom, transferObstacle, type PlacementCandidate, type PlacementRequest, type PlacementWall } from "@/lib/elementPlacement";
import { normalizeRoomPerson } from "@/lib/person";
import { defaultPersonSpec, syncSupportedPeople } from "@/lib/people";
import { SettingsDialog } from "@/components/SettingsDialog";
import { DEFAULT_APP_PREFERENCES, getCurrencyPreferenceSnapshot, getServerCurrencyPreferenceSnapshot, readAppearancePreferences, subscribeCurrencyPreference, watchThemePreference, writeAppearancePreferences, type AppPreferences } from "@/lib/appPreferences";
import type { CatalogueItem, DemoResponse, LayoutResult, Measurement, Obstacle, PersonMockup, Room, RoomFinishes, WallViewMode } from "@/lib/types";
import { ADD_TO_PLAN_MODES, type AddToPlanMode } from "@/lib/addToPlanModes";
import { formatLength, formatMeasurementText } from "@/lib/units";
import type { FloorplanStyle } from "@/lib/floorplanStyles";
import { DEFAULT_TOOLBAR_AVAILABILITY, DEFAULT_TOOLBAR_VISIBILITY, FLOORPLAN_TOOLBARS, VIEWER_TOOLBARS, type ToolbarId, type ToolbarVisibility } from "@/lib/toolbars";
import { commercialRequest } from "@/lib/commercialApi";
import { includesPlannerBuild, type PlanKey } from "@/lib/commercialCatalogue";
import { DEFAULT_ELECTRICAL_LAYOUT, electricalObstacleIds, normalizeElectricalLayout } from "@/lib/electricalLayout";
import type { ElectricalLayoutImportPlan } from "@/lib/electricalLayoutPackage";
import { HeatingLayoutProvider } from "@/components/HeatingLayoutContext";
import { isHeatingElement, emptyHeatingSpec } from "@/lib/heatingElements";
import { newHeatingProject } from "@/lib/heatingDocument";
import { EnergyLayoutProvider } from "@/components/EnergyLayoutContext";
import { newEnergyProject } from "@/lib/energyDocument";

// Keep browser requests on the frontend origin. Next.js proxies these calls to
// the private local engineering backend, so phones on the LAN never try to use
// their own `localhost:8000`.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/engineering-api";
const FULL_FLOORPLAN_SELECTION = "__FULL_FLOORPLAN__";
// Catalogue administration changes the software's master configuration and is
// intentionally available only while an administrator runs a development build.
const CATALOGUE_MANAGER_AVAILABLE = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_ENABLE_PROGRAMMER_TOOLS === "true";

function initialAppPreferences(): AppPreferences {
  if (typeof window === "undefined") return DEFAULT_APP_PREFERENCES;
  try {
    return { ...DEFAULT_APP_PREFERENCES, ...readAppearancePreferences(window.localStorage), currency: DEFAULT_APP_PREFERENCES.currency };
  } catch {
    return DEFAULT_APP_PREFERENCES;
  }
}

const emptyFloorRoom:Room={id:"empty-floor",name:"Draw an enclosed room",version:0,vertices:[],wall_height:{value:2400,uncertainty_mm:0,verified:false,source_type:"DESIGN_SETTING"},wall_thickness:{value:100,uncertainty_mm:0,verified:false,source_type:"DESIGN_SETTING"},openings:[],obstacles:[]};

export default function Home() {
  const local = useLocalProject();
  const scopeToken=local.project?projectScope(local.project,local.documentSession):undefined;
  const [buildingView,setBuildingView]=useState<BuildingView>({whole:false,roof:false,reference:true,snap:true});
  const [keepFloorOpeningsSquare,setKeepFloorOpeningsSquare]=useState(true);
  const [openingTool,setOpeningTool]=useState<FloorOpeningTool>(null),[selectedFloorOpening,setSelectedFloorOpening]=useState<string|null>(null),[finishOpening,setFinishOpening]=useState(0);
  const [buildingError,setBuildingError]=useState(""),[roofPreview,setRoofPreview]=useState<RoofConfiguration|null>(null);
  const compactWorkspace = useCompactWorkspace();
  const [compactEditorTool, setCompactEditorTool] = useState<ToolbarId | null>("floorplan-build");
  const [compactViewerTool, setCompactViewerTool] = useState<ToolbarId | null>("viewer-view");
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [placementWalls,setPlacementWalls]=useState<PlacementWall[]>([]);
  const [placement, setPlacement] = useState<PlacementRequest | null>(null);
  const [electricalLayoutRequest, setElectricalLayoutRequest] = useState(0);
  const [electricalStatus, setElectricalStatus] = useState<string | null>(null);
  const [plannerBuildDemoMode, setPlannerBuildDemoMode] = useState(false);
  useEffect(() => {
    if (!placement) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setPlacement(null); return; }
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key.toLowerCase() === "r" && !placement.opening) {
        event.preventDefault();
        if (requiresWallMount(placement.obstacle)) return; // Mounted fittings get their orientation from the host wall.
        setPlacement(current => current ? {...current, obstacle:{...current.obstacle, wall_lock:false, rotation_deg:(current.obstacle.rotation_deg+(event.shiftKey?-90:90)+360)%360}} : null);
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [placement]);
  const [uiSettings, setUiSettings] = useState<SoftwareUi | null>(null);
  const [demo, setDemo] = useState<DemoResponse | null>(null);
  const [mode, setMode] = useState<"EDITOR" | "ANALYSIS">("EDITOR");
  const [workspaceMode, setWorkspaceModeState] = useState<"FLOORPLAN" | "PLANNERBUILD" | "CLIMOPTIX">("FLOORPLAN");
  const workspaceRequest = useRef(0);
  const closePrivateWorkspace = useCallback(() => {
    setWorkspaceModeState(current => current === "CLIMOPTIX" ? "FLOORPLAN" : current);
  }, []);
  const climoptixEnabled = useClimoptixAccess(API_URL, closePrivateWorkspace);
  function setWorkspaceMode(nextMode: typeof workspaceMode) {
    workspaceRequest.current++;
    if (nextMode === "CLIMOPTIX" && !climoptixEnabled) return;
    setWorkspaceModeState(nextMode);
  }
  const [cfdMenuTarget,setCFDMenuTarget]=useState<HTMLDivElement|null>(null);
  const [insulationEditRequest, setInsulationEditRequest] = useState<{ id: string; elementId: string; pointMm?: [number, number] }>();
  const [plannerBuildView, setPlannerBuildView] = usePlannerBuildView();
  const [projectRooms, setProjectRooms] = useState<Room[]>([]);
  const [viewerRoomSelection, setViewerRoomSelection] = useState(FULL_FLOORPLAN_SELECTION);
  const [pendingViewerRoomSelection, setPendingViewerRoomSelection] = useState(FULL_FLOORPLAN_SELECTION);
  const [layoutResult, setLayoutResult] = useState<LayoutResult | null>(null);
  const [runningAnalysis, setRunningAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [catalogueManagerOpen, setCatalogueManagerOpen] = useState(false);
  const [catalogueManagerOpener, setCatalogueManagerOpener] = useState<HTMLElement | null>(null);
  const [tierPreview, setTierPreview] = useState<PlanKey | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountInitialSection, setAccountInitialSection] = useState<"account" | "plans">("account");
  const closeAccountDialog = useCallback(() => setAccountOpen(false), []);
  const [wallMode, setWallMode] = useState<WallViewMode>("SOLID");
  const [floorplanStyle, setFloorplanStyle] = useState<FloorplanStyle>("DEFAULT");
  const [floorplanExportRequest, setFloorplanExportRequest] = useState(0);
  const [floorplanAnnotateRequest, setFloorplanAnnotateRequest] = useState(0);
  const [viewerSaveViewRequest, setViewerSaveViewRequest] = useState(0);
  const [floorplanImportFile, setFloorplanImportFile] = useState<File | null>(null);
  const [preferences, setPreferences] = useState(initialAppPreferences);
  const defaultCurrency = useSyncExternalStore(subscribeCurrencyPreference, getCurrencyPreferenceSnapshot, getServerCurrencyPreferenceSnapshot);
  const appPreferences = { ...preferences, currency: defaultCurrency };
  useEffect(() => {
    return watchThemePreference(preferences.theme, document.documentElement, window.matchMedia("(prefers-color-scheme: dark)"));
  }, [preferences.theme]);
  useEffect(() => {
    document.documentElement.dataset.density = preferences.density.toLowerCase();
  }, [preferences.density]);
  const handlePreferencesChange = useCallback((next: AppPreferences) => {
    setPreferences(next);
    try {
      writeAppearancePreferences(next, window.localStorage);
    } catch {
      // Applying a preference remains immediate when local storage is blocked.
    }
  }, []);
  const [demoLoadRequest, setDemoLoadRequest] = useState(0);
  const [toolbarVisibility, setToolbarVisibility] = useState(DEFAULT_TOOLBAR_VISIBILITY);
  const compactActiveTool = mode === "EDITOR" ? compactEditorTool : compactViewerTool;
  const visibleToolbars = compactWorkspace
    ? Object.fromEntries(Object.keys(toolbarVisibility).map(id => [id, id === compactActiveTool])) as ToolbarVisibility
    : toolbarVisibility;
  const [toolbarAvailability, setToolbarAvailability] = useState(DEFAULT_TOOLBAR_AVAILABILITY);
  const [toolbarLayoutResetKey, setToolbarLayoutResetKey] = useState(0);
  const [fillToolbarLayout, setFillToolbarLayout] = useState(false);
  const [viewerFitRequest, setViewerFitRequest] = useState(0);
  const [viewerOpeningEditRequest, setViewerOpeningEditRequest] = useState<{ id: string; roomId: string; requestId: number } | null>(null);
  const [viewerElementEditRequest, setViewerElementEditRequest] = useState<{ id: string; roomId: string; requestId: number } | null>(null);
  const [viewerAddToPlanMode, setViewerAddToPlanMode] = useState<AddToPlanMode>("FURNITURE");
  const [viewerOpeningSyncRequest, setViewerOpeningSyncRequest] = useState<{ room: Room; requestId: number } | null>(null);
  const [openingEditorTarget, setOpeningEditorTarget] = useState<HTMLDivElement | null>(null);
  const handleViewerOpeningSelected = useCallback((selection: { id: string; roomId: string } | null) => {
    if (selection) {
      setViewerElementEditRequest(null);
      const opening = (demo ? (projectRooms.length ? projectRooms : [demo.room]) : []).find(room => room.id === selection.roomId)?.openings.find(item => item.id === selection.id);
      if (opening) setViewerAddToPlanMode(opening.kind === "WINDOW" ? "WINDOW" : "DOOR");
    }
    setViewerOpeningEditRequest(current => selection ? { ...selection, requestId: (current?.requestId ?? 0) + 1 } : null);
  }, [demo, projectRooms]);
  const handlePlanElementSelected = useCallback((selection: { id: string; roomId: string } | null) => {
    if (!selection) {
      setViewerElementEditRequest(null);
      return;
    }
    setViewerOpeningEditRequest(null);
    setViewerElementEditRequest((current) => ({ ...selection, requestId: (current?.requestId ?? 0) + 1 }));
    setCompactEditorTool("floorplan-openings");
    setToolbarVisibility((current) => current["floorplan-openings"] ? current : { ...current, "floorplan-openings": true });
  }, []);
  const handleImportDrawing = useCallback((file: File) => setFloorplanImportFile(file), []);
  const setLayoutAnalysisToolbarVisible = useCallback((visible: boolean) => {
    setToolbarAvailability((current) => current["viewer-layout-analysis"] === visible ? current : { ...current, "viewer-layout-analysis": visible });
    setToolbarVisibility((current) => current["viewer-layout-analysis"] === visible ? current : { ...current, "viewer-layout-analysis": visible });
  }, []);
  const setHumanMockupToolbarVisible = useCallback((visible: boolean) => {
    setToolbarAvailability((current) => current["viewer-person"] === visible ? current : { ...current, "viewer-person": visible });
    setToolbarVisibility((current) => current["viewer-person"] === visible ? current : { ...current, "viewer-person": visible });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const loadDemo = async (attempt: number): Promise<void> => {
      try {
        const nextDemo = starterDemo as unknown as DemoResponse;
        if (!cancelled) { setDemo({ ...nextDemo, room: normalizeRoomPerson(nextDemo.room) }); setError(null); }
      } catch (reason) {
        if (cancelled) return;
        if (attempt < 4) {
          retryTimer = setTimeout(() => { void loadDemo(attempt + 1); }, 500 * (attempt + 1));
          return;
        }
        setError(reason instanceof Error ? reason.message : "Unable to reach the engineering backend.");
      }
    };
    void loadDemo(0);
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); };
  }, [demoLoadRequest]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`${API_URL}/settings`).then((response) => response.ok ? response.json() : Promise.reject()).then((settings: { toolbars?: { layout_analysis?: boolean; human_mockup?: boolean }; ui?: SoftwareUi }) => {
      if (!cancelled && settings.ui) setUiSettings(settings.ui);
      const layoutAnalysisVisible = settings.toolbars?.layout_analysis;
      const humanMockupVisible = settings.toolbars?.human_mockup;
      if (!cancelled && typeof layoutAnalysisVisible === "boolean") {
        setToolbarAvailability((current) => ({ ...current, "viewer-layout-analysis": layoutAnalysisVisible }));
        setToolbarVisibility((current) => ({ ...current, "viewer-layout-analysis": layoutAnalysisVisible }));
      }
      if (!cancelled && typeof humanMockupVisible === "boolean") {
        setToolbarAvailability((current) => ({ ...current, "viewer-person": humanMockupVisible }));
        setToolbarVisibility((current) => ({ ...current, "viewer-person": humanMockupVisible }));
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!local.restore) return;
    const saved = local.restore;
    queueMicrotask(() => { setProjectRooms(saved.rooms); const room = saved.rooms[0]??emptyFloorRoom;setDemo(current => current ? { ...current, room } : current); });
  }, [local.restore]);

  useEffect(() => {
    let cancelled=false;
    queueMicrotask(()=>{
      if(cancelled)return;
      // A file replacement/reset starts a new editing session, even when its
      // persisted IDs are unchanged. No old selection, draft or drawing tool survives.
      setPlacement(null);setOpeningTool(null);setSelectedFloorOpening(null);
      setInsulationEditRequest(undefined);
      setRoofPreview(null);setBuildingError("");
      setViewerOpeningEditRequest(null);setViewerElementEditRequest(null);setViewerOpeningSyncRequest(null);
      setViewerRoomSelection(FULL_FLOORPLAN_SELECTION);setPendingViewerRoomSelection(FULL_FLOORPLAN_SELECTION);
      setAssetsOpen(false);setCatalogueOpen(false);setCatalogueManagerOpen(false);
      setLayoutResult(null);setAnalysisError(null);setRunningAnalysis(false);
    });
    return()=>{cancelled=true;};
  },[local.documentSession]);

  const markGenerated = local.generated;
  useEffect(() => {
    const project = local.project;
    if (!project || project.generated || !project.rooms.length || !project.floorplan?.rooms.length) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void Promise.all(project.rooms.map(room => fetch(`${API_URL}/rooms/validate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(room), signal: controller.signal }))).then(responses => { if (!controller.signal.aborted && responses.every(r => r.ok)) void markGenerated(); }).catch(() => undefined);
    }, 1200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [local.project, markGenerated]);

  const analysisIsStale = Boolean(layoutResult && demo && layoutResult.room_version !== demo.room.version);

  function invalidateAnalysis() {
    setLayoutResult(null);
    setAnalysisError(null);
  }

  function roomOptions(current: DemoResponse | null, rooms = projectRooms): Room[] {
    return current ? (rooms.length ? rooms : current.room.vertices.length ? [current.room] : []) : [];
  }

  function saveElectricalLayout(layout: typeof DEFAULT_ELECTRICAL_LAYOUT, rooms = roomOptions(demo)) {
    if (!local.project || !local.isScopeCurrent(scopeToken)) return;
    local.setElectricalLayout(normalizeElectricalLayout(layout, electricalObstacleIds(rooms)));
  }

  function openPlansDialog() {
    setAccountInitialSection("plans");
    setAccountOpen(true);
  }

  function beginPlacement(request: PlacementRequest) {
    setViewerElementEditRequest(null);
    setPlacement(request);
  }

  function openElectricalLayout() {
    setPlacement(null);
    setMode("EDITOR");
    setElectricalStatus(null);
    setElectricalLayoutRequest((request) => request + 1);
  }

  async function changeWorkspaceMode(nextMode: "FLOORPLAN" | "PLANNERBUILD" | "CLIMOPTIX") {
    if (nextMode === "CLIMOPTIX" && !climoptixEnabled) return;
    const request = ++workspaceRequest.current;
    let demoMode = false;
    if (nextMode === "PLANNERBUILD") {
      let available = false;
      if (CATALOGUE_MANAGER_AVAILABLE && tierPreview !== null) {
        available = includesPlannerBuild(tierPreview);
        demoMode = !available;
      } else {
        try {
          const summary = await commercialRequest<{ plan?: string; capabilities?: { canUsePlannerBuild?: boolean } }>("/summary");
          available = summary.capabilities?.canUsePlannerBuild === true;
          demoMode = !available;
        } catch {
          // Local planning and quotations must remain usable without account services.
          demoMode = true;
        }
      }
      // An older account lookup must never override a later workspace choice,
      // including a direct return from the shared service/source editors.
      if (request !== workspaceRequest.current) return;
      if (!available && !demoMode) {
        openPlansDialog();
        return;
      }
    }
    setPlacement(null);
    setPlannerBuildDemoMode(nextMode === "PLANNERBUILD" && demoMode);
    setWorkspaceMode(nextMode);
  }

  function resolveViewerRoom(current: DemoResponse | null, rooms = projectRooms, selection = viewerRoomSelection): Room | null {
    if (!current) return null;
    const options = roomOptions(current, rooms);
    if (selection === FULL_FLOORPLAN_SELECTION) return options.find((room) => room.id === current.room.id) ?? options[0] ?? current.room;
    return options.find((room) => room.id === selection) ?? current.room;
  }

  function applyPlanRooms(rooms: Room[]) {
    if(!local.isScopeCurrent(scopeToken))return;
      rooms = rooms.map(room => ({ ...room, obstacles: syncSupportedPeople(room.obstacles, roomOptions(demo).find(old => old.id === room.id)?.obstacles, room, placementWalls) }));
    setProjectRooms(rooms);
    saveElectricalLayout(local.project?.electricalLayout ?? DEFAULT_ELECTRICAL_LAYOUT, rooms);
    setDemo((current) => {
      if (!current) return current;
      const room = resolveViewerRoom(current, rooms);
      return room ? { ...current, room: normalizeRoomPerson(room) } : current;
    });
    invalidateAnalysis();
  }

  function applyElectricalImport(plan: ElectricalLayoutImportPlan) {
    if(!local.isScopeCurrent(scopeToken))return;
    const normalized = normalizeElectricalLayout(plan.electricalLayout, electricalObstacleIds(plan.rooms));
    const existingAssetIds = new Set(local.project?.assets.map((asset) => asset.assetId) ?? []);
    const assets = [...(local.project?.assets ?? []), ...plan.assets.filter((asset) => !existingAssetIds.has(asset.assetId))];
    setProjectRooms(plan.rooms);
    local.setElectricalProjectData(plan.rooms, normalized, plan.assetInstances, assets);
    setDemo((current) => {
      if (!current) return current;
      const room = plan.rooms.find((item) => item.id === current.room.id) ?? plan.rooms[0];
      return room ? { ...current, room: normalizeRoomPerson(room) } : current;
    });
    invalidateAnalysis();
  }

  function applyPlanRoom(room: Room) {
    if(!local.isScopeCurrent(scopeToken))return;
      room = { ...room, obstacles: syncSupportedPeople(room.obstacles, roomOptions(demo).find(old => old.id === room.id)?.obstacles, room, placementWalls) };
    const nextRooms = [...roomOptions(demo).filter(item => item.id !== room.id && item.source_floorplan_room_id !== room.source_floorplan_room_id), room];
    setProjectRooms(nextRooms);
    saveElectricalLayout(local.project?.electricalLayout ?? DEFAULT_ELECTRICAL_LAYOUT, nextRooms);
    setDemo(current => current ? { ...current, room } : current);
    invalidateAnalysis();
  }

  function applyObstacles(obstacles: Obstacle[], roomId?: string) {
    if(!local.isScopeCurrent(scopeToken))return;
    const target = roomId ? roomOptions(demo).find((room) => room.id === roomId) : resolveViewerRoom(demo);
    if (!target) return;
    const bounded = obstacles.flatMap(obstacle => {
      const previous = target.obstacles.find(item => item.id === obstacle.id);
      if (previous?.heating_spec && JSON.stringify(previous.dimensions) !== JSON.stringify(obstacle.dimensions)) obstacle = { ...obstacle, heating_spec: { ...obstacle.heating_spec ?? previous.heating_spec, ratedOutputW: null, manufacturerPerformanceData: [], performanceReference: undefined } };
      const geometryUnchanged = previous && JSON.stringify([previous.center,previous.dimensions,previous.rotation_deg,previous.wall_lock]) === JSON.stringify([obstacle.center,obstacle.dimensions,obstacle.rotation_deg,obstacle.wall_lock]);
      const next = geometryUnchanged ? obstacle : constrainObstacleToRoom(obstacle,target,obstacle.center,target.source_floorplan_room_id ? placementWalls : []);
      return next ? [next] : previous ? [previous] : [];
    });
    const beforeRooms = roomOptions(demo);
      const updated = { ...target, obstacles: syncSupportedPeople(bounded, target.obstacles, target, placementWalls), version: target.version + 1 };
    const nextRooms = beforeRooms.map((room) => room.id === target.id ? updated : room);
    saveElectricalLayout(local.project?.electricalLayout ?? DEFAULT_ELECTRICAL_LAYOUT, nextRooms);
    setDemo((current) => current ? { ...current, room: current.room.id === target.id ? updated : current.room } : current);
    setProjectRooms((rooms) => rooms.map((room) => room.id === target.id ? updated : room));
    invalidateAnalysis();
  }

  function moveElementToRoom(obstacle: Obstacle, roomId: string) {
    if(!local.isScopeCurrent(scopeToken))return false;
    const destination=roomOptions(demo).find(room=>room.id===roomId);
    if (!destination || !obstacleFitsInRoom(obstacle,destination,destination.source_floorplan_room_id ? placementWalls : [])) return false;
    const updated = transferObstacle(roomOptions(demo), obstacle, roomId);
    setProjectRooms(updated);
    setDemo(current => current ? {...current, room: updated.find(room => room.id === current.room.id) ?? current.room} : current);
    setViewerElementEditRequest(current => current?.id === obstacle.id ? {...current,roomId} : current);
    invalidateAnalysis();
    return true;
  }

  function commitPlacement(candidate: PlacementCandidate) {
    if (!placement) return;
    if (placement.commit) { if (placement.commit(candidate)) setPlacement(null); return; }
    if (!candidate.roomId) return;
    if (moveElementToRoom(candidate.obstacle,candidate.roomId)) setPlacement(null);
  }

  function applyStandaloneOpeningRoom(updated: Room) {
    if(!local.isScopeCurrent(scopeToken))return;
    setDemo(current => current && current.room.id === updated.id ? { ...current, room: updated } : current);
    setProjectRooms(rooms => rooms.map(room => room.id === updated.id ? updated : room));
    if (updated.source_floorplan_room_id) setViewerOpeningSyncRequest(current => ({ room: updated, requestId: (current?.requestId ?? 0) + 1 }));
    invalidateAnalysis();
  }

  function applyFinishes(finishes: RoomFinishes, roomId?: string) {
    if(!local.isScopeCurrent(scopeToken))return;
    const target = roomId ? roomOptions(demo).find((room) => room.id === roomId) : resolveViewerRoom(demo);
    if (!target) return;
    const updated = { ...target, finishes };
    setDemo((current) => current ? { ...current, room: current.room.id === target.id ? updated : current.room } : current);
    setProjectRooms((rooms) => rooms.map((room) => room.id === target.id ? updated : room));
  }

  function applyPerson(person: PersonMockup | null, roomId?: string) {
    if(!local.isScopeCurrent(scopeToken))return;
    const target = roomId ? roomOptions(demo).find((room) => room.id === roomId) : resolveViewerRoom(demo);
    if (!target) return;
    const updated = { ...target, person_mockup: person, version: target.version + 1 };
    setDemo((current) => current ? { ...current, room: current.room.id === target.id ? updated : current.room } : current);
    setProjectRooms((rooms) => rooms.map((room) => room.id === target.id ? updated : room));
    invalidateAnalysis();
  }

  function applyPersonVisibility(showClearance: boolean) {
    if(!local.isScopeCurrent(scopeToken))return;
    const target = resolveViewerRoom(demo);
    if (!target?.person_mockup) return;
    const updated = { ...target, person_mockup: { ...target.person_mockup, show_clearance: showClearance } };
    setDemo((current) => current ? { ...current, room: current.room.id === target.id ? updated : current.room } : current);
    setProjectRooms((rooms) => rooms.map((room) => room.id === target.id ? updated : room));
  }

  function toggleToolbar(id: ToolbarId) {
    if (!toolbarAvailability[id]) return;
    if (compactWorkspace) {
      const setTool = id.startsWith("floorplan-") ? setCompactEditorTool : setCompactViewerTool;
      setTool(current => current === id ? null : id);
      return;
    }
    setToolbarVisibility((current) => ({ ...current, [id]: !current[id] }));
  }

  function selectCompactTool(id: ToolbarId) {
    if (!compactWorkspace || !toolbarAvailability[id]) return;
    const setTool = id.startsWith("floorplan-") ? setCompactEditorTool : setCompactViewerTool;
    setTool(id);
  }

  const handleViewerElementSelected = useCallback((selection: { id: string; roomId: string } | null) => {
    if (!selection) {
      setViewerElementEditRequest(null);
      return;
    }
    const selectedObstacle = (demo ? (projectRooms.length ? projectRooms : [demo.room]) : []).find(room => room.id === selection.roomId)?.obstacles.find(obstacle => obstacle.id === selection.id);
    setViewerAddToPlanMode(selectedObstacle?.representation_key?.startsWith("balustrade-")?"BALUSTRADES":selectedObstacle?.representation_key?.startsWith("people-") ? "PEOPLE" : selectedObstacle?.representation_key?.startsWith("electrical-") ? "ELECTRICAL" : selectedObstacle && isHeatingElement(selectedObstacle) ? "HEATING" : "FURNITURE");
    setViewerOpeningEditRequest(null);
    setViewerElementEditRequest((current) => ({ ...selection, requestId: (current?.requestId ?? 0) + 1 }));
    setCompactViewerTool("viewer-analysis");
    setToolbarVisibility((current) => current["viewer-analysis"] ? current : { ...current, "viewer-analysis": true });
  }, [demo, projectRooms]);

  function enterViewer() {
    setPlacement(null);setOpeningTool(null);setSelectedFloorOpening(null); setViewerOpeningEditRequest(null); setViewerElementEditRequest(null); setMode("ANALYSIS");
    setViewerFitRequest((current) => current + 1);
  }

  function showAllToolbars() {
    if (compactWorkspace) { if (mode === "EDITOR") setCompactEditorTool("floorplan-build"); else setCompactViewerTool("viewer-view"); return; }
    const toolbars = mode === "EDITOR" ? FLOORPLAN_TOOLBARS : VIEWER_TOOLBARS;
    setFillToolbarLayout(true);
    setToolbarVisibility((current) => ({ ...current, ...Object.fromEntries(toolbars.filter((toolbar) => toolbarAvailability[toolbar.id]).map((toolbar) => [toolbar.id, true])) }));
    setToolbarLayoutResetKey((current) => current + 1);
  }

  function hideAllToolbars() {
    if (compactWorkspace) { if (mode === "EDITOR") setCompactEditorTool(null); else setCompactViewerTool(null); return; }
    const toolbars = mode === "EDITOR" ? FLOORPLAN_TOOLBARS : VIEWER_TOOLBARS;
    setFillToolbarLayout(false);
    setToolbarVisibility((current) => ({ ...current, ...Object.fromEntries(toolbars.map((toolbar) => [toolbar.id, false])) }));
  }

  async function openRoomFile(room: Room) {
    if (!Array.isArray(room.vertices) || !room.wall_height || !room.wall_thickness) throw new Error("This file is not a Renovation Fit room.");
    if (preferences.confirmBeforeOpen && !window.confirm("Replace the current working room with the selected file?")) return;
    const normalizedRoom = normalizeRoomPerson(room);
    const response = await fetch(`${API_URL}/rooms/validate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(normalizedRoom) });
    if (!response.ok) {
      const payload = await response.json() as { detail?: string };
      throw new Error(payload.detail ?? "The room geometry is invalid.");
    }
    if(!local.isScopeCurrent(scopeToken))throw new Error("The selected floor changed while opening this room. Select the intended floor and open the file again.");
    setDemo((current) => current ? { ...current, room: normalizedRoom } : current);
    // A matching restored outline must not override the finishes just opened from file.
    setProjectRooms((current) => current.map((existing) => existing.id === normalizedRoom.id || (normalizedRoom.source_floorplan_room_id && existing.source_floorplan_room_id === normalizedRoom.source_floorplan_room_id) ? normalizedRoom : existing));
    invalidateAnalysis();
  }

  function insertCatalogueItem(item: CatalogueItem) {
    // Openings need a parent wall and belong in the 2D Add elements editor;
    // they are not room obstacles and must never be inserted as fixtures.
    if (item.fixture_kind === "DOOR" || item.fixture_kind === "WINDOW") return;
    const target = resolveViewerRoom(demo);
    if (!target) return;
    const minX = Math.min(...target.vertices.map((point) => point.x));
    const maxX = Math.max(...target.vertices.map((point) => point.x));
    const minY = Math.min(...target.vertices.map((point) => point.y));
    const maxY = Math.max(...target.vertices.map((point) => point.y));
    const measured = (value: number): Measurement => ({ value, uncertainty_mm: 5, verified: false, source_type: item.category_id === "people" ? "USER_MEASURED" : "MANUFACTURER_DATASHEET" });
    const unalignedObstacle: Obstacle = {
      id: `fixture-${crypto.randomUUID().slice(0, 8)}`,
      person_spec: defaultPersonSpec(item.representation_key, item.height_mm),
      name: item.name,
      kind: item.plan_shape === "ELLIPSE" ? "CYLINDER" : "BOX",
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      dimensions: { width: measured(item.width_mm), depth: measured(item.depth_mm), height: measured(item.height_mm) },
      base_z_mm: item.representation_key?.startsWith("furniture-kitchen-cabinet-") ? 1500 : 0,
      rotation_deg: 0,
      source_type: item.category_id === "people" ? "USER_MEASURED" : "MANUFACTURER_DATASHEET",
      verified: false,
      fixture_kind: item.fixture_kind,
      model_id: item.id,
      heating_spec: item.heating_spec ?? (item.category_id.startsWith("heating") || item.category_id.startsWith("radiators-") ? emptyHeatingSpec(item.name) : undefined),
      plan_symbol_data_url: item.plan_symbol_data_url,
      representation_key: item.representation_key,
      plan_symbol_url: item.plan_symbol_url,
      subcategory: item.subcategory,
      color_hex: item.color_hex,
      // Keep free-standing items freely movable; users can opt into wall
      // adjacency in the Position controls when it is appropriate.
      wall_lock: DEFAULT_OBSTACLE_WALL_LOCK,
      stl_filename: item.stl_filename ?? undefined,
      stl_base64: item.stl_base64 ?? undefined,
      side_clearance_mm: item.side_clearance_mm ?? undefined,
      front_clearance_mm: item.front_clearance_mm ?? undefined,
      ...electricalPlacement(item.representation_key, item.height_mm, target.wall_height.value),
    };
    setPlacement({ id: unalignedObstacle.id, obstacle: unalignedObstacle });
  }

  async function runAnalysis() {
    const target = resolveViewerRoom(demo);
    if (!target) return;
    setRunningAnalysis(true);
    setAnalysisError(null);
    try {
      const response = await fetch(`${API_URL}/layout-checks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target),
      });
      if (!response.ok) throw new Error(await response.text());
      const result=await response.json() as LayoutResult;
      if(local.isScopeCurrent(scopeToken))setLayoutResult(result);
    } catch (reason) {
      if(local.isScopeCurrent(scopeToken))setAnalysisError(reason instanceof Error ? reason.message : "Analysis failed.");
    } finally {
      setRunningAnalysis(false);
    }
  }

  if (!demo || !local.project) {
    return <main className="loading-state"><Image className="brand-mark" src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/planner-build-icon.png`} alt="PlannerBuild" width={34} height={34} priority /><p className={styles.loadingHeading}>Opening your planner</p><p>{error ? `Backend unavailable: ${error}` : "Loading verified millimetre geometry…"}</p>{error && <button type="button" onClick={() => { setDemo(null); setError(null); setDemoLoadRequest((request) => request + 1); }}>Retry connection</button>}</main>;
  }

  const building=buildingOf(local.project),currentFloor=activeFloor(local.project),floors=projectFloors(local.project),floorIndex=floors.findIndex(f=>f.id===currentFloor.id),belowFloor=floors[floorIndex-1],topFloor=floors.at(-1)!;
  function restoreBuildingUi(p:ProjectDocument|null) { if(!p)return;setPlacement(null);setOpeningTool(null);setSelectedFloorOpening(null);setViewerOpeningEditRequest(null);setViewerElementEditRequest(null);setViewerRoomSelection(FULL_FLOORPLAN_SELECTION);setPendingViewerRoomSelection(FULL_FLOORPLAN_SELECTION);setProjectRooms(p.rooms);setDemo(current=>current?{...current,room:p.rooms[0]??emptyFloorRoom}:current);invalidateAnalysis(); }
  function editBuilding(operation:(p:ProjectDocument)=>ProjectDocument) { restoreBuildingUi(local.editBuilding(operation)); }
  function changeBuildingView(next:BuildingView) {
    if(next.roof&&!buildingView.roof&&currentFloor.id!==topFloor.id)next={...next,whole:true};
    if(!next.whole&&buildingView.whole&&currentFloor.id!==topFloor.id)next={...next,roof:false};
    setBuildingView(next);
  }
  function previewExterior() { setOpeningTool(null);setSelectedFloorOpening(null);setMode("ANALYSIS");setWallMode("SOLID");setBuildingView(v=>({...v,whole:true,roof:true})); }
  function startNewOutline(points:readonly {x:number;y:number}[]|null) {
    try {
      restoreBuildingUi(local.editBuilding(p=>resetBuildingOutline(p,points),true));
      setBuildingError("");setRoofPreview(null);
      setBuildingView(v=>({...v,whole:false,roof:false}));
    } catch(error) { setBuildingError(error instanceof Error?error.message:"Could not start a new outline."); }
  }
  function undoProject() { restoreBuildingUi(local.undo()); }
  function redoProject() { restoreBuildingUi(local.redo()); }
  function changeFloorOpenings(openings:FloorOpening[]) { editBuilding(p=>{const f=activeFloor(p),c=projectFloors(p).find(x=>x.id===f.id)!.content;for(const o of openings)validateFloorOpening(c,o,openings);return updateFloor(p,f.id,{openings});}); }
  const viewerRoomOptions = roomOptions(demo);
  const appliedViewerSelection = viewerRoomSelection === FULL_FLOORPLAN_SELECTION || viewerRoomOptions.some((room) => room.id === viewerRoomSelection) ? viewerRoomSelection : FULL_FLOORPLAN_SELECTION;
  const pendingSelection = pendingViewerRoomSelection === FULL_FLOORPLAN_SELECTION || viewerRoomOptions.some((room) => room.id === pendingViewerRoomSelection) ? pendingViewerRoomSelection : FULL_FLOORPLAN_SELECTION;
  const selectedViewerRoom = resolveViewerRoom(demo, projectRooms, appliedViewerSelection) ?? demo.room;
  const displayedViewerRooms = appliedViewerSelection === FULL_FLOORPLAN_SELECTION ? viewerRoomOptions : [selectedViewerRoom];

  function openViewerSelection() {
    setPlacement(null);
    const selection = pendingSelection;
    const target = resolveViewerRoom(demo, projectRooms, selection);
    if (!target) return;
    setViewerRoomSelection(selection);
    setPendingViewerRoomSelection(selection);
    setDemo((current) => current ? { ...current, room: normalizeRoomPerson(target) } : current);
    invalidateAnalysis();
  }

  return (
<EnergyLayoutProvider editRequest={insulationEditRequest} visible={workspaceMode === "FLOORPLAN" && mode === "EDITOR"} scopeKey={scopeToken} data={local.project.energyLayout ?? newEnergyProject()} onChange={next=>{if(local.isScopeCurrent(scopeToken))local.setEnergyLayout(next);}} onOpen={() => { setPlacement(null);setMode("EDITOR");setWorkspaceMode("FLOORPLAN"); }}><HeatingLayoutProvider visible={workspaceMode === "FLOORPLAN" && mode === "EDITOR"} scopeKey={scopeToken} data={local.project.heatingLayout ?? newHeatingProject()} rooms={local.project.rooms} onChange={next => { if(!local.isScopeCurrent(scopeToken))return;const rooms = local.setHeatingLayout(next); if (rooms) { setProjectRooms(rooms); setDemo(current => current ? { ...current, room: rooms.find(room => room.id === current.room.id) ?? current.room } : current); } }} onOpen={() => { setPlacement(null);setMode("EDITOR");setWorkspaceMode("FLOORPLAN"); }}><main className={`planner-workspace ${compactWorkspace ? "compact-workspace" : ""}`}>
      <UiTheme settings={uiSettings} />
      <header className="topbar">
        <div className="app-identity"><a className="brand" href="https://www.freefloorplan3d.com/" title="Return to FreeFloorplan3D website"><Image className="brand-mark" src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/planner-build-icon.png`} alt="FreeFloorplan3D" width={34} height={34} priority /><span>FreeFloorplan3D</span></a><ApplicationMenuBar onClimoptixMenuTarget={setCFDMenuTarget} buildingView={buildingView} onBuildingViewChange={changeBuildingView} roofAvailable={(roofPreview??building.roof).enabled!==false} onPrepareProject={local.prepareFile} onSaveProject={local.saveFile} onOpenProject={local.openFile} onOpenAssets={() => setAssetsOpen(true)} onOpenPrivacy={() => setPrivacyOpen(true)} room={demo.room} mode={mode} workspaceMode={workspaceMode} wallMode={wallMode} floorplanStyle={floorplanStyle} displayUnits={preferences.units} onDisplayUnitsChange={(units) => handlePreferencesChange({ ...appPreferences, units })} onOpenRoom={openRoomFile} onOpenCatalogue={() => setCatalogueOpen(true)} onOpenElectricalLayout={openElectricalLayout} onOpenCatalogueManager={(opener) => { setCatalogueManagerOpener(opener); setCatalogueManagerOpen(true); }} catalogueManagerAvailable={CATALOGUE_MANAGER_AVAILABLE} onWallModeChange={setWallMode} onFloorplanStyleChange={setFloorplanStyle} onExportFloorplan={() => setFloorplanExportRequest((current) => current + 1)} onSaveView={() => setViewerSaveViewRequest((current) => current + 1)} onAnnotate={() => setFloorplanAnnotateRequest((current) => current + 1)} onImportDrawing={handleImportDrawing} onOpenSettings={() => setSettingsOpen(true)} toolbars={mode === "EDITOR" ? FLOORPLAN_TOOLBARS : VIEWER_TOOLBARS} toolbarVisibility={visibleToolbars} toolbarAvailability={toolbarAvailability} onToggleToolbar={toggleToolbar} onShowAllToolbars={showAllToolbars} onHideAllToolbars={hideAllToolbars} /></div>
        <nav className="app-nav" aria-label="Project workflow">
          <label className="workspace-mode-control"><span className="workspace-mode-label">Workspace</span><select className="workspace-mode-select" aria-label="Workspace" value={workspaceMode} onChange={(event) => void changeWorkspaceMode(event.target.value as "FLOORPLAN" | "PLANNERBUILD" | "CLIMOPTIX")}><option value="FLOORPLAN">Floorplan</option><option value="PLANNERBUILD">PlannerBuild</option>{climoptixEnabled && <option value="CLIMOPTIX">Climoptix CFD</option>}</select></label>
          {workspaceMode !== "CLIMOPTIX" && <div className="app-nav-modes" role="group" aria-label={workspaceMode === "FLOORPLAN" ? "Floorplan view" : "PlannerBuild view"}>
            {workspaceMode === "FLOORPLAN" ? <>
              <button aria-pressed={mode === "EDITOR"} className={mode === "EDITOR" ? "active" : ""} onClick={() => { setPlacement(null); setViewerOpeningEditRequest(null); setViewerElementEditRequest(null); setMode("EDITOR"); }}>2D</button>
              <button aria-pressed={mode === "ANALYSIS"} className={mode === "ANALYSIS" ? "active" : ""} onClick={enterViewer}>3D</button>
            </> : <select className="workspace-mode-select planner-build-view-select" aria-label="PlannerBuild view" value={plannerBuildView} onChange={event => setPlannerBuildView(event.target.value as "GANTT" | "DASHBOARD" | "QUOTE")}><option value="GANTT">Gantt</option><option value="DASHBOARD">Dashboard</option><option value="QUOTE">Quote Generator</option></select>}
          </div>}
          <AccountStatusButton onOpen={() => { setAccountInitialSection("account"); setAccountOpen(true); }} />
        </nav>
      </header>

      <div className="local-save-status" role="status" title="Projects are saved in this browser. Download a .floorplan3d backup before clearing browser data.">{local.status}</div>
      {climoptixEnabled && insulationEditRequest && workspaceMode === "FLOORPLAN" && <div className="thermal-return-bar" role="region" aria-label="Return to thermal study"><span>Editing source insulation · {insulationEditRequest.elementId.split("|")[1]} · finish or cancel the layer editor before returning.</span><button onClick={() => { setInsulationEditRequest(undefined);setWorkspaceMode("CLIMOPTIX"); }}>Return to Climoptix</button></div>}
      {compactWorkspace && workspaceMode === "FLOORPLAN" && <nav className="compact-tool-switcher" aria-label="Workspace tools">
        {(mode === "EDITOR" ? [...FLOORPLAN_TOOLBARS, { id: "floorplan-coordinates" as const, name: "Coordinates" }] : VIEWER_TOOLBARS).filter(tool => toolbarAvailability[tool.id]).map(tool =>
          <button key={tool.id} type="button" aria-pressed={compactActiveTool === tool.id} onClick={() => selectCompactTool(tool.id)}>{({ "floorplan-build": "Build", "floorplan-openings": "Elements", "floorplan-view": "View", "floorplan-coordinates": "Coordinates", "viewer-analysis": "Elements", "viewer-layout-analysis": "Analysis", "viewer-person": "Person", "viewer-view": "View" })[tool.id]}</button>)}
      </nav>}
      <div className="building-plan-stage" data-dock-workspace="floorplan" hidden={workspaceMode!=="FLOORPLAN"}>
      {workspaceMode==="FLOORPLAN"&&<BuildingControls key={`${local.project.projectId}|${local.documentSession}`} project={local.project} onEdit={editBuilding} onUndo={undoProject} onRedo={redoProject} canUndo={local.canUndo} canRedo={local.canRedo} units={preferences.units} in3D={mode==="ANALYSIS"} view={buildingView} onView={changeBuildingView} tool={openingTool} onTool={setOpeningTool} keepOpeningSquare={keepFloorOpeningsSquare} onKeepOpeningSquare={setKeepFloorOpeningsSquare} onFinish={()=>setFinishOpening(x=>x+1)} selectedOpening={selectedFloorOpening} onSelectOpening={setSelectedFloorOpening} onRoofPreview={setRoofPreview} error={buildingError} onError={setBuildingError}/>}
<section className="environment-screen" hidden={workspaceMode !== "FLOORPLAN" || mode !== "EDITOR"} aria-hidden={workspaceMode !== "FLOORPLAN" || mode !== "EDITOR"}><FullFloorplanEditor onNewOutline={startNewOutline} supportFloor={belowFloor?.content} referenceFloor={buildingView.reference?belowFloor?.content:undefined} snapReference={buildingView.snap&&buildingView.reference} floorOpenings={currentFloor.openings} floorOpeningTool={openingTool} keepFloorOpeningsSquare={keepFloorOpeningsSquare} onFloorOpeningTool={setOpeningTool} selectedFloorOpening={selectedFloorOpening} onSelectFloorOpening={setSelectedFloorOpening} onFloorOpeningsChange={changeFloorOpenings} onBuildingError={setBuildingError} finishFloorOpeningRequest={finishOpening} roofProfile={topFloor.id===currentFloor.id?(roofPreview??building.roof):undefined} onProjectUndo={undoProject} onProjectRedo={redoProject} canProjectUndo={local.canUndo} canProjectRedo={local.canRedo} key={local.revision} initialFloorplan={local.restore?.floorplan} onPersistFloorplan={(plan,rooms)=>{const message=local.changeFloorplan(plan,rooms,scopeToken);if(message)setBuildingError(message);}} onPlacementWallsChange={setPlacementWalls} placement={mode === "EDITOR" ? placement : null} onBeginPlacement={beginPlacement} onCancelPlacement={() => setPlacement(null)} onCommitPlacement={commitPlacement} onTransferObstacle={moveElementToRoom} viewerOpeningRoom={projectRooms.find(room => room.id === viewerOpeningEditRequest?.roomId) ?? demo.room} onStandaloneRoomChange={applyStandaloneOpeningRoom} openingEditRequest={mode === "ANALYSIS" ? viewerOpeningEditRequest : null} externalOpeningSyncRequest={viewerOpeningSyncRequest} elementEditRequest={mode === "EDITOR" ? viewerElementEditRequest : null} onElementSelected={handlePlanElementSelected} openingEditorTarget={openingEditorTarget} projectRooms={projectRooms.length ? projectRooms : local.project.rooms} onPlanRoomChange={applyPlanRoom} onPlanRoomsChange={applyPlanRooms} apiUrl={API_URL} displayUnits={preferences.units} defaultCurrency={defaultCurrency} floorplanStyle={floorplanStyle} exportRequest={floorplanExportRequest} annotateRequest={floorplanAnnotateRequest} importFile={floorplanImportFile} activeSourceRoomId={demo.room.source_floorplan_room_id} fixtures={demo.room.obstacles} onFixturesChange={applyObstacles} toolbarVisibility={visibleToolbars} onToggleToolbar={toggleToolbar} toolbarLayoutResetKey={toolbarLayoutResetKey} fillToolbarLayout={fillToolbarLayout} electricalLayoutWindowRequest={electricalLayoutRequest} electricalLayout={local.project.electricalLayout ?? DEFAULT_ELECTRICAL_LAYOUT} onElectricalLayoutChange={saveElectricalLayout} electricalLimitStatus={electricalStatus} onElectricalLimitStatusChange={setElectricalStatus} projectName={local.project.name} electricalAssets={local.project.assets} electricalAssetInstances={local.project.assetInstances} onElectricalAssetInstancesChange={next=>{if(local.isScopeCurrent(scopeToken))local.setInstances(next);}} onApplyElectricalImport={applyElectricalImport} /></section>
      {workspaceMode === "FLOORPLAN" && mode === "ANALYSIS" ? (
        <section className="analysis-workspace">
<EngineeringViewer buildingProject={local.project} buildingView={buildingView} onBuildingViewChange={changeBuildingView} onExteriorView={previewExterior} roofPreview={roofPreview??undefined} assetInstances={local.project?.assetInstances ?? []} placementWalls={displayedViewerRooms.some(room=>room.source_floorplan_room_id) ? placementWalls : []} placement={placement} onCancelPlacement={() => setPlacement(null)} onCommitPlacement={commitPlacement} onTransferObstacle={moveElementToRoom} key={`engineering-viewer-${appliedViewerSelection}-${selectedViewerRoom.id}-${local.project?.projectId}-${local.revision}`} apiUrl={API_URL} room={selectedViewerRoom} sceneRooms={displayedViewerRooms} roomSelection={pendingSelection} roomSelectionOptions={projectRooms} fullFloorplanSelection={FULL_FLOORPLAN_SELECTION} onRoomSelectionChange={setPendingViewerRoomSelection} onOpenRoomSelection={openViewerSelection} collisionIds={layoutResult?.collision_ids ?? []} onObstaclesChange={applyObstacles} onFinishesChange={applyFinishes} onPersonChange={applyPerson} onOpeningSelected={handleViewerOpeningSelected} onElementSelected={handleViewerElementSelected} wallMode={wallMode} toolbarVisibility={visibleToolbars} toolbarAvailability={toolbarAvailability} onToggleToolbar={toggleToolbar} toolbarLayoutResetKey={toolbarLayoutResetKey} fillToolbarLayout={fillToolbarLayout} fitRequest={viewerFitRequest} saveViewRequest={viewerSaveViewRequest} renderCamera={local.project?.renderCamera} onRenderCameraChange={local.setRenderCamera} />
          {viewerOpeningEditRequest && <FloatingToolbar title="Edit door or window" defaultPosition={{ x: 790, y: 200 }} dock={{ side: "RIGHT", slot: 2, slots: 3 }} layoutResetKey={toolbarLayoutResetKey} maxHeight={650} onClose={() => setViewerOpeningEditRequest(null)}><div ref={setOpeningEditorTarget} /></FloatingToolbar>}
          {visibleToolbars["viewer-analysis"] && <FloatingToolbar title="Add elements" defaultPosition={{ x: 18, y: 112 }} dock={fillToolbarLayout ? positionedToolbarDock("RIGHT", 8, undefined, 340) : { side: "LEFT", slot: 1, slots: 3 }} layoutResetKey={toolbarLayoutResetKey} maxHeight={760} onClose={() => { setViewerElementEditRequest(null); toggleToolbar("viewer-analysis"); }}><aside className="evidence-panel floating-evidence-panel">
            <div className="viewer-add-elements-panel">
              <select className="add-to-plan-mode" aria-label="Add to plan" value={viewerAddToPlanMode} onChange={event => { setPlacement(null); setViewerElementEditRequest(null); setViewerOpeningEditRequest(null); setViewerAddToPlanMode(event.target.value as AddToPlanMode); }}>
                {ADD_TO_PLAN_MODES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              {viewerAddToPlanMode === "DOOR" || viewerAddToPlanMode === "WINDOW" ? <ViewerOpeningEditor
                key={`${viewerAddToPlanMode}-${selectedViewerRoom.id}`}
                kind={viewerAddToPlanMode}
                room={selectedViewerRoom}
                apiUrl={API_URL}
                refreshKey={Number(catalogueOpen) + Number(catalogueManagerOpen)}
                displayUnits={preferences.units}
                onRoomChange={applyStandaloneOpeningRoom}
                onBeginPlacement={beginPlacement}
                onEditOpening={handleViewerOpeningSelected}
                placementWalls={placementWalls}
              /> : <CatalogueFixtureEditor
                key={`viewer-${viewerAddToPlanMode}-${selectedViewerRoom.id}-${viewerElementEditRequest?.requestId ?? "new"}`}
                apiUrl={API_URL}
                refreshKey={Number(catalogueOpen) + Number(catalogueManagerOpen)}
                categoryFilter={viewerAddToPlanMode === "BALUSTRADES"?"balustrades":viewerAddToPlanMode === "PEOPLE" ? "people" : viewerAddToPlanMode === "ELECTRICAL" ? "electric" : viewerAddToPlanMode === "HEATING" ? "heating" : undefined}
                room={selectedViewerRoom}
                displayUnits={preferences.units}
                onChange={obstacles => applyObstacles(obstacles, selectedViewerRoom.id)}
                elementEditRequest={viewerElementEditRequest?.roomId === selectedViewerRoom.id ? viewerElementEditRequest : null}
                onEditEnd={() => handleViewerElementSelected(null)}
                onElementSelected={handleViewerElementSelected}
                placementWalls={placementWalls}
                onBeginPlacement={beginPlacement}
              />}
            </div>
          </aside></FloatingToolbar>}
          {visibleToolbars["viewer-layout-analysis"] && <FloatingToolbar title="Layout analysis" defaultPosition={{ x: 380, y: 112 }} dock={fillToolbarLayout ? positionedToolbarDock("RIGHT", "calc(50% + 4px)", undefined, 340) : { side: "RIGHT", slot: 1, slots: 3 }} layoutResetKey={toolbarLayoutResetKey} maxHeight={650} onClose={() => toggleToolbar("viewer-layout-analysis")}><aside className="evidence-panel floating-evidence-panel">
            {(!layoutResult || analysisIsStale) && (
              <div className="stale-analysis">
                <strong>{analysisIsStale ? "Room layout changed" : "Layout ready for analysis"}</strong>
                <p>Check placed elements and the optional person against the room, clearances and door swings.</p>
                <button onClick={runAnalysis} disabled={runningAnalysis}>{runningAnalysis ? "Running checks…" : "Run layout analysis"}</button>
                {analysisError && <span>{analysisError}</span>}
              </div>
            )}

            {layoutResult && !analysisIsStale && (
              <>
                <div className={`result-summary status-${layoutResult.status.toLowerCase()}`}>
                  <div className="result-label"><span>{layoutResult.status}</span><small>ENGINE v{layoutResult.engine_version}</small></div>
                  <p>{layoutResult.summary.replace(`${layoutResult.status} — `, "")}</p>
                </div>
                <div className="metric-grid">
                  <div><span>Placed elements</span><strong>{demo.room.obstacles.length}</strong></div>
                  <div><span>Room height</span><strong>{formatLength(demo.room.wall_height.value, preferences.units)}</strong></div>
                  <div><span>Wall thickness</span><strong>{formatLength(demo.room.wall_thickness.value, preferences.units)}</strong></div>
                  <div><span>Room topology</span><strong>{demo.room.vertices.length} <small>walls</small></strong></div>
                </div>
                <div className="checks-heading"><h2>Individual checks</h2><span>{layoutResult.checks.length} rules</span></div>
                <div className="checks-list">
                  {layoutResult.checks.map((check) => (
                    <article key={check.check_id} className={`check check-${check.status.toLowerCase()}`}>
                      <span className="check-status">{check.status}</span>
                      <div><h3>{check.check_id.replaceAll("-", " ").replaceAll(":", " · ")}</h3><p>{formatMeasurementText(check.explanation, preferences.units)}</p></div>
                      {check.margin_mm !== undefined && check.margin_mm !== null && <code>{check.margin_mm >= 0 ? "+" : "−"}{formatLength(Math.abs(check.margin_mm), preferences.units)}</code>}
                    </article>
                  ))}
                </div>
              </>
            )}
          </aside></FloatingToolbar>}
          {visibleToolbars["viewer-person"] && <FloatingToolbar title="Human mock-up" defaultPosition={{ x: 430, y: 18 }} dock={fillToolbarLayout ? positionedToolbarDock("LEFT", "calc(clamp(166px, 14%, 174px) + clamp(300px, 43%, 494px) + 8px)", undefined, 340) : { side: "LEFT", slot: 2, slots: 3 }} layoutResetKey={toolbarLayoutResetKey} maxHeight={620} onClose={() => toggleToolbar("viewer-person")}><PersonEditor key={`person-editor-${demo.room.id}-${demo.room.version}`} room={demo.room} displayUnits={preferences.units} onChange={applyPerson} onVisibilityChange={applyPersonVisibility} /></FloatingToolbar>}
          <footer className="viewer-warning"><strong>Engineering view</strong><span>Browser geometry is informational. Layout decisions are calculated by the backend kernel.</span></footer>
        </section>
      ) : null}
      </div>
      {climoptixEnabled && <section className="climoptix-screen" hidden={workspaceMode!=="CLIMOPTIX"} aria-hidden={workspaceMode!=="CLIMOPTIX"}><ClimoptixWorkspace active={workspaceMode==="CLIMOPTIX"} key={`${local.project.projectId}|${local.documentSession}`} project={local.project} apiUrl={API_URL} menuTarget={cfdMenuTarget} onChange={(next,checkpoint,groups)=>local.setCFDScenarios(next,scopeToken,checkpoint,groups)} onUndo={undoProject} onRedo={redoProject} canUndo={local.canUndo} canRedo={local.canRedo} onEditBuilding={()=>{setPlacement(null);setMode("EDITOR");void changeWorkspaceMode("FLOORPLAN");}} onEditInsulation={(face, constructionScenario) => { editBuilding(p => { const next=selectFloor(p,face.floorId);return {...next,energyLayout:{...(next.energyLayout??newEnergyProject()),activeScenarioId:constructionScenario}}; });setInsulationEditRequest({id:crypto.randomUUID(),elementId:face.elementId,pointMm:[face.centroidMm[0],face.centroidMm[1]]});setPlacement(null);setMode("EDITOR");setWorkspaceMode("FLOORPLAN"); }}/></section>}
      <section className="planner-build-screen" hidden={workspaceMode !== "PLANNERBUILD"} aria-hidden={workspaceMode !== "PLANNERBUILD"}>{local.project ? <PlannerBuildWorkspace project={local.project} view={plannerBuildView} displayUnits={preferences.units} defaultCurrency={defaultCurrency} onQuotesChange={local.setQuotes} onSaveQuotes={local.saveQuotes} onActivitiesChange={(activities) => local.setPlannerBuild({ ...(local.project?.plannerBuild ?? { activities: [] }), activities })} demoMode={plannerBuildDemoMode} onDemoLimitReached={openPlansDialog} /> : <p className="pb-loading-state" role="status">Loading project data…</p>}</section>
{placement && <div className="placement-status" role="status"><strong>Placing {placement.obstacle.name}</strong><span><span className="placement-hint-desktop">Click to place · Esc or right-click to cancel{!placement.opening && (requiresWallMount(placement.obstacle) ? " · Snaps and aligns to a wall" : " · R to rotate")}</span><span className="placement-hint-touch">Tap to place</span></span><button type="button" className="review-style-button" onClick={() => setPlacement(null)}>Cancel</button></div>}
      {assetsOpen && local.project && <LocalAssetLibrary assets={local.project.assets} instances={local.project.assetInstances} apiUrl={API_URL} onImport={asset=>{if(local.isScopeCurrent(scopeToken))local.addAsset(asset);}} onChange={next=>{if(local.isScopeCurrent(scopeToken))local.setInstances(next);}} onClose={() => setAssetsOpen(false)} />}
      {privacyOpen && <PlannerPrivacyDialog onClose={() => setPrivacyOpen(false)} />}
      {accountOpen && <AccountDialog onClose={closeAccountDialog} initialSection={accountInitialSection} />}
      <CatalogueBrowser apiUrl={API_URL} open={catalogueOpen} displayUnits={preferences.units} onClose={() => setCatalogueOpen(false)} onInsert={insertCatalogueItem} />
      {CATALOGUE_MANAGER_AVAILABLE && <CatalogueManager apiUrl={API_URL} open={catalogueManagerOpen} opener={catalogueManagerOpener} layoutAnalysisToolbarVisible={toolbarAvailability["viewer-layout-analysis"]} onLayoutAnalysisToolbarVisibleChange={setLayoutAnalysisToolbarVisible} humanMockupToolbarVisible={toolbarAvailability["viewer-person"]} onHumanMockupToolbarVisibleChange={setHumanMockupToolbarVisible} uiSettings={uiSettings} onUiSettingsChange={setUiSettings} tierPreview={tierPreview} onTierPreviewChange={setTierPreview} onClose={() => setCatalogueManagerOpen(false)} />}
      <SettingsDialog open={settingsOpen} preferences={appPreferences} onChange={handlePreferencesChange} onClose={() => setSettingsOpen(false)} />
    </main></HeatingLayoutProvider></EnergyLayoutProvider>
  );
}
