import { commercialRequest, CommercialApiError } from "./commercialApi";
import { storedAccountId } from "./commercialAuth";
import { matchesLocalStorageAccount } from "./localDatabase";
import { parseProject, type ProjectDocument } from "./projectDocument";
import { cloudProjectDocument, mergeCloudProject } from "./cloudProjectPrivacy";

export const CLOUD_RECOVERY_CHANGED = "freefloorplan3d:cloud-recovery-changed";
const key = () => `freefloorplan3d:cloud-recovery:${storedAccountId() ?? "guest"}`;
let serverAllowsRecovery = true;
export function cloudRecoveryEnabled() {
  try { return serverAllowsRecovery && !!storedAccountId() && localStorage.getItem(key()) !== "off"; } catch { return false; }
}
function storeChoice(enabled: boolean) {
  localStorage.setItem(key(), enabled ? "on" : "off");
  window.dispatchEvent(new Event(CLOUD_RECOVERY_CHANGED));
}
export async function setCloudRecoveryEnabled(enabled: boolean) {
  if (!enabled) storeChoice(false);
  await queue;
  await commercialRequest("/resume/preference", {method:"PUT",body:JSON.stringify({enabled})});
  serverAllowsRecovery = enabled; ready = false; stopped = false; initialRead = null;
  storeChoice(enabled);
}
type Recovery = {document:ProjectDocument | null; revision:number; updated_at:string};
let revision: number | null = null;
let ready = false;
let stopped = false;
let queue: Promise<void> = Promise.resolve();
let saved = "";
let initialRead: Promise<Recovery | null> | null = null;
export function pauseCloudRecovery() { stopped = true; }

export async function readCloudRecovery(): Promise<Recovery | null> {
  const {resume, enabled} = await commercialRequest<{resume:Recovery | null;enabled:boolean}>("/resume", {signal:AbortSignal.timeout(15000)});
  serverAllowsRecovery = enabled === true;
  if (!serverAllowsRecovery) window.dispatchEvent(new Event(CLOUD_RECOVERY_CHANGED));
  if (!resume) return null;
  if (!Number.isSafeInteger(resume.revision) || resume.revision < 1) throw new Error("Invalid cloud recovery revision.");
  return {...resume, document:resume.document ? parseProject(resume.document) : null};
}

export async function recoverCloudProject(local: ProjectDocument): Promise<ProjectDocument> {
  if (!cloudRecoveryEnabled()) return local;
  const resume = await (initialRead ??= readCloudRecovery().catch(error => { initialRead = null; throw error; }));
  revision = resume?.revision ?? null; ready = true; stopped = false;
  saved = resume?.document ? JSON.stringify(resume.document) : "";
  // The previous project remains in IndexedDB when the current pointer changes.
  const empty = !local.cfdScenarios?.length && !local.rooms.length && !local.floorplan?.walls.length && !local.assets.length && !local.building?.floors.some(f => f.content?.rooms.length);
  if (serverAllowsRecovery && resume?.document && (empty || resume.document.updatedAt > local.updatedAt)) return mergeCloudProject(local, resume.document);
  return local;
}

export function syncCloudRecovery(project: ProjectDocument): Promise<boolean> {
  const account = storedAccountId();
  const operation = queue.then(async () => {
    if (!account || !matchesLocalStorageAccount(account) || storedAccountId() !== account || !cloudRecoveryEnabled()) return false;
    // Once a CFD project is in recovery, clearing its LAST study is still a
    // change to save. Otherwise an older cloud copy resurrects deleted studies.
    if (project.cfdScenarios === undefined) return false;
    if (stopped) throw new Error("A newer cloud setup exists. Open Privacy and local saving to download it.");
    if (!ready && await recoverCloudProject(project) !== project) {
      stopped = true;
      throw new Error("A newer cloud setup is available. Download it in Privacy and local saving; your local changes are kept.");
    }
    if (!cloudRecoveryEnabled()) return false;
    const document = cloudProjectDocument(project);
    const content = JSON.stringify(document);
    if (content === saved) return true;
    try {
      const result = await commercialRequest<{revision:number}>("/resume", {method:"PUT",body:JSON.stringify({document,expected_revision:revision})});
      if (!Number.isSafeInteger(result.revision) || result.revision <= (revision ?? 0)) throw new Error("Cloud recovery was not acknowledged.");
      revision = result.revision; saved = content;
      return true;
    } catch (error) {
      if (error instanceof CommercialApiError && typeof error.detail === "object" && error.detail !== null && "code" in error.detail && error.detail.code === "recovery_disabled") {
        serverAllowsRecovery = false; storeChoice(false); return false;
      }
      if (error instanceof CommercialApiError && error.status === 409) stopped = true;
      throw error;
    }
  });
  queue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function deleteCloudRecovery() {
  storeChoice(false);
  await queue;
  await commercialRequest("/resume", {method:"DELETE"});
  serverAllowsRecovery = false;
  revision = null; ready = false; saved = ""; initialRead = null; stopped = false;
}
