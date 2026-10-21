"use client";

import { useEffect, useState } from "react";
import { CfdProxyMesh } from "./CfdProxyMesh";
import { FixturePreview } from "./FixturePreview";
import { ParametricFixture } from "./ParametricFixture";
import { StlFixture } from "./StlFixture";
import { parseCfdMesh, type CfdMesh } from "@/lib/cfd";
import { defaultPersonSpec } from "@/lib/people";
import type { CatalogueItem, Obstacle } from "@/lib/types";

export function CatalogueAssetPreview({ item, apiUrl }: { item: CatalogueItem; apiUrl: string }) {
  const [mode, setMode] = useState<"DETAIL" | "CFD">("DETAIL");
  const [personStyle, setPersonStyle] = useState<"CASUAL" | "SMART" | "MANNEQUIN">("CASUAL");
  const [result, setResult] = useState<{ mesh?: CfdMesh; error?: string }>({});
  const eligible = Boolean(item.cfd_proxy) && !["DOOR", "WINDOW"].includes(item.fixture_kind)
    && !item.representation_key?.startsWith("electrical-") && item.category_id !== "electric";
  const endpoint = `${apiUrl}/catalog/items/${encodeURIComponent(item.id)}/cfd`;
  useEffect(() => {
    if (mode !== "CFD" || !eligible) return;
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error("CFD representation is unavailable. Try again later."); return response.json(); })
      .then(value => {
        let mesh: CfdMesh;
        try { mesh = parseCfdMesh(value); } catch { throw new Error("The CFD surface is invalid. Refresh the catalogue or review this entry."); }
        if (mesh.profile !== item.cfd_proxy?.profile || mesh.dimensions_mm.some((v, i) => v !== [item.width_mm, item.depth_mm, item.height_mm][i]))
          throw new Error("CFD geometry does not match this catalogue entry. Refresh the catalogue.");
        if (!controller.signal.aborted) setResult({ mesh });
      })
      .catch((reason: Error) => { if (!controller.signal.aborted) setResult({ error: reason.message }); });
    return () => controller.abort();
  }, [mode, eligible, endpoint, item.cfd_proxy?.profile, item.width_mm, item.depth_mm, item.height_mm]);
  const measured = (value: number) => ({ value, uncertainty_mm: 0, verified: false, source_type: "USER_MEASURED" as const });
  const occupant = defaultPersonSpec(item.representation_key, item.height_mm);
  const obstacle: Obstacle = {
    person_spec: occupant ? { ...occupant, style: personStyle } : undefined,
    id: item.representation_key?.startsWith("door-opening-") ? "opening-preview" : item.id,
    name: item.name, kind: "BOX", fixture_kind: ["SHOWER", "BASIN", "TOILET"].includes(item.fixture_kind) ? item.fixture_kind as "SHOWER" | "BASIN" | "TOILET" : "FURNITURE",
    representation_key: item.representation_key, stl_base64: item.stl_base64 ?? undefined,
    center: { x: 0, y: 0 }, dimensions: { width: measured(item.width_mm), depth: measured(item.depth_mm), height: measured(item.height_mm) },
    rotation_deg: 0, base_z_mm: 0, color_hex: item.color_hex, verified: false,
  };
  const largest = Math.max(item.width_mm, item.depth_mm, item.height_mm);
  const size = { width: item.width_mm / largest, depth: item.depth_mm / largest, height: item.height_mm / largest };
  const procedural = <ParametricFixture obstacle={obstacle} {...size} />;
  const baseClearance = result.mesh ? Math.min(...result.mesh.vertices_mm.map(point => point[2])) : 0;
  const knownDetailed = Boolean(item.stl_base64 || /^(balustrade-|people-|electrical-|furniture-|window-|door-|shower-|basin-|toilet-|heating-)/.test(item.representation_key ?? ""));
  return <section className="catalogue-asset-preview" aria-label="Catalogue 3D asset viewer">
    <header><h4>3D preview</h4><span>{mode === "CFD" ? "Simplified obstruction" : knownDetailed ? "Asset model" : "Dimension envelope"}</span></header>
    <div className="catalogue-preview-modes" role="group" aria-label="Asset representation">
      <button type="button" aria-pressed={mode === "DETAIL"} onClick={() => setMode("DETAIL")}>Asset</button>
      {eligible && <button type="button" aria-pressed={mode === "CFD"} onClick={() => { if (mode !== "CFD") { setResult({}); setMode("CFD"); } }}>CFD shape</button>}
    </div>
    {occupant && mode === "DETAIL" && <label className="field"><span>Display style</span><select value={personStyle} onChange={event => setPersonStyle(event.target.value as typeof personStyle)}><option value="CASUAL">Casual</option><option value="SMART">Smart</option><option value="MANNEQUIN">Mannequin</option></select></label>}
    {mode === "DETAIL" || result.mesh ? <FixturePreview key={`${item.id}:${mode}`} obstacle={obstacle} appearanceControls>
      {mode === "CFD" && result.mesh ? <CfdProxyMesh mesh={result.mesh} /> : item.stl_base64 ? <StlFixture obstacle={obstacle} {...size} colour={item.color_hex} fallback={procedural} /> : procedural}
    </FixturePreview> : <div className="catalogue-preview-status" role={result.error ? "alert" : "status"}>{result.error ?? "Loading simplified CFD surface…"}</div>}
    <p className="catalogue-preview-guidance">Drag to orbit · scroll or use the slider to zoom · Fit resets the framing</p>
    {mode === "CFD" && result.mesh && <div className="catalogue-cfd-info">
      <strong>{result.mesh.label}</strong><p>Closed surface · {result.mesh.triangles.length} triangles · millimetres</p>
      <p>Outline marks the asset origin; it is not exported.{baseClearance > 0 && <> Underside: {baseClearance.toLocaleString("en-GB", { maximumFractionDigits: 1 })} mm above origin. Check mounting height.</>}</p>
      {result.mesh.geometry_revision && <p>Geometry revision {result.mesh.geometry_revision}</p>}
      <a href={`${endpoint}.stl`} download>Download CFD STL (mm)</a>
      <details><summary>CFD assumptions &amp; limitations</summary><ul>{result.mesh.assumptions.map(note => <li key={note}>{note}</li>)}</ul></details>
    </div>}
    <p className="catalogue-preview-disclaimer">{mode === "CFD" ? "Generic CFD input—not a simulation result. Review airflow paths and mesh settings." : "Illustrative model. Measured dimensions—not the preview—determine fit."}</p>
  </section>;
}
