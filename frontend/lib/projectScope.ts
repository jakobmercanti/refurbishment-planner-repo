import type { ProjectDocument } from "./projectDocument";

/** Both identifiers matter: unrelated projects commonly share "floor-ground". */
export function projectScope(project:Pick<ProjectDocument,"projectId"|"building">,session=0):string {
  return `${project.projectId}|${project.building?.activeFloorId??"legacy"}|${session}`;
}
export function matchesProjectScope(project:ProjectDocument|null,scope:string|undefined,session=0):boolean {
  return project!==null&&scope!==undefined&&projectScope(project,session)===scope;
}
