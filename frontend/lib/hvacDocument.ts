import { z } from "zod";
import { ventSchema, type CFDScenario, type CFDVent } from "./climoptixDocument";
import type { ProjectDocument } from "./projectDocument";
import { projectFloors } from "./buildingDocument";
import { hasSharedSources, sharedCaseRooms, sharedRadiatorIds } from "./sharedSources";

const id = z.string().regex(/^[\w:-]{1,150}$/);
const finite = z.number().finite();
export const hvacConditionsSchema = z.object({
  roomC: finite.min(-50).max(80).default(20),
  outdoorC: finite.min(-80).max(80).default(-3),
  supplyC: finite.min(-50).max(100).default(30),
  densityKgM3: finite.positive().max(10).default(1.2),
  cpJKgK: finite.positive().max(10000).default(1005),
  infiltrationM3S: finite.nonnegative().max(1e5).default(0),
  occupants: finite.int().nonnegative().max(100000).default(0),
  sensibleWPerson: finite.nonnegative().max(1000).default(75),
  equipmentW: finite.nonnegative().max(1e9).default(0),
  solarW: finite.nonnegative().max(1e9).default(0),
  targetACH: finite.nonnegative().max(1000).default(3),
  litresPerson: finite.nonnegative().max(1000).default(0),
  litresM2: finite.nonnegative().max(1000).default(0),
  includeHeating: z.boolean().default(true),
  durationHours: finite.positive().max(8784).nullable().default(null),
}).strict().prefault({});
export type HvacConditions = z.infer<typeof hvacConditionsSchema>;
const ventOperation = z.object({
  enabled: z.boolean().optional(), valueSI: finite.min(-1e9).max(1e9).optional(),
  temperatureK: finite.min(150).max(1500).optional(),
}).strict();
const heaterOperation = z.object({ enabled: z.boolean().default(true), actualW: finite.nonnegative().max(1e9).nullable().default(null) }).strict();
const operatingScenario = z.object({
  id, name: z.string().trim().min(1).max(100), floorId: id, roomId: id,
  conditions: hvacConditionsSchema,
  ventOverrides: z.record(id, ventOperation).default({}),
  heaterOverrides: z.record(id, heaterOperation).default({}),
}).strict();
export type HvacOperatingScenario = z.infer<typeof operatingScenario>;
export const ventDeviceSchema = z.object({
  vent: ventSchema, floorId: id, roomId: id,
  outdoorAirFraction: finite.min(0).max(1).default(1),
  extractKind: z.enum(["exhaust", "return"]).default("exhaust"),
  enabled: z.boolean().default(true),
}).strict();
export type VentDevice = z.infer<typeof ventDeviceSchema>;
const binding = z.object({
  operatingScenarioId: id.nullable().default(null),
  deviceIds: z.array(id).max(500),
  editMode: z.enum(["design", "override"]).default("design"),
  overrides: z.record(id, ventOperation).default({}),
  scopeRooms: z.array(z.object({ floorId: id, roomId: id }).strict()).max(200).nullable().optional(),
  scopeSeed: z.object({ floorId: id, roomId: id }).strict().nullable().optional(),
}).strict();
export const hvacSchema = z.object({
  version: z.literal(1), devices: z.array(ventDeviceSchema).max(500),
  scenarios: z.array(operatingScenario).max(100).default([]),
  activeScenarioId: id.nullable().default(null),
  bindings: z.record(id, binding).refine(v => Object.keys(v).length <= 100, "A project supports 100 CFD bindings.").default({}),
  migrationWarnings: z.array(z.string().max(500)).max(500).default([]),
  snapshots: z.array(z.object({ caseId: id, operatingScenarioId: id, createdAt: z.iso.datetime(), inputHash: z.string().regex(/^[a-f0-9]{64}$/), boundaryJson: z.string().max(1500000).refine(value => { try { const parsed = JSON.parse(value); return parsed?.version === 1 && typeof parsed.sourceInput === "string"; } catch { return false; } }, "Invalid HVAC boundary snapshot.") }).strict()).max(5).default([]),
}).strict().superRefine((data, ctx) => {
  if (new Set(data.devices.map(d => d.vent.id)).size !== data.devices.length ||
      new Set(data.scenarios.map(s => s.id)).size !== data.scenarios.length ||
      Object.values(data.bindings).some(b => new Set(b.deviceIds).size !== b.deviceIds.length || b.deviceIds.some(id => !data.devices.some(d => d.vent.id === id))))
    ctx.addIssue({ code: "custom", message: "HVAC IDs and device bindings must be unique and reference shared devices." });
  for (const overrides of [...data.scenarios.map(s => s.ventOverrides), ...Object.values(data.bindings).map(b => b.overrides)]) {
    for (const [key, override] of Object.entries(overrides)) {
      const d = data.devices.find(d => d.vent.id === key);
      if (d && d.vent.control !== "pressure" && override.valueSI !== undefined && override.valueSI <= 0)
        ctx.addIssue({ code: "custom", message: "Prescribed scenario flow must be positive; disable the device to turn it off." });
    }
  }
});
export type HvacProject = z.infer<typeof hvacSchema>;
export const newHvacProject = (): HvacProject => hvacSchema.parse({ version: 1, devices: [] });
export function hvacErrorMessage(cause: unknown, fallback = "Invalid HVAC inputs."): string {
  return cause instanceof z.ZodError ? cause.issues.slice(0, 3).map(issue => issue.message).join(" ") : cause instanceof Error ? cause.message : fallback;
}
export interface HvacDomainScope { scenarioId: string; rooms: { floorId: string; roomId: string }[] }

/** Idempotent shared-source reconciliation, including cases created before HVAC setup. */
export function migrateHvac(project: ProjectDocument): ProjectDocument {
  const radiators = sharedRadiatorIds(project);
  const shared = hasSharedSources(project);
  if (!project.hvac && !project.cfdScenarios?.some(s => s.vents.length) && !radiators.size && !shared) {
    return project.cfdScenarios?.some(s => s.sharedBoundaries) ? { ...project, cfdScenarios: project.cfdScenarios.map(s => ({ ...s, sharedBoundaries: undefined })) } : project;
  }
  const hvac = structuredClone(project.hvac ?? newHvacProject());
  const scenarios = project.cfdScenarios?.map(s => {
    const stored = s.sharedBoundaries || s.assetOverrides.some(o => radiators.has(o.objectId)) ? { ...s, sharedBoundaries: undefined, assetOverrides: s.assetOverrides.filter(o => !radiators.has(o.objectId)) } : s;
    if (!s.vents.length) {
      if (!hvac.bindings[s.id]) {
        // Establish shared design without replacing an older case's independent
        // air conditions. Operating linkage is an explicit workbench selection.
        hvac.bindings[s.id] = { operatingScenarioId: null, deviceIds: [], editMode: "design", overrides: {} };
      }
      return stored;
    }
    const ids: string[] = [];
    const overrides: Record<string, z.infer<typeof ventOperation>> = {};
    for (const vent of s.vents) {
      const owner = projectFloors(project).flatMap(f => f.content.rooms.map(room => ({ floorId: f.id, roomId: room.id, prefix: `${f.id}:${room.id}:` }))).filter(r => vent.host.patchId.startsWith(r.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
      let key = vent.id;
      const prior = hvac.devices.find(d => d.vent.id === key);
      // Conflicting legacy geometry represents different designs. Preserve both with a stable crosswalk.
      if (prior && JSON.stringify({ ...prior.vent, valueSI: 0, temperatureK: 0 }) !== JSON.stringify({ ...vent, valueSI: 0, temperatureK: 0 })) {
        key = `${vent.id.slice(0, 70)}:legacy:${s.id.slice(0, 65)}`;
        const warning = `Legacy vent ${vent.id} had conflicting geometry in ${s.name}; retained as ${key}. Review both designs.`;
        if (!hvac.migrationWarnings.includes(warning)) hvac.migrationWarnings.push(warning);
      }
      if (!hvac.devices.some(d => d.vent.id === key)) hvac.devices.push({ vent: { ...vent, id: key }, floorId: owner?.floorId ?? s.seed?.floorId ?? "unassigned", roomId: owner?.roomId ?? s.seed?.roomId ?? "unassigned", outdoorAirFraction: 1, extractKind: "exhaust", enabled: true });
      else if (prior && (prior.vent.valueSI !== vent.valueSI || prior.vent.temperatureK !== vent.temperatureK)) overrides[key] = { valueSI: vent.valueSI, temperatureK: vent.temperatureK };
      ids.push(key);
    }
    hvac.bindings[s.id] = { operatingScenarioId: null, deviceIds: ids, editMode: "design", overrides };
    return { ...stored, vents: [] };
  });
  return { ...project, hvac: hvacSchema.parse(hvac), cfdScenarios: scenarios };
}

export function operatingVents(hvac: HvacProject, operating?: HvacOperatingScenario | null): VentDevice[] {
  return hvac.devices.map(d => {
    const override = operating?.ventOverrides[d.vent.id];
    return { ...d, enabled: override?.enabled ?? d.enabled, vent: ventSchema.parse({ ...d.vent, valueSI: override?.valueSI ?? d.vent.valueSI, temperatureK: override?.temperatureK ?? d.vent.temperatureK }) };
  });
}

export function resolveHvacVents(project: ProjectDocument, scenario: CFDScenario): CFDVent[] {
  const hvac = project.hvac, link = hvac?.bindings[scenario.id];
  if (!hvac || !link) return scenario.vents;
  const operating = hvac.scenarios.find(s => s.id === link.operatingScenarioId);
  const designs = operatingVents(hvac, operating);
  const rooms = sharedCaseRooms(project, scenario);
  return designs.flatMap(d => {
    const id = d.vent.id, override = link.overrides[id];
    if (!link.deviceIds.includes(id) && !rooms.some(r => r.floorId === d.floorId && r.roomId === d.roomId)) return [];
    if (!(override?.enabled ?? d.enabled)) return [];
    return [ventSchema.parse({ ...d.vent, valueSI: override?.valueSI ?? d.vent.valueSI, temperatureK: override?.temperatureK ?? d.vent.temperatureK })];
  });
}

/** The shared project command boundary for CFD edits, drags, duplication and optimiser moves. */
export function commitHvacCFD(project: ProjectDocument, scenarios: CFDScenario[], domain?: HvacDomainScope, copiedFrom?: Record<string, string>): ProjectDocument {
  let next = migrateHvac(project);
  if (!next.hvac) return migrateHvac({ ...project, cfdScenarios: scenarios });
  const hvac = structuredClone(next.hvac);
  const radiators = sharedRadiatorIds(next);
  for (const [copyId, sourceId] of Object.entries(copiedFrom ?? {})) {
    if (project.cfdScenarios?.some(s => s.id === copyId) || !scenarios.some(s => s.id === copyId)) continue;
    const source = hvac.bindings[sourceId]; if (!source) continue;
    const copy = structuredClone(source), operation = hvac.scenarios.find(s => s.id === source.operatingScenarioId);
    if (operation) {
      if (hvac.scenarios.length >= 100) throw new Error("The 100-scenario HVAC limit is reached. The case was not duplicated.");
      const overrides = structuredClone(operation.ventOverrides);
      for (const [id, override] of Object.entries(copy.overrides)) overrides[id] = { ...overrides[id], ...override };
      const cloned = { ...structuredClone(operation), id: crypto.randomUUID(), name: `${operation.name.slice(0, 95)} copy`, ventOverrides: overrides };
      hvac.scenarios.push(cloned); copy.operatingScenarioId = cloned.id; copy.overrides = {};
    }
    hvac.bindings[copyId] = copy;
  }
  const deleted = new Set<string>();
  const stored = scenarios.map(s => {
    const old = project.cfdScenarios?.find(item => item.id === s.id);
    const before = old ? resolveHvacVents(next, old) : [];
    const link = hvac.bindings[s.id] ?? { deviceIds: [], operatingScenarioId: null, editMode: "design" as const, overrides: {} };
    // Non-device operations frequently pass the stored (empty) transport view.
    if (old && s === old) return s;
    const removed = before.filter(v => !s.vents.some(v2 => v2.id === v.id));
    const operating = hvac.scenarios.find(op => op.id === link.operatingScenarioId);
    const baselineOperation = next.hvac!.scenarios.find(op => op.id === link.operatingScenarioId);
    if (operating && baselineOperation) {
      const c = baselineOperation.conditions;
      operating.conditions = hvacConditionsSchema.parse({ ...operating.conditions,
        ...(s.physics.densityKgM3 !== c.densityKgM3 ? { densityKgM3: s.physics.densityKgM3 } : {}),
        ...(s.physics.heatCapacityJKgK !== c.cpJKgK ? { cpJKgK: s.physics.heatCapacityJKgK } : {}),
        ...(s.physics.referenceTemperatureK !== c.roomC + 273.15 ? { roomC: s.physics.referenceTemperatureK - 273.15 } : {}),
        ...(s.physics.outdoorTemperatureK !== c.outdoorC + 273.15 ? { outdoorC: s.physics.outdoorTemperatureK - 273.15 } : {}),
      });
    }
    for (const v of removed) {
      if (link.editMode === "override") {
        if (operating) {
          operating.ventOverrides[v.id] = { ...operating.ventOverrides[v.id], enabled: false };
          if (link.overrides[v.id]) { delete link.overrides[v.id].enabled; if (!Object.keys(link.overrides[v.id]).length) delete link.overrides[v.id]; }
        }
        else link.overrides[v.id] = { ...link.overrides[v.id], enabled: false };
      }
      else {
        deleted.add(v.id);
        hvac.devices = hvac.devices.filter(d => d.vent.id !== v.id);
        for (const b of Object.values(hvac.bindings)) { b.deviceIds = b.deviceIds.filter(id => id !== v.id); delete b.overrides[v.id]; }
        for (const op of hvac.scenarios) delete op.ventOverrides[v.id];
      }
    }
    for (const v of s.vents) {
      const owner = projectFloors(project).flatMap(f => f.content.rooms.map(room => ({ floorId: f.id, roomId: room.id, prefix: `${f.id}:${room.id}:` }))).filter(r => v.host.patchId.startsWith(r.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
      const found = hvac.devices.find(d => d.vent.id === v.id);
      const prior = before.find(item => item.id === v.id);
      if (prior && JSON.stringify(prior) === JSON.stringify(v)) continue;
      if (deleted.has(v.id)) throw new Error("Conflicting simultaneous vent edits and deletion. Refresh the case and retry.");
      if (!found) hvac.devices.push({ vent: v, floorId: owner?.floorId ?? s.seed?.floorId ?? "unassigned", roomId: owner?.roomId ?? s.seed?.roomId ?? "unassigned", outdoorAirFraction: 1, extractKind: "exhaust", enabled: true });
      else if (!old) {
        const geometry = (vent: CFDVent) => JSON.stringify({ ...vent, valueSI: 0, temperatureK: 0 });
        if (geometry(found.vent) !== geometry(v)) throw new Error("Imported vent geometry conflicts with a shared design ID. Give the imported device a new ID before importing.");
        const effective = operatingVents(hvac, operating).find(d => d.vent.id === v.id)?.vent ?? found.vent;
        if (effective.valueSI !== v.valueSI || effective.temperatureK !== v.temperatureK) link.overrides[v.id] = { valueSI: v.valueSI, temperatureK: v.temperatureK };
      }
      else {
        if (link.editMode === "override") {
          found.vent = { ...v, valueSI: found.vent.valueSI, temperatureK: found.vent.temperatureK };
          if (operating) {
            const flowChanged = prior?.valueSI !== v.valueSI, temperatureChanged = prior?.temperatureK !== v.temperatureK;
            if (flowChanged || temperatureChanged) operating.ventOverrides[v.id] = { ...operating.ventOverrides[v.id], ...(flowChanged ? { valueSI: v.valueSI } : {}), ...(temperatureChanged ? { temperatureK: v.temperatureK } : {}) };
            if (link.overrides[v.id]) {
              if (flowChanged) delete link.overrides[v.id].valueSI;
              if (temperatureChanged) delete link.overrides[v.id].temperatureK;
              if (!Object.keys(link.overrides[v.id]).length) delete link.overrides[v.id];
            }
          }
          else link.overrides[v.id] = { ...link.overrides[v.id], valueSI: v.valueSI, temperatureK: v.temperatureK };
        } else {
          const flowChanged = prior?.valueSI !== v.valueSI, temperatureChanged = prior?.temperatureK !== v.temperatureK;
          found.vent = { ...v, valueSI: flowChanged ? v.valueSI : found.vent.valueSI, temperatureK: temperatureChanged ? v.temperatureK : found.vent.temperatureK };
          // Moving a device must never promote effective scenario values into
          // nameplate/design data. An explicit permanent operating edit clears
          // only the corresponding override, so the new value is visible.
          for (const overrides of [link.overrides, ...(operating ? [operating.ventOverrides] : [])]) {
            if (overrides[v.id]) {
              if (flowChanged) delete overrides[v.id].valueSI;
              if (temperatureChanged) delete overrides[v.id].temperatureK;
              if (!Object.keys(overrides[v.id]).length) delete overrides[v.id];
            }
          }
        }
        if (owner) { found.floorId = owner.floorId; found.roomId = owner.roomId; }
      }
      if (!link.deviceIds.includes(v.id)) link.deviceIds.push(v.id);
    }
    const order = s.objectGroups?.flatMap(g => g.memberIds.filter(id => id.startsWith("vent:")).map(id => id.slice(5))) ?? s.vents.map(v => v.id);
    const rank = new Map(next.hvac!.devices.map((d, i) => [d.vent.id, i]));
    const beforeOrder = old?.objectGroups?.flatMap(g => g.memberIds.filter(id => id.startsWith("vent:")).map(id => id.slice(5)).sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity))) ?? before.map(v => v.id);
    if (link.editMode === "design" && JSON.stringify(order) !== JSON.stringify(beforeOrder)) {
      const ids = new Set(order), ordered = order.flatMap(id => hvac.devices.filter(d => d.vent.id === id));
      hvac.devices = [...hvac.devices.filter(d => !ids.has(d.vent.id)), ...ordered];
    }
    hvac.bindings[s.id] = link;
    return { ...s, vents: [], sharedBoundaries: undefined, assetOverrides: s.assetOverrides.filter(o => !radiators.has(o.objectId)) };
  });
  const studyIds = new Set(stored.map(s => s.id));
  hvac.bindings = Object.fromEntries(Object.entries(hvac.bindings).filter(([id]) => studyIds.has(id)));
  if (domain && hvac.bindings[domain.scenarioId]) {
    hvac.bindings[domain.scenarioId].scopeRooms = domain.rooms;
    hvac.bindings[domain.scenarioId].scopeSeed = stored.find(s => s.id === domain.scenarioId)?.seed ?? null;
  }
  next = { ...next, hvac: hvacSchema.parse(hvac), cfdScenarios: stored };
  return next;
}

export function removeVent(hvac: HvacProject, id: string): HvacProject {
  const next = structuredClone(hvac);
  next.devices = next.devices.filter(d => d.vent.id !== id);
  for (const b of Object.values(next.bindings)) { b.deviceIds = b.deviceIds.filter(key => key !== id); delete b.overrides[id]; }
  for (const s of next.scenarios) delete s.ventOverrides[id];
  return hvacSchema.parse(next);
}
