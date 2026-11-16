import { activeFloor, projectFloors } from "./buildingDocument";
import { newCFDScenario } from "./climoptixDocument";
import { newEnergyProject } from "./energyDocument";
import { hvacConditionsSchema, hvacSchema, newHvacProject, type HvacOperatingScenario } from "./hvacDocument";
import type { ProjectDocument } from "./projectDocument";

export type ScenarioEditor = "cfd" | "hvac" | "energy";

function scenarioNames(project: ProjectDocument, editor: ScenarioEditor) {
  if (editor === "cfd") return new Map(project.cfdScenarios?.map(s => [s.id, s.name]));
  if (editor === "energy") return new Map(project.energyLayout?.scenarios.map(s => [s.scenarioId, s.name]));
  return new Map(project.hvac?.scenarios.map(s => [s.id, s.name]));
}

/**
 * HVAC holds the project-wide scenario catalogue and active ID.
 * Solver settings and floor construction assignments are facets keyed by that ID.
 */
export function syncSharedScenarios(project: ProjectDocument, previous?: ProjectDocument, editor?: ScenarioEditor) {
  const hvac = project.hvac ?? newHvacProject();
  const floors = projectFloors(project);
  const currentFloor = activeFloor(project).id;
  const energy = project.energyLayout;
  const cases = new Map(project.cfdScenarios?.map(s => [s.id, s]));
  const catalogue = new Map(hvac.scenarios.map(s => [s.id, s]));
  const aliases = new Map<string, string>();
  const bindings = { ...hvac.bindings };

  // Preserve persisted study IDs so saved worker jobs are still recoverable.
  // A legacy binding is explicit evidence that those two records belong together.
  if (!previous) for (const study of cases.values()) {
    const legacyId = bindings[study.id]?.operatingScenarioId;
    const operation = legacyId ? hvac.scenarios.find(s => s.id === legacyId) : undefined;
    if (!operation || operation.id === study.id || catalogue.has(study.id)) continue;
    catalogue.set(study.id, { ...operation, id: study.id, name: study.name });
    if (!cases.has(operation.id) && !aliases.has(operation.id)) {
      aliases.set(operation.id, study.id);
      catalogue.delete(operation.id);
    }
  }

  const ids = new Map([...catalogue].map(([id, scenario]) => [id, scenario.name]));
  for (const study of cases.values()) if (!ids.has(study.id)) ids.set(study.id, study.name);
  for (const floor of floors) for (const scenario of floor.content.energyLayout?.scenarios ?? []) {
    const sourceId = scenario.scenarioId;
    if (!/^[\w:-]{1,150}$/.test(sourceId) && !aliases.has(sourceId)) aliases.set(sourceId, crypto.randomUUID());
    const id = aliases.get(sourceId) ?? sourceId;
    if (!ids.has(id)) ids.set(id, scenario.name);
  }
  if (previous && editor) {
    const edited = scenarioNames(project, editor);
    for (const id of scenarioNames(previous, editor).keys()) if (!edited.has(id)) ids.delete(aliases.get(id) ?? id);
    for (const [id, name] of edited) ids.set(aliases.get(id) ?? id, name);
  }
  if (!ids.size && !previous?.hvac?.scenarios.length) return project;
  if (ids.size > 100) {
    if (previous) throw new Error("The shared scenario list supports 100 entries.");
    return project;
  }

  let active = editor === "energy" ? energy?.activeScenarioId ?? null : hvac.activeScenarioId;
  if (!previous && !active && !hvac.scenarios.length) active = energy?.activeScenarioId ?? ids.keys().next().value ?? null;
  if (active) active = aliases.get(active) ?? active;
  if (active && !ids.has(active)) active = ids.keys().next().value ?? null;
  const added = previous && editor === "cfd" ? [...ids.keys()].filter(id => !previous.cfdScenarios?.some(study => study.id === id)) : [];
  if (added.length === 1) active = added[0];

  const defaultFloor = floors.find(f => f.id === currentFloor) ?? floors[0];
  const scenarios: HvacOperatingScenario[] = [...ids].map(([id, rawName]) => {
    const name = rawName.trim().slice(0, 120) || "Scenario";
    const saved = catalogue.get(id);
    const study = cases.get(id);
    if (saved) return { ...saved, ...(editor === "cfd" ? study?.seed : null), name };
    const inherited = catalogue.get(bindings[id]?.operatingScenarioId ?? "");
    if (inherited) return { ...structuredClone(inherited), id, name };
    const seed = study?.seed ?? { floorId: defaultFloor.id, roomId: defaultFloor.content.rooms[0]?.id ?? "unassigned" };
    const temperature = (kelvin: number | undefined, min: number, max: number) =>
      kelvin === undefined ? undefined : Math.min(max, Math.max(min, kelvin - 273.15));
    const conditions = hvacConditionsSchema.parse({
      roomC: temperature(study?.physics.referenceTemperatureK, -50, 80),
      outdoorC: temperature(study?.physics.outdoorTemperatureK, -80, 80),
      densityKgM3: study ? Math.min(10, study.physics.densityKgM3) : undefined,
      cpJKgK: study ? Math.min(10000, study.physics.heatCapacityJKgK) : undefined,
    });
    return { ...seed, id, name, conditions, ventOverrides: {}, heaterOverrides: {} };
  });
  const metadata = new Map(scenarios.map(s => [s.id, s]));
  const ordered = [...cases.keys()].filter(id => metadata.has(id));
  ordered.push(...scenarios.filter(s => !cases.has(s.id)).map(s => s.id));
  const cfdScenarios = ordered.map(id => {
    const item = metadata.get(id)!;
    const saved = cases.get(id);
    const seed = floors.some(f => f.id === item.floorId && f.content.rooms.some(room => room.id === item.roomId))
      ? { floorId: item.floorId, roomId: item.roomId } : null;
    const prior = bindings[id];
    bindings[id] = { ...(prior ?? { deviceIds: [], overrides: {}, editMode: "override" }),
      analysisMode: prior?.analysisMode ?? (saved?.physics.energy ? "thermal" : "airflow"),
      operatingScenarioId: id };
    return { ...(saved ?? { ...newCFDScenario(project.projectId, item.name), id, seed }), name: item.name };
  });

  const floorEnergy = new Map(floors.map(floor => {
    const data = floor.content.energyLayout ?? newEnergyProject();
    const saved = new Map(data.scenarios.map(s => [aliases.get(s.scenarioId) ?? s.scenarioId, s]));
    return [floor.id, { ...data, activeScenarioId: active,
      scenarios: scenarios.map(({ id, name }) => {
        const legacyId = !previous ? cases.get(id)?.thermalEnvelope?.insulationScenarios[floor.id] : undefined;
        const construction = saved.get(id) ?? (legacyId ? saved.get(aliases.get(legacyId) ?? legacyId) : undefined);
        return { scenarioId: id, name, assignments: construction?.assignments ?? [] };
      }) }];
  }));
  const building = project.building && { ...project.building, floors: project.building.floors.map(floor =>
    floor.content && floor.id !== currentFloor ? { ...floor, content: { ...floor.content, energyLayout: floorEnergy.get(floor.id) } } : floor) };
  return { ...project, building, energyLayout: floorEnergy.get(currentFloor), cfdScenarios,
    hvac: hvacSchema.parse({ ...hvac, scenarios, activeScenarioId: active,
      snapshots: hvac.snapshots.filter(s => metadata.has(s.caseId)).map(s => ({ ...s, operatingScenarioId: s.caseId })),
      bindings: Object.fromEntries(Object.entries(bindings).filter(([id]) => metadata.has(id))) }) };
}
