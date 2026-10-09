import type { Room } from "./types";
import type { HeatingProject, HeatingRadiator, UFHZone, UFHCircuit } from "./heatingDocument";
import { calculateRoomHeatLoss, calculateRadiatorOutput, calculateElectricEmitterSize, calculateUFHOutput, calculateUFHFlowRate, calculateCircuitLength, calculatePressureDrop, thermalRoom, radiatorPlacementWarnings, snapRadiatorToWall, geometryFingerprint } from "./heatingCalculations";
import { activeUFHAreaM2, generateUFHLoops, validateCircuitGeometry } from "./heatingGeometry";
import { REFERENCE_RADIATORS, referenceRadiatorForRoom, type ReferenceRadiator } from "./heatingCatalogue";
import { withHeatingElements } from "./heatingElements";

export function newHeatingRadiator(room: Room, technology: HeatingRadiator["emitterTechnology"] = "Hydronic"): HeatingRadiator {
  return snapRadiatorToWall({ radiatorId: crypto.randomUUID(), roomId: room.id, manufacturer: "", model: "User reference radiator", category: "Type 22", emitterTechnology: technology, widthMm: 1000, heightMm: 600, depthMm: 100, positionMm: room.vertices[0], rotationDeg: 0, ratedOutputW: null, ratedDeltaTK: 50, exponent: 1.3, electricalInputW: 0, fanMode: "Normal", manufacturerPerformanceData: [], locked: false }, room, room.vertices[0]);
}
export function newUFHZone(room: Room, manifoldId: string | null): UFHZone {
  return { zoneId: crypto.randomUUID(), roomId: room.id, name: room.name, pipeType: "User-specified UFH pipe", diameterMm: 16, internalDiameterMm: null, spacingMm: 200, boundaryOffsetMm: 100, minBendRadiusMm: 80, maxCircuitLengthM: 100, pattern: "Spiral", orientation: "Auto", floorConstruction: "User-specified build-up", floorCovering: "Tile / stone", floorThermalResistance: 0.01, maxSurfaceTemperatureC: 29, manifoldId, performanceDataset: null, geometryFingerprint: "" };
}
export function heatingResults(rooms: readonly Room[], heating: HeatingProject) {
  if (!heating.radiators.length) heating = withHeatingElements(heating, rooms);
  const { flowTemperatureC: flow, returnTemperatureC: returning } = heating.heatingSystem;
  const rows = rooms.map(room => {
    const demand = calculateRoomHeatLoss(room, rooms, heating), settings = thermalRoom(room, heating), warnings: string[] = [];
    const emitters = heating.radiators.filter(r => r.roomId === room.id).map(r => ({ radiator: r, ...calculateRadiatorOutput(r, flow, returning, demand.targetC), warnings: radiatorPlacementWarnings(r, room) }));
    const zones = heating.ufhZones.filter(z => z.roomId === room.id).map(zone => {
      const exclusions = heating.exclusions.filter(e => e.roomId === room.id), activeAreaM2 = activeUFHAreaM2(room.vertices, exclusions.map(e => e.polygonMm));
      const circuits = heating.ufhCircuits.filter(c => c.zoneId === zone.zoneId), areaFromRuns = circuits.reduce((a, c) => a + calculateCircuitLength({ ...c, supplyPathMm: [], returnPathMm: [] }) * c.spacingMm / 1000, 0), coveredAreaM2 = Math.min(activeAreaM2, areaFromRuns);
      const parametersChanged = circuits.some(c => c.spacingMm !== zone.spacingMm || c.diameterMm !== zone.diameterMm);
      const performance = parametersChanged ? null : calculateUFHOutput(zone, flow, returning, demand.targetC);
      const stale = circuits.length > 0 && zone.geometryFingerprint !== geometryFingerprint(room, exclusions);
      const selectedManifold = heating.manifolds.find(m => m.manifoldId === zone.manifoldId);
      const zoneWarnings = [ ...(parametersChanged ? ["Pipe diameter/spacing changed: saved circuit geometry retained; regenerate explicitly before using the new performance table."] : []), ...(stale ? ["Project geometry/exclusions changed: existing pipes retained; review or regenerate explicitly."] : []), ...(!performance ? ["UFH performance not set for the selected pipe/build-up/spacing/resistance/temperatures."] : []), ...(performance?.overLimit ? ["UFH exceeds a supplied output limit or the chosen surface-temperature limit."] : []), ...(performance && performance.surfaceTemperatureC === null ? ["Surface-temperature data missing; capacity is not confirmed as safe."] : []), ...(selectedManifold && heating.ufhCircuits.filter(c => c.manifoldId === selectedManifold.manifoldId).length > selectedManifold.ports ? ["Manifold port count exceeded."] : []), ...(coveredAreaM2 < activeAreaM2 * 0.85 ? ["Pipe coverage is incomplete; area is estimated from heated path length × spacing, capped at active area."] : []) ];
      return { zone, activeAreaM2, coveredAreaM2, performance, outputW: performance ? coveredAreaM2 * performance.outputWm2 : null, warnings: zoneWarnings, circuits: circuits.map(c => {
        const heatedLengthM = calculateCircuitLength({ ...c, supplyPathMm: [], returnPathMm: [] }), areaM2 = areaFromRuns > 0 ? coveredAreaM2 * (heatedLengthM * c.spacingMm / 1000) / areaFromRuns : 0;
        const outputW = performance ? areaM2 * performance.outputWm2 : null, flowLmin = outputW === null ? null : calculateUFHFlowRate(outputW, flow, returning), lengthM = calculateCircuitLength(c);
        return { circuit: c, lengthM, areaM2, outputW, flowLmin, designFlowLmin: calculateUFHFlowRate(demand.designW * areaM2 / Math.max(activeAreaM2, 0.01), flow, returning), pressureDropPa: flowLmin === null || (zone.internalDiameterMm ?? Infinity) >= zone.diameterMm ? null : calculatePressureDrop(lengthM, flowLmin, zone.internalDiameterMm, (flow + returning) / 2), warnings: validateCircuitGeometry(c, room, zone, heating.exclusions) };
      }) };
    });
    if (flow <= returning) warnings.push("Flow temperature must exceed return temperature for hydronic flow sizing.");
    if (zones.length > 1) warnings.push("Multiple zones share this room: verify non-overlapping active coverage; capacities are not summed as certified coverage.");
    const radiatorW = emitters.reduce((s, e) => s + (e.outputW ?? 0), 0), ufhW = zones.reduce((s, z) => s + (z.outputW ?? 0), 0), capacityW = radiatorW + ufhW;
    const unknown = emitters.some(e => e.radiator.category !== "Boiler" && (e.radiator.estimatedOutput || e.outputW === null || e.radiator.emitterTechnology !== "Electric" && flow <= returning)) || zones.some(z => !z.performance || z.performance.surfaceTemperatureC === null || z.performance.overLimit || flow <= returning || z.zone.geometryFingerprint !== geometryFingerprint(room, heating.exclusions.filter(e => e.roomId === room.id)) || z.circuits.some(c => c.warnings.some(w => /crosses room boundary|exceeds preferred maximum/i.test(w)))) || zones.length > 1;
    const status = unknown || demand.warnings.some(w => w.startsWith("Energy ")) ? "Not verified" : capacityW >= demand.designW ? "Sufficient" : capacityW >= demand.designW * 0.9 ? "Marginal" : "Insufficient";
    if (settings.selectedEmitterType !== "None" && capacityW < demand.designW) warnings.push("Installed emitters do not meet the selected design requirement.");
    return { room, settings, demand, emitters, zones, radiatorW, ufhW, capacityW, coveragePercent: demand.designW ? capacityW / demand.designW * 100 : 0, status, warnings: [...warnings, ...demand.warnings.filter(w => w.startsWith("Energy ")), ...emitters.flatMap(e => e.warnings), ...zones.flatMap(z => [...z.warnings, ...z.circuits.flatMap(c => c.warnings)])] };
  });
  const orphanIds = [...heating.radiators, ...heating.ufhZones, ...heating.exclusions].filter(e => !rooms.some(r => r.id === e.roomId));
  return { rooms: rows, heatLossW: rows.reduce((s, r) => s + r.demand.designW, 0), radiatorW: rows.reduce((s, r) => s + r.radiatorW, 0), ufhW: rows.reduce((s, r) => s + r.ufhW, 0), electricW: rows.reduce((s, r) => s + r.emitters.reduce((s, e) => s + e.electricalW, 0), 0), pipeM: heating.ufhCircuits.reduce((s, c) => s + calculateCircuitLength(c), 0), sufficient: rows.filter(r => r.status === "Sufficient").length, warnings: [...rows.flatMap(r => r.warnings.map(message => `${r.room.name}: ${message}`)), ...(orphanIds.length ? [`${orphanIds.length} heating objects reference removed rooms. Data retained, but capacity excluded; review the saved layout.`] : [])] };
}
export function regenerateHeatingRoom(room: Room, heating: HeatingProject) {
  const next = structuredClone(heating), changes: string[] = [];
  for (const zone of next.ufhZones.filter(z => z.roomId === room.id)) {
    const existing = next.ufhCircuits.filter(c => c.zoneId === zone.zoneId), manifold = next.manifolds.find(m => m.manifoldId === zone.manifoldId);
    if (!manifold) { changes.push(`${room.name}: place/select a manifold first.`); continue; }
    const result = generateUFHLoops(room, zone, manifold, next.exclusions, existing);
    if (!result.circuits.length) { changes.push(...result.warnings.map(w => `${room.name}: ${w}`)); continue; }
    next.ufhCircuits = [...next.ufhCircuits.filter(c => c.zoneId !== zone.zoneId), ...result.circuits];
    if (!existing.some(c => c.locked)) zone.geometryFingerprint = result.fingerprint;
    changes.push(`${room.name}: ${result.circuits.length} circuits (${result.circuits.map(c => `${calculateCircuitLength(c).toFixed(1)} m`).join(", ")}).`, ...result.warnings);
  }
  return { heating: next, changes };
}
export function autoDesignHeating(rooms: readonly Room[], heating: HeatingProject, referenceOutputPerMetreW: number | null, scopeRoomIds?: string[], catalogueRadiators: ReferenceRadiator[] = REFERENCE_RADIATORS) {
  let next = structuredClone(heating); const changes: string[] = [];
  for (const room of rooms) {
    if (scopeRoomIds && !scopeRoomIds.includes(room.id)) continue;
    const settings = thermalRoom(room, next), demand = calculateRoomHeatLoss(room, rooms, next).designW;
    if (settings.selectedEmitterType.includes("UFH") || settings.selectedEmitterType === "Underfloor Heating") {
      if (!next.ufhZones.some(z => z.roomId === room.id)) next.ufhZones.push(newUFHZone(room, next.manifolds[0]?.manifoldId ?? null));
      const generated = regenerateHeatingRoom(room, next);next = generated.heating;changes.push(...generated.changes);
    }
    const installed = next.radiators.filter(r => r.roomId === room.id && r.category !== "Boiler");
    if (installed.length) { changes.push(`${room.name}: existing radiator selections retained; review capacity or remove before auto sizing.`); continue; }
    if (settings.selectedEmitterType === "None" || settings.selectedEmitterType === "Underfloor Heating") continue;
    const ufhOutput = heatingResults([room], next).rooms[0].ufhW, remaining = settings.selectedEmitterType === "Radiator + UFH" ? Math.max(0, demand - ufhOutput) : demand;
    if (remaining <= 0) continue;
    if (settings.selectedEmitterType === "Electric Radiator") {
      calculateElectricEmitterSize(remaining).forEach((capacity, i) => { const radiator = newHeatingRadiator(room, "Electric"); radiator.ratedOutputW = capacity; radiator.model = `${capacity} W resistive emitter`; const edge = room.vertices[i % room.vertices.length];next.radiators.push(snapRadiatorToWall(radiator, room, edge)); });
      changes.push(`${room.name}: electric capacity sized to ${remaining.toFixed(0)} W demand.`);
    } else if (settings.selectedEmitterType === "Hybrid Radiator" || !referenceOutputPerMetreW) {
      const technology = settings.selectedEmitterType === "Hybrid Radiator" ? "Hybrid" : "Hydronic";
      const candidates = catalogueRadiators.filter(p => p.emitterTechnology === technology).flatMap(product => room.vertices.map((a,i) => {
        const b = room.vertices[(i+1)%room.vertices.length], radiator = referenceRadiatorForRoom(product,room);
        return snapRadiatorToWall(radiator,room,{x:(a.x+b.x)/2,y:(a.y+b.y)/2});
      })).filter(r => !radiatorPlacementWarnings(r,room).length).map(r => ({radiator:r,output:calculateRadiatorOutput(r,next.heatingSystem.flowTemperatureC,next.heatingSystem.returnTemperatureC,settings.designIndoorTemperatureC).outputW})).filter((c): c is {radiator:HeatingRadiator;output:number} => c.output !== null);
      const chosen = candidates.filter(c => c.output >= remaining).sort((a,b) => a.radiator.widthMm*a.radiator.heightMm-b.radiator.widthMm*b.radiator.heightMm)[0] ?? candidates.sort((a,b) => b.output-a.output)[0];
      if (chosen) { next.radiators.push(chosen.radiator);changes.push(`${room.name}: ${chosen.radiator.manufacturer} ${chosen.radiator.model}, ${Math.round(chosen.output)} W at selected conditions; ${chosen.output >= remaining ? "demand covered" : "undersized — supplementary emitter required"}. Source stored with selection.`); }
      else changes.push(`${room.name}: no reference model with supported operating conditions and available wall space. Hybrid tables support 20°C room temperature only; choose/import appropriate product data. Generic panels require your W/m reference.`);
    }
    else {
      const reference = newHeatingRadiator(room);reference.ratedOutputW = referenceOutputPerMetreW;
      const { flowTemperatureC: flow, returnTemperatureC: returning } = next.heatingSystem, atOneMetre = calculateRadiatorOutput(reference, flow, returning, settings.designIndoorTemperatureC).outputW ?? 0;
      if (!atOneMetre) { changes.push(`${room.name}: selected water temperature cannot deliver heat above room temperature.`); continue; }
      let widthNeeded = Math.ceil(remaining / atOneMetre * 10) * 100;
      const available = room.vertices.map((a, index) => { const b = room.vertices[(index + 1) % room.vertices.length], length = Math.hypot(b.x - a.x, b.y - a.y), doors = room.openings.filter(o => o.kind === "DOOR" && o.parent_wall_id === `wall-${String(index + 1).padStart(3, "0")}`).sort((a, b) => a.offset_mm - b.offset_mm);let start = 0; const segments: { index: number; start: number; length: number }[] = [];for (const d of doors) { if (d.offset_mm > start) segments.push({ index, start, length: d.offset_mm - start });start = Math.max(start, d.offset_mm + d.width.value); }if (length > start) segments.push({ index, start, length: length - start });return segments; }).flat().sort((a, b) => b.length - a.length);
      for (const span of available) {
        const width = Math.min(2000, widthNeeded, Math.floor((span.length - 100) / 100) * 100);if (width < 300) continue;
        const radiator = { ...reference, radiatorId: crypto.randomUUID(), widthMm: width, ratedOutputW: referenceOutputPerMetreW * width / 1000, model: "Generic estimated panel (user W/m reference)" }, a = room.vertices[span.index], b = room.vertices[(span.index + 1) % room.vertices.length], length = Math.hypot(b.x - a.x, b.y - a.y), along = span.start + width / 2 + 50;
        next.radiators.push(snapRadiatorToWall(radiator, room, { x: a.x + (b.x - a.x) * along / length, y: a.y + (b.y - a.y) * along / length }));widthNeeded -= width;if (widthNeeded <= 0) break;
      }
      changes.push(`${room.name}: generic estimated panels sized using your ${referenceOutputPerMetreW} W/m reference; ${widthNeeded > 0 ? "available wall space insufficient" : "required output covered"}.`);
    }
  }
  return { heating: next, changes };
}
export function splitHeatingCircuit(c: UFHCircuit, heating: HeatingProject, paths: Point2DPair) {
  const manifold = heating.manifolds.find(m => m.manifoldId === c.manifoldId)!;
  return paths.map((pathMm, i) => ({ ...c, circuitId: crypto.randomUUID(), name: `${c.name}-${i + 1}`, pathMm, generatedPathMm: undefined, supplyPathMm: [manifold.positionMm, pathMm[0]], returnPathMm: [pathMm.at(-1)!, manifold.positionMm], manuallyEdited: true }));
}
type Point2DPair = import("./types").Point2D[][];
