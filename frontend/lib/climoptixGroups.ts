import {
  boundarySchema, duplicateCFDScenario,
  type CFDBoundaryCollection, type CFDScenario, type CFDSimulationGroup,
} from "./climoptixDocument";
import type { CFDPatch } from "./climoptix";

export const sameGroup = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const shortName = (value: string, length: number) => value.slice(0, length).replace(/[\uD800-\uDBFF]$/, "");
export function uniqueGroupName(names: string[], base = "Group"): string {
  base = shortName(base, 80);
  const used = new Set(names.map(n => n.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`, name = shortName(base, 80 - suffix.length) + suffix;
    if (!used.has(name.toLowerCase())) return name;
  }
}

/** Empty folders persist independently; legacy label-only simulations remain visible. */
export function simulationGroups(scenarios: CFDScenario[], saved: CFDSimulationGroup[] = []): CFDSimulationGroup[] {
  const groups = [...saved];
  for (const s of scenarios) {
    if (groups.some(g => sameGroup(g.name, s.group))) continue;
    let id = `legacy:${groups.length}`;
    while (groups.some(g => g.id === id)) id += ":next";
    groups.push({ id, name: s.group });
  }
  return groups;
}

export function duplicateSimulationGroup(scenarios: CFDScenario[], groups: CFDSimulationGroup[], id: string) {
  const group = groups.find(g => g.id === id);
  if (!group || groups.length >= 100) return null;
  const members = scenarios.filter(s => sameGroup(s.group, group.name));
  if (members.length + scenarios.length > 100) return null;
  const copy = { id: crypto.randomUUID(), name: uniqueGroupName(groups.map(g => g.name), `${shortName(group.name, 75)} copy`) };
  const next = [...groups];
  next.splice(groups.indexOf(group) + 1, 0, copy);
  return { groups: next, scenarios: [...scenarios, ...members.map(s => ({ ...duplicateCFDScenario(s), group: copy.name }))] };
}

export const DEFAULT_BOUNDARY_GROUP = "all-surfaces";
export const BOUNDARY_COLOURS = ["#3284cd", "#c46c38", "#38957e", "#9868c8", "#cb618c", "#a18424", "#4d8d9d", "#7b8851"];
export function boundaryGroups(scenario: CFDScenario): CFDBoundaryCollection[] {
  const saved = scenario.boundaries.collections;
  return saved.some(g => g.id === DEFAULT_BOUNDARY_GROUP) ? saved : [
    { id: DEFAULT_BOUNDARY_GROUP, name: uniqueGroupName(saved.map(g => g.name), "Default surfaces"), patchIds: [], boundary: null }, ...saved,
  ];
}
export function boundaryMembers(group: CFDBoundaryCollection, groups: CFDBoundaryCollection[], patches: CFDPatch[]) {
  const assigned = new Set(groups.filter(g => g.id !== DEFAULT_BOUNDARY_GROUP).flatMap(g => g.patchIds));
  const byId = new Map(patches.map(p => [p.id, p]));
  const orderedIds = new Set(group.patchIds);
  const ordered = group.patchIds.flatMap(id => { const patch = byId.get(id); return patch && !assigned.has(id) ? [patch] : []; });
  return group.id === DEFAULT_BOUNDARY_GROUP ? [...ordered, ...patches.filter(p => !assigned.has(p.id) && !orderedIds.has(p.id))] :
    group.patchIds.flatMap(id => { const patch = byId.get(id); return patch ? [patch] : []; });
}
export type BoundaryDisplayGroup = { id: string; name: string; colour: string; patchIds: string[] };
/** One physical surface belongs to one folder; explicit patch overrides are retained. */
export function moveBoundary(scenario: CFDScenario, patchId: string, target: string, boundary: number, patches: CFDPatch[]): CFDScenario {
  const groups = boundaryGroups(scenario);
  if (!groups.some(g => g.id === target) || !patches.some(p => p.id === patchId) || !Number.isInteger(boundary) || boundary < 0) return scenario;
  const members = boundaryMembers(groups.find(g => g.id === target)!, groups, patches);
  if (boundary > members.length) return scenario;
  const index = members.findIndex(p => p.id === patchId);
  if (index >= 0 && (boundary === index || boundary === index + 1)) return scenario;
  const before = members[boundary]?.id;
  return { ...scenario, boundaries: { ...scenario.boundaries, collections: groups.map(g => {
    const ids = (g.id === target && target === DEFAULT_BOUNDARY_GROUP ? members.map(p => p.id) : g.patchIds).filter(id => id !== patchId);
    if (g.id === target) {
      const at = before ? ids.indexOf(before) : ids.length;
      ids.splice(at < 0 ? ids.length : at, 0, patchId);
    }
    return { ...g, patchIds: ids };
  }) } };
}
export function effectiveBoundary(scenario: CFDScenario, patch: CFDPatch) {
  const collection = scenario.boundaries.collections.find(g => g.patchIds.includes(patch.id)) ??
    scenario.boundaries.collections.find(g => g.id === DEFAULT_BOUNDARY_GROUP);
  const defaults = scenario.boundaries.collections.find(g => g.id === DEFAULT_BOUNDARY_GROUP);
  return scenario.boundaries.patches[patch.id] ?? collection?.boundary ?? defaults?.boundary ?? scenario.boundaries.groups[patch.kind] ?? patch.boundary ?? boundarySchema.parse({});
}
