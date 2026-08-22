"use client";

import { useEffect, useMemo, useState } from "react";
import { EngineeringViewer } from "@/components/EngineeringViewer";
import { FloorPlanEditor } from "@/components/FloorPlanEditor";
import type { DemoResponse, FitResult, Room, Status } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const statusOrder: Status[] = ["FIT", "VERIFY", "FAIL"];

export default function Home() {
  const [demo, setDemo] = useState<DemoResponse | null>(null);
  const [selected, setSelected] = useState<Status>("FIT");
  const [mode, setMode] = useState<"EDITOR" | "ANALYSIS">("EDITOR");
  const [analysedVersions, setAnalysedVersions] = useState<Record<Status, number>>({ FIT: 0, VERIFY: 0, FAIL: 0 });
  const [runningAnalysis, setRunningAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/demo`)
      .then((response) => {
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        return response.json() as Promise<DemoResponse>;
      })
      .then((payload) => {
        setDemo(payload);
        setAnalysedVersions({ FIT: payload.room.version, VERIFY: payload.room.version, FAIL: payload.room.version });
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  const result = useMemo(() => demo?.results[selected], [demo, selected]);
  const analysisIsStale = demo ? analysedVersions[selected] !== demo.room.version : false;

  function applyRoom(room: Room) {
    setDemo((current) => current ? { ...current, room } : current);
    setAnalysedVersions({ FIT: 0, VERIFY: 0, FAIL: 0 });
    setSelected("FIT");
    setMode("ANALYSIS");
  }

  async function runAnalysis() {
    if (!demo) return;
    setRunningAnalysis(true);
    setAnalysisError(null);
    try {
      const response = await fetch(`${API_URL}/fit-checks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: demo.room, product: demo.product, placement: demo.placements[selected] }),
      });
      if (!response.ok) throw new Error(await response.text());
      const nextResult = await response.json() as FitResult;
      setDemo({ ...demo, results: { ...demo.results, [selected]: nextResult } });
      setAnalysedVersions((versions) => ({ ...versions, [selected]: demo.room.version }));
    } catch (reason) {
      setAnalysisError(reason instanceof Error ? reason.message : "Analysis failed.");
    } finally {
      setRunningAnalysis(false);
    }
  }

  if (!demo) {
    return (
      <main className="loading-state">
        <div className="brand-mark">RF</div>
        <h1>Connecting to the engineering kernel</h1>
        <p>{error ? `Backend unavailable: ${error}` : "Loading verified millimetre geometry…"}</p>
      </main>
    );
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
            <h1>Will this enclosure fit?</h1>
            <p className="product-name">{demo.product.manufacturer} · {demo.product.sku}</p>

            <div className="scenario-tabs" role="tablist" aria-label="Placement scenarios">
              {statusOrder.map((status) => (
                <button key={status} role="tab" aria-selected={selected === status} className={`status-${status.toLowerCase()} ${selected === status ? "selected" : ""}`} onClick={() => setSelected(status)}>
                  <span className="status-icon" aria-hidden>{status === "FIT" ? "✓" : status === "VERIFY" ? "!" : "×"}</span>{status}
                </button>
              ))}
            </div>

            {analysisIsStale && (
              <div className="stale-analysis">
                <strong>Room geometry changed</strong>
                <p>The saved result is hidden until this placement is checked against room v{demo.room.version}.</p>
                <button onClick={runAnalysis} disabled={runningAnalysis}>{runningAnalysis ? "Running checks…" : `Re-run ${selected} analysis`}</button>
                {analysisError && <span>{analysisError}</span>}
              </div>
            )}

            {result && !analysisIsStale && (
              <>
                <div className={`result-summary status-${result.status.toLowerCase()}`}>
                  <div className="result-label"><span>{result.status}</span><small>ENGINE v{result.engine_version}</small></div>
                  <p>{result.summary.replace(`${result.status} — `, "")}</p>
                </div>
                <div className="metric-grid">
                  <div><span>Minimum clearance</span><strong>{result.minimum_clearance_mm?.toFixed(0) ?? "—"} <small>mm</small></strong></div>
                  <div><span>Room height</span><strong>{demo.room.wall_height.value.toFixed(0)} <small>mm</small></strong></div>
                  <div><span>Wall thickness</span><strong>{demo.room.wall_thickness.value.toFixed(0)} <small>mm</small></strong></div>
                  <div><span>Room topology</span><strong>{demo.room.vertices.length} <small>walls</small></strong></div>
                </div>
                {result.manual_measurements_required.length > 0 && <div className="manual-callout"><span>Required confirmation</span>{result.manual_measurements_required.map((item) => <p key={item}>{item}</p>)}</div>}
                <div className="checks-heading"><h2>Individual checks</h2><span>{result.checks.length} rules</span></div>
                <div className="checks-list">
                  {result.checks.map((check) => (
                    <article key={check.check_id} className={`check check-${check.status.toLowerCase()}`}>
                      <span className="check-status">{check.status}</span>
                      <div><h3>{check.check_id.replaceAll("-", " ")}</h3><p>{check.explanation}</p></div>
                      {check.margin_mm !== undefined && check.margin_mm !== null && <code>{check.margin_mm >= 0 ? "+" : ""}{check.margin_mm.toFixed(1)} mm</code>}
                    </article>
                  ))}
                </div>
              </>
            )}
          </aside>

          <section className="visual-panel">
            <div className="visual-heading"><div><span className="eyebrow">Authoritative geometry snapshot</span><h2>{demo.room.name}</h2></div><span className="version-chip">Room v{demo.room.version} · Product v{demo.product.version}</span></div>
            <EngineeringViewer room={demo.room} product={demo.product} placement={demo.placements[selected]} status={analysisIsStale ? "VERIFY" : selected} collisionIds={analysisIsStale ? [] : result?.collisions.map((item) => item.object_id) ?? []} />
            <footer className="viewer-warning"><strong>Engineering view</strong><span>Browser geometry is informational. Fit decisions are calculated by the backend kernel.</span></footer>
          </section>
        </section>
      )}
    </main>
  );
}
