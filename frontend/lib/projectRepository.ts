import { completed, localDatabase, requestValue } from "./localDatabase";
import { migrateProject, newProject, parseProject, type ProjectDocument } from "./projectDocument";
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
    const legacy = localStorage.getItem("renovation-fit:complete-floorplan:v2");
    if (legacy) { project.floorplan = JSON.parse(legacy) as PersistedFloorplan; parseProject(project); }
    await this.saveProject(project);
    return project;
  }
  createProject(project: ProjectDocument) { return this.saveProject(project); }
  async saveProject(project: ProjectDocument) {
    const p = parseProject(project), db = await localDatabase();
    const tx = db.transaction(["projects", "backups", "meta"], "readwrite"); const done = completed(tx);
    const store = tx.objectStore("projects"); const previous = store.get(p.projectId);
    previous.onsuccess = () => { if (previous.result) { try { tx.objectStore("backups").put(parseProject(previous.result), p.projectId); } catch { /* retain the existing valid backup */ } } store.put(p, p.projectId); tx.objectStore("meta").put(p.projectId, "current"); };
    await done;
  }
  async deleteProject(id: string) { const db = await localDatabase(), tx = db.transaction(["projects", "backups", "meta"], "readwrite"), done = completed(tx); tx.objectStore("projects").delete(id); tx.objectStore("backups").delete(id); const current = tx.objectStore("meta").get("current"); current.onsuccess = () => { if (current.result === id) tx.objectStore("meta").delete("current"); }; await done; }
  async duplicateProject(id: string) { const p = await this.getProject(id); if (!p) throw new Error("Project not found."); const copy = { ...p, projectId: crypto.randomUUID(), name: `${p.name} copy`, generated: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; await this.saveProject(copy); return copy; }
}
export const projectRepository = new LocalProjectRepository();
