import { parseProject, type ProjectDocument } from "./projectDocument";

const localOnly = new Set(["quotes", "plannerBuild", "electricalLayout", "renderCamera", "snapshots"]);
const privateText = new Set(["notes", "note", "description", "email", "telephone", "phone", "address", "postcode", "customerName", "customerEmail", "contact"]);

/** Cloud copies contain planning inputs. Customer records and narrative content stay local. */
export function cloudProjectDocument(project: ProjectDocument): ProjectDocument {
  const scrub = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(scrub);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !localOnly.has(key)).map(([key,item]) =>
      [key, key === "annotations" ? [] : privateText.has(key) && typeof item === "string" ? "" : scrub(item)]));
  };
  return parseProject(scrub(project));
}

/** Restore technical inputs without replacing customer records already saved on this device. */
export function mergeCloudProject(local: ProjectDocument, remote: ProjectDocument): ProjectDocument {
  if (local.projectId !== remote.projectId) return remote;
  const merge = (incoming: unknown, existing: unknown): unknown => {
    if (Array.isArray(incoming)) return incoming.map((item,index) => {
      if (!Array.isArray(existing)) return item;
      const idKey = item && typeof item === "object" ? Object.keys(item).find(key => key === "id")
        ?? Object.keys(item).find(key => key.endsWith("Id")) : undefined;
      const old = idKey ? existing.find(candidate => candidate?.[idKey] === item[idKey]) : existing[index];
      return merge(item,old);
    });
    if (!incoming || typeof incoming !== "object" || !existing || typeof existing !== "object") return incoming;
    const next = {...incoming} as Record<string,unknown>;
    for (const [key,value] of Object.entries(incoming)) next[key] = merge(value,(existing as Record<string,unknown>)[key]);
    for (const [key,value] of Object.entries(existing)) if (localOnly.has(key) || privateText.has(key) || key === "annotations") next[key] = value;
    return next;
  };
  return parseProject(merge(remote,local));
}
