"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { EngineeringViewer } from "@/components/EngineeringViewer";
import { ApplicationMenuBar } from "@/components/ApplicationMenuBar";
import { CatalogueBrowser } from "@/components/CatalogueBrowser";
import { CatalogueManager } from "@/components/CatalogueManager";
import { CatalogueFixtureEditor } from "@/components/CatalogueFixtureEditor";
import { FullFloorplanEditor } from "@/components/FullFloorplanEditor";
import { FloatingToolbar } from "@/components/FloatingToolbar";
import { PersonEditor } from "@/components/PersonEditor";
import { alignObstacleToNearestWall } from "@/lib/layoutInteraction";
import { normalizeRoomPerson } from "@/lib/person";
import { type AppPreferences, SettingsDialog } from "@/components/SettingsDialog";
import type { CatalogueItem, DemoResponse, LayoutResult, Measurement, Obstacle, PersonMockup, Room, RoomFinishes, WallViewMode } from "@/lib/types";
import { formatLength, formatMeasurementText } from "@/lib/units";
import { DEFAULT_TOOLBAR_VISIBILITY, FLOORPLAN_TOOLBARS, VIEWER_TOOLBARS, type ToolbarId } from "@/lib/toolbars";

// Keep browser requests on the frontend origin. Next.js proxies these calls to
// the private local engineering backend, so phones on the LAN never try to use
// their own `localhost:8000`.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/engineering-api";
const FULL_FLOORPLAN_SELECTION = "__FULL_FLOORPLAN__";

export default function Home() {
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
  const [floorplanStyle, setFloorplanStyle] = useState<"DEFAULT" | "TRADITIONAL">("DEFAULT");
  const [floorplanExportRequest, setFloorplanExportRequest] = useState(0);
  const [preferences, setPreferences] = useState<AppPreferences>({ density: "COMFORTABLE", confirmBeforeOpen: true, units: "MM" });
  const [demoLoadRequest, setDemoLoadRequest] = useState(0);
  const [toolbarVisibility, setToolbarVisibility] = useState(DEFAULT_TOOLBAR_VISIBILITY);
  const [toolbarLayoutResetKey, setToolbarLayoutResetKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const loadDemo = async (attempt: number): Promise<void> => {
      try {
        const response = await fetch(`${API_URL}/demo`);
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        const nextDemo = await response.json() as DemoResponse;
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

  function applyObstacles(obstacles: Obstacle[]) {
    const target = resolveViewerRoom(demo);
    if (!target) return;
    const updated = { ...target, obstacles, version: target.version + 1 };
    setDemo((current) => current ? { ...current, room: current.room.id === target.id ? updated : current.room } : current);
    setProjectRooms((rooms) => rooms.map((room) => room.id === target.id ? updated : room));
    invalidateAnalysis();
  }

  function applyFinishes(finishes: RoomFinishes) {
    const target = resolveViewerRoom(demo);
    if (!target) return;
    const updated = { ...target, finishes };
    setDemo((current) => current ? { ...current, room: current.room.id === target.id ? updated : current.room } : current);
    setProjectRooms((rooms) => rooms.map((room) => room.id === target.id ? updated : room));
  }

  function applyPerson(person: PersonMockup | null) {
    const target = resolveViewerRoom(demo);
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
    setToolbarVisibility((current) => ({ ...current, [id]: !current[id] }));
  }

  function showAllToolbars() {
    const toolbars = mode === "EDITOR" ? FLOORPLAN_TOOLBARS : VIEWER_TOOLBARS;
    setToolbarVisibility((current) => ({ ...current, ...Object.fromEntries(toolbars.map((toolbar) => [toolbar.id, true])) }));
    setToolbarLayoutResetKey((current) => current + 1);
  }

  function hideAllToolbars() {
    const toolbars = mode === "EDITOR" ? FLOORPLAN_TOOLBARS : VIEWER_TOOLBARS;
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
    invalidateAnalysis();
  }

  function insertCatalogueItem(item: CatalogueItem) {
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
      base_z_mm: 0,
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
    const obstacle = alignObstacleToNearestWall(unalignedObstacle, target.vertices, unalignedObstacle.center);
    applyObstacles([...target.obstacles, obstacle]);
    setMode("ANALYSIS");
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

  if (!demo) {
    return <main className="loading-state"><Image className="brand-mark" src="/planner-build-icon.png" alt="PlannerBuild" width={34} height={34} priority /><h1>Connecting to the engineering kernel</h1><p>{error ? `Backend unavailable: ${error}` : "Loading verified millimetre geometry…"}</p>{error && <button type="button" onClick={() => { setDemo(null); setError(null); setDemoLoadRequest((request) => request + 1); }}>Retry connection</button>}</main>;
  }

  const viewerRoomOptions = roomOptions(demo);
  const appliedViewerSelection = viewerRoomSelection === FULL_FLOORPLAN_SELECTION || viewerRoomOptions.some((room) => room.id === viewerRoomSelection) ? viewerRoomSelection : FULL_FLOORPLAN_SELECTION;
  const pendingSelection = pendingViewerRoomSelection === FULL_FLOORPLAN_SELECTION || viewerRoomOptions.some((room) => room.id === pendingViewerRoomSelection) ? pendingViewerRoomSelection : FULL_FLOORPLAN_SELECTION;
  const selectedViewerRoom = resolveViewerRoom(demo, projectRooms, appliedViewerSelection) ?? demo.room;
  const displayedViewerRooms = appliedViewerSelection === FULL_FLOORPLAN_SELECTION ? viewerRoomOptions : [selectedViewerRoom];

  function openViewerSelection() {
    const selection = pendingSelection;
    const target = resolveViewerRoom(demo, projectRooms, selection);
    if (!target) return;
    setViewerRoomSelection(selection);
    setPendingViewerRoomSelection(selection);
    setDemo((current) => current ? { ...current, room: normalizeRoomPerson(target) } : current);
    invalidateAnalysis();
  }

  return (
    <main className={preferences.density === "COMPACT" ? "density-compact" : ""}>
      <header className="topbar">
        <div className="app-identity"><div className="brand"><Image className="brand-mark" src="/planner-build-icon.png" alt="PlannerBuild" width={34} height={34} priority /><span>Renovation Fit</span></div><ApplicationMenuBar room={demo.room} mode={mode} wallMode={wallMode} floorplanStyle={floorplanStyle} displayUnits={preferences.units} onOpenRoom={openRoomFile} onOpenCatalogue={() => setCatalogueOpen(true)} onOpenCatalogueManager={(opener) => { setCatalogueManagerOpener(opener); setCatalogueManagerOpen(true); }} onWallModeChange={setWallMode} onFloorplanStyleChange={setFloorplanStyle} onExportFloorplan={() => setFloorplanExportRequest((current) => current + 1)} onOpenSettings={() => setSettingsOpen(true)} toolbars={mode === "EDITOR" ? FLOORPLAN_TOOLBARS : VIEWER_TOOLBARS} toolbarVisibility={toolbarVisibility} onToggleToolbar={toggleToolbar} onShowAllToolbars={showAllToolbars} onHideAllToolbars={hideAllToolbars} /></div>
        <nav className="app-nav" aria-label="Project workflow">
          <button aria-pressed={mode === "EDITOR"} className={mode === "EDITOR" ? "active" : ""} onClick={() => setMode("EDITOR")}>2D</button>
          <button aria-pressed={mode === "ANALYSIS"} className={mode === "ANALYSIS" ? "active" : ""} onClick={() => setMode("ANALYSIS")}>3D</button>
        </nav>
      </header>

      <section className="environment-screen" hidden={mode !== "EDITOR"} aria-hidden={mode !== "EDITOR"}><FullFloorplanEditor projectRooms={projectRooms} onPlanRoomChange={applyPlanRoom} onPlanRoomsChange={applyPlanRooms} apiUrl={API_URL} displayUnits={preferences.units} floorplanStyle={floorplanStyle} exportRequest={floorplanExportRequest} activeSourceRoomId={demo.room.source_floorplan_room_id} fixtures={demo.room.obstacles} onFixturesChange={applyObstacles} toolbarVisibility={toolbarVisibility} onToggleToolbar={toggleToolbar} toolbarLayoutResetKey={toolbarLayoutResetKey} /></section>
      {mode === "ANALYSIS" ? (
        <section className="analysis-workspace">
          <EngineeringViewer key={`engineering-viewer-${appliedViewerSelection}-${selectedViewerRoom.id}`} apiUrl={API_URL} room={selectedViewerRoom} sceneRooms={displayedViewerRooms} collisionIds={layoutResult?.collision_ids ?? []} onObstaclesChange={applyObstacles} onFinishesChange={applyFinishes} onPersonChange={applyPerson} wallMode={wallMode} toolbarVisibility={toolbarVisibility} onToggleToolbar={toggleToolbar} toolbarLayoutResetKey={toolbarLayoutResetKey} />
          {toolbarVisibility["viewer-room"] && <FloatingToolbar title="Room selector" defaultPosition={{ x: 18, y: 18 }} dock={{ side: "LEFT", slot: 0, slots: 3 }} layoutResetKey={toolbarLayoutResetKey} maxHeight={240} onClose={() => toggleToolbar("viewer-room")}><div className="viewer-room-selector"><label>Room <select value={pendingSelection} onChange={(event) => setPendingViewerRoomSelection(event.target.value)}><option value={FULL_FLOORPLAN_SELECTION}>Full floorplan</option>{projectRooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label><button className="review-style-button" type="button" onClick={openViewerSelection}>Open selection in 3D</button></div></FloatingToolbar>}
          {toolbarVisibility["viewer-analysis"] && <FloatingToolbar title="Add elements" defaultPosition={{ x: 18, y: 112 }} dock={{ side: "LEFT", slot: 1, slots: 3 }} layoutResetKey={toolbarLayoutResetKey} maxHeight={650} onClose={() => toggleToolbar("viewer-analysis")}><aside className="evidence-panel floating-evidence-panel">
            <p className="product-name">Add and check only the elements that belong in this bathroom.</p>

            <CatalogueFixtureEditor key={demo.room.id} apiUrl={API_URL} refreshKey={Number(catalogueOpen) + Number(catalogueManagerOpen)} room={demo.room} displayUnits={preferences.units} onChange={applyObstacles} />

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
          {toolbarVisibility["viewer-person"] && <FloatingToolbar title="Human mock-up" defaultPosition={{ x: 430, y: 18 }} dock={{ side: "LEFT", slot: 2, slots: 3 }} layoutResetKey={toolbarLayoutResetKey} maxHeight={620} onClose={() => toggleToolbar("viewer-person")}><PersonEditor key={`person-editor-${demo.room.id}-${demo.room.version}`} room={demo.room} displayUnits={preferences.units} onChange={applyPerson} onVisibilityChange={applyPersonVisibility} /></FloatingToolbar>}
          <footer className="viewer-warning"><strong>Engineering view</strong><span>Browser geometry is informational. Layout decisions are calculated by the backend kernel.</span></footer>
        </section>
      ) : null}
      <CatalogueBrowser apiUrl={API_URL} open={catalogueOpen} displayUnits={preferences.units} onClose={() => setCatalogueOpen(false)} onInsert={insertCatalogueItem} />
      <CatalogueManager apiUrl={API_URL} open={catalogueManagerOpen} opener={catalogueManagerOpener} onClose={() => setCatalogueManagerOpen(false)} />
      <SettingsDialog open={settingsOpen} preferences={preferences} onChange={setPreferences} onClose={() => setSettingsOpen(false)} />
    </main>
  );
}
