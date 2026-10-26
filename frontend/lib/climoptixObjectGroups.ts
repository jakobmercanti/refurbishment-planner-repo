import { assetOverrideSchema, type CFDObjectCollection, type CFDScenario } from "./climoptixDocument";
import type { CFDObject } from "./climoptix";
import { uniqueGroupName } from "./climoptixGroups";

export const DEFAULT_OBJECT_GROUP = "objects-default";
export type CFDObjectEntry = { id: string; name: string; detail: string; type: "vent" | "object"; sourceId: string };
export function objectGroups(scenario: CFDScenario, objects: CFDObject[] = []): CFDObjectCollection[] {
  const groups = scenario.objectGroups ?? [];
  if (scenario.objectGroups && !groups.length && !objectEntries(scenario, objects).length) return [];
  return groups.some(g => g.id === DEFAULT_OBJECT_GROUP) ? groups : [
    { id: DEFAULT_OBJECT_GROUP, name: uniqueGroupName(groups.map(g => g.name), "General"), memberIds: [] }, ...groups,
  ];
}
export function objectEntries(scenario: CFDScenario, objects: CFDObject[]): CFDObjectEntry[] {
  const hidden = new Set(scenario.hiddenObjectIds);
  return [...scenario.vents.map(v => ({ id: `vent:${v.id}`, sourceId: v.id, name: v.name, type: "vent" as const, detail: `${v.role} · ${v.shape === "circle" ? `Ø ${v.diameterMm}` : `${v.widthMm} × ${v.heightMm}`} mm` })),
    ...objects.filter(o => !hidden.has(o.id)).map(o => ({ id: `object:${o.id}`, sourceId: o.id, name: o.name, type: "object" as const, detail: `${o.mode} · ${o.heatW} W` }))];
}
export function objectMembers(group: CFDObjectCollection, groups: CFDObjectCollection[], entries: CFDObjectEntry[]) {
  const assigned = new Set(groups.filter(g => g.id !== DEFAULT_OBJECT_GROUP).flatMap(g => g.memberIds));
  const byId = new Map(entries.map(e => [e.id, e]));
  const ordered = group.memberIds.flatMap(id => byId.has(id) && (group.id !== DEFAULT_OBJECT_GROUP || !assigned.has(id)) ? [byId.get(id)!] : []);
  return group.id !== DEFAULT_OBJECT_GROUP ? ordered : [...ordered, ...entries.filter(e => !assigned.has(e.id) && !group.memberIds.includes(e.id))];
}
export function moveObject(scenario: CFDScenario, id: string, target: string, boundary: number, objects: CFDObject[]): CFDScenario {
  const groups = objectGroups(scenario), entries = objectEntries(scenario, objects), group = groups.find(g => g.id === target);
  if (!group || !entries.some(e => e.id === id) || !Number.isInteger(boundary) || boundary < 0) return scenario;
  const members = objectMembers(group, groups, entries);
  if (boundary > members.length) return scenario;
  const index = members.findIndex(e => e.id === id);
  if (index >= 0 && (boundary === index || boundary === index + 1)) return scenario;
  const before = members[boundary]?.id;
  return { ...scenario, objectGroups: groups.map(g => {
    const ids = (g.id === DEFAULT_OBJECT_GROUP && target === g.id ? members.map(e => e.id) : g.memberIds).filter(mid => mid !== id);
    if (g.id === target) { const at = before ? ids.indexOf(before) : ids.length; ids.splice(at < 0 ? ids.length : at, 0, id); }
    return { ...g, memberIds: ids };
  }) };
}
export function duplicateObjectEntry(scenario: CFDScenario, entry: CFDObjectEntry, objects: CFDObject[]) {
  const id = crypto.randomUUID();
  const used = new Set([...scenario.vents, ...objects, ...scenario.objectCopies ?? []].map(o => o.name.toLowerCase()));
  let name = "";
  for (let number = 1; ; number++) {
    const suffix = ` copy${number === 1 ? "" : ` ${number}`}`;
    name = entry.name.slice(0, 120 - suffix.length).replace(/[\uD800-\uDBFF]$/, "") + suffix;
    if (!used.has(name.toLowerCase())) break;
  }
  if (entry.type === "vent") {
    const vent = scenario.vents.find(v => v.id === entry.sourceId);
    if (!vent || scenario.vents.length >= 500) return null;
    const copy = { ...structuredClone(vent), id, name, host: { ...vent.host, u: Math.min(0.9, vent.host.u + 0.15) } };
    return { scenario: { ...scenario, vents: [...scenario.vents, copy] }, id: `vent:${id}` };
  }
  const source = objects.find(o => o.id === entry.sourceId);
  if (!source || source.roomId === "unresolved" || (scenario.objectCopies?.length ?? 0) >= 500 || scenario.assetOverrides.length >= 2000) return null;
  const sourceObjectId = scenario.objectCopies?.find(o => o.id === source.id)?.sourceObjectId ?? source.id;
  const override = scenario.assetOverrides.find(o => o.objectId === source.id) ?? assetOverrideSchema.parse({ objectId: source.id, mode: source.mode, heatW: source.heatW, co2M3S: source.co2M3S });
  return { scenario: { ...scenario, objectCopies: [...scenario.objectCopies ?? [], { id, sourceObjectId, name }],
    assetOverrides: [...scenario.assetOverrides, { ...structuredClone(override), objectId: id }] }, id: `object:${id}` };
}
export function deleteObjectEntry(scenario: CFDScenario, entry: CFDObjectEntry): CFDScenario {
  const copy = scenario.objectCopies?.some(o => o.id === entry.sourceId);
  if (entry.type === "object" && !copy && (scenario.hiddenObjectIds?.length ?? 0) >= 2000) return scenario;
  return { ...scenario,
    vents: entry.type === "vent" ? scenario.vents.filter(v => v.id !== entry.sourceId) : scenario.vents,
    ...(entry.type === "object" ? copy ? { objectCopies: scenario.objectCopies!.filter(o => o.id !== entry.sourceId), assetOverrides: scenario.assetOverrides.filter(o => o.objectId !== entry.sourceId) } :
      { hiddenObjectIds: [...new Set([...scenario.hiddenObjectIds ?? [], entry.sourceId])] } : {}),
    objectGroups: objectGroups(scenario).map(g => ({ ...g, memberIds: g.memberIds.filter(id => id !== entry.id) })),
  };
}
