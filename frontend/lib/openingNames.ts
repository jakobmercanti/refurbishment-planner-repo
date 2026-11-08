import { passageProfileForKey, passageProfileForOpening } from "./passageOpenings";
import type { Opening } from "./types";

type NamedOpening = Pick<Opening, "id" | "kind" | "metadata" | "passage_profile"> & { representationKey?: string };

/** Shared-wall records refer to the same physical opening and share its name. */
export function numberedOpeningNames(openings: Iterable<NamedOpening>) {
  const names = new Map<string, string>();
  const counts = { Window: 0, Door: 0, Passage: 0, Opening: 0 };
  for (const opening of openings) {
    if (names.has(opening.id)) continue;
    const kind = opening.kind === "WINDOW" ? "Window" : opening.kind === "DOOR"
      ? passageProfileForKey(opening.representationKey) || passageProfileForOpening(opening) ? "Passage" : "Door"
      : "Opening";
    names.set(opening.id, `${kind} ${++counts[kind]}`);
  }
  return names;
}
