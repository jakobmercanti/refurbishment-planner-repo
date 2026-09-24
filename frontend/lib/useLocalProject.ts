"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PersistedFloorplan } from "../components/FullFloorplanEditor";
import { newProject, type AssetDefinition, type AssetInstance, type ProjectDocument } from "./projectDocument";
import { projectRepository } from "./projectRepository";
import { exportProject, importProject } from "./projectPackage";
import { analytics, exported } from "./analytics";
import type { Room } from "./types";

export function useLocalProject() {
  const [project, setProject] = useState<ProjectDocument | null>(null);
  const [status, setStatus] = useState("Opening local project…");
  const [revision, setRevision] = useState(0);
  const [restore, setRestore] = useState<ProjectDocument | null>(null);
  const current = useRef<ProjectDocument | null>(null);
  const lastSaved = useRef<string>("");
  const replace = useCallback((p: ProjectDocument) => { current.current = p; lastSaved.current = JSON.stringify(p); setProject(p); setRestore(p); setRevision(r => r + 1); }, []);
  useEffect(() => {
    let cancelled = false;
    void projectRepository.currentProject().then(p => { if (!cancelled && p) { replace(p); setStatus("Saved locally"); } }).catch(() => {
      if (!cancelled) { replace(newProject()); setStatus("Could not recover local data. Your previous records have been kept; export a backup before leaving."); }
    });
    return () => { cancelled = true; };
  }, [replace]);
  const update = useCallback((changes: Partial<ProjectDocument>) => {
    const p = current.current; if (!p) return;
    const next = { ...p, ...changes, updatedAt: new Date().toISOString() };
    current.current = next; setProject(next);
  }, []);
  const changeFloorplan = useCallback((floorplan: PersistedFloorplan, rooms: Room[]) => update({ floorplan, rooms }), [update]);
  useEffect(() => {
    if (!project || JSON.stringify(project) === lastSaved.current) return;
    const timer = setTimeout(() => {
      setStatus("Saving locally…");
      void projectRepository.saveProject(project).then(() => { lastSaved.current = JSON.stringify(project); setStatus("Saved locally"); }).catch(e => setStatus(e instanceof Error ? e.message : "Local save failed. Download a backup."));
    }, 900);
    return () => clearTimeout(timer);
  }, [project]);
  useEffect(() => {
    const flush = () => { if (current.current && JSON.stringify(current.current) !== lastSaved.current) void projectRepository.saveProject(current.current).catch(() => undefined); };
    const visibility = () => { if (document.visibilityState === "hidden") flush(); };
    const leave = (event: BeforeUnloadEvent) => { if (current.current && JSON.stringify(current.current) !== lastSaved.current) { flush(); event.preventDefault(); } };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("beforeunload", leave);
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("beforeunload", leave); };
  }, []);
  const generated = useCallback(async () => {
    const p = current.current; if (!p || p.generated) return;
    update({ generated: true });
    // Persist the once-per-project marker before dispatch; storage failure doesn't break the planner.
    try { await projectRepository.saveProject(current.current!); analytics.capture("floorplan_generated"); } catch { setStatus("Could not save locally. Download a backup."); }
  }, [update]);
  const prepareFile = useCallback(async (filename = "my-floorplan") => {
    if (!current.current) throw new Error("Your project is still opening. Please try again.");
    const output = await exportProject(current.current);
    const name = filename.replace(/[\\/:*?"<>|]/g, "-").replace(/\.floorplan3d(?:\.zip)?$/i, "").trim() || "my-floorplan";
    return new File([output], `${name}.floorplan3d`, { type: "application/zip" });
  }, []);
  const saveFile = useCallback(async (filename = "my-floorplan") => {
    const file = await prepareFile(filename), url = URL.createObjectURL(file);
    const a = document.createElement("a"); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000); exported("floorplan3d");
  }, [prepareFile]);
  const openFile = useCallback(async (file: File) => { const p = await importProject(file); replace(p); setStatus("Saved locally"); }, [replace]);
  const addAsset = useCallback((asset: AssetDefinition) => { const p = current.current; if (p && !p.assets.some(a => a.assetId === asset.assetId)) update({ assets: [...p.assets, asset] }); }, [update]);
  const setInstances = useCallback((assetInstances: AssetInstance[]) => update({ assetInstances }), [update]);
  return { project, restore, revision, status, changeFloorplan, generated, saveFile, prepareFile, openFile, addAsset, setInstances };
}
