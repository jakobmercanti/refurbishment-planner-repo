"use client";

import { useState } from "react";

export type ElectricalExportOptions = {
  format: "PDF" | "SVG" | "PNG";
  paperSize: "A4" | "A3";
  orientation: "LANDSCAPE" | "PORTRAIT";
  plan: boolean;
  bom: boolean;
  connectionSummary: boolean;
  connections: boolean;
  segments: boolean;
  circuits: boolean;
  notes: boolean;
  pictures: boolean;
};

type Props = { onPreview: (options: ElectricalExportOptions) => void | Promise<void>; onExport: (options: ElectricalExportOptions) => void | Promise<void>; status?: string | null; busy?: boolean };

export function ElectricalExportWindow({ onExport, onPreview, status, busy = false }: Props) {
  const [options, setOptions] = useState<ElectricalExportOptions>({ format: "PDF", paperSize: "A3", orientation: "LANDSCAPE", plan: true, bom: true, connectionSummary: true, connections: true, segments: false, circuits: true, notes: false, pictures: false });
  const set = <K extends keyof ElectricalExportOptions>(key: K, value: ElectricalExportOptions[K]) => setOptions((current) => ({ ...current, [key]: value }));
  const drawingOnly = options.format !== "PDF";
  const validSelection = drawingOnly ? options.plan : options.plan || options.bom || options.connectionSummary || options.connections || options.circuits || options.notes || options.pictures;
  return <section className="electrical-export-window-content">
    <p>Build a clean electrical drawing and optional documentation pages. Editor selections and temporary controls are excluded.</p>
    <div className="electrical-export-options-grid">
      <label className="field"><span>Format</span><select value={options.format} onChange={(event) => set("format", event.target.value as ElectricalExportOptions["format"])}><option value="PDF">PDF (print / save as PDF)</option><option value="SVG">SVG drawing</option><option value="PNG">PNG drawing</option></select></label>
      {options.format === "PDF" && <><label className="field"><span>Paper size</span><select value={options.paperSize} onChange={(event) => set("paperSize", event.target.value as ElectricalExportOptions["paperSize"])}><option>A3</option><option>A4</option></select></label><label className="field"><span>Orientation</span><select value={options.orientation} onChange={(event) => set("orientation", event.target.value as ElectricalExportOptions["orientation"])}><option value="LANDSCAPE">Landscape</option><option value="PORTRAIT">Portrait</option></select></label></>}
    </div>
    <fieldset className="electrical-export-checks"><legend>{drawingOnly ? "Drawing" : "Document contents"}</legend>
      <label><input type="checkbox" checked={options.plan} onChange={(event) => set("plan", event.target.checked)} /> Electrical plan</label>
      {!drawingOnly && <>
        <label><input type="checkbox" checked={options.bom} onChange={(event) => set("bom", event.target.checked)} /> Electrical BOM</label>
        <label><input type="checkbox" checked={options.connectionSummary} onChange={(event) => set("connectionSummary", event.target.checked)} /> Connection summary</label>
        <label><input type="checkbox" checked={options.connections} onChange={(event) => set("connections", event.target.checked)} /> Individual connection schedule</label>
        <label><input type="checkbox" checked={options.segments} disabled={!options.connections} onChange={(event) => set("segments", event.target.checked)} /> Include segment details</label>
        <label><input type="checkbox" checked={options.circuits} onChange={(event) => set("circuits", event.target.checked)} /> Circuit schedule</label>
        <label><input type="checkbox" checked={options.notes} onChange={(event) => set("notes", event.target.checked)} /> Notes</label>
        <label><input type="checkbox" checked={options.pictures} onChange={(event) => set("pictures", event.target.checked)} /> Pictures marked “Include in export”</label>
      </>}
    </fieldset>
    <p className="electrical-schedule-disclaimer">Drawing-line length is schematic only. It is not a physical cable length or cable quantity.</p>
    <p className="electrical-export-summary">Selected: {[options.plan && "Electrical plan", options.bom && !drawingOnly && "BOM", options.connectionSummary && !drawingOnly && "Connection summary", options.connections && !drawingOnly && "Connection schedule", options.circuits && !drawingOnly && "Circuit schedule", options.notes && !drawingOnly && "Notes", options.pictures && !drawingOnly && "Pictures"].filter(Boolean).join(" · ") || "No content selected"}</p>
    {status && <p className="electrical-layout-status" role="status">{status}</p>}
    <button type="button" className="electrical-export-submit" disabled={busy || !validSelection} onClick={() => void onPreview(options)}>Preview in separate window</button>
    <button type="button" className="primary-small electrical-export-submit" disabled={busy || !validSelection} onClick={() => void onExport(options)}>{busy ? "Preparing export…" : options.format === "PDF" ? "Open print / Save as PDF" : `Download ${options.format}`}</button>
  </section>;
}
