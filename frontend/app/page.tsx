"use client";

import { useEffect, useState } from "react";
import { EngineeringViewer } from "@/components/EngineeringViewer";
import { ApplicationMenuBar } from "@/components/ApplicationMenuBar";
import { CatalogueBrowser } from "@/components/CatalogueBrowser";
import { FixtureEditor } from "@/components/FixtureEditor";
import { FullFloorplanEditor } from "@/components/FullFloorplanEditor";
import { PersonEditor } from "@/components/PersonEditor";
import { type AppPreferences, SettingsDialog } from "@/components/SettingsDialog";
import type { CatalogueItem, DemoResponse, LayoutResult, Measurement, Obstacle, PersonMockup, Room, RoomFinishes, WallViewMode } from "@/lib/types";
import { formatLength, formatMeasurementText } from "@/lib/units";

// Keep browser requests on the frontend origin. Next.js proxies these calls to
// the private local engineering backend, so phones on the LAN never try to use
// their own `localhost:8000`.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/engineering-api";

export default function Home() {
  const [demo, setDemo] = useState<DemoResponse | null>(null);
  const [mode, setMode] = useState<"EDITOR" | "ANALYSIS">("EDITOR");
  const [projectRooms, setProjectRooms] = useState<Room[]>([]);
  const [layoutResult, setLayoutResult] = useState<LayoutResult | null>(null);
  const [runningAnalysis, setRunningAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [personPanelVisible, setPersonPanelVisible] = useState(false);
  const [wallMode, setWallMode] = useState<WallViewMode>("SOLID");
  const [floorplanStyle, setFloorplanStyle] = useState<"DEFAULT" | "TRADITIONAL">("DEFAULT");
  const [floorplanExportRequest, setFloorplanExportRequest] = useState(0);
  const [preferences, setPreferences] = useState<AppPreferences>({ density: "COMFORTABLE", confirmBeforeOpen: true, units: "MM" });
  const [demoLoadRequest, setDemoLoadRequest] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const loadDemo = async (attempt: number): Promise<void> => {
      try {
        const response = await fetch(`${API_URL}/demo`);
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        const nextDemo = await response.json() as DemoResponse;
        if (!cancelled) { setDemo(nextDemo); setError(null); }
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

  function openDetectedRoom(name: string, vertices: import("@/lib/types").Point2D[], openings: import("@/lib/types").Opening[], wallHeight: number, wallThickness: number) {
    setDemo((current) => {
      if (!current) return current;
      const room = { ...current.room, id: crypto.randomUUID(), name, vertices, openings, wall_height: { ...current.room.wall_height, value: wallHeight }, wall_thickness: { ...current.room.wall_thickness, value: wallThickness }, obstacles: [], person_mockup: null, finishes: undefined, version: current.room.version + 1 };
      setProjectRooms((rooms) => [...rooms, room]);
      return { ...current, room };
    });
    invalidateAnalysis();
    setMode("ANALYSIS");
  }

  function applyObstacles(obstacles: Obstacle[]) {
    setDemo((current) => current ? { ...current, room: { ...current.room, obstacles, version: current.room.version + 1 } } : current);
    invalidateAnalysis();
  }

  function applyFinishes(finishes: RoomFinishes) {
    setDemo((current) => current ? { ...current, room: { ...current.room, finishes } } : current);
  }

  function applyPerson(person: PersonMockup | null) {
    setDemo((current) => current ? { ...current, room: { ...current.room, person_mockup: person, version: current.room.version + 1 } } : current);
    invalidateAnalysis();
  }

  function togglePersonPanel() {
    const nextVisible = !personPanelVisible;
    if (!nextVisible && demo?.room.person_mockup?.enabled) {
      applyPerson({ ...demo.room.person_mockup, enabled: false });
    }
    setPersonPanelVisible(nextVisible);
  }

  async function openRoomFile(room: Room) {
    if (!Array.isArray(room.vertices) || !room.wall_height || !room.wall_thickness) throw new Error("This file is not a Renovation Fit room.");
    if (preferences.confirmBeforeOpen && !window.confirm("Replace the current working room with the selected file?")) return;
    const response = await fetch(`${API_URL}/rooms/validate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(room) });
    if (!response.ok) {
      const payload = await response.json() as { detail?: string };
      throw new Error(payload.detail ?? "The room geometry is invalid.");
    }
    setDemo((current) => current ? { ...current, room } : current);
    invalidateAnalysis();
  }

  function insertCatalogueItem(item: CatalogueItem) {
    const minX = Math.min(...demo!.room.vertices.map((point) => point.x));
    const maxX = Math.max(...demo!.room.vertices.map((point) => point.x));
    const minY = Math.min(...demo!.room.vertices.map((point) => point.y));
    const maxY = Math.max(...demo!.room.vertices.map((point) => point.y));
    const measured = (value: number): Measurement => ({ value, uncertainty_mm: 5, verified: false, source_type: "MANUFACTURER_DATASHEET" });
    const obstacle: Obstacle = {
      id: `fixture-${crypto.randomUUID().slice(0, 8)}`,
      name: item.name,
      kind: "BOX",
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      dimensions: { width: measured(item.width_mm), depth: measured(item.depth_mm), height: measured(item.height_mm) },
      base_z_mm: 0,
      rotation_deg: 0,
      source_type: "MANUFACTURER_DATASHEET",
      verified: false,
      fixture_kind: item.fixture_kind,
      model_id: item.id,
      color_hex: item.color_hex,
      wall_lock: false,
      stl_filename: item.stl_filename ?? undefined,
      stl_base64: item.stl_base64 ?? undefined,
    };
    applyObstacles([...demo!.room.obstacles, obstacle]);
    setMode("ANALYSIS");
  }

  async function runAnalysis() {
    if (!demo) return;
    setRunningAnalysis(true);
    setAnalysisError(null);
    try {
      const response = await fetch(`${API_URL}/layout-checks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(demo.room),
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
    return <main className="loading-state"><div className="brand-mark">RF</div><h1>Connecting to the engineering kernel</h1><p>{error ? `Backend unavailable: ${error}` : "Loading verified millimetre geometry…"}</p>{error && <button type="button" onClick={() => { setDemo(null); setError(null); setDemoLoadRequest((request) => request + 1); }}>Retry connection</button>}</main>;
  }

  return (
    <main className={preferences.density === "COMPACT" ? "density-compact" : ""}>
      <header className="topbar">
        <div className="app-identity"><div className="brand"><span className="brand-mark">RF</span><span>Renovation Fit</span></div><ApplicationMenuBar room={demo.room} mode={mode} personPanelVisible={personPanelVisible} wallMode={wallMode} floorplanStyle={floorplanStyle} displayUnits={preferences.units} onOpenRoom={openRoomFile} onOpenCatalogue={() => setCatalogueOpen(true)} onTogglePersonPanel={togglePersonPanel} onWallModeChange={setWallMode} onFloorplanStyleChange={setFloorplanStyle} onExportFloorplan={() => setFloorplanExportRequest((current) => current + 1)} onOpenSettings={() => setSettingsOpen(true)} /></div>
        <nav className="app-nav" aria-label="Project workflow">
          <button className={mode === "EDITOR" ? "active" : ""} onClick={() => setMode("EDITOR")}>1 · Floorplan</button>
          <button className={mode === "ANALYSIS" ? "active" : ""} onClick={() => setMode("ANALYSIS")}>2 · 3D viewer</button>
        </nav>
        <div className="truth-badge"><span className="truth-dot" />Deterministic engine · {{ MM: "mm", CM: "cm", INCHES: "in", FEET: "ft", METERS: "m" }[preferences.units]}</div>
      </header>

      <section hidden={mode !== "EDITOR"} aria-hidden={mode !== "EDITOR"}><FullFloorplanEditor apiUrl={API_URL} displayUnits={preferences.units} floorplanStyle={floorplanStyle} exportRequest={floorplanExportRequest} activeRoomName={demo.room.name} fixtures={demo.room.obstacles} onFixturesChange={applyObstacles} onOpenRoom={openDetectedRoom} /></section>
      {mode === "ANALYSIS" ? (
        <><div className="viewer-room-selector"><label>Room <select value={demo.room.id} onChange={(event) => { const room = projectRooms.find((item) => item.id === event.target.value); if (room) setDemo((current) => current ? { ...current, room } : current); }}><option value={demo.room.id}>{demo.room.name}</option>{projectRooms.filter((room) => room.id !== demo.room.id).map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label></div><section className="workspace">
          <aside className="evidence-panel">
            <div className="eyebrow">Engineering analysis</div>
            <h1>Plan fixtures and furniture</h1>
            <p className="product-name">Add and check only the elements that belong in this bathroom.</p>

            <FixtureEditor room={demo.room} displayUnits={preferences.units} onChange={applyObstacles} />
            {personPanelVisible && <PersonEditor key={`person-editor-${demo.room.version}`} room={demo.room} displayUnits={preferences.units} onChange={applyPerson} />}

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
          </aside>

          <section className="visual-panel">
            <EngineeringViewer room={demo.room} collisionIds={layoutResult?.collision_ids ?? []} onObstaclesChange={applyObstacles} onFinishesChange={applyFinishes} onPersonChange={applyPerson} wallMode={wallMode} />
            <footer className="viewer-warning"><strong>Engineering view</strong><span>Browser geometry is informational. Layout decisions are calculated by the backend kernel.</span></footer>
          </section>
        </section></>
      ) : null}
      <CatalogueBrowser apiUrl={API_URL} open={catalogueOpen} displayUnits={preferences.units} onClose={() => setCatalogueOpen(false)} onInsert={insertCatalogueItem} />
      <SettingsDialog open={settingsOpen} preferences={preferences} onChange={setPreferences} onClose={() => setSettingsOpen(false)} />
    </main>
  );
}
