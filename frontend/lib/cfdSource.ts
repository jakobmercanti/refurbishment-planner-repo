import type { CFDScenario } from "./climoptixDocument";
import type { ProjectDocument } from "./projectDocument";
import { preparationInput } from "./climoptix";

export interface CFDSource {
  projectId: string;
  studyId: string;
  input: string;
}

export function captureCFDSource(project: ProjectDocument, scenario: CFDScenario): CFDSource {
  return { projectId: project.projectId, studyId: scenario.id, input: preparationInput(project, scenario) };
}

/** Successes and failures must both belong to the current measured source. */
export function matchesCFDSource(source: CFDSource, project: ProjectDocument, scenarios: CFDScenario[]): boolean {
  if (source.projectId !== project.projectId) return false;
  const live = scenarios.find(s => s.id === source.studyId);
  return !!live && preparationInput(project, live) === source.input;
}

export type CFDReportCache<T> = { projectId: string; reports: Record<string, T> };

/** Keep at most three potentially large reports, without retaining deleted studies or another project. */
export function cacheCFDReport<T>(cache: CFDReportCache<T>, source: CFDSource, report: T, studyIds: string[]): CFDReportCache<T> {
  const previous = cache.projectId === source.projectId ? cache.reports : {};
  return { projectId: source.projectId, reports: {
    ...Object.fromEntries(Object.entries(previous).filter(([id]) => id !== source.studyId && studyIds.includes(id)).slice(-2)),
    [source.studyId]: report,
  } };
}
