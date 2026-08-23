"use client";

import { useEffect, useState } from "react";
import { EngineeringViewer } from "@/components/EngineeringViewer";
import { ApplicationMenuBar } from "@/components/ApplicationMenuBar";
import { CatalogueBrowser } from "@/components/CatalogueBrowser";
import { FixtureEditor } from "@/components/FixtureEditor";
import { FloorPlanEditor } from "@/components/FloorPlanEditor";
import { PersonEditor } from "@/components/PersonEditor";
import { type AppPreferences, SettingsDialog } from "@/components/SettingsDialog";
import type { CatalogueItem, DemoResponse, LayoutResult, Measurement, Obstacle, PersonMockup, Room, RoomFinishes, WallViewMode } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function Home() {
  const [demo, setDemo] = useState<DemoResponse | null>(null);
  const [mode, setMode] = useState<"EDITOR" | "ANALYSIS">("EDITOR");
  const [layoutResult, setLayoutResult] = useState<LayoutResult | null>(null);
  const [runningAnalysis, setRunningAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [personPanelVisible, setPersonPanelVisible] = useState(false);
  const [wallMode, setWallMode] = useState<WallViewMode>("SOLID");
  const [preferences, setPreferences] = useState<AppPreferences>({ density: "COMFORTABLE", confirmBeforeOpen: true });

  useEffect(() => {
    fetch(`${API_URL}/demo`)
      .then((response) => {
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        return response.json() as Promise<DemoResponse>;
      })
      .then(setDemo)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  const analysisIsStale = Boolean(layoutResult && demo && layoutResult.room_version !== demo.room.version);

  function invalidateAnalysis() {
    setLayoutResult(null);
    setAnalysisError(null);
  }

  function applyRoom(room: Room) {
    setDemo((current) => current ? { ...current, room } : current);
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
    return <main className="loading-state"><div className="brand-mark">RF</div><h1>Connecting to the engineering kernel</h1><p>{error ? `Backend unavailable: ${error}` : "Loading verified millimetre geometry…"}</p></main>;
  }

  return (
    <main className={preferences.density === "COMPACT" ? "density-compact" : ""}>
      <header className="topbar">
        <div className="app-identity"><div className="brand"><span className="brand-mark">RF</span><span>Renovation Fit</span></div><ApplicationMenuBar room={demo.room} personPanelVisible={personPanelVisible} wallMode={wallMode} onOpenRoom={openRoomFile} onOpenCatalogue={() => setCatalogueOpen(true)} onTogglePersonPanel={() => setPersonPanelVisible((current) => !current)} onWallModeChange={setWallMode} onOpenSettings={() => setSettingsOpen(true)} /></div>
        <nav className="app-nav" aria-label="Project workflow">
          <button className={mode === "EDITOR" ? "active" : ""} onClick={() => setMode("EDITOR")}>1 · Floor plan</button>
          <button className={mode === "ANALYSIS" ? "active" : ""} onClick={() => setMode("ANALYSIS")}>2 · Fit analysis</button>
        </nav>
        <div className="truth-badge"><span className="truth-dot" />Deterministic engine · mm</div>
      </header>

      {mode === "EDITOR" ? (
        <FloorPlanEditor room={demo.room} apiUrl={API_URL} onApply={applyRoom} onCancel={() => setMode("ANALYSIS")} />
      ) : (
        <section className="workspace">
          <aside className="evidence-panel">
            <div className="eyebrow">Engineering analysis</div>
            <h1>Plan fixtures and furniture</h1>
            <p className="product-name">Add and check only the elements that belong in this bathroom.</p>

            <FixtureEditor room={demo.room} onChange={applyObstacles} />
            {personPanelVisible && <PersonEditor key={`person-editor-${demo.room.version}`} room={demo.room} onChange={applyPerson} />}

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
                  <div><span>Room height</span><strong>{demo.room.wall_height.value.toFixed(0)} <small>mm</small></strong></div>
                  <div><span>Wall thickness</span><strong>{demo.room.wall_thickness.value.toFixed(0)} <small>mm</small></strong></div>
                  <div><span>Room topology</span><strong>{demo.room.vertices.length} <small>walls</small></strong></div>
                </div>
                <div className="checks-heading"><h2>Individual checks</h2><span>{layoutResult.checks.length} rules</span></div>
                <div className="checks-list">
                  {layoutResult.checks.map((check) => (
                    <article key={check.check_id} className={`check check-${check.status.toLowerCase()}`}>
                      <span className="check-status">{check.status}</span>
                      <div><h3>{check.check_id.replaceAll("-", " ").replaceAll(":", " · ")}</h3><p>{check.explanation}</p></div>
                      {check.margin_mm !== undefined && check.margin_mm !== null && <code>{check.margin_mm >= 0 ? "+" : ""}{check.margin_mm.toFixed(1)} mm</code>}
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
        </section>
      )}
      <CatalogueBrowser apiUrl={API_URL} open={catalogueOpen} onClose={() => setCatalogueOpen(false)} onInsert={insertCatalogueItem} />
      <SettingsDialog open={settingsOpen} preferences={preferences} onChange={setPreferences} onClose={() => setSettingsOpen(false)} />
    </main>
  );
}
