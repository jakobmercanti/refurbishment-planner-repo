"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useCompactWorkspace } from "@/lib/useCompactWorkspace";
import { useLocalProject } from "@/lib/useLocalProject";
import { PlannerPrivacyDialog } from "@/components/PlannerPrivacyDialog";
import { LocalAssetLibrary } from "@/components/LocalAssetLibrary";
import starterDemo from "@/lib/starterDemo.json";
import { EngineeringViewer } from "@/components/EngineeringViewer";
import { ApplicationMenuBar } from "@/components/ApplicationMenuBar";
import { CatalogueBrowser } from "@/components/CatalogueBrowser";
import { CatalogueManager } from "@/components/CatalogueManager";
import { UiTheme, type SoftwareUi } from "@/components/UiTheme";
import { CatalogueFixtureEditor } from "@/components/CatalogueFixtureEditor";
import { FullFloorplanEditor } from "@/components/FullFloorplanEditor";
import { FloatingToolbar, positionedToolbarDock } from "@/components/FloatingToolbar";
import { PersonEditor } from "@/components/PersonEditor";
import { constrainObstacleToRoom, obstacleFitsInRoom, transferObstacle, type PlacementCandidate, type PlacementRequest, type PlacementWall } from "@/lib/elementPlacement";
import { normalizeRoomPerson } from "@/lib/person";
import { type AppPreferences, SettingsDialog } from "@/components/SettingsDialog";
import type { CatalogueItem, DemoResponse, LayoutResult, Measurement, Obstacle, PersonMockup, Room, RoomFinishes, WallViewMode } from "@/lib/types";
import { formatLength, formatMeasurementText } from "@/lib/units";
import type { FloorplanStyle } from "@/lib/floorplanStyles";
import { DEFAULT_TOOLBAR_AVAILABILITY, DEFAULT_TOOLBAR_VISIBILITY, FLOORPLAN_TOOLBARS, VIEWER_TOOLBARS, type ToolbarId, type ToolbarVisibility } from "@/lib/toolbars";

// Keep browser requests on the frontend origin. Next.js proxies these calls to
// the private local engineering backend, so phones on the LAN never try to use
// their own `localhost:8000`.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/engineering-api";
const FULL_FLOORPLAN_SELECTION = "__FULL_FLOORPLAN__";
// Catalogue administration changes the software's master configuration and is
// intentionally available only while an administrator runs a development build.
const CATALOGUE_MANAGER_AVAILABLE = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_ENABLE_PROGRAMMER_TOOLS === "true";

export default function Home() {
  const local = useLocalProject();
  const compactWorkspace = useCompactWorkspace();
  const [compactEditorTool, setCompactEditorTool] = useState<ToolbarId | null>("floorplan-build");
  const [compactViewerTool, setCompactViewerTool] = useState<ToolbarId | null>("viewer-view");
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [placementWalls,setPlacementWalls]=useState<PlacementWall[]>([]);
  const [placement, setPlacement] = useState<PlacementRequest | null>(null);
  useEffect(() => {
    if (!placement) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setPlacement(null); return; }
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key.toLowerCase() === "r" && !placement.opening) {
        event.preventDefault();
        setPlacement(current => current ? {...current, obstacle:{...current.obstacle, wall_lock:false, rotation_deg:(current.obstacle.rotation_deg+(event.shiftKey?-90:90)+360)%360}} : null);
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [placement]);
  const [uiSettings, setUiSettings] = useState<SoftwareUi | null>(null);
  const [demo, setDemo] = useState<DemoResponse | null>(null);
  const [mode, setMode] = useState<"EDITOR" | "ANALYSIS">("EDITOR");
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wallMode, setWallMode] = useState<WallViewMode>("SOLID");
  const [floorplanStyle, setFloorplanStyle] = useState<FloorplanStyle>("DEFAULT");
  const [floorplanExportRequest, setFloorplanExportRequest] = useState(0);
  const [floorplanAnnotateRequest, setFloorplanAnnotateRequest] = useState(0);
  const [viewerSaveViewRequest, setViewerSaveViewRequest] = useState(0);
  const [floorplanImportFile, setFloorplanImportFile] = useState<File | null>(null);
  const [preferences, setPreferences] = useState<AppPreferences>({ density: "COMFORTABLE", confirmBeforeOpen: true, units: "MM" });
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
  const [openingEditorTarget, setOpeningEditorTarget] = useState<HTMLDivElement | null>(null);
  const handleViewerOpeningSelected = useCallback((selection: { id: string; roomId: string } | null) => {
    if (selection) setViewerElementEditRequest(null);
    setViewerOpeningEditRequest(current => selection ? { ...selection, requestId: (current?.requestId ?? 0) + 1 } : null);
  }, []);
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
    queueMicrotask(() => { setProjectRooms(saved.rooms); const room = saved.rooms[0]; if (room) setDemo(current => current ? { ...current, room } : current); });
  }, [local.restore]);

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
    return current ? (rooms.length ? rooms : [current.room]) : [];
  }

  function resolveViewerRoom(current: DemoResponse | null, rooms = projectRooms, selection = viewerRoomSelection): Room | null {
    if (!current) return null;
    const options = roomOptions(current, rooms);
    if (selection === FULL_FLOORPLAN_SELECTION) return options.find((room) => room.id === current.room.id) ?? options[0] ?? current.room;
    return options.find((room) => room.id === selection) ?? current.room;
  }

  function applyPlanRooms(rooms: Room[]) {
    setProjectRooms(rooms);
    setDemo((current) => {
      if (!current) return current;
      const room = resolveViewerRoom(current, rooms);
      return room ? { ...current, room: normalizeRoomPerson(room) } : current;
    });
    invalidateAnalysis();
  }

  function applyPlanRoom(room: Room) {
    setProjectRooms(current => [...current.filter(item => item.source_floorplan_room_id !== room.source_floorplan_room_id), room]);
    setDemo(current => current ? { ...current, room } : current);
    invalidateAnalysis();
  }

  function applyObstacles(obstacles: Obstacle[], roomId?: string) {
    const target = roomId ? roomOptions(demo).find((room) => room.id === roomId) : resolveViewerRoom(demo);
    if (!target) return;
    const bounded = obstacles.flatMap(obstacle => {
      const previous = target.obstacles.find(item => item.id === obstacle.id);
      const geometryUnchanged = previous && JSON.stringify([previous.center,previous.dimensions,previous.rotation_deg,previous.wall_lock]) === JSON.stringify([obstacle.center,obstacle.dimensions,obstacle.rotation_deg,obstacle.wall_lock]);
      const next = geometryUnchanged ? obstacle : constrainObstacleToRoom(obstacle,target,obstacle.center,target.source_floorplan_room_id ? placementWalls : []);
      return next ? [next] : previous ? [previous] : [];
    });
    const updated = { ...target, obstacles: bounded, version: target.version + 1 };
    setDemo((current) => current ? { ...current, room: current.room.id === target.id ? updated : current.room } : current);
    setProjectRooms((rooms) => rooms.map((room) => room.id === target.id ? updated : room));
    invalidateAnalysis();
  }

  function moveElementToRoom(obstacle: Obstacle, roomId: string) {
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
    setDemo(current => current && current.room.id === updated.id ? { ...current, room: updated } : current);
    setProjectRooms(rooms => rooms.map(room => room.id === updated.id ? updated : room));
    invalidateAnalysis();
  }

  function applyFinishes(finishes: RoomFinishes, roomId?: string) {
    const target = roomId ? roomOptions(demo).find((room) => room.id === roomId) : resolveViewerRoom(demo);
    if (!target) return;
    const updated = { ...target, finishes };
    setDemo((current) => current ? { ...current, room: current.room.id === target.id ? updated : current.room } : current);
    setProjectRooms((rooms) => rooms.map((room) => room.id === target.id ? updated : room));
  }

  function applyPerson(person: PersonMockup | null, roomId?: string) {
    const target = roomId ? roomOptions(demo).find((room) => room.id === roomId) : resolveViewerRoom(demo);
    if (!target) return;
    const updated = { ...target, person_mockup: person, version: target.version + 1 };
    setDemo((current) => current ? { ...current, room: current.room.id === target.id ? updated : current.room } : current);
    setProjectRooms((rooms) => rooms.map((room) => room.id === target.id ? updated : room));
    invalidateAnalysis();
  }

  function applyPersonVisibility(showClearance: boolean) {
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
    setViewerOpeningEditRequest(null);
    setViewerElementEditRequest((current) => ({ ...selection, requestId: (current?.requestId ?? 0) + 1 }));
    setCompactViewerTool("viewer-analysis");
    setToolbarVisibility((current) => current["viewer-analysis"] ? current : { ...current, "viewer-analysis": true });
  }, []);

  function enterViewer() {
    setPlacement(null); setViewerOpeningEditRequest(null); setViewerElementEditRequest(null); setMode("ANALYSIS");
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
    const measured = (value: number): Measurement => ({ value, uncertainty_mm: 5, verified: false, source_type: "MANUFACTURER_DATASHEET" });
    const unalignedObstacle: Obstacle = {
      id: `fixture-${crypto.randomUUID().slice(0, 8)}`,
      name: item.name,
      kind: item.plan_shape === "ELLIPSE" ? "CYLINDER" : "BOX",
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      dimensions: { width: measured(item.width_mm), depth: measured(item.depth_mm), height: measured(item.height_mm) },
      base_z_mm: item.representation_key?.startsWith("furniture-kitchen-cabinet-") ? 1500 : 0,
      rotation_deg: 0,
      source_type: "MANUFACTURER_DATASHEET",
      verified: false,
      fixture_kind: item.fixture_kind,
      model_id: item.id,
      plan_symbol_data_url: item.plan_symbol_data_url,
      representation_key: item.representation_key,
      plan_symbol_url: item.plan_symbol_url,
      subcategory: item.subcategory,
      color_hex: item.color_hex,
      // New catalogue items should begin adjacent to a wall. Users can opt out
      // from the selected-element controls after placement.
      wall_lock: true,
      stl_filename: item.stl_filename ?? undefined,
      stl_base64: item.stl_base64 ?? undefined,
      side_clearance_mm: item.side_clearance_mm ?? undefined,
      front_clearance_mm: item.front_clearance_mm ?? undefined,
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
      setLayoutResult(await response.json() as LayoutResult);
    } catch (reason) {
      setAnalysisError(reason instanceof Error ? reason.message : "Analysis failed.");
    } finally {
      setRunningAnalysis(false);
    }
  }

  if (!demo || !local.project) {
    return <main className="loading-state"><Image className="brand-mark" src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/planner-build-icon.png`} alt="PlannerBuild" width={34} height={34} priority /><h1>Opening your planner</h1><p>{error ? `Backend unavailable: ${error}` : "Loading verified millimetre geometry…"}</p>{error && <button type="button" onClick={() => { setDemo(null); setError(null); setDemoLoadRequest((request) => request + 1); }}>Retry connection</button>}</main>;
  }

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
    <main className={`planner-workspace ${compactWorkspace ? "compact-workspace" : ""} ${preferences.density === "COMPACT" ? "density-compact" : ""}`}>
      <UiTheme settings={uiSettings} />
      <header className="topbar">
        <div className="app-identity"><a className="brand" href="https://www.freefloorplan3d.com/" title="Return to FreeFloorplan3D website"><Image className="brand-mark" src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/planner-build-icon.png`} alt="FreeFloorplan3D" width={34} height={34} priority /><span>FreeFloorplan3D</span></a><ApplicationMenuBar onPrepareProject={local.prepareFile} onSaveProject={local.saveFile} onOpenProject={local.openFile} onOpenAssets={() => setAssetsOpen(true)} onOpenPrivacy={() => setPrivacyOpen(true)} room={demo.room} mode={mode} wallMode={wallMode} floorplanStyle={floorplanStyle} displayUnits={preferences.units} onOpenRoom={openRoomFile} onOpenCatalogue={() => setCatalogueOpen(true)} onOpenCatalogueManager={(opener) => { setCatalogueManagerOpener(opener); setCatalogueManagerOpen(true); }} catalogueManagerAvailable={CATALOGUE_MANAGER_AVAILABLE} onWallModeChange={setWallMode} onFloorplanStyleChange={setFloorplanStyle} onExportFloorplan={() => setFloorplanExportRequest((current) => current + 1)} onSaveView={() => setViewerSaveViewRequest((current) => current + 1)} onAnnotate={() => setFloorplanAnnotateRequest((current) => current + 1)} onImportDrawing={handleImportDrawing} onOpenSettings={() => setSettingsOpen(true)} toolbars={mode === "EDITOR" ? FLOORPLAN_TOOLBARS : VIEWER_TOOLBARS} toolbarVisibility={visibleToolbars} toolbarAvailability={toolbarAvailability} onToggleToolbar={toggleToolbar} onShowAllToolbars={showAllToolbars} onHideAllToolbars={hideAllToolbars} /></div>
        <nav className="app-nav" aria-label="Project workflow">
          <button aria-pressed={mode === "EDITOR"} className={mode === "EDITOR" ? "active" : ""} onClick={() => { setPlacement(null); setViewerOpeningEditRequest(null); setViewerElementEditRequest(null); setMode("EDITOR"); }}>2D</button>
          <button aria-pressed={mode === "ANALYSIS"} className={mode === "ANALYSIS" ? "active" : ""} onClick={enterViewer}>3D</button>
          <a className="app-nav-entry" href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/account/`}>Account</a>
        </nav>
      </header>

      <div className="local-save-status" role="status" title="Projects are saved in this browser. Download a .floorplan3d backup before clearing browser data.">{local.status}</div>
      {compactWorkspace && <nav className="compact-tool-switcher" aria-label="Workspace tools">
        {(mode === "EDITOR" ? [...FLOORPLAN_TOOLBARS, { id: "floorplan-coordinates" as const, name: "Coordinates" }] : VIEWER_TOOLBARS).filter(tool => toolbarAvailability[tool.id]).map(tool =>
          <button key={tool.id} type="button" aria-pressed={compactActiveTool === tool.id} onClick={() => selectCompactTool(tool.id)}>{({ "floorplan-build": "Build", "floorplan-openings": "Elements", "floorplan-view": "View", "floorplan-coordinates": "Coordinates", "viewer-analysis": "Elements", "viewer-layout-analysis": "Analysis", "viewer-person": "Person", "viewer-view": "View" })[tool.id]}</button>)}
      </nav>}
      <section className="environment-screen" hidden={mode !== "EDITOR"} aria-hidden={mode !== "EDITOR"}><FullFloorplanEditor key={local.revision} initialFloorplan={local.restore?.floorplan} onPersistFloorplan={local.changeFloorplan} onPlacementWallsChange={setPlacementWalls} placement={mode === "EDITOR" ? placement : null} onBeginPlacement={setPlacement} onCancelPlacement={() => setPlacement(null)} onCommitPlacement={commitPlacement} onTransferObstacle={moveElementToRoom} viewerOpeningRoom={projectRooms.find(room => room.id === viewerOpeningEditRequest?.roomId) ?? demo.room} onStandaloneRoomChange={applyStandaloneOpeningRoom} openingEditRequest={mode === "ANALYSIS" ? viewerOpeningEditRequest : null} elementEditRequest={mode === "EDITOR" ? viewerElementEditRequest : null} onElementSelected={handlePlanElementSelected} openingEditorTarget={openingEditorTarget} projectRooms={projectRooms} onPlanRoomChange={applyPlanRoom} onPlanRoomsChange={applyPlanRooms} apiUrl={API_URL} displayUnits={preferences.units} floorplanStyle={floorplanStyle} exportRequest={floorplanExportRequest} annotateRequest={floorplanAnnotateRequest} importFile={floorplanImportFile} activeSourceRoomId={demo.room.source_floorplan_room_id} fixtures={demo.room.obstacles} onFixturesChange={applyObstacles} toolbarVisibility={visibleToolbars} onToggleToolbar={toggleToolbar} toolbarLayoutResetKey={toolbarLayoutResetKey} fillToolbarLayout={fillToolbarLayout} /></section>
      {mode === "ANALYSIS" ? (
        <section className="analysis-workspace">
          <EngineeringViewer assetInstances={local.project?.assetInstances ?? []} placementWalls={displayedViewerRooms.some(room=>room.source_floorplan_room_id) ? placementWalls : []} placement={placement} onCancelPlacement={() => setPlacement(null)} onCommitPlacement={commitPlacement} onTransferObstacle={moveElementToRoom} key={`engineering-viewer-${appliedViewerSelection}-${selectedViewerRoom.id}`} apiUrl={API_URL} room={selectedViewerRoom} sceneRooms={displayedViewerRooms} roomSelection={pendingSelection} roomSelectionOptions={projectRooms} fullFloorplanSelection={FULL_FLOORPLAN_SELECTION} onRoomSelectionChange={setPendingViewerRoomSelection} onOpenRoomSelection={openViewerSelection} collisionIds={layoutResult?.collision_ids ?? []} onObstaclesChange={applyObstacles} onFinishesChange={applyFinishes} onPersonChange={applyPerson} onOpeningSelected={handleViewerOpeningSelected} onElementSelected={handleViewerElementSelected} wallMode={wallMode} toolbarVisibility={visibleToolbars} toolbarAvailability={toolbarAvailability} onToggleToolbar={toggleToolbar} toolbarLayoutResetKey={toolbarLayoutResetKey} fillToolbarLayout={fillToolbarLayout} fitRequest={viewerFitRequest} saveViewRequest={viewerSaveViewRequest} />
          {viewerOpeningEditRequest && <FloatingToolbar title="Edit door or window" defaultPosition={{ x: 790, y: 200 }} dock={{ side: "RIGHT", slot: 2, slots: 3 }} layoutResetKey={toolbarLayoutResetKey} maxHeight={650} onClose={() => setViewerOpeningEditRequest(null)}><div ref={setOpeningEditorTarget} /></FloatingToolbar>}
          {visibleToolbars["viewer-analysis"] && <FloatingToolbar title="Add elements" defaultPosition={{ x: 18, y: 112 }} dock={fillToolbarLayout ? positionedToolbarDock("RIGHT", 8, undefined, 340) : { side: "LEFT", slot: 1, slots: 3 }} layoutResetKey={toolbarLayoutResetKey} maxHeight={760} onClose={() => { setViewerElementEditRequest(null); toggleToolbar("viewer-analysis"); }}><aside className="evidence-panel floating-evidence-panel">
            <CatalogueFixtureEditor key={`${(projectRooms.find(room => room.id === viewerElementEditRequest?.roomId) ?? demo.room).id}-${viewerElementEditRequest?.requestId ?? "new"}`} apiUrl={API_URL} refreshKey={Number(catalogueOpen) + Number(catalogueManagerOpen)} room={projectRooms.find(room => room.id === viewerElementEditRequest?.roomId) ?? demo.room} displayUnits={preferences.units} onChange={obstacles => applyObstacles(obstacles, viewerElementEditRequest?.roomId ?? demo.room.id)} elementEditRequest={viewerElementEditRequest} onEditEnd={() => handleViewerElementSelected(null)} onElementSelected={handleViewerElementSelected} placementWalls={placementWalls} onBeginPlacement={setPlacement} />
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
        {placement && <div className="placement-status" role="status"><strong>Placing {placement.obstacle.name}</strong><span><span className="placement-hint-desktop">Click to place · Esc or right-click to cancel{!placement.opening && " · R to rotate"}</span><span className="placement-hint-touch">Tap to place</span></span><button type="button" className="review-style-button" onClick={() => setPlacement(null)}>Cancel</button></div>}
      {assetsOpen && local.project && <LocalAssetLibrary assets={local.project.assets} instances={local.project.assetInstances} apiUrl={API_URL} onImport={local.addAsset} onChange={local.setInstances} onClose={() => setAssetsOpen(false)} />}
      {privacyOpen && <PlannerPrivacyDialog onClose={() => setPrivacyOpen(false)} />}
      <CatalogueBrowser apiUrl={API_URL} open={catalogueOpen} displayUnits={preferences.units} onClose={() => setCatalogueOpen(false)} onInsert={insertCatalogueItem} />
      {CATALOGUE_MANAGER_AVAILABLE && <CatalogueManager apiUrl={API_URL} open={catalogueManagerOpen} opener={catalogueManagerOpener} layoutAnalysisToolbarVisible={toolbarAvailability["viewer-layout-analysis"]} onLayoutAnalysisToolbarVisibleChange={setLayoutAnalysisToolbarVisible} humanMockupToolbarVisible={toolbarAvailability["viewer-person"]} onHumanMockupToolbarVisibleChange={setHumanMockupToolbarVisible} uiSettings={uiSettings} onUiSettingsChange={setUiSettings} onClose={() => setCatalogueManagerOpen(false)} />}
      <SettingsDialog open={settingsOpen} preferences={preferences} onChange={setPreferences} onClose={() => setSettingsOpen(false)} />
    </main>
  );
}
