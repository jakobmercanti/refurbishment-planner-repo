/** Show the exact generated export without downloading or opening print automatically. */
export function showElectricalDocumentPreview(target: Window, html: string, file?: { blob: Blob; name: string; onDownload: () => void }) {
  target.opener = null;
  target.document.open(); target.document.write(html); target.document.close();
  const doc = target.document;
  const style = doc.createElement("style");
  style.textContent = "@media screen{body{background:#e6edf3;padding:16px}.print-sheet{background:white;padding:12mm;margin:18px auto;box-shadow:0 2px 14px #10234420}.export-preview-actions{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:center;gap:12px;background:#102344;color:white;padding:12px;border-radius:8px;font:14px Arial}.export-preview-actions button{padding:10px 16px;border:0;border-radius:6px;cursor:pointer}.drawing-preview{background:white;max-width:100%;padding:16px}.drawing-preview img{width:100%;height:auto}}@media print{.export-preview-actions{display:none!important}body{padding:0;background:white}}";
  doc.head.append(style);
  const actions = doc.createElement("nav"); actions.className = "export-preview-actions"; actions.setAttribute("aria-label", "Document preview actions");
  const label = doc.createElement("strong"); label.textContent = "Electrical export preview · nothing exported yet";
  const exportButton = doc.createElement("button"); exportButton.textContent = file ? "Download drawing" : "Print / Save as PDF";
  exportButton.addEventListener("click", () => {
    if (!file) { target.print(); return; }
    const url = URL.createObjectURL(file.blob), link = doc.createElement("a"); link.href = url; link.download = file.name; link.click(); file.onDownload();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
  const close = doc.createElement("button"); close.textContent = "Close preview"; close.addEventListener("click", () => target.close());
  actions.append(label, exportButton, close); doc.body.prepend(actions);
}
