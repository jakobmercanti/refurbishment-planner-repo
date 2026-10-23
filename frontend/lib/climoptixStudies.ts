import type { CFDScenario } from "./climoptixDocument";
import { sameGroup } from "./climoptixGroups";

/** Insert at a boundary in the original list, rather than swapping neighbours. */
export function insertAtBoundary<T extends { id: string }>(
  items: T[],
  id: string,
  boundary: number,
): T[] {
  const index = items.findIndex((item) => item.id === id);
  if (
    index < 0 ||
    !Number.isInteger(boundary) ||
    boundary < 0 ||
    boundary > items.length
  )
    return items;
  const next = items.filter((item) => item.id !== id);
  next.splice(boundary > index ? boundary - 1 : boundary, 0, items[index]);
  return next;
}

/** Array order is persisted; group names are presentation metadata, not solver intent. */
export function moveStudy(
  studies: CFDScenario[],
  id: string,
  group: string,
  boundary: number,
): CFDScenario[] {
  const source = studies.find((s) => s.id === id);
  const original = studies.filter((s) => sameGroup(s.group, group));
  if (
    !source ||
    !group.trim() ||
    group.length > 80 ||
    !Number.isInteger(boundary) ||
    boundary < 0 ||
    boundary > original.length
  )
    return studies;
  if (sameGroup(source.group, group)) {
    const ordered = insertAtBoundary(original, id, boundary);
    let index = 0;
    return studies.map((s) => (sameGroup(s.group, group) ? ordered[index++] : s));
  }
  const remaining = studies.filter((s) => s.id !== id);
  const members = remaining.filter((s) => sameGroup(s.group, group));
  const before = members[boundary];
  const last = members.at(-1);
  const at = before
    ? remaining.findIndex((s) => s.id === before.id)
    : last
      ? remaining.findIndex((s) => s.id === last.id) + 1
      : remaining.length;
  remaining.splice(at, 0, { ...source, group });
  return remaining;
}
