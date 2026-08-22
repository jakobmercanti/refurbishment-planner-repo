"use client";

import { useEffect, useMemo, useState } from "react";
import { EngineeringViewer } from "@/components/EngineeringViewer";
import type { DemoResponse, Status } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const statusOrder: Status[] = ["FIT", "VERIFY", "FAIL"];

export default function Home() {
  const [demo, setDemo] = useState<DemoResponse | null>(null);
  const [selected, setSelected] = useState<Status>("FIT");
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

  const result = useMemo(() => demo?.results[selected], [demo, selected]);

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
        <div className="project-meta"><span>PROJECT</span><strong>L-shaped bathroom / v{demo.room.version}</strong></div>
        <div className="truth-badge"><span className="truth-dot" />Deterministic engine · mm</div>
      </header>

      <section className="workspace">
        <aside className="evidence-panel">
          <div className="eyebrow">Engineering analysis</div>
          <h1>Will this enclosure fit?</h1>
          <p className="product-name">{demo.product.manufacturer} · {demo.product.sku}</p>

          <div className="scenario-tabs" role="tablist" aria-label="Placement scenarios">
            {statusOrder.map((status) => (
              <button
                key={status}
                role="tab"
                aria-selected={selected === status}
                className={`status-${status.toLowerCase()} ${selected === status ? "selected" : ""}`}
                onClick={() => setSelected(status)}
              >
                <span className="status-icon" aria-hidden>{status === "FIT" ? "✓" : status === "VERIFY" ? "!" : "×"}</span>
                {status}
              </button>
            ))}
          </div>

          {result && (
            <>
              <div className={`result-summary status-${result.status.toLowerCase()}`}>
                <div className="result-label"><span>{result.status}</span><small>ENGINE v{result.engine_version}</small></div>
                <p>{result.summary.replace(`${result.status} — `, "")}</p>
              </div>

              <div className="metric-grid">
                <div><span>Minimum clearance</span><strong>{result.minimum_clearance_mm?.toFixed(0) ?? "—"} <small>mm</small></strong></div>
                <div><span>Room height</span><strong>{demo.room.wall_height.value.toFixed(0)} <small>mm</small></strong></div>
                <div><span>Wall thickness</span><strong>{demo.room.wall_thickness.value.toFixed(0)} <small>mm</small></strong></div>
                <div><span>Room topology</span><strong>6 <small>walls</small></strong></div>
              </div>

              {result.manual_measurements_required.length > 0 && (
                <div className="manual-callout">
                  <span>Required confirmation</span>
                  {result.manual_measurements_required.map((item) => <p key={item}>{item}</p>)}
                </div>
              )}

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
          <div className="visual-heading">
            <div><span className="eyebrow">Authoritative geometry snapshot</span><h2>{demo.room.name}</h2></div>
            <span className="version-chip">Room v{demo.room.version} · Product v{demo.product.version}</span>
          </div>
          <EngineeringViewer
            room={demo.room}
            product={demo.product}
            placement={demo.placements[selected]}
            status={selected}
            collisionIds={result?.collisions.map((item) => item.object_id) ?? []}
          />
          <footer className="viewer-warning"><strong>Engineering view</strong><span>Browser geometry is informational. Fit decisions are calculated by the backend kernel.</span></footer>
        </section>
      </section>
    </main>
  );
}

