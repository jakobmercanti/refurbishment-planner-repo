"use client";

import { useEffect, useState } from "react";
import { EngineeringViewer } from "@/components/EngineeringViewer";
import { FixtureEditor } from "@/components/FixtureEditor";
import { FloorPlanEditor } from "@/components/FloorPlanEditor";
import type { DemoResponse, LayoutResult, Obstacle, Room, RoomFinishes } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function Home() {
  const [demo, setDemo] = useState<DemoResponse | null>(null);
  const [mode, setMode] = useState<"EDITOR" | "ANALYSIS">("EDITOR");
  const [layoutResult, setLayoutResult] = useState<LayoutResult | null>(null);
  const [runningAnalysis, setRunningAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <main>
      <header className="topbar">
        <div className="brand"><span className="brand-mark">RF</span><span>Renovation Fit</span></div>
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

            {(!layoutResult || analysisIsStale) && (
              <div className="stale-analysis">
                <strong>{analysisIsStale ? "Room layout changed" : "Layout ready for analysis"}</strong>
                <p>Check every placed element against the room boundary, ceiling, other elements and door swings.</p>
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
            <div className="visual-heading"><div><span className="eyebrow">Authoritative geometry snapshot</span><h2>{demo.room.name}</h2></div><span className="version-chip">Room v{demo.room.version} · {demo.room.obstacles.length} elements</span></div>
            <EngineeringViewer room={demo.room} collisionIds={layoutResult?.collision_ids ?? []} onObstaclesChange={applyObstacles} onFinishesChange={applyFinishes} />
            <footer className="viewer-warning"><strong>Engineering view</strong><span>Browser geometry is informational. Layout decisions are calculated by the backend kernel.</span></footer>
          </section>
        </section>
      )}
    </main>
  );
}
