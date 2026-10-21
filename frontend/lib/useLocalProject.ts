"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PersistedFloorplan } from "../components/FullFloorplanEditor";
import { newProject, parseProject, type AssetDefinition, type AssetInstance, type ProjectDocument } from "./projectDocument";
import { activeFloor, floorContent, projectFloors } from "./buildingDocument";
import { validateFloorOpening, validateFloorSupports } from "./buildingGeometry";
import type { RenderCameraState } from "./renderCamera";
import { projectRepository } from "./projectRepository";
import { exportProject, importProject } from "./projectPackage";
import { analytics, exported } from "./analytics";
import type { ElectricalLayoutData } from "./electricalLayout";
import type { PlannerBuildData } from "./plannerBuild";
import type { Room } from "./types";
import type { QuoteDocument } from "./quoteDocument";
import type { HeatingProject } from "./heatingDocument";
import type { EnergyProject } from "./energyDocument";
import { commitHeatingElements } from "./heatingElements";
import { ProjectHistory } from "./projectHistory";
import { matchesProjectScope } from "./projectScope";
import { cfdScenariosSchema, type CFDScenario } from "./climoptixDocument";

export function useLocalProject() {
  const [project, setProject] = useState<ProjectDocument | null>(null);
  const [status, setStatus] = useState("Opening local project…");
  const [revision, setRevision] = useState(0);
  const [restore, setRestore] = useState<ProjectDocument | null>(null);
  const [documentSession,setDocumentSession]=useState(0);
  const sessionRef=useRef(0);
  const resetSession=useCallback(()=>setDocumentSession(++sessionRef.current),[]);
  const current = useRef<ProjectDocument | null>(null);
  const lastSaved = useRef<string>("");
  const history = useRef(new ProjectHistory());
  const [historyStatus,setHistoryStatus]=useState({canUndo:false,canRedo:false});
  const refreshHistory=useCallback(()=>{const canUndo=history.current.past.length>0,canRedo=history.current.future.length>0;setHistoryStatus(s=>s.canUndo===canUndo&&s.canRedo===canRedo?s:{canUndo,canRedo});},[]);
  const replace = useCallback((p: ProjectDocument) => { resetSession();history.current.clear();refreshHistory(); current.current = p; lastSaved.current = JSON.stringify(p); setProject(p); setRestore(p); setRevision(r => r + 1); }, [refreshHistory,resetSession]);
  useEffect(() => {
    let cancelled = false;
    void projectRepository.currentProject().then(p => { if (!cancelled && p) { replace(p); setStatus("Saved locally"); } }).catch(() => {
      if (!cancelled) { replace(newProject()); setStatus("Could not recover local data. Your previous records have been kept; export a backup before leaving."); }
    });
    return () => { cancelled = true; };
  }, [replace]);
  const update = useCallback((changes: Partial<ProjectDocument>, forceHistory = false) => {
    const p = current.current; if (!p) return;
    // An empty floor publishes a fresh [] when the editor is restored. Avoid
    // feeding an unchanged snapshot back into the editor and starving autosave.
    if (Object.entries(changes).every(([key,value]) => JSON.stringify(p[key as keyof ProjectDocument]) === JSON.stringify(value))) return;
    let next = { ...p, ...changes, updatedAt: new Date().toISOString() };
    if(changes.rooms&&next.building?.roof.roomOverrides){const ids=new Set(projectFloors(next).flatMap(f=>f.content.rooms.map(room=>room.id)));next={...next,building:{...next.building,roof:{...next.building.roof,roomOverrides:next.building.roof.roomOverrides.filter(item=>ids.has(item.roomId))}}};}
    history.current.record(p,next,forceHistory);
    refreshHistory();
    current.current = next; setProject(next);
  }, [refreshHistory]);
  const isScopeCurrent = useCallback((scope:string|undefined)=>matchesProjectScope(current.current,scope,sessionRef.current),[]);
  const changeFloorplan = useCallback((floorplan: PersistedFloorplan, rooms: Room[], scope?:string) => {
    const p=current.current;if(!p||scope!==undefined&&!matchesProjectScope(p,scope,sessionRef.current))return;
    const geometry=(plan:PersistedFloorplan|null,items:Room[])=>JSON.stringify([plan?.walls.map(w=>w.points)??[],items.map(r=>r.vertices)]);
    try{const floor=activeFloor(p);for(const opening of floor.openings)validateFloorOpening({...floorContent(p),floorplan,rooms},opening,floor.openings);if(geometry(p.floorplan,p.rooms)!==geometry(floorplan,rooms))validateFloorSupports(projectFloors({...p,floorplan,rooms}));}
    catch(error){const message=error instanceof Error?error.message:"Invalid slab geometry.";setStatus("Wall edit not saved. Previous geometry kept.");setRestore(p);setRevision(r=>r+1);return message;}
    update({ floorplan, rooms });
  }, [update]);
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
  const setRenderCamera = useCallback((renderCamera: RenderCameraState) => update({ renderCamera }), [update]);
  const setElectricalLayout = useCallback((electricalLayout: ElectricalLayoutData) => update({ electricalLayout }), [update]);
  const setElectricalProjectData = useCallback((rooms: Room[], electricalLayout: ElectricalLayoutData, assetInstances: AssetInstance[], assets?: AssetDefinition[]) => update({ rooms, electricalLayout, assetInstances, ...(assets ? { assets } : {}) }), [update]);
  const setPlannerBuild = useCallback((plannerBuild: PlannerBuildData) => update({ plannerBuild }), [update]);
  const setQuotes = useCallback((quotes: QuoteDocument[]) => update({ quotes }), [update]);
  const saveQuotes = useCallback(async (quotes: QuoteDocument[]) => {
    if (!current.current) throw new Error("Your project is still opening.");
    const base = current.current;
    const snapshot = { ...base, quotes, updatedAt: new Date().toISOString() };
    setStatus("Saving locally…");
    try {
      await projectRepository.saveProject(snapshot);
      if (current.current === base) {
        current.current = snapshot; setProject(snapshot);
        lastSaved.current = JSON.stringify(snapshot); setStatus("Saved locally");
      } else {
        // Preserve edits made while saving; only append a newly saved copy.
        const added = quotes.filter(quote => !base.quotes?.some(item => item.quoteId === quote.quoteId));
        if (added.length) update({ quotes: [...(current.current?.quotes ?? []), ...added] });
      }
    } catch (cause) { setStatus("Local save failed. Download a backup."); throw cause; }
  }, [update]);
  const setHeatingLayout = useCallback((heatingLayout: HeatingProject) => {
    const p = current.current; if (!p) return;
    const next = commitHeatingElements(heatingLayout, p.rooms); update(next); return next.rooms;
  }, [update]);
  const setEnergyLayout = useCallback((energyLayout: EnergyProject) => update({ energyLayout }), [update]);
  const setCFDScenarios = useCallback((scenarios: CFDScenario[],scope?:string,checkpoint=false) => {
    const p=current.current;
    if(!p||!matchesProjectScope(p,scope,sessionRef.current))return;
    const next=cfdScenariosSchema.parse(scenarios);
    if(next.some(s=>s.sourceBuildingId!==p.projectId))throw new Error("Scenario source does not match this project.");
    update({cfdScenarios:next},checkpoint);
  },[update]);
  const restoreEdit = useCallback((p: ProjectDocument | null) => { if(!p)return null;refreshHistory(); const next={...p,updatedAt:new Date().toISOString()};current.current=next;setProject(next);setRestore(next);setRevision(r=>r+1);return next; },[refreshHistory]);
  const editBuilding = useCallback((operation:(p:ProjectDocument)=>ProjectDocument,resetDocument=false) => { const before=current.current;if(!before)return null;const result=operation(before);if(result===before)return before;const next=parseProject(result);if(JSON.stringify(before.building?.floors.map(f=>f.id))!==JSON.stringify(next.building?.floors.map(f=>f.id)))validateFloorSupports(projectFloors(next));history.current.record(before,next,true);if(resetDocument)resetSession();return restoreEdit(next); },[restoreEdit,resetSession]);
  const undo = useCallback(()=>current.current ? restoreEdit(history.current.undo(current.current)) : null,[restoreEdit]);
  const redo = useCallback(()=>current.current ? restoreEdit(history.current.redo(current.current)) : null,[restoreEdit]);
  return { project, restore, revision, documentSession, status, changeFloorplan, generated, saveFile, prepareFile, openFile, addAsset, setInstances, setRenderCamera, setElectricalLayout, setElectricalProjectData, setPlannerBuild, setQuotes, saveQuotes, setHeatingLayout, setEnergyLayout, setCFDScenarios, editBuilding, undo, redo, isScopeCurrent, ...historyStatus };
}
