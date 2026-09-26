"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { CommercialApiError, commercialRequest, uploadSignedFile } from "@/lib/commercialApi";
import { currentSession, signOut, type AuthSession } from "@/lib/commercialAuth";
import { projectRepository } from "@/lib/projectRepository";
import { assetRepository } from "@/lib/assetRepository";
import { parseProject, type AssetClassification, type ProjectDocument } from "@/lib/projectDocument";

type Usage = { projects: number; assets: number; storage_bytes: number };
type Summary = { plan: string; name: string; status: string; monthly_price_pence: number; storage_limit_bytes: number; project_limit: number; asset_limit: number; medium_remaining: number; high_remaining: number; capabilities: { maxElectricalElementsPerProject: number | null }; usage: Usage };
type CloudProject = { project_id: string; title: string; revision: number; byte_size: number; updated_at: string; project_json?: unknown };
type Asset = { asset_id: string; local_asset_key?: string | null; name: string; original_format: string; processing_status: string; processing_error?: string; triangle_count?: number; source_unit?: string; category_id?: string; category_name?: string; subcategory?: string };
type Render = { render_id: string; quality_class: string; status: string; safe_error?: string; created_at: string; image_url?: string };
type Conflict = { local: ProjectDocument; remote: ProjectDocument; revision: number };
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function WorkspacePage() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [projects, setProjects] = useState<CloudProject[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [renders, setRenders] = useState<Render[]>([]);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stlUnit, setStlUnit] = useState<"mm" | "cm" | "in">("mm");
  const [renderQuality, setRenderQuality] = useState<"medium" | "high">("medium");
  const [renderPrompt, setRenderPrompt] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [account, cloud, models, jobs] = await Promise.all([
        commercialRequest<Summary>("/summary"), commercialRequest<{ projects: CloudProject[] }>("/projects"),
        commercialRequest<{ assets: Asset[] }>("/assets"), commercialRequest<{ renders: Render[] }>("/renders"),
      ]);
      setSummary(account); setProjects(cloud.projects); setAssets(models.assets);
      const details = await Promise.all(jobs.renders.slice(0, 12).map((render) => render.status === "succeeded"
        ? commercialRequest<Render>(`/renders/${render.render_id}`).catch(() => render) : Promise.resolve(render)));
      setRenders(details);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Workspace data could not be loaded."); }
  }, []);

  useEffect(() => {
    let mounted = true;
    void currentSession()
      .then((value) => { if (mounted) { setSession(value); if (value) void refresh(); } })
      .catch(() => { if (mounted) setError("Account access is temporarily unavailable. Refresh this page to try again."); });
    return () => { mounted = false; };
  }, [refresh]);

  useEffect(() => {
    const renderPending = renders.some((render) => render.status === "queued" || render.status === "processing");
    const assetPending = assets.some((asset) => asset.processing_status === "uploading" || asset.processing_status === "queued" || asset.processing_status === "processing");
    if (!renderPending && !assetPending) return;
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [assets, renders, refresh]);

  async function uploadAssetFile(file: File, localAssetKey?: string, sourceUnit?: "mm" | "cm" | "in", classification?: AssetClassification) {
    const format = file.name.toLowerCase().endsWith(".stl") ? "stl" : "glb";
    const contentType = format === "glb" ? "model/gltf-binary" : file.type === "model/stl" || file.type === "application/sla" ? file.type : "application/octet-stream";
    const reserved = await commercialRequest<{ asset_id: string; upload_url: string; required_headers: Record<string, string> }>("/assets/upload", {
      method: "POST", body: JSON.stringify({ name: file.name, format, content_type: contentType, expected_bytes: file.size,
        source_unit: format === "stl" ? sourceUnit ?? "mm" : null, local_asset_key: format === "glb" ? localAssetKey ?? null : null,
        category_id: classification?.categoryId ?? "custom", subcategory: classification?.subcategory ?? "General" }),
    });
    await uploadSignedFile(reserved.upload_url, reserved.required_headers, file);
    await commercialRequest(`/assets/${reserved.asset_id}/finalize`, { method: "POST" });
    return reserved.asset_id;
  }

  async function restoreProjectAssets(document: ProjectDocument) {
    for (const asset of document.assets) {
      try { await assetRepository.getAssetBlob(asset.assetId); continue; } catch { /* download a cloud copy below */ }
      const link = await commercialRequest<{ url: string; name?: string }>(`/assets/local/${encodeURIComponent(asset.assetId)}/download`);
      const response = await fetch(link.url);
      if (!response.ok) throw new Error(`The cloud copy of “${asset.name}” could not be downloaded.`);
      const blob = await response.blob();
      const restored = await assetRepository.importLocalAsset(new File([blob], asset.name.endsWith(".glb") ? asset.name : `${asset.name}.glb`, { type: "model/gltf-binary" }));
      if (restored.assetId !== asset.assetId || restored.contentHash !== asset.contentHash) throw new Error(`The downloaded model “${asset.name}” did not match the project reference.`);
    }
  }

  async function saveLocalProject() {
    setBusy(true); setError(""); setNotice(""); setConflict(null);
    try {
      const local = parseProject(await projectRepository.currentProject());
      for (const asset of local.assets) {
        const backedUp = assets.find((item) => item.local_asset_key === asset.assetId);
        if (backedUp?.processing_status === "ready") continue;
        if (backedUp) throw new Error(`“${asset.name}” is ${backedUp.processing_status}. Wait for processing to finish, or remove the failed cloud asset before retrying.`);
        const blob = await assetRepository.getAssetBlob(asset.assetId);
        await uploadAssetFile(new File([blob], asset.name, { type: "model/gltf-binary" }), asset.assetId, undefined, {
          categoryId: asset.categoryId ?? "custom", categoryName: asset.categoryName ?? "Custom", subcategory: asset.subcategory ?? "General",
        });
        setNotice(`“${asset.name}” was uploaded and is processing. Wait until its status is Ready, then back up the project.`);
        await refresh();
        return;
      }
      const existing = projects.find((project) => project.project_id === local.projectId);
      await commercialRequest(`/projects/${local.projectId}`, { method: "PUT", body: JSON.stringify({ document: local, expected_revision: existing?.revision ?? null }) });
      setNotice(`“${local.name}” was backed up to your private cloud workspace. The browser copy remains available.`);
      await refresh();
    } catch (cause) {
      if (cause instanceof CommercialApiError && cause.status === 409 && typeof cause.detail === "object" && cause.detail) {
        const value = cause.detail as { serverRevision?: unknown; serverProject?: unknown };
        try {
          if (typeof value.serverRevision === "number" && value.serverProject) {
            setConflict({ local: parseProject(await projectRepository.currentProject()), remote: parseProject(value.serverProject), revision: value.serverRevision });
            return;
          }
        } catch { /* show the original error if a provider response cannot be parsed */ }
      }
      setError(cause instanceof Error ? cause.message : "The local project could not be backed up.");
    } finally { setBusy(false); }
  }

  async function replaceCloudCopy() {
    if (!conflict) return;
    setBusy(true); setError("");
    try {
      await commercialRequest(`/projects/${conflict.local.projectId}`, { method: "PUT", body: JSON.stringify({ document: conflict.local, expected_revision: conflict.revision }) });
      setNotice("The cloud copy was replaced with your browser copy."); setConflict(null); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The cloud copy was not replaced."); }
    finally { setBusy(false); }
  }

  async function openCloudProject(id: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await commercialRequest<CloudProject>(`/projects/${id}`);
      const document = parseProject(result.project_json);
      await restoreProjectAssets(document);
      await projectRepository.saveProject(document);
      setNotice(`“${document.name}” is now the browser's current project. Its cloud copy is unchanged.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The cloud project could not be opened."); }
    finally { setBusy(false); }
  }

  async function loadConflictingCloud() {
    if (!conflict) return;
    setBusy(true);
    try { await restoreProjectAssets(conflict.remote); await projectRepository.saveProject(conflict.remote); setNotice("The newer cloud version is now the browser's current project."); setConflict(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The cloud project could not be restored."); }
    finally { setBusy(false); }
  }

  async function removeCloudProject(project: CloudProject) {
    if (!window.confirm(`Delete the cloud backup “${project.title}”? The browser copy is not affected.`)) return;
    try { await commercialRequest(`/projects/${project.project_id}`, { method: "DELETE" }); setNotice("Cloud backup deleted. Your browser copy remains unchanged."); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The cloud backup could not be deleted."); }
  }

  async function uploadAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("model") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await uploadAssetFile(file, undefined, stlUnit);
      fileInput.value = ""; setNotice("Upload received and queued for private processing. Visual model bounds are not engineering evidence."); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The model upload could not be completed."); }
    finally { setBusy(false); }
  }

  async function removeAsset(asset: Asset) {
    if (!window.confirm(`Delete “${asset.name}” and its private model files?`)) return;
    try { await commercialRequest(`/assets/${asset.asset_id}`, { method: "DELETE" }); setNotice("The asset and its private files were deleted."); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The asset could not be deleted."); }
  }

  async function requestRender(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("reference") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const mime = file.type || (file.name.toLowerCase().endsWith(".jpg") || file.name.toLowerCase().endsWith(".jpeg") ? "image/jpeg" : file.name.toLowerCase().endsWith(".webp") ? "image/webp" : "image/png");
    setBusy(true); setError(""); setNotice("");
    try {
      const reserved = await commercialRequest<{ reservation_id: string; upload_url: string; required_headers: Record<string, string> }>("/render-references/upload", {
        method: "POST", body: JSON.stringify({ content_type: mime, expected_bytes: file.size }),
      });
      await uploadSignedFile(reserved.upload_url, reserved.required_headers, file);
      await commercialRequest("/renders", { method: "POST", body: JSON.stringify({ reservation_id: reserved.reservation_id, quality: renderQuality, prompt: renderPrompt, idempotency_key: crypto.randomUUID() }) });
      input.value = ""; setNotice("Render queued. It will appear here when ready."); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The render could not be queued."); }
    finally { setBusy(false); }
  }

  if (!session) return <main className="commercial-page"><header className="commercial-header"><a className="commercial-brand" href={`${base}/`}>FreeFloorplan3D</a><nav><a href={`${base}/account/`}>Account</a></nav></header><section className="commercial-card"><h1>Sign in to your workspace</h1><p>Cloud projects and paid features are optional. Your local planner remains available without signing in.</p><a className="commercial-primary" href={`${base}/account/`}>Go to account</a></section></main>;

  return <main className="commercial-page">
    <header className="commercial-header"><a className="commercial-brand" href={`${base}/`}>FreeFloorplan3D</a><nav><a href={`${base}/`}>Planner</a><a href={`${base}/account/`}>Account</a><button type="button" onClick={() => void signOut().then(() => { setSession(null); router.push(`${base}/account/`); })}>Sign out</button></nav></header>
    <div className="commercial-content"><div className="commercial-page-heading"><div><p className="commercial-eyebrow">CLOUD WORKSPACE</p><h1>Your projects, assets and renders</h1><p>Cloud storage is an explicit backup; local browser data is retained and is never silently overwritten.</p></div><a className="commercial-secondary" href={`${base}/`}>Return to planner</a></div>
      {error && <p className="commercial-error" role="alert">{error}</p>}{notice && <p className="commercial-status" role="status">{notice}</p>}
      {summary && <section className="commercial-panel"><div className="commercial-panel-heading"><div><h2>{summary.name} plan</h2><p>{summary.status === "free" ? "Local planner only" : `${summary.status} · £${(summary.monthly_price_pence / 100).toFixed(2)} per month`}</p></div><a href={`${base}/account/?tab=plans`}>{summary.status === "free" ? "Compare plans" : "Manage plan"}</a></div><div className="commercial-metrics"><div><span>Cloud projects</span><strong>{summary.usage.projects} / {summary.project_limit || "—"}</strong></div><div><span>Assets</span><strong>{summary.usage.assets} / {summary.asset_limit || "—"}</strong></div><div><span>Storage used</span><strong>{(summary.usage.storage_bytes / 1024 ** 3).toFixed(2)} GB / {(summary.storage_limit_bytes / 1024 ** 3).toFixed(0)} GB</strong></div><div><span>Render credits</span><strong>{summary.medium_remaining} medium · {summary.high_remaining} high</strong></div></div></section>}
      {conflict && <section className="commercial-panel conflict-panel"><h2>Choose which project copy to keep</h2><p>Both copies are preserved until you choose. Cloud revision {conflict.revision} is newer than this browser’s version.</p><div className="commercial-actions"><button className="commercial-primary" disabled={busy} onClick={() => void loadConflictingCloud()}>Use cloud copy on this device</button><button className="commercial-secondary" disabled={busy} onClick={() => void replaceCloudCopy()}>Replace cloud with browser copy</button></div></section>}
      <section className="commercial-panel"><div className="commercial-panel-heading"><div><h2>Cloud projects</h2><p>Back up this browser’s current project when you choose. Downloads do not change the cloud copy.</p></div><button className="commercial-primary compact-button" disabled={busy || summary?.status === "free"} onClick={() => void saveLocalProject()}>{busy ? "Working…" : "Back up current local project"}</button></div>
        {projects.length ? <ul className="commercial-list">{projects.map((project) => <li key={project.project_id}><div><strong>{project.title}</strong><small>Revision {project.revision} · {(project.byte_size / 1024).toFixed(1)} KB · {new Date(project.updated_at).toLocaleString()}</small></div><div className="commercial-actions"><button className="commercial-secondary" disabled={busy} onClick={() => void openCloudProject(project.project_id)}>Open in this browser</button><button className="commercial-danger" onClick={() => void removeCloudProject(project)}>Delete cloud copy</button></div></li>)}</ul> : <p className="commercial-empty">No cloud projects yet.</p>}
      </section>
      <section className="commercial-panel"><div className="commercial-panel-heading"><div><h2>Private model assets</h2><p>GLB and STL uploads are stored privately. STL source units are converted to millimetres for bounds; those bounds remain visual-only.</p></div></div>
        <form className="commercial-inline-form" onSubmit={uploadAsset}><label>Model file<input name="model" type="file" accept=".glb,.stl,model/gltf-binary,model/stl" required /></label><label>STL coordinate units<select value={stlUnit} onChange={(event) => setStlUnit(event.target.value as "mm" | "cm" | "in")}><option value="mm">mm</option><option value="cm">cm</option><option value="in">inches</option></select></label><button className="commercial-primary" disabled={busy || summary?.status === "free"}>{busy ? "Uploading…" : "Upload privately"}</button></form>
        {assets.length ? <ul className="commercial-list">{assets.map((asset) => <li key={asset.asset_id}><div><strong>{asset.name}</strong><small>{asset.category_name ?? "Custom"} · {asset.subcategory ?? "General"} · {asset.original_format.toUpperCase()} · {asset.processing_status}{asset.source_unit ? ` · source units ${asset.source_unit}` : ""}{asset.triangle_count ? ` · ${asset.triangle_count.toLocaleString()} triangles` : ""}{asset.processing_error ? ` · ${asset.processing_error}` : ""}</small></div><button className="commercial-danger" onClick={() => void removeAsset(asset)}>Delete asset</button></li>)}</ul> : <p className="commercial-empty">No uploaded assets yet.</p>}
      </section>
      <section className="commercial-panel"><div className="commercial-panel-heading"><div><h2>AI concept render</h2><p>Upload a reference image. The image and text prompt are sent to the image provider; your project document and geometry are not.</p></div></div>
        <form className="commercial-stack" onSubmit={requestRender}><label>Reference image<input name="reference" type="file" accept="image/png,image/jpeg,image/webp" required /></label><label>Quality<select value={renderQuality} onChange={(event) => setRenderQuality(event.target.value as "medium" | "high")}><option value="medium">Medium · {summary?.medium_remaining ?? 0} credits</option><option value="high">High · {summary?.high_remaining ?? 0} credits</option></select></label><label>Optional visual direction<textarea maxLength={1000} rows={3} value={renderPrompt} onChange={(event) => setRenderPrompt(event.target.value)} placeholder="Materials, lighting or mood — do not use this for measured changes" /></label><button className="commercial-primary" disabled={busy || summary?.status === "free"}>{busy ? "Queueing…" : "Create concept render"}</button></form>
        {renders.length ? <div className="render-gallery">{renders.map((render) => <article key={render.render_id}><div className="render-preview">{render.image_url ? <Image src={render.image_url} alt={`AI ${render.quality_class} visual concept`} fill unoptimized sizes="(max-width: 600px) 100vw, 25vw" /> : <span>{render.status}</span>}</div><strong>{render.quality_class === "high" ? "High" : "Medium"} concept</strong><small>{render.status}{render.safe_error ? ` · ${render.safe_error}` : ""}</small></article>)}</div> : <p className="commercial-empty">No renders yet.</p>}
      </section>
      <p className="commercial-footnote">Project geometry and fitting remain governed by the deterministic planner. AI images and processed model bounds are visual aids, not fit evidence. Your cloud copy is retained after cancellation; deletion is available above.</p>
    </div>
  </main>;
}
