import type { CFDReport } from "./climoptixReport";
import type { CFDScenario } from "./climoptixDocument";

export type DiagnosticTarget = {
  label: string;
  patchIds?: readonly string[];
  ventId?: string;
  objectId?: string;
  roomId?: string;
  refinementId?: string;
};

const technicalId = /\b(?:reveal:|opening:)?[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b/gi;

/** Report references stay unchanged. Only the names shown in the warnings list are shortened. */
export function diagnosticCopy(
  diagnostic: CFDReport["diagnostics"][number],
  target: DiagnosticTarget | undefined,
  scenario: CFDScenario,
  report: CFDReport | null,
  openingNames: ReadonlyMap<string, string>,
) {
  const { message, repair } = diagnostic;
  const sourceName = target?.label;
  const vent = target?.ventId ? scenario.vents.find(item => item.id === target.ventId) : undefined;
  const prefix = vent?.role === "supply" ? "inlet" : vent?.role === "extract" ? "outlet" : "return";
  const openingId = sourceName?.match(/(?:reveal|opening):([^\s·]+)/)?.[1]
    ?? report?.patches.find(patch => target?.patchIds?.includes(patch.id) && openingNames.has(patch.sourceId))?.sourceId;
  const openingName = openingId && openingNames.get(openingId);
  const shortName = vent ? `${prefix}_${scenario.vents.filter(item => item.role === vent.role).indexOf(vent) + 1}`
    : openingName ? openingName.toLowerCase().replaceAll(" ", "_")
    : openingId ? "Opening" : sourceName?.replace(technicalId, "Surface");
  const compactMessage = sourceName && message.startsWith(`${sourceName}: `) ? message.slice(sourceName.length + 2) : message;
  return {
    label: shortName,
    message: compactMessage.replace(technicalId, () => shortName ?? "the affected element"),
    repair: repair.replace(technicalId, () => shortName ?? "the affected element"),
  };
}

export function diagnosticTarget(id: string | null, scenario: CFDScenario, report: CFDReport | null): DiagnosticTarget | undefined {
  if (!id) return;
  const vent = scenario.vents.find(item => item.id === id);
  if (vent) return { label: vent.name, ventId: vent.id };
  const audit = report?.sharedBoundaryAudit;
  const entry = audit?.sources.find(item => item.id === id) ?? audit?.envelope.find(item => item.id === id);
  if (entry) return { label: entry.name, patchIds: entry.patchIds, ...(entry.patchIds.length ? {} : { objectId: id }) };
  const patch = report?.patches.find(item => item.id === id) ?? report?.patches.find(item => item.id === id.split(":thermal:")[0]);
  if (patch) return { label: patch.label ?? `${patch.kind[0].toUpperCase()}${patch.kind.slice(1)} surface`, patchIds: [patch.id] };
  const object = report?.objects.find(item => item.id === id);
  if (object) return { label: object.name, objectId: id };
  const room = report?.domain.regions.find(item => item.id === id);
  if (room) return { label: room.name, roomId: id };
  const refinement = scenario.mesh.refinements.find(item => item.id === id);
  if (refinement) return { label: refinement.name, refinementId: id };
}
