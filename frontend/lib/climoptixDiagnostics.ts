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
