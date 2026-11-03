import { projectFloors } from "./buildingDocument";
import { withEnergyFabric } from "./energyCalculations";
import { newEnergyProject } from "./energyDocument";
import { heatingResults } from "./heatingDesign";
import { newHeatingProject } from "./heatingDocument";
import { withHeatingElements } from "./heatingElements";
import { assetOverrideSchema, type CFDScenario, type CFDVent } from "./climoptixDocument";
import { calculateHvac, ventAreaM2, ventFlowM3S } from "./hvacCalculations";
import { operatingVents, resolveHvacVents, type HvacConditions, type HvacOperatingScenario } from "./hvacDocument";
import type { ProjectDocument } from "./projectDocument";
import type { CFDReport } from "./climoptix";
import { geometryFingerprint } from "./heatingCalculations";
import type { SharedBoundaryInputs, SharedBoundaryAudit } from "./sharedBoundaryDocument";

export function hasSharedInsulation(project: ProjectDocument) {
  return projectFloors(project).some(f => { const e = f.content.energyLayout; return e && (e.existingAssignments.length || e.scenarios.find(s => s.scenarioId === e.activeScenarioId)?.assignments.length); });
}

/** All powers are room-effective thermal W, never water temperatures or electrical fan draw. */
export function hvacHeatingSources(project: ProjectDocument, operating?: HvacOperatingScenario | null) {
  return projectFloors(project).flatMap(floor => {
    const data = floor.content;
    let heating = withHeatingElements(data.heatingLayout ?? newHeatingProject(), data.rooms);
    if (operating && floor.id === operating.floorId) heating = { ...heating,
      buildingSettings: { ...heating.buildingSettings, externalDesignTemperatureC: operating.conditions.outdoorC },
      rooms: [...heating.rooms.filter(r => r.roomId !== operating.roomId), {
        roomId: operating.roomId,
        airChangeRate: 0, selectedEmitterType: "Radiator", floorBoundary: "Ground", ceilingBoundary: "External", adjacentTemperatureC: 10, walls: {},
        ...heating.rooms.find(r => r.roomId === operating.roomId),
        // Evaluate emitter output at this scenario's air temperature; retain all design settings.
        ...( { designIndoorTemperatureC: operating.conditions.roomC, designTemperatureOverride: true } ),
      }],
    };
    heating = withEnergyFabric(heating, data.energyLayout ?? newEnergyProject(), data.rooms);
    return heatingResults(data.rooms, heating).rooms.map(row => ({ floorId: floor.id, row, heating }));
  });
}

export function conventionalHvac(project: ProjectDocument, operating: HvacOperatingScenario) {
  const source = hvacHeatingSources(project, operating).find(r => r.floorId === operating.floorId && r.row.room.id === operating.roomId);
  if (!source) throw new Error("Select an existing measured room on this floor.");
  const row = source.row;
  const heaters = [...row.emitters.filter(e => e.radiator.category !== "Boiler").map(e => ({ id: e.radiator.radiatorId, name: e.radiator.model, watts: e.outputW })),
    ...row.zones.map(z => ({ id: z.zone.zoneId, name: z.zone.name, watts: z.warnings.length ? null : z.outputW }))].map(h => {
      const o = operating.heaterOverrides[h.id];
      return { ...h, watts: o?.enabled === false ? 0 : o?.actualW ?? h.watts };
    });
  const devices = operatingVents(project.hvac!, operating).filter(d => d.floorId === operating.floorId && d.roomId === operating.roomId);
  return calculateHvac({ areaM2: row.demand.areaM2, volumeM3: row.demand.volumeM3, conditions: operating.conditions, devices,
    surfaces: row.demand.surfaces.map(s => ({ label: s.label, hWK: s.boundary === "Adiabatic" ? 0 : s.uValue * s.areaM2, adjacentC: s.adjacentTemperatureC })), heating: heaters });
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
      ...(operating ? { densityKgM3: operating.conditions.densityKgM3, heatCapacityJKgK: operating.conditions.cpJKgK, referenceTemperatureK: operating.conditions.roomC + 273.15, initialTemperatureK: operating.conditions.roomC + 273.15, outdoorTemperatureK: operating.conditions.outdoorC + 273.15 } : {}),
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
  envelope: { floorId: string; roomId: string; surfaceKey: string; label: string; areaM2: number; uWm2K: number; adjacentC: number; boundary: string }[];
  sourceInput: string; vents: { id: string; roomId: string; floorId: string; host: string; role: string; areaM2: number; volumeFlowM3S: number | null; massFlowKgS: number | null; meanNormalVelocityMS: number | null; outwardNormalVelocityMS: number | null; temperatureK: number; control: string; parameters: CFDVent; outdoorAirFraction: number; patchId: string | null; centerMm: number[] | null; normal: number[] | null; turbulenceIntensity: number; turbulenceLengthM: number; status: "checked" | "unvalidated" }[];
  heaters: { id: string; name: string; floorId: string; roomId: string; kind: "radiator" | "ufh"; watts: number | null; enabled: boolean; inDomain: boolean; model: string; coverageM2: number | null; footprint: unknown; notes: string }[];
  warnings: string[]; thermalExecution: "notConnected";
}

export function hvacBoundaryPackage(project: ProjectDocument, scenario: CFDScenario, report?: CFDReport | null): HvacCfdBoundaryPackage {
  const hvac = project.hvac, binding = hvac?.bindings[scenario.id];
  const operating = hvac?.scenarios.find(s => s.id === binding?.operatingScenarioId);
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
  const scope = JSON.stringify(binding?.scopeSeed) === JSON.stringify(scenario.seed) ? binding?.scopeRooms ?? [] : [];
  const included = (floorId: string, roomId: string) => report ? report.domain.regions.some(r => r.included && r.id === roomId && r.floorId === floorId) : scope.some(r => r.floorId === floorId && r.roomId === roomId) || scenario.seed?.floorId === floorId && scenario.seed?.roomId === roomId;
    const heaters: HvacCfdBoundaryPackage["heaters"] = [];
  const envelope: HvacCfdBoundaryPackage["envelope"] = [];
  const sources: SharedBoundaryInputs["sources"] = [];
  for (const { floorId, row, heating } of hvacHeatingSources(project, operating)) {
    envelope.push(...row.demand.surfaces.map(s => ({ floorId, roomId: row.room.id, surfaceKey: s.key, label: s.label, areaM2: s.areaM2, uWm2K: s.uValue, adjacentC: s.adjacentTemperatureC, boundary: s.boundary })));
    for (const e of row.emitters.filter(e => e.radiator.category !== "Boiler")) {
      const override = operating?.heaterOverrides[e.radiator.radiatorId];
      heaters.push({ id: e.radiator.radiatorId, name: e.radiator.model, floorId, roomId: row.room.id, kind: "radiator", watts: override?.enabled === false ? 0 : override?.actualW ?? e.outputW,
        enabled: override?.enabled !== false && (operating?.conditions.includeHeating ?? true), inDomain: included(floorId, row.room.id), model: "solidProxySurfacePower", coverageM2: null, footprint: e.radiator.positionMm,
        notes: `${e.note} Lumped room-effective sensible heat distributed once over exposed proxy surfaces. Radiation is not separately resolved; no local comfort claim.` });
      const h = heaters.at(-1)!;
      sources.push({ id: h.id, name: h.name.slice(0, 200), floorId, roomId: row.room.id, kind: "radiator", watts: h.watts, enabled: h.enabled, geometryValid: true, planningAreaM2: null, circuits: [], exclusions: [] });
    }
    for (const z of row.zones) {
      const override = operating?.heaterOverrides[z.zone.zoneId];
      heaters.push({ id: z.zone.zoneId, name: z.zone.name, floorId, roomId: row.room.id, kind: "ufh", watts: override?.enabled === false ? 0 : override?.actualW ?? (z.warnings.length ? null : z.outputW),
        enabled: override?.enabled !== false && (operating?.conditions.includeHeating ?? true), inDomain: included(floorId, row.room.id), model: "zoneHeatFluxTubeSpacing", coverageM2: z.coveredAreaM2,
        footprint: { roomPolygonMm: row.room.vertices, exclusions: heating.exclusions.filter(e => e.roomId === row.room.id), circuits: z.circuits.map(c => ({ id: c.circuit.circuitId, pathMm: c.circuit.pathMm, spacingMm: c.circuit.spacingMm })), zone: z.zone },
        notes: "Upward room-side watts from the existing UFH performance model or reviewed operation. Preparation maps uniform heat to tube-spacing footprints clipped to checked floor faces and exclusions; this is not a resolved pipe/solid or radiation model." });
      const h = heaters.at(-1)!, exclusions = heating.exclusions.filter(e => e.roomId === row.room.id);
      sources.push({ id: h.id, name: h.name.slice(0, 200), floorId, roomId: row.room.id, kind: "ufh", watts: h.watts, enabled: h.enabled,
        geometryValid: z.zone.geometryFingerprint === geometryFingerprint(row.room, exclusions) && z.circuits.every(c => c.circuit.spacingMm === z.zone.spacingMm && c.circuit.diameterMm === z.zone.diameterMm), planningAreaM2: z.coveredAreaM2,
        circuits: z.circuits.map(c => ({ id: c.circuit.circuitId, pathMm: c.circuit.pathMm, spacingMm: c.circuit.spacingMm })), exclusions: exclusions.map(e => e.polygonMm) });
    }
  }
  const warnings = ["Thermal execution is not connected to the isothermal native worker. Export this package for a compatible energy solver.",
    "Room-average sensible balance assumes steady, well-mixed air and lumped radiant exchange. It does not predict local temperatures, draught or humidity.",
    "Shared insulation maps declared Rtotal − Rsi to checked faces. Missing film splits or temperatures stay marked for review; Heating estimates do not silently replace missing insulation.",
    ...(operating && (operating.conditions.occupants || operating.conditions.equipmentW || operating.conditions.solarW) ? ["Zone-average people/equipment/solar gains are exported as intent. Located CFD source/receiver mapping is not connected; no extra air heat source is invented."] : []),
    ...(operating?.conditions.infiltrationM3S ? ["Conventional infiltration has no located CFD opening; define its physical boundary before thermal solving."] : []),
    ...heaters.filter(h => h.inDomain && h.enabled && h.watts === null).map(h => `${h.name}: effective heat is unknown; enter reviewed actual watts.`),
    ...heaters.filter(h => h.inDomain && h.enabled && h.kind === "ufh").map(h => `${h.name}: review the checked tube-spacing footprint and mapped power in Boundary capture; no whole-floor temperature substitution is used.`)];
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
  if (scenario.sharedBoundaries && (scenario.physics.energy || scenario.sharedBoundaries.sources.some(s => s.enabled && (s.watts === null || s.watts > 0)))) return true;
  if (!project.hvac?.bindings[scenario.id]) return false;
  if (project.hvac.bindings[scenario.id].operatingScenarioId) return true;
  if (hasSharedInsulation(project)) return true;
  return hvacBoundaryPackage(project, scenario).heaters.some(h => h.inDomain && h.enabled && (h.watts === null || h.watts > 0));
}

/** Derived solver view. No canonical room/device is cloned back into a second editable collection. */
export function resolveHvacScenario(project: ProjectDocument, scenario: CFDScenario): CFDScenario {
  if (!project.hvac?.bindings[scenario.id]) return scenario;
  const pkg = hvacBoundaryPackage(project, scenario);
  const order = new Map(project.hvac.devices.map((d, i) => [`vent:${d.vent.id}`, i]));
  return { ...scenario, vents: resolveHvacVents(project, scenario), sharedBoundaries: pkg.boundaryInputs,
    objectGroups: scenario.objectGroups?.map(g => {
      const vents = g.memberIds.filter(id => id.startsWith("vent:")).sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity));
      let i = 0;
      return { ...g, memberIds: g.memberIds.map(id => id.startsWith("vent:") ? vents[i++] : id) };
    }),
    assetOverrides: pkg.caseSettings.assetOverrides, physics: pkg.caseSettings.physics, outputs: pkg.caseSettings.outputs, postProcessing: pkg.caseSettings.postProcessing,
  };
}
