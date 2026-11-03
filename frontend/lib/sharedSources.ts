import { projectFloors } from "./buildingDocument";
import { isHeatingElement } from "./heatingElements";
import type { CFDScenario } from "./climoptixDocument";
import type { ProjectDocument } from "./projectDocument";

export function hasSharedInsulation(project: ProjectDocument): boolean {
  return projectFloors(project).some(({ content }) => {
    const energy = content.energyLayout;
    return !!energy && (energy.existingAssignments.length > 0 ||
      !!energy.scenarios.find(s => s.scenarioId === energy.activeScenarioId)?.assignments.length);
  });
}

/** Canonical measured emitters plus legacy IDs pending reconciliation. Boilers are plant. */
export function sharedRadiatorIds(project: ProjectDocument): Set<string> {
  return new Set(projectFloors(project).flatMap(({ content }) => [
    ...content.rooms.flatMap(room => room.obstacles
      .filter(o => isHeatingElement(o) && o.heating_spec?.category !== "Boiler").map(o => o.id)),
    ...(content.heatingLayout?.radiators.filter(r => r.category !== "Boiler").map(r => r.radiatorId) ?? []),
  ]));
}

export function hasSharedSources(project: ProjectDocument): boolean {
  return hasSharedInsulation(project) || projectFloors(project).some(({ content }) => {
    const heating = content.heatingLayout;
    return content.rooms.some(room => room.obstacles.some(isHeatingElement)) || !!heating &&
      [heating.radiators, heating.ufhZones, heating.pipes, heating.manifolds, heating.exclusions].some(items => items.length > 0);
  });
}

/** A discovered scope belongs only to the seed that produced it. Object key order is irrelevant. */
export function sharedCaseRooms(project: ProjectDocument, scenario: CFDScenario) {
  const binding = project.hvac?.bindings[scenario.id], seed = scenario.seed;
  const scope = seed && binding?.scopeSeed?.floorId === seed.floorId && binding.scopeSeed.roomId === seed.roomId
    ? binding.scopeRooms ?? [] : [];
  return [...scope, ...(seed ? [seed] : [])];
}
