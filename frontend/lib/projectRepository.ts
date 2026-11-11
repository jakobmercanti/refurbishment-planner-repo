import { completed, localDatabase, openGuestHandoffDestination, requestValue, usesGuestLocalStorage } from "./localDatabase";
import { migrateProject, newProject, parseProject, type ProjectDocument } from "./projectDocument";
import { projectElectricalAttachments, projectFloors } from "./buildingDocument";
import type { PersistedFloorplan } from "../components/FullFloorplanEditor";

export interface ProjectRepository {
  listProjects(): Promise<ProjectDocument[]>; getProject(id: string): Promise<ProjectDocument | null>;
  createProject(project: ProjectDocument): Promise<void>; saveProject(project: ProjectDocument): Promise<void>;
  deleteProject(id: string): Promise<void>; duplicateProject(id: string): Promise<ProjectDocument>;
}
export class LocalProjectRepository implements ProjectRepository {
  async listProjects() { const db = await localDatabase(); return (await requestValue(db.transaction("projects").objectStore("projects").getAll())).map(migrateProject); }
  async getProject(id: string) {
    const db = await localDatabase();
    const value = await requestValue(db.transaction("projects").objectStore("projects").get(id));
    return value ? migrateProject(value) : null;
  }
  async getBackup(id: string) { const db = await localDatabase(); const value = await requestValue(db.transaction("backups").objectStore("backups").get(id)); return value ? migrateProject(value) : null; }
  async currentProject() {
    const db = await localDatabase(); const id = await requestValue(db.transaction("meta").objectStore("meta").get("current"));
    if (id) { try { return await this.getProject(id); } catch { const backup = await this.getBackup(id); if (backup) return backup; throw new Error("Saved project is damaged; original records have been preserved."); } }
    const project = newProject();
    // Explicit import of the historical v2 browser draft. Keep the original for recovery.
    const legacy = usesGuestLocalStorage() ? localStorage.getItem("renovation-fit:complete-floorplan:v2") : null;
    if (legacy) { project.floorplan = JSON.parse(legacy) as PersistedFloorplan; parseProject(project); }
    await this.saveProject(project);
    return project;
  }
  createProject(project: ProjectDocument) { return this.saveProject(project); }

  async carryGuestDraft(project: ProjectDocument, account: string, isCurrent: () => boolean) {
    if (!usesGuestLocalStorage() || !isCurrent()) return;
    const floors = projectFloors(project);
    const hasDrawing = floors.some(({ content, openings }) => content.rooms.length || openings.length ||
      content.floorplan?.walls.length || content.floorplan?.annotations?.length || content.floorplan?.measurements?.length);
    // Opening the editor can autosave its empty canvas. Keep the account's
    // existing project selected when there is no guest work to bring across.
    if (!hasDrawing && floors.length <= 1 && !project.assets.length && !project.quotes?.length &&
      !project.plannerBuild.activities.length && !project.cfdScenarios?.length && !projectElectricalAttachments(project).length) return;
    const draft = parseProject(project);
    await this.saveProject(draft);
    const source = await localDatabase();
    const tables = ["assets", "electricalAttachments"] as const;
    const reads = source.transaction(tables.slice());
    const keys = [draft.assets.map(asset => asset.assetId),
      projectElectricalAttachments(draft).map(attachment => attachment.attachmentId)];
    const records = await Promise.all(tables.flatMap((table, index) => keys[index].map(async key => {
      const value = await requestValue(reads.objectStore(table).get(key));
      if (!value) throw new Error("A local file needed by this draft is missing. Repair the draft before signing in.");
      return { table, key, value };
    })));
    if (!isCurrent()) return;
    const destination = await openGuestHandoffDestination(account);
    try {
      if (!isCurrent()) return;
      const tx = destination.transaction(["projects", "meta", ...tables], "readwrite");
      const done = completed(tx);
      const projects = tx.objectStore("projects"), meta = tx.objectStore("meta");
      const receipt = `guest-draft:${draft.projectId}`;
      try {
        const previous = await requestValue(meta.get(receipt));
        if (isCurrent() && previous !== draft.updatedAt) {
          const collision = await requestValue(projects.getKey(draft.projectId));
          const files = await Promise.all(records.map(async record => ({
            ...record, exists: await requestValue(tx.objectStore(record.table).getKey(record.key)),
          })));
          if (isCurrent()) {
            const projectId = collision === undefined ? draft.projectId : crypto.randomUUID();
            const next = projectId === draft.projectId ? draft : parseProject({
              ...draft, projectId,
              quotes: draft.quotes?.map(quote => ({ ...quote, projectId })),
              cfdScenarios: draft.cfdScenarios?.map(scenario => ({ ...scenario, sourceBuildingId: projectId, validation: null })),
            });
            for (const file of files) if (file.exists === undefined) tx.objectStore(file.table).add(file.value, file.key);
            projects.add(next, projectId);
            meta.put(projectId, "current");
            meta.put(draft.updatedAt, receipt);
          }
        }
      } catch (error) {
        try { tx.abort(); } catch { /* already aborted */ }
        await done.catch(() => undefined);
        throw error;
      }
      await done;
    } finally { destination.close(); }
  }

  async saveProject(project: ProjectDocument) {
    const p = parseProject(project), db = await localDatabase();
    const tx = db.transaction(["projects", "backups", "meta"], "readwrite"); const done = completed(tx);
    const store = tx.objectStore("projects"); const previous = store.get(p.projectId);
    previous.onsuccess = () => { if (previous.result) { try { tx.objectStore("backups").put(parseProject(previous.result), p.projectId); } catch { /* retain the existing valid backup */ } } store.put(p, p.projectId); tx.objectStore("meta").put(p.projectId, "current"); };
    await done;
  }
  async deleteProject(id: string) { const db = await localDatabase(), tx = db.transaction(["projects", "backups", "meta"], "readwrite"), done = completed(tx); tx.objectStore("projects").delete(id); tx.objectStore("backups").delete(id); const current = tx.objectStore("meta").get("current"); current.onsuccess = () => { if (current.result === id) tx.objectStore("meta").delete("current"); }; await done; }
  async duplicateProject(id: string) {
    const p = await this.getProject(id); if (!p) throw new Error("Project not found.");
    const projectId = crypto.randomUUID();
    const copy = { ...p, projectId, name: `${p.name} copy`, generated: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), quotes: (p.quotes ?? []).map(quote => ({ ...structuredClone(quote), projectId, quoteId: crypto.randomUUID() })), ...(p.cfdScenarios?{cfdScenarios:p.cfdScenarios.map(s=>({...structuredClone(s),id:crypto.randomUUID(),sourceBuildingId:projectId,validation:null}))}:{}) };
    await this.saveProject(copy); return copy;
  }
}
export const projectRepository = new LocalProjectRepository();
