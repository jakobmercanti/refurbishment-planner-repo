import { projectFloors } from "./buildingDocument";
import { withEnergyFabric } from "./energyCalculations";
import { newEnergyProject } from "./energyDocument";
import { heatingResults } from "./heatingDesign";
import { newHeatingProject } from "./heatingDocument";
import { withHeatingElements } from "./heatingElements";
import { geometryFingerprint } from "./heatingCalculations";
import { calculateHvac } from "./hvacCalculations";
import { operatingVents, type HvacOperatingScenario } from "./hvacDocument";
import type { ProjectDocument } from "./projectDocument";
import type { SharedBoundaryInputs } from "./sharedBoundaryDocument";

export interface SharedHeater {
  id: string; name: string; floorId: string; roomId: string;
  kind: "radiator" | "ufh"; watts: number | null; enabled: boolean; inDomain: boolean;
  model: string; coverageM2: number | null; footprint: unknown; notes: string;
}
export interface SharedEnvelope {
  floorId: string; roomId: string; surfaceKey: string; label: string;
  areaM2: number; uWm2K: number; adjacentC: number; boundary: string;
}

/** All powers are room-effective thermal W, never water temperatures or electrical fan draw. */
function heatingSources(project: ProjectDocument, operating?: HvacOperatingScenario | null) {
  return projectFloors(project).flatMap(floor => {
    const data = floor.content;
    let heating = withHeatingElements(data.heatingLayout ?? newHeatingProject(), data.rooms);
    if (operating && floor.id === operating.floorId) heating = { ...heating,
      buildingSettings: { ...heating.buildingSettings, externalDesignTemperatureC: operating.conditions.outdoorC },
      rooms: [...heating.rooms.filter(r => r.roomId !== operating.roomId), {
        roomId: operating.roomId,
        airChangeRate: 0, selectedEmitterType: "Radiator", floorBoundary: "Ground", ceilingBoundary: "External", adjacentTemperatureC: 10, walls: {},
        ...heating.rooms.find(r => r.roomId === operating.roomId),
        designIndoorTemperatureC: operating.conditions.roomC, designTemperatureOverride: true,
      }],
    };
    heating = withEnergyFabric(heating, data.energyLayout ?? newEnergyProject(), data.rooms);
    return heatingResults(data.rooms, heating).rooms.map(row => ({ floorId: floor.id, row, heating }));
  });
}

function operatingPower(id: string, watts: number | null, operating?: HvacOperatingScenario | null) {
  const override = operating?.heaterOverrides[id];
  return {
    watts: override?.enabled === false ? 0 : override?.actualW ?? watts,
    enabled: override?.enabled !== false && (operating?.conditions.includeHeating ?? true),
  };
}

export function conventionalHvac(project: ProjectDocument, operating: HvacOperatingScenario) {
  const source = heatingSources(project, operating).find(r => r.floorId === operating.floorId && r.row.room.id === operating.roomId);
  if (!source) throw new Error("Select an existing measured room on this floor.");
  const row = source.row;
  const heaters = [...row.emitters.filter(e => e.radiator.category !== "Boiler").map(e => ({ id: e.radiator.radiatorId, name: e.radiator.model, watts: e.outputW })),
    ...row.zones.map(z => ({ id: z.zone.zoneId, name: z.zone.name, watts: z.warnings.length ? null : z.outputW }))]
    .map(h => ({ ...h, ...operatingPower(h.id, h.watts, operating) }));
  const devices = project.hvac ? operatingVents(project.hvac, operating).filter(d => d.floorId === operating.floorId && d.roomId === operating.roomId) : [];
  return calculateHvac({ areaM2: row.demand.areaM2, volumeM3: row.demand.volumeM3, conditions: operating.conditions, devices,
    surfaces: row.demand.surfaces.map(s => ({ label: s.label, hWK: s.boundary === "Adiabatic" ? 0 : s.uValue * s.areaM2, adjacentC: s.adjacentTemperatureC })), heating: heaters });
}

/** One source projection serves both live CFD preparation and the review/export package. */
export function sharedHeatingBoundaries(
  project: ProjectDocument,
  operating: HvacOperatingScenario | undefined,
  included: (floorId: string, roomId: string) => boolean,
) {
  const heaters: SharedHeater[] = [], envelope: SharedEnvelope[] = [];
  const sources: SharedBoundaryInputs["sources"] = [];
  for (const { floorId, row, heating } of heatingSources(project, operating)) {
    const roomId = row.room.id, inDomain = included(floorId, roomId);
    envelope.push(...row.demand.surfaces.map(s => ({ floorId, roomId, surfaceKey: s.key, label: s.label, areaM2: s.areaM2, uWm2K: s.uValue, adjacentC: s.adjacentTemperatureC, boundary: s.boundary })));
    for (const e of row.emitters.filter(e => e.radiator.category !== "Boiler")) {
      const id = e.radiator.radiatorId;
      const heater: SharedHeater = { id, name: e.radiator.model, floorId, roomId, inDomain, kind: "radiator",
        ...operatingPower(id, e.outputW, operating), model: "solidProxySurfacePower", coverageM2: null, footprint: e.radiator.positionMm,
        notes: `${e.note} Lumped room-effective sensible heat distributed once over exposed proxy surfaces. Radiation is not separately resolved; no local comfort claim.` };
      heaters.push(heater);
      sources.push({ id, name: heater.name.slice(0, 200), floorId, roomId, kind: "radiator", watts: heater.watts, enabled: heater.enabled,
        geometryValid: true, planningAreaM2: null, circuits: [], exclusions: [] });
    }
    const exclusions = heating.exclusions.filter(e => e.roomId === roomId);
    for (const z of row.zones) {
      const id = z.zone.zoneId;
      const circuits = z.circuits.map(c => ({ id: c.circuit.circuitId, pathMm: c.circuit.pathMm, spacingMm: c.circuit.spacingMm }));
      const heater: SharedHeater = { id, name: z.zone.name, floorId, roomId, inDomain, kind: "ufh",
        ...operatingPower(id, z.warnings.length ? null : z.outputW, operating), model: "zoneHeatFluxTubeSpacing", coverageM2: z.coveredAreaM2,
        footprint: { roomPolygonMm: row.room.vertices, exclusions, circuits, zone: z.zone },
        notes: "Upward room-side watts from the existing UFH performance model or reviewed operation. Preparation maps uniform heat to tube-spacing footprints clipped to checked floor faces and exclusions; this is not a resolved pipe/solid or radiation model." };
      heaters.push(heater);
      sources.push({ id, name: heater.name.slice(0, 200), floorId, roomId, kind: "ufh", watts: heater.watts, enabled: heater.enabled,
        geometryValid: z.zone.geometryFingerprint === geometryFingerprint(row.room, exclusions) && z.circuits.every(c => c.circuit.spacingMm === z.zone.spacingMm && c.circuit.diameterMm === z.zone.diameterMm),
        planningAreaM2: z.coveredAreaM2, circuits, exclusions: exclusions.map(e => e.polygonMm) });
    }
  }
  return { heaters, envelope, sources };
}
