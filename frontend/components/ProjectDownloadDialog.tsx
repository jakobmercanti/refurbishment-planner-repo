"use client";
import { useEffect, useRef, useState } from "react";
import { exported } from "@/lib/analytics";

export function ProjectDownloadDialog({ file, onClose }: { file: File; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [sharing, setSharing] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  // ZIP is recognised by native share sheets and file pickers. Its contents are
  // the same portable project; Open accepts either extension.
  const shareFile = new File([file], `${file.name}.zip`, { type: "application/zip" });
  const canShare = typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [shareFile] });
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => { setTimeout(() => URL.revokeObjectURL(objectUrl), 60000); };
  }, [file]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  async function share() {
    setError(""); setSharing(true);
    try { await navigator.share({ files: [shareFile] }); }
    catch (reason) { if (!(reason instanceof Error && reason.name === "AbortError")) setError("Sharing is unavailable here. Use Download project instead."); }
    finally { setSharing(false); }
  }
  return <div className="modal-backdrop project-download-backdrop">
    <section ref={dialog} tabIndex={-1} className="save-as-dialog project-download-dialog" role="dialog" aria-modal="true" aria-labelledby="project-download-title" onKeyDown={event => {
      if (event.key === "Escape" && !sharing) { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)'));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <header><h2 id="project-download-title">Your project is ready</h2><button type="button" className="modal-close" aria-label="Close project download" onClick={onClose}>×</button></header>
      <p className="project-download-name">{file.name}</p>
      <p>Includes every room and the 3D models used in your plan. Keep this file as a backup or open it on another device.</p>
      <div className="project-download-actions">
        {url && <a className="primary" href={url} download={file.name} onClick={() => exported("floorplan3d")}>Download project</a>}
        {canShare && <button type="button" disabled={sharing} onClick={() => void share()}>{sharing ? "Sharing…" : "Share / Save to Files…"}</button>}
      </div>
      <p className="project-download-help">On iPhone or iPad, save to Files. On Android, look in Downloads. To return later, choose <strong>File → Open project</strong> and select the saved .floorplan3d or .zip file. No unzipping is needed.</p>
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" onClick={onClose}>Done</button></footer>
    </section>
  </div>;
}
