import { hvacConditionsSchema, ventDeviceSchema, type HvacConditions, type VentDevice } from "./hvacDocument";

export interface HvacSurface { label: string; hWK: number; adjacentC: number }
export interface HvacHeat { id: string; name: string; watts: number | null }
export const flowToDisplay = (q: number, unit: string) => q * (unit === "L/s" ? 1000 : unit === "m³/h" ? 3600 : 1);
export const flowFromDisplay = (q: number, unit: string) => q / (unit === "L/s" ? 1000 : unit === "m³/h" ? 3600 : 1);
export function ventAreaM2(device: VentDevice): number {
  const v = device.vent;
  return (v.shape === "circle" ? Math.PI * v.diameterMm ** 2 / 4 : v.widthMm * v.heightMm) / 1e6 * v.openAreaFraction;
}
export function ventFlowM3S(device: VentDevice, density: number): number | null {
  const v = device.vent;
  if (!device.enabled) return 0;
  if (v.control === "pressure") return null;
  if (!(density > 0) || !Number.isFinite(v.valueSI) || v.valueSI <= 0) return null;
  return v.control === "massFlow" ? v.valueSI / density : v.control === "velocity" ? v.valueSI * ventAreaM2(device) : v.valueSI;
}
export function requiredSensibleFlow(loadW: number, supplyC: number, roomC: number, density = 1.2, cp = 1005): number | null {
  // Positive load is heat that must be removed; negative load needs heating.
  const drive = roomC - supplyC;
  if (![loadW, supplyC, roomC, density, cp].every(Number.isFinite) || density <= 0 || cp <= 0 || Math.abs(drive) < 0.01 || loadW * drive < 0) return null;
  return Math.abs(loadW / (density * cp * drive));
}
export function calculateHvac(input: {
  volumeM3: number; areaM2: number; conditions: HvacConditions;
  devices: VentDevice[]; surfaces?: HvacSurface[]; heating?: HvacHeat[];
}) {
  const c = hvacConditionsSchema.parse(input.conditions);
  if (!(input.volumeM3 > 0) || !(input.areaM2 > 0) || !Number.isFinite(input.volumeM3) || !Number.isFinite(input.areaM2)) throw new Error("A positive measured room area and volume are required.");
  const surfaces = input.surfaces ?? [];
  if (surfaces.some(s => !Number.isFinite(s.hWK) || s.hWK < 0 || !Number.isFinite(s.adjacentC))) throw new Error("Invalid envelope conductance or source temperature.");
  const warnings: string[] = [];
  const streams = input.devices.map(d => ventDeviceSchema.parse(d)).filter(d => d.enabled).map(device => {
    const flowM3S = ventFlowM3S(device, c.densityKgM3), areaM2 = ventAreaM2(device);
    if (!(areaM2 > 0)) throw new Error("Vent effective area must be positive.");
    if (flowM3S === null) warnings.push(`${device.vent.name}: pressure-controlled flow is unknown until solved.`);
    return { device, flowM3S, areaM2, faceVelocityMS: flowM3S === null ? null : flowM3S / areaM2 };
  });
  const supply = streams.filter(s => s.device.vent.role === "supply"), extracts = streams.filter(s => s.device.vent.role === "extract");
  const sumFlow = (list: typeof streams) => list.some(s => s.flowM3S === null) ? null : list.reduce((total, s) => total + (s.flowM3S ?? 0), 0);
  const supplyM3S = sumFlow(supply), extractM3S = sumFlow(extracts);
  const outdoorM3S = supplyM3S === null ? null : supply.reduce((total, s) => total + s.flowM3S! * s.device.outdoorAirFraction, 0);
  const exhaustM3S = sumFlow(extracts.filter(s => s.device.extractKind === "exhaust"));
  const returnM3S = sumFlow(extracts.filter(s => s.device.extractKind === "return"));
  const recirculatedM3S = supplyM3S === null || outdoorM3S === null ? null : supplyM3S - outdoorM3S;
  if (recirculatedM3S && returnM3S !== null && returnM3S < recirculatedM3S - 1e-8) warnings.push("Recirculated supply exceeds declared return flow; review the mixing/return path.");
  const balanceM3S = supplyM3S === null || extractM3S === null ? null : supplyM3S + c.infiltrationM3S - extractM3S;
  const knownExtract = extracts.reduce((sum, s) => sum + (s.flowM3S ?? 0), 0);
  const massValid = supplyM3S !== null && supplyM3S + c.infiltrationM3S >= knownExtract - 1e-8;
  if (!massValid) warnings.push("Extract exceeds known inflow. Add the actual infiltration/transfer path before calculating room temperature.");
  if (balanceM3S !== null && balanceM3S > 1e-8) warnings.push("Surplus inflow requires a pressure outlet or equal relief/exfiltration at room temperature; no extra outdoor inflow is invented.");
  const heating = c.includeHeating ? input.heating ?? [] : [];
  if (heating.some(h => h.watts === null)) warnings.push("Some heating outputs are unknown at these operating conditions; equilibrium and residual cannot be confirmed.");
  if (heating.some(h => h.watts !== null && (!Number.isFinite(h.watts) || h.watts < 0))) throw new Error("Invalid effective heating output.");
  const heatingW = heating.reduce((sum, h) => sum + (h.watts ?? 0), 0);
  const knownHeating = !heating.some(h => h.watts === null);
  const rc = c.densityKgM3 * c.cpJKgK;
  const conductionW = surfaces.reduce((sum, s) => sum + s.hWK * (s.adjacentC - c.roomC), 0);
  const peopleW = c.occupants * c.sensibleWPerson, internalW = peopleW + c.equipmentW + c.solarW;
  const infiltrationW = rc * c.infiltrationM3S * (c.outdoorC - c.roomC);
  const ventilationW = supplyM3S === null ? null : supply.reduce((sum, s) => sum + rc * s.flowM3S! * (s.device.vent.temperatureK - 273.15 - c.roomC), 0);
  const loadWithoutSupplyW = conductionW + internalW + infiltrationW + heatingW;
  const residualW = ventilationW === null || !knownHeating || !massValid ? null : loadWithoutSupplyW + ventilationW;
  const h = surfaces.reduce((sum, s) => sum + s.hWK, 0);
  const numerator = surfaces.reduce((sum, s) => sum + s.hWK * s.adjacentC, 0) + rc * c.infiltrationM3S * c.outdoorC + internalW;
  const denominator = h + rc * (c.infiltrationM3S + (supplyM3S ?? 0));
  const equilibriumC = supplyM3S === null || !knownHeating || !massValid || denominator < 1e-9 ? null :
    (numerator + heatingW + supply.reduce((sum, s) => sum + rc * s.flowM3S! * (s.device.vent.temperatureK - 273.15), 0)) / denominator;
  const freeDenominator = h + rc * c.infiltrationM3S;
  const freeFloatingC = freeDenominator > 1e-9 ? numerator / freeDenominator : null;
  if (equilibriumC === null) warnings.push("No determinate steady room temperature with the specified heat/air paths.");
  const requiredFlowM3S = knownHeating && massValid ? requiredSensibleFlow(loadWithoutSupplyW, c.supplyC, c.roomC, c.densityKgM3, c.cpJKgK) : null;
  if (requiredFlowM3S === null) warnings.push("Required sensible airflow is undefined/infeasible: check supply temperature, load sign and missing inputs.");
  const ach = (q: number | null) => q === null ? null : q * 3600 / input.volumeM3;
  return { volumeM3: input.volumeM3, areaM2: input.areaM2, supplyM3S, extractM3S, outdoorM3S, exhaustM3S, returnM3S, recirculatedM3S,
    supplyACH: ach(supplyM3S), outdoorACH: ach(outdoorM3S), exhaustACH: ach(exhaustM3S), balanceM3S,
    targetFlowM3S: c.targetACH * input.volumeM3 / 3600,
    occupancyFlowM3S: (c.occupants * c.litresPerson + input.areaM2 * c.litresM2) / 1000,
    ventilationW, conductionW, peopleW, equipmentW: c.equipmentW, solarW: c.solarW, infiltrationW, heatingW, heatingKnown: knownHeating, residualW,
    requiredHeatingW: residualW === null ? null : Math.max(0, -residualW), requiredCoolingW: residualW === null ? null : Math.max(0, residualW),
    equilibriumC, freeFloatingC, requiredFlowM3S,
    equilibriumResidualW: equilibriumC === null ? null : numerator + heatingW + supply.reduce((sum, s) => sum + rc * s.flowM3S! * (s.device.vent.temperatureK - 273.15), 0) - denominator * equilibriumC,
    freshAirConditioningW: outdoorM3S === null ? null : rc * outdoorM3S * (c.supplyC - c.outdoorC),
    sensibleKwh: residualW === null || c.durationHours === null ? null : Math.abs(residualW) * c.durationHours / 1000,
    streams, warnings };
}
