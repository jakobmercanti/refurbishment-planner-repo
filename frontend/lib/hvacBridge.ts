import { projectFloors } from "./buildingDocument";
import { assetOverrideSchema, newCFDScenario, type CFDScenario, type CFDVent } from "./climoptixDocument";
import { ventAreaM2, ventFlowM3S } from "./hvacCalculations";
import { hvacSchema, resolveHvacVents, type HvacConditions, type HvacOperatingScenario } from "./hvacDocument";
import type { ProjectDocument } from "./projectDocument";
import type { CFDReport } from "./climoptix";
import { sharedHeatingBoundaries, type SharedHeater, type SharedEnvelope } from "./hvacHeating";
import { hasSharedInsulation, sharedCaseRooms } from "./sharedSources";
import type { SharedBoundaryInputs, SharedBoundaryAudit } from "./sharedBoundaryDocument";

function operatingAirProperties(operating: HvacOperatingScenario | undefined) {
  if (!operating) return {};
  const { densityKgM3, cpJKgK, roomC, outdoorC } = operating.conditions;
  return { densityKgM3, heatCapacityJKgK: cpJKgK, referenceTemperatureK: roomC + 273.15,
    initialTemperatureK: roomC + 273.15, outdoorTemperatureK: outdoorC + 273.15 };
}

function hvacCaseSettings(scenario: CFDScenario, operating: HvacOperatingScenario | undefined, heaters: HvacCfdBoundaryPackage["heaters"], envelopeActive: boolean) {
  const radiators = heaters.filter(h => h.kind === "radiator"), ids = new Set(radiators.map(h => h.id));
  const thermal = envelopeActive || !!operating || heaters.some(h => h.inDomain && h.enabled && (h.watts === null || h.watts > 0));
  return {
    seed: scenario.seed, mesh: scenario.mesh,
    boundaries: { ...scenario.boundaries, hideDefaultGroup: undefined },
    thermalEnvelope: scenario.thermalEnvelope ?? null,
    thermalApplication: scenario.thermalSnapshots?.[0] ? { caseHash: scenario.thermalSnapshots[0].caseHash, sourceRevision: scenario.thermalSnapshots[0].sourceRevision } : null,
    assetOverrides: [...scenario.assetOverrides.filter(o => !ids.has(o.objectId)), ...radiators.map(h => assetOverrideSchema.parse({ objectId: h.id, mode: "solidProxy", heatW: h.enabled ? h.watts ?? 0 : 0, temperatureK: null, notes: h.notes }))],
    physics: thermal ? { ...scenario.physics, energy: true, boussinesq: true, preset: "custom" as const,
      ...operatingAirProperties(operating),
    } : scenario.physics,
    outputs: thermal ? { ...scenario.outputs, temperature: true } : scenario.outputs,
    postProcessing: thermal ? { ...scenario.postProcessing, fields: [...new Set([...scenario.postProcessing.fields, "T" as const])] } : scenario.postProcessing,
  };
}

export interface HvacCfdBoundaryPackage {
  version: 1; units: "mm"; scenarioId: string; operatingScenarioId: string | null;
  conditions: HvacConditions | null;
  caseSettings: ReturnType<typeof hvacCaseSettings>;
  boundaryInputs: SharedBoundaryInputs;
  checkedBoundaryCapture: SharedBoundaryAudit | null;
  checkedPatches: { id: string; kind: string; areaM2: number; boundary: CFDReport["patches"][number]["boundary"]; boundaryOrigin: string }[] | null;
  zoneGains: { peopleW: number; equipmentW: number; solarW: number; mapping: "requiresLocatedSources" } | null;
  envelope: SharedEnvelope[];
  sourceInput: string; vents: { id: string; roomId: string; floorId: string; host: string; role: string; areaM2: number; volumeFlowM3S: number | null; massFlowKgS: number | null; meanNormalVelocityMS: number | null; outwardNormalVelocityMS: number | null; temperatureK: number; control: string; parameters: CFDVent; outdoorAirFraction: number; patchId: string | null; centerMm: number[] | null; normal: number[] | null; turbulenceIntensity: number; turbulenceLengthM: number; status: "checked" | "unvalidated" }[];
  heaters: SharedHeater[];
  warnings: string[]; thermalExecution: "notConnected";
}

function sharedCaseInputs(project: ProjectDocument, scenario: CFDScenario, report?: CFDReport | null) {
  const binding = project.hvac?.bindings[scenario.id];
  const operating = project.hvac?.scenarios.find(s => s.id === binding?.operatingScenarioId);
  const rooms = report ? report.domain.regions.filter(r => r.included).map(r => ({ floorId: r.floorId, roomId: r.id })) : sharedCaseRooms(project, scenario);
  const included = (floorId: string, roomId: string) => rooms.some(r => r.floorId === floorId && r.roomId === roomId);
  const { heaters, envelope, sources } = sharedHeatingBoundaries(project, operating, included);
  const unlocated: SharedBoundaryInputs["unlocated"] = operating ? ([
    { kind: "people" as const, name: "People sensible gains", valueSI: operating.conditions.occupants * operating.conditions.sensibleWPerson, units: "W" as const },
    { kind: "equipment" as const, name: "Equipment sensible gains", valueSI: operating.conditions.equipmentW, units: "W" as const },
    { kind: "solar" as const, name: "Zone-average solar gain", valueSI: operating.conditions.solarW, units: "W" as const },
    { kind: "infiltration" as const, name: "Diffuse infiltration", valueSI: operating.conditions.infiltrationM3S, units: "m³/s" as const },
  ].filter(v => v.valueSI > 0).map(v => ({ ...v, id: `unlocated:${operating.id.slice(0, 120)}:${v.kind}`, floorId: operating.floorId, roomId: operating.roomId }))) : [];
  const boundaryInputs: SharedBoundaryInputs = { version: 1, captureEnvelope: true, sources, unlocated,
    inventory: projectFloors(project).flatMap(f => { const h = f.content.heatingLayout; return [
      { floorId: f.id, kind: "boiler" as const, count: f.content.rooms.flatMap(r => r.obstacles).filter(o => o.heating_spec?.category === "Boiler").length },
      { floorId: f.id, kind: "pipe" as const, count: h?.pipes.length ?? 0 }, { floorId: f.id, kind: "manifold" as const, count: h?.manifolds.length ?? 0 }, { floorId: f.id, kind: "exclusion" as const, count: h?.exclusions.length ?? 0 },
    ].filter(i => i.count); }) };
  const caseSettings = hvacCaseSettings(scenario, operating, heaters, hasSharedInsulation(project));
  return { operating, heaters, envelope, boundaryInputs, caseSettings };
}

export function hvacBoundaryPackage(project: ProjectDocument, scenario: CFDScenario, report?: CFDReport | null): HvacCfdBoundaryPackage {
  const hvac = project.hvac;
  const { operating, heaters, envelope, boundaryInputs, caseSettings } = sharedCaseInputs(project, scenario, report);
  const density = operating?.conditions.densityKgM3 ?? scenario.physics.densityKgM3;
  const vents = resolveHvacVents(project, scenario).map(vent => {
    const d = hvac?.devices.find(d => d.vent.id === vent.id);
    const device = { vent, enabled: true, floorId: d?.floorId ?? "unassigned", roomId: d?.roomId ?? "unassigned", outdoorAirFraction: d?.outdoorAirFraction ?? 1, extractKind: d?.extractKind ?? "exhaust" as const };
    const q = ventFlowM3S(device, density), areaM2 = ventAreaM2(device);
    const checked = report?.vents.find(v => v.id === vent.id);
    return { id: vent.id, roomId: device.roomId, floorId: device.floorId, host: vent.host.patchId, role: vent.role === "extract" ? device.extractKind : "supply", areaM2, volumeFlowM3S: q, massFlowKgS: q === null ? null : q * density, meanNormalVelocityMS: q === null ? null : q / areaM2, temperatureK: vent.temperatureK, control: vent.control,
      parameters: structuredClone(vent), outdoorAirFraction: device.outdoorAirFraction, outwardNormalVelocityMS: q === null ? null : (vent.role === "supply" ? -1 : 1) * q / areaM2,
      patchId: checked?.patchId ?? null, centerMm: checked?.centerMm ?? null, normal: checked?.outwardNormal ?? null, turbulenceIntensity: vent.turbulenceIntensity, turbulenceLengthM: vent.turbulenceLengthM, status: checked ? "checked" as const : "unvalidated" as const };
  });
  const warnings = ["Thermal execution is not connected to the isothermal native worker. Export this package for a compatible energy solver.",
    "Room-average sensible balance assumes steady, well-mixed air and lumped radiant exchange. It does not predict local temperatures, draught or humidity.",
    "Shared insulation maps declared Rtotal − Rsi to checked faces. Missing film splits or temperatures stay marked for review; Heating estimates do not silently replace missing insulation.",
    ...(operating && (operating.conditions.occupants || operating.conditions.equipmentW || operating.conditions.solarW) ? ["Zone-average people/equipment/solar gains are exported as intent. Located CFD source/receiver mapping is not connected; no extra air heat source is invented."] : []),
    ...(operating?.conditions.infiltrationM3S ? ["Conventional infiltration has no located CFD opening; define its physical boundary before thermal solving."] : []),
    ...heaters.filter(h => h.inDomain && h.enabled && h.watts === null).map(h => `${h.name}: effective heat is unknown; enter reviewed actual watts.`),
    ...heaters.filter(h => h.inDomain && h.enabled && h.kind === "ufh").map(h => `${h.name}: review the checked tube-spacing footprint and mapped power in Boundary capture; no whole-floor temperature substitution is used.`)];
  const sourceInput = JSON.stringify({ operating, caseSettings, devices: hvac?.devices, heaters: heaters.map(({ inDomain, ...h }) => { void inDomain; return h; }), vents: vents.map(({ patchId, centerMm, normal, status, ...v }) => { void [patchId, centerMm, normal, status]; return v; }),
    floors: projectFloors(project).map(f => ({ id: f.id, elevationMm: f.elevationMm, heightMm: f.heightMm, openings: f.openings, rooms: f.content.rooms, energy: f.content.energyLayout, heating: f.content.heatingLayout ? { ...f.content.heatingLayout, enabled: undefined, display: undefined } : undefined })), roof: project.building?.roof });
  return { version: 1, units: "mm", scenarioId: scenario.id, operatingScenarioId: operating?.id ?? null, conditions: operating?.conditions ?? null, caseSettings, boundaryInputs,
    checkedBoundaryCapture: report?.sharedBoundaryAudit ?? null,
    checkedPatches: report ? report.patches.map(({ id, kind, areaM2, boundary, boundaryOrigin }) => ({ id, kind, areaM2, boundary, boundaryOrigin })) : null,
    zoneGains: operating ? { peopleW: operating.conditions.occupants * operating.conditions.sensibleWPerson, equipmentW: operating.conditions.equipmentW, solarW: operating.conditions.solarW, mapping: "requiresLocatedSources" } : null,
    envelope, sourceInput, vents, heaters, warnings, thermalExecution: "notConnected" };
}

export const hvacModelLabel = (model: string) => model === "solidProxySurfacePower" ? "Room-effective heat over the measured radiator surface" : model === "zoneHeatFluxTubeSpacing" ? "Upward heat over the checked tube-spacing footprint" : model;
export const hvacControlLabel = (control: CFDVent["control"]) => ({ volumeFlow: "Volume flow", massFlow: "Mass flow", velocity: "Mean velocity", pressure: "Pressure" })[control];

export function requiresHvacThermalExecution(project: ProjectDocument, scenario: CFDScenario): boolean {
  const binding = project.hvac?.bindings[scenario.id];
  if (binding?.analysisMode === "airflow") return false;
  if (scenario.sharedBoundaries && (scenario.physics.energy || scenario.sharedBoundaries.sources.some(s => s.enabled && (s.watts === null || s.watts > 0)))) return true;
  if (!binding) return false;
  if (binding.analysisMode === "thermal" || binding.operatingScenarioId) return true;
  if (hasSharedInsulation(project)) return true;
  return sharedCaseInputs(project, scenario).heaters.some(h => h.inDomain && h.enabled && (h.watts === null || h.watts > 0));
}

/** Derived solver view. No canonical room/device is cloned back into a second editable collection. */
export function resolveHvacScenario(project: ProjectDocument, scenario: CFDScenario): CFDScenario {
  const hvac = project.hvac, binding = hvac?.bindings[scenario.id];
  if (!hvac || !binding) return scenario;
  const order = new Map(hvac.devices.map((d, i) => [`vent:${d.vent.id}`, i]));
  const linked = {
    ...scenario, vents: resolveHvacVents(project, scenario),
    objectGroups: scenario.objectGroups?.map(g => {
      const vents = g.memberIds.filter(id => id.startsWith("vent:")).sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity));
      let i = 0;
      return { ...g, memberIds: g.memberIds.map(id => id.startsWith("vent:") ? vents[i++] : id) };
    }),
  };
  if (binding.analysisMode === "airflow") {
    const operating = hvac.scenarios.find(s => s.id === binding.operatingScenarioId);
    return { ...linked, sharedBoundaries: undefined, physics: { ...linked.physics, ...operatingAirProperties(operating) } };
  }
  const source = sharedCaseInputs(project, scenario);
  return { ...linked, sharedBoundaries: source.boundaryInputs,
    assetOverrides: source.caseSettings.assetOverrides, physics: source.caseSettings.physics, outputs: source.caseSettings.outputs, postProcessing: source.caseSettings.postProcessing,
  };
}

/** A fresh airflow setup keeps the measured domain, vent hosts and operating flow. */
export function copyHvacAsAirflow(project: ProjectDocument, original: CFDScenario) {
  const hvac = project.hvac, binding = hvac?.bindings[original.id];
  if (!hvac || !binding || !original.seed) throw new Error("Select a measured room before creating the airflow copy.");
  if ((project.cfdScenarios?.length ?? 0) >= 100) throw new Error("Remove an existing simulation before creating the airflow copy.");
  const names = new Set(project.cfdScenarios?.map(s => s.name));
  const base = original.name.slice(0, 100) + " · Airflow";
  let name = base, index = 2;
  while (names.has(name)) name = base + " " + index++;
  const scenario = { ...newCFDScenario(project.projectId, name), seed: original.seed, group: original.group };
  return { scenario, hvac: hvacSchema.parse({ ...hvac, bindings: {
    ...hvac.bindings, [scenario.id]: { ...binding, analysisMode: "airflow" },
  } }) };
}
