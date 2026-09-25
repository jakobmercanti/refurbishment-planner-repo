"use client";

import { useEffect, useRef, useState } from "react";
import { CommercialApiError, commercialRequest, uploadSignedFile } from "@/lib/commercialApi";
import { assetRepository } from "@/lib/assetRepository";
import { convertStlToGlb, type StlUnit } from "@/lib/stlToLocalAsset";
import type { AssetClassification, AssetDefinition } from "@/lib/projectDocument";

type Mode = "stl" | "photos";
type View = "front" | "left" | "right" | "back";
type DimensionsMm = { width: number; depth: number; height: number };
type GenerationJob = {
  generation_id: string;
  asset_id: string;
  asset_name: string;
  declared_dimensions_mm: DimensionsMm;
  status: "queued" | "submitting" | "generating" | "storing" | "succeeded" | "failed" | "cancelled";
  progress: number;
  category_id?: string;
  category_name?: string;
  subcategory?: string;
  safe_error?: string | null;
  created_at?: string;
};
type Availability = { enabled: boolean; remaining: number; reason: string | null };

const VIEW_NAMES: View[] = ["front", "left", "right", "back"];
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export function AddCustomAssetDialog({ classification, onImport }: { classification: AssetClassification; onImport: (asset: AssetDefinition) => void }) {
  const [mode, setMode] = useState<Mode>("stl");
  const [stlUnit, setStlUnit] = useState<StlUnit>("mm");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [views, setViews] = useState<View[]>([]);
  const [assetName, setAssetName] = useState("");
  const [dimensions, setDimensions] = useState({ width: "", depth: "", height: "" });
  const [verifiedJobIds, setVerifiedJobIds] = useState<Set<string>>(() => new Set());
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [importingJobId, setImportingJobId] = useState("");
  const [importedJobs, setImportedJobs] = useState<Set<string>>(() => new Set());
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void commercialRequest<Availability>("/ai-3d/status")
      .then(value => { if (mounted) setAvailability(value); })
      .catch(reason => {
        const message = reason instanceof CommercialApiError && reason.status === 401
          ? "Sign in to check AI 3D generation access."
          : "AI 3D generation availability could not be checked.";
        if (mounted) setAvailability({ enabled: false, remaining: 0, reason: message });
      });
    void commercialRequest<{ jobs: GenerationJob[] }>("/ai-3d/jobs")
      .then(result => {
        if (!mounted) return;
        setJobs(result.jobs);
        setSelectedJobId(current => current || result.jobs[0]?.generation_id || "");
      })
      .catch(() => undefined);
    return () => { mounted = false; };
  }, []);

  const selectedJob = jobs.find(job => job.generation_id === selectedJobId) ?? null;
  const selectedGenerationId = selectedJob?.generation_id ?? "";
  const selectedJobStatus = selectedJob?.status ?? "";
  useEffect(() => {
    if (!selectedGenerationId || ["succeeded", "failed", "cancelled"].includes(selectedJobStatus)) return;
    let mounted = true;
    const poll = async () => {
      try {
        const job = await commercialRequest<GenerationJob>("/ai-3d/jobs/" + selectedGenerationId);
        if (mounted) setJobs(current => [job, ...current.filter(item => item.generation_id !== selectedGenerationId)]);
      }
      catch { /* The job remains available for a later refresh. */ }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 5000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [selectedGenerationId, selectedJobStatus]);

  async function importStl(file?: File) {
    if (!file) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const glb = await convertStlToGlb(file, stlUnit);
      const asset = await assetRepository.importLocalAsset(glb, undefined, undefined, classification);
      onImport(asset);
      setNotice("STL converted and saved in this browser. No AI service or cloud upload was used.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The STL could not be imported.");
    } finally { setBusy(false); }
  }

  function selectPhotos(files: FileList | null) {
    setError(""); setNotice("");
    const selected = Array.from(files ?? []);
    if (selected.length > 3) { setPhotos([]); setViews([]); setError("Choose no more than three photos."); return; }
    const invalid = selected.find(file => !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size < 1 || file.size > MAX_PHOTO_BYTES);
    if (invalid) { setPhotos([]); setViews([]); setError("Each photo must be PNG, JPEG or WebP and no larger than 10 MB."); return; }
    setPhotos(selected);
    setViews(selected.map((_, index) => VIEW_NAMES[index]));
  }

  function changeView(index: number, view: View) {
    setViews(current => current.map((currentView, currentIndex) => currentIndex === index ? view : currentView));
  }

  function setJobVerified(jobId: string, verified: boolean) {
    setVerifiedJobIds(current => {
      const next = new Set(current);
      if (verified) next.add(jobId);
      else next.delete(jobId);
      return next;
    });
  }

  async function generate() {
    setError(""); setNotice("");
    if (!availability?.enabled) { setError(availability?.reason ?? "AI 3D generation is not enabled for this account."); return; }
    if (photos.length < 1 || photos.length > 3) { setError("Choose between one and three photos."); return; }
    if (photos.length > 1 && (!views.includes("front") || new Set(views).size !== views.length)) {
      setError("For multiple photos, assign a front view and a different angle to each photo."); return;
    }
    const parsed = { width: Number(dimensions.width), depth: Number(dimensions.depth), height: Number(dimensions.height) };
    if (!Object.values(parsed).every(value => Number.isFinite(value) && value > 0 && value <= 10000)) {
      setError("Enter positive width, depth and height values in millimetres (up to 10,000 mm)."); return;
    }
    if (!assetName.trim()) { setError("Enter a name for this asset."); return; }
    setBusy(true);
    try {
      const references: { reservation_id: string; view: View }[] = [];
      for (const [index, file] of photos.entries()) {
        const reservation = await commercialRequest<{ reservation_id: string; upload_url: string; required_headers: Record<string, string> }>("/ai-3d/references/upload", {
          method: "POST", body: JSON.stringify({ content_type: file.type, expected_bytes: file.size }),
        });
        await uploadSignedFile(reservation.upload_url, reservation.required_headers, file);
        references.push({ reservation_id: reservation.reservation_id, view: views[index] });
      }
      idempotencyKey.current ??= crypto.randomUUID();
      const result = await commercialRequest<{ status: string; generation: GenerationJob }>("/ai-3d/jobs", {
        method: "POST",
        body: JSON.stringify({
          name: assetName.trim(), dimensions_mm: parsed, references, idempotency_key: idempotencyKey.current,
          category_id: classification.categoryId, subcategory: classification.subcategory,
        }),
      });
      idempotencyKey.current = null;
      setJobs(current => [result.generation, ...current.filter(job => job.generation_id !== result.generation.generation_id)]);
      setSelectedJobId(result.generation.generation_id);
      setNotice("Generation queued. You can close this window; the job remains available in your asset library.");
      setAvailability(current => current ? { ...current, remaining: Math.max(0, current.remaining - (result.status === "created" ? 1 : 0)) } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The AI 3D generation could not be queued.");
    } finally { setBusy(false); }
  }

  async function addGeneratedAsset(job: GenerationJob) {
    setImportingJobId(job.generation_id); setError("");
    try {
      const link = await commercialRequest<{ url: string }>(`/assets/${job.asset_id}/download?variant=model`);
      const response = await fetch(link.url, { cache: "no-store" });
      if (!response.ok) throw new Error("The generated model download failed. Try again.");
      const model = await response.blob();
      if (model.size < 20 || model.size > 50 * 1024 * 1024) throw new Error("The generated model is outside the 50 MB planner limit.");
      const safeName = job.asset_name.replace(/[\\/:*?"<>|]/g, "-").slice(0, 180) || "AI 3D asset";
      const file = new File([model], `${safeName}.glb`, { type: "model/gltf-binary" });
      const dimensions = job.declared_dimensions_mm;
      const savedClassification: AssetClassification = {
        categoryId: job.category_id ?? classification.categoryId,
        categoryName: job.category_name ?? classification.categoryName,
        subcategory: job.subcategory ?? classification.subcategory,
      };
      const asset = await assetRepository.importLocalAsset(
        file,
        dimensions,
        verifiedJobIds.has(job.generation_id) ? "user-verified" : "user-declared",
        savedClassification,
      );
      onImport(asset);
      setImportedJobs(current => new Set(current).add(job.generation_id));
      setNotice(`${job.asset_name} was added to this planner as a visual-only model.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The model could not be added to this planner.");
    } finally { setImportingJobId(""); }
  }

  const selectedJobWasImported = selectedJob ? importedJobs.has(selectedJob.generation_id) : false;
  return <div className="custom-asset-content">
      <div className="custom-asset-tabs" role="tablist" aria-label="Custom asset method">
        <button type="button" role="tab" aria-selected={mode === "stl"} className={mode === "stl" ? "active" : ""} onClick={() => { setMode("stl"); setError(""); }}>Free STL</button>
        <button type="button" role="tab" aria-selected={mode === "photos"} className={mode === "photos" ? "active" : ""} onClick={() => { setMode("photos"); setError(""); }}>Generate from photos</button>
      </div>

      {mode === "stl" ? <section className="custom-asset-panel" role="tabpanel">
        <h3>Import a model for free</h3>
        <p>Choose an STL file and its coordinate unit. It is converted to GLB locally and stays in this browser; no account or AI generation is used.</p>
        <label className="custom-asset-field">STL units
          <select value={stlUnit} onChange={event => setStlUnit(event.target.value as StlUnit)} disabled={busy}>
            <option value="mm">Millimetres (mm)</option><option value="cm">Centimetres (cm)</option><option value="in">Inches (in)</option>
          </select>
        </label>
        <label className="custom-asset-file">Choose STL file (up to 50 MB)
          <input type="file" accept=".stl,model/stl,application/sla" disabled={busy} onChange={event => { void importStl(event.target.files?.[0]); event.target.value = ""; }} />
        </label>
        {busy && <p role="status">Converting STL to GLB locally…</p>}
      </section> : <section className="custom-asset-panel" role="tabpanel">
        <h3>Create a model from photos</h3>
        <p>Upload one front photo, or up to three views of the same object. For multiple photos, include a front view and assign a different angle to each.</p>
        <div className="custom-asset-form-grid">
          <label className="custom-asset-field span-two">Asset name
            <input value={assetName} maxLength={200} onChange={event => setAssetName(event.target.value)} placeholder="e.g. Walnut vanity" />
          </label>
          {(["width", "depth", "height"] as const).map(axis => <label className="custom-asset-field" key={axis}>{axis[0].toUpperCase() + axis.slice(1)} (mm)
            <input type="number" min="1" max="10000" step="1" value={dimensions[axis]} onChange={event => setDimensions(current => ({ ...current, [axis]: event.target.value }))} placeholder="mm" />
          </label>)}
        </div>
        <label className="custom-asset-file">Photos (1–3, PNG/JPEG/WebP, 10 MB each)
          <input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={busy} onChange={event => { selectPhotos(event.target.files); event.target.value = ""; }} />
        </label>
        {photos.length > 0 && <div className="custom-asset-photos">
          {photos.map((photo, index) => <div className="custom-asset-photo-row" key={`${photo.name}-${photo.lastModified}-${index}`}>
            <span>{photo.name} <small>({(photo.size / (1024 * 1024)).toFixed(1)} MB)</small></span>
            {photos.length > 1 ? <label>View<select value={views[index]} disabled={index === 0} onChange={event => changeView(index, event.target.value as View)}>
              {VIEW_NAMES.filter(view => view === views[index] || !views.some((assigned, otherIndex) => assigned === view && otherIndex !== index)).map(view => <option value={view} key={view}>{view[0].toUpperCase() + view.slice(1)}</option>)}
            </select></label> : <span>Front view</span>}
          </div>)}
        </div>}
        <p className="custom-asset-dimension-note">Your entered dimensions are saved as the intended physical size. Tripo infers visual proportions from photos; it does not accept exact width/depth/height controls, and the generated mesh is not a fit measurement.</p>
        <p className="custom-asset-privacy-note">Photos are sent to Tripo only after you choose Generate. They are uploaded through private temporary storage and removed after the provider accepts the job; Tripo’s processing is subject to its privacy terms.</p>
        {availability && !availability.enabled && <p className="custom-asset-gate" role="status">{availability.reason ?? "AI 3D generation is not enabled for this account yet."}</p>}
        {availability?.enabled && <p className="custom-asset-allowance" role="status">{availability.remaining} AI generation{availability.remaining === 1 ? "" : "s"} available this billing period.</p>}
        <button type="button" className="custom-asset-primary" disabled={busy || !availability?.enabled} onClick={() => { void generate(); }}>{busy ? "Preparing photos…" : "Generate 3D asset"}</button>
        {selectedJob && <div className="custom-asset-job" aria-live="polite">
          <div className="custom-asset-job-heading"><strong>{selectedJob.asset_name}</strong><span>{selectedJob.status.replaceAll("-", " ")}</span></div>
          {!(["succeeded", "failed", "cancelled"].includes(selectedJob.status)) && <><progress max="100" value={selectedJob.progress} /><p>{selectedJob.status === "queued" ? "Waiting for the generation worker…" : selectedJob.status === "submitting" ? "Preparing your photos for Tripo…" : selectedJob.status === "storing" ? "Checking and saving the private model…" : "Tripo is generating the model…"} {selectedJob.progress}%</p></>}
          {selectedJob.status === "failed" && <p role="alert">{selectedJob.safe_error ?? "Generation failed. You can review the photos and try again."}</p>}
          {selectedJob.status === "succeeded" && <>
            <p>Intended dimensions: {selectedJob.declared_dimensions_mm.width} × {selectedJob.declared_dimensions_mm.depth} × {selectedJob.declared_dimensions_mm.height} mm. The model remains visual-only.</p>
            <label className="custom-asset-confirm"><input type="checkbox" checked={verifiedJobIds.has(selectedJob.generation_id)} onChange={event => setJobVerified(selectedJob.generation_id, event.target.checked)} />I have independently checked these physical dimensions</label>
            <button type="button" className="custom-asset-primary" disabled={importingJobId === selectedJob.generation_id || selectedJobWasImported} onClick={() => { void addGeneratedAsset(selectedJob); }}>
              {selectedJobWasImported ? "Added to planner" : importingJobId === selectedJob.generation_id ? "Downloading model…" : "Add to this planner"}
            </button>
          </>}
        </div>}
        {jobs.length > 1 && <label className="custom-asset-field">Recent generations
          <select value={selectedJobId} onChange={event => setSelectedJobId(event.target.value)}>{jobs.map(job => <option value={job.generation_id} key={job.generation_id}>{job.asset_name} — {job.status}</option>)}</select>
        </label>}
      </section>}

      {notice && <p className="custom-asset-success" role="status">{notice}</p>}
      {error && <p className="custom-asset-error" role="alert">{error}</p>}
  </div>;
}
