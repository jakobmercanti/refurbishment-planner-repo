"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";
import { createPortal } from "react-dom";
import { FloatingToolbar } from "./FloatingToolbar";

export interface ReportPreviewOptions { title: string; includeDetails: boolean }
function PdfReportPages({ bytes }: { bytes: Uint8Array }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(1), [count, setCount] = useState(1), [error, setError] = useState("");
  const [rendered, setRendered] = useState<{ bytes: Uint8Array; page: number } | null>(null);
  const ready = rendered?.bytes === bytes && rendered.page === page;
  useEffect(() => {
    let active = true, loading: PDFDocumentLoadingTask | undefined, render: RenderTask | undefined;
    void (async () => {
      const pdfjs = await import("pdfjs-dist");
      if (!active) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      loading = pdfjs.getDocument({ data: new Uint8Array(bytes) });
      const pdf = await loading.promise;
      if (!active) return;
      setCount(pdf.numPages); const sheet = await pdf.getPage(Math.min(page, pdf.numPages));
      const target = canvas.current; if (!active || !target) return;
      const viewport = sheet.getViewport({ scale: 1.5 }); target.width = viewport.width; target.height = viewport.height;
      render = sheet.render({ canvas: target, viewport }); await render.promise;
      if (active) { setError(""); setRendered({ bytes, page }); }
    })().catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Preview could not be rendered."); });
    return () => { active = false; render?.cancel(); void loading?.destroy(); };
  }, [bytes, page]);
  return <><div className="report-page-navigation"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous page</button><span>Page {Math.min(page, count)} of {count}</span><button type="button" disabled={page >= count} onClick={() => setPage(page + 1)}>Next page</button></div>{error && <p role="alert">{error}</p>}<div className="report-pdf-preview" aria-busy={!ready}>{!ready && !error && <p role="status">Rendering page…</p>}<canvas ref={canvas} role="img" aria-label={`PDF report preview, page ${Math.min(page, count)} of ${count}`} style={{ visibility: ready ? "visible" : "hidden" }} /></div></>;
}
export function ReportExportPreview({ title, fileName, makePdf, onClose }: { title: string; fileName: string; makePdf: (options: ReportPreviewOptions) => Promise<Uint8Array>; onClose: () => void }) {
  const [options, setOptions] = useState<ReportPreviewOptions>({ title, includeDetails: true });
  const [name, setName] = useState(fileName), [preview, setPreview] = useState<{ bytes: Uint8Array; url: string; key: string; builder: typeof makePdf } | null>(null), [error, setError] = useState("");
  const current = preview?.key === JSON.stringify(options) && preview.builder === makePdf ? preview : null;
  useEffect(() => {
    let active = true, url: string | undefined;
    const timer = setTimeout(() => { setPreview(null); setError(""); void makePdf(options).then(bytes => {
      if (!active) return; const blob = new Blob([new Uint8Array(bytes).buffer], { type: "application/pdf" });
      url = URL.createObjectURL(blob); setPreview({ bytes, url, key: JSON.stringify(options), builder: makePdf });
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Could not create the preview."); }); }, 180);
    return () => { active = false; clearTimeout(timer); if (url) URL.revokeObjectURL(url); };
  }, [makePdf, options]);
  return createPortal(<FloatingToolbar title={`${title} — preview`} className="report-export-preview" dialog defaultPosition={{ x: 80, y: 70 }} initialSize={{ width: 900, height: 760 }} maxHeight={900} bringToFront onClose={onClose}>
    <div className="report-preview-options"><label>Report title<input value={options.title} maxLength={100} onChange={e => setOptions({ ...options, title: e.target.value })} /></label><label>File name<input value={name} maxLength={120} onChange={e => setName(e.target.value)} /></label><label><input type="checkbox" checked={options.includeDetails} onChange={e => setOptions({ ...options, includeDetails: e.target.checked })} />Include calculation details</label></div>
    {error && <p role="alert">{error}</p>}
    {current ? <PdfReportPages bytes={current.bytes} /> : !error && <p role="status">Preparing preview…</p>}
    <div className="report-preview-actions"><button type="button" onClick={onClose}>Cancel</button><button type="button" disabled={!current || !name.trim()} onClick={() => {
      if (!current) return; const link = document.createElement("a"); link.href = current.url; link.download = (name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "-") || "report").replace(/\.pdf$/i, "") + ".pdf"; link.click();
    }}>Download PDF</button></div>
  </FloatingToolbar>, document.body);
}
