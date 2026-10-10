import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { assetRepository, contentHash, MAX_GLB_BYTES, validateGlb } from "./assetRepository";
import { completed, localDatabase } from "./localDatabase";
import { getElectricalImage, validateElectricalImageBytes } from "./electricalAttachments";
import { DEFAULT_ELECTRICAL_CIRCUIT, isElectricalObstacle, type ElectricalLayoutData } from "./electricalLayout";
import { newProject, parseProject, type AssetDefinition, type AssetInstance } from "./projectDocument";
import type { Obstacle, Room } from "./types";

const PACKAGE_TYPE = "freefloorplan3d-electrical-layout";
const PACKAGE_VERSION = 1;
const MAX_PACKAGE_BYTES = 200 * 1024 * 1024;
const MAX_LAYOUT_JSON_BYTES = 8 * 1024 * 1024;
const MAX_ATTACHMENTS = 30;
const MAX_LAYOUT_ASSETS = 100;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const idPattern = /^[\w:-]{1,150}$/;

export interface ElectricalLayoutPackageItem { roomId: string; obstacle: Obstacle }
export interface ElectricalLayoutPackage {
  packageType: typeof PACKAGE_TYPE;
  schemaVersion: number;
  projectName: string;
  exportedAt: string;
  items: ElectricalLayoutPackageItem[];
  assets: AssetDefinition[];
  assetInstances: AssetInstance[];
  electricalLayout: ElectricalLayoutData;
}

const attachmentPath = (id: string, type: string) => `attachments/${id}.${type === "image/jpeg" ? "jpg" : type === "image/png" ? "png" : "webp"}`;

function validatePackageData(raw: unknown): ElectricalLayoutPackage {
  if (!raw || typeof raw !== "object") throw new Error("The electrical layout file is invalid.");
  const candidate = raw as Partial<ElectricalLayoutPackage>;
  if (candidate.packageType !== PACKAGE_TYPE || candidate.schemaVersion !== PACKAGE_VERSION) throw new Error("This electrical layout file uses an unsupported version.");
  if (!Array.isArray(candidate.items) || candidate.items.length > 10000) throw new Error("Electrical layout contains too many or invalid fittings.");
  if (!Array.isArray(candidate.assets) || !Array.isArray(candidate.assetInstances)) throw new Error("Electrical asset references are invalid.");
  if (!candidate.electricalLayout || typeof candidate.electricalLayout !== "object" || !Array.isArray(candidate.electricalLayout.connections) || !Array.isArray(candidate.electricalLayout.circuits) || !candidate.electricalLayout.documentation || typeof candidate.electricalLayout.documentation !== "object" || !Array.isArray(candidate.electricalLayout.documentation.attachments)) throw new Error("Electrical layout data is incomplete.");
  const itemIds = new Set<string>();
  const items = candidate.items.map((item) => {
    if (!item || typeof item !== "object" || !idPattern.test(item.roomId) || !item.obstacle || !isElectricalObstacle(item.obstacle)) throw new Error("Electrical layout contains an invalid fitting reference.");
    if (itemIds.has(item.obstacle.id)) throw new Error("Electrical layout contains duplicate fitting IDs.");
    itemIds.add(item.obstacle.id);
    return item;
  });
  if (candidate.assetInstances.length > 1000 || candidate.assets.length > 100) throw new Error("Electrical layout contains too many local asset references.");
  for (const item of candidate.assetInstances) if (!item || typeof item !== "object") throw new Error("Electrical asset reference is invalid.");
  const groupedRooms = new Map<string, Obstacle[]>();
  for (const item of items) groupedRooms.set(item.roomId, [...(groupedRooms.get(item.roomId) ?? []), item.obstacle]);
  const rooms: Room[] = [...groupedRooms].map(([id, obstacles]) => ({
    id, name: id, version: 0, vertices: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }],
    wall_height: { value: 2400, uncertainty_mm: 0, verified: true, source_type: "portable-layout-validation" },
    wall_thickness: { value: 100, uncertainty_mm: 0, verified: true, source_type: "portable-layout-validation" },
    openings: [], obstacles,
  }));
  const project = parseProject({ ...newProject(), name: typeof candidate.projectName === "string" ? candidate.projectName.slice(0, 200) : "Electrical layout", rooms, assets: candidate.assets, assetInstances: candidate.assetInstances, electricalLayout: candidate.electricalLayout });
  const rawCircuits = candidate.electricalLayout.circuits as unknown[];
  const circuitsAreValid = rawCircuits.length === 0
    ? project.electricalLayout!.circuits.length === 1
      && project.electricalLayout!.circuits[0].id === DEFAULT_ELECTRICAL_CIRCUIT.id
      && project.electricalLayout!.circuits[0].name === DEFAULT_ELECTRICAL_CIRCUIT.name
    : project.electricalLayout!.circuits.length === rawCircuits.length
      && rawCircuits.every((rawCircuit, index) => {
        if (!rawCircuit || typeof rawCircuit !== "object") return false;
        const circuit = rawCircuit as { id?: unknown; name?: unknown };
        return typeof circuit.id === "string"
          && typeof circuit.name === "string"
          && project.electricalLayout!.circuits[index].id === circuit.id
          && project.electricalLayout!.circuits[index].name === circuit.name.trim().slice(0, 100);
      });
  const rawCircuitIds = new Set(rawCircuits.flatMap((rawCircuit) => rawCircuit && typeof rawCircuit === "object" && typeof (rawCircuit as { id?: unknown }).id === "string" ? [(rawCircuit as { id: string }).id] : []));
  const hasBrokenCircuitReference = candidate.electricalLayout.connections.some((rawConnection) => {
    if (!rawConnection || typeof rawConnection !== "object") return false;
    const circuitId = (rawConnection as { circuitId?: unknown }).circuitId;
    return typeof circuitId === "string" && circuitId.length > 0 && !rawCircuitIds.has(circuitId);
  });
  if (!circuitsAreValid
    || hasBrokenCircuitReference
    || project.electricalLayout!.connections.length !== candidate.electricalLayout?.connections.length
    || project.electricalLayout!.documentation.attachments.length !== candidate.electricalLayout?.documentation.attachments.length
    || project.assetInstances.length !== candidate.assetInstances.length) throw new Error("Electrical layout contains a broken connection, circuit, picture or asset reference.");
  const ids = project.electricalLayout!.connections.flatMap((connection) => [connection.fromId, connection.toId]);
  if (ids.some((id) => !itemIds.has(id))) throw new Error("An electrical connection references a missing fitting.");
  const electricalAssetIds = new Set(project.assets.filter((asset) => ["electric", "electrical"].includes((asset.categoryId ?? "").toLowerCase())).map((asset) => asset.assetId));
  if (electricalAssetIds.size !== project.assets.length || project.assetInstances.some((instance) => !electricalAssetIds.has(instance.assetId))) throw new Error("Portable layouts may reference electrical assets only.");
  if (candidate.electricalLayout.documentation.attachments.length !== project.electricalLayout!.documentation.attachments.length) throw new Error("Electrical layout contains invalid picture metadata.");
  const documentation = project.electricalLayout!.documentation;
  const connectionIds = new Set(project.electricalLayout!.connections.map((connection) => connection.id));
  const circuitIds = new Set(project.electricalLayout!.circuits.map((circuit) => circuit.id));
  const manualIds = documentation.manualBomItems.map((item) => item.bomRowId);
  const attachmentIds = documentation.attachments.map((item) => item.attachmentId);
  if (new Set(manualIds).size !== manualIds.length || new Set(attachmentIds).size !== attachmentIds.length) throw new Error("Electrical layout contains duplicate documentation IDs.");
  const bomKeys = new Set([...Object.keys(documentation.bomOverrides), ...documentation.manualBomItems.map((item) => item.bomRowId)]);
  for (const item of items) bomKeys.add(item.obstacle.representation_key ? `catalogue:${item.obstacle.representation_key}` : item.obstacle.model_id ? `model:${item.obstacle.model_id}` : `instance:${item.obstacle.id}`);
  for (const instance of project.assetInstances) bomKeys.add(`asset:${instance.assetId}@${instance.assetVersion}`);
  const placedIds = new Set([...itemIds, ...project.assetInstances.map((instance) => instance.instanceId)]);
  const safeDocumentation = {
    ...documentation,
    connectionNotes: Object.fromEntries(Object.entries(documentation.connectionNotes).filter(([id]) => connectionIds.has(id))),
    circuitNotes: Object.fromEntries(Object.entries(documentation.circuitNotes).filter(([id]) => circuitIds.has(id))),
    attachments: documentation.attachments.map((attachment) => {
      const relation = attachment.relation;
      const valid = relation.kind === "LAYOUT" || relation.kind === "CONNECTION" && connectionIds.has(relation.id)
        || relation.kind === "CIRCUIT" && circuitIds.has(relation.id) || relation.kind === "ASSET" && placedIds.has(relation.id)
        || relation.kind === "BOM" && bomKeys.has(relation.id);
      return valid ? attachment : { ...attachment, relation: { kind: "LAYOUT" as const } };
    }),
  };
  const electricalLayout = { ...project.electricalLayout!, documentation: safeDocumentation };
  return {
    packageType: PACKAGE_TYPE,
    schemaVersion: PACKAGE_VERSION,
    projectName: typeof candidate.projectName === "string" ? candidate.projectName.slice(0, 200) : "Electrical layout",
    exportedAt: typeof candidate.exportedAt === "string" && Number.isFinite(Date.parse(candidate.exportedAt)) ? candidate.exportedAt : "",
    items,
    assets: project.assets,
    assetInstances: project.assetInstances,
    electricalLayout,
  };
}

export async function exportElectricalLayoutPackage(
  projectName: string,
  rooms: readonly Room[],
  assets: readonly AssetDefinition[],
  assetInstances: readonly AssetInstance[],
  electricalLayout: ElectricalLayoutData,
): Promise<Blob> {
  const electricalItems = rooms.flatMap((room) => room.obstacles.filter(isElectricalObstacle).map((obstacle) => ({ roomId: room.id, obstacle })));
  const referencedAssetIds = new Set(assetInstances.filter((instance) => assets.some((asset) => asset.assetId === instance.assetId && ["electric", "electrical"].includes((asset.categoryId ?? "").toLowerCase()))).map((instance) => instance.assetId));
  const electricalAssetDefinitions = assets.filter((asset) => referencedAssetIds.has(asset.assetId));
  const electricalAssetInstances = assetInstances.filter((instance) => referencedAssetIds.has(instance.assetId));
  const normalized = validatePackageData({ packageType: PACKAGE_TYPE, schemaVersion: PACKAGE_VERSION, projectName, exportedAt: new Date().toISOString(), items: electricalItems, assets: electricalAssetDefinitions, assetInstances: electricalAssetInstances, electricalLayout });
  const layoutBytes = strToU8(JSON.stringify(normalized));
  if (layoutBytes.length > MAX_LAYOUT_JSON_BYTES) throw new Error("Electrical layout metadata exceeds 8 MB.");
  const entries: Record<string, Uint8Array> = { "electrical-layout.json": layoutBytes };
  let total = layoutBytes.length;
  for (const asset of normalized.assets) {
    const blob = await assetRepository.getAssetBlob(asset.assetId);
    if (blob.size !== asset.byteSize) throw new Error(`Local electrical model “${asset.name}” is missing or damaged.`);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (await contentHash(bytes) !== asset.contentHash) throw new Error(`Local electrical model “${asset.name}” failed its integrity check.`);
    total += bytes.length;
    if (total > MAX_PACKAGE_BYTES) throw new Error("Electrical layout package exceeds 200 MB.");
    entries[`assets/${asset.assetId}/model.glb`] = bytes;
  }
  for (const attachment of normalized.electricalLayout.documentation.attachments) {
    const blob = await getElectricalImage(attachment.attachmentId);
    if (blob.size !== attachment.sizeBytes || blob.type !== attachment.mediaType) throw new Error("An electrical reference picture is missing or damaged.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!validateElectricalImageBytes(bytes.slice(0, 12), attachment.mediaType)) throw new Error("An electrical reference picture has an invalid format.");
    total += bytes.length;
    if (total > MAX_PACKAGE_BYTES) throw new Error("Electrical layout package exceeds 200 MB.");
    entries[attachmentPath(attachment.attachmentId, attachment.mediaType)] = bytes;
  }
  return new Blob([new Uint8Array(zipSync(entries, { level: 0 }))], { type: "application/zip" });
}

export async function readElectricalLayoutPackage(file: File): Promise<{ data: ElectricalLayoutPackage; attachmentBlobs: Map<string, Blob>; assetBlobs: Map<string, Blob> }> {
  if (file.size <= 0 || file.size > MAX_PACKAGE_BYTES) throw new Error("Choose a valid electrical layout package smaller than 200 MB.");
  let count = 0; let expandedBytes = 0; const names = new Set<string>();
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter(entry) {
      if (++count > MAX_ATTACHMENTS + MAX_LAYOUT_ASSETS + 1 || names.has(entry.name)) throw new Error("The electrical layout archive has duplicate or excessive entries.");
      names.add(entry.name);
      const isManifest = entry.name === "electrical-layout.json";
      const isAttachment = /^attachments\/[\w:-]+\.(jpg|png|webp)$/.test(entry.name);
      const isAsset = /^assets\/[\w:-]+\/model\.glb$/.test(entry.name);
      if (!isManifest && !isAttachment && !isAsset) throw new Error("The electrical layout archive contains an unsafe file path.");
      const limit = isManifest ? MAX_LAYOUT_JSON_BYTES : isAttachment ? MAX_ATTACHMENT_BYTES : MAX_GLB_BYTES;
      if (entry.originalSize > limit || (expandedBytes += entry.originalSize) > MAX_PACKAGE_BYTES) throw new Error("The electrical layout archive expands beyond its size limit.");
      return true;
    } });
  } catch (error) {
    if (error instanceof Error && /electrical layout|size limit|unsafe|duplicate|excessive/i.test(error.message)) throw error;
    throw new Error("The electrical layout file is damaged or cannot be opened.");
  }
  const layoutJson = entries["electrical-layout.json"];
  if (!layoutJson || layoutJson.length > MAX_LAYOUT_JSON_BYTES) throw new Error("Electrical layout file contents are missing or too large.");
  let raw: unknown;
  try { raw = JSON.parse(strFromU8(layoutJson)); } catch { throw new Error("Electrical layout data is not valid JSON."); }
  const data = validatePackageData(raw);
  const expected = new Set(["electrical-layout.json"]);
  const attachmentBlobs = new Map<string, Blob>();
  const assetBlobs = new Map<string, Blob>();
  for (const asset of data.assets) {
    const name = `assets/${asset.assetId}/model.glb`; const bytes = entries[name];
    if (!bytes || bytes.length !== asset.byteSize || await contentHash(bytes) !== asset.contentHash) throw new Error(`The custom electrical model “${asset.name}” is missing or invalid.`);
    const bounds = await validateGlb(bytes);
    if (["x", "y", "z"].some((axis) => Math.abs(bounds[axis as keyof typeof bounds] - asset.computedBoundsMm[axis as keyof typeof bounds]) > 0.01)) throw new Error(`Custom electrical model “${asset.name}” does not match its metadata.`);
    expected.add(name); assetBlobs.set(asset.assetId, new Blob([new Uint8Array(bytes)], { type: "model/gltf-binary" }));
  }
  for (const attachment of data.electricalLayout.documentation.attachments) {
    const name = attachmentPath(attachment.attachmentId, attachment.mediaType);
    const bytes = entries[name];
    if (!bytes || bytes.length !== attachment.sizeBytes || !validateElectricalImageBytes(bytes.slice(0, 12), attachment.mediaType)) throw new Error("An electrical reference picture is missing or invalid.");
    expected.add(name);
    attachmentBlobs.set(attachment.attachmentId, new Blob([new Uint8Array(bytes)], { type: attachment.mediaType }));
  }
  if (Object.keys(entries).length !== expected.size || Object.keys(entries).some((name) => !expected.has(name))) throw new Error("The electrical layout contains unregistered files.");
  return { data, attachmentBlobs, assetBlobs };
}

export type ElectricalLayoutImportMode = "REPLACE" | "MERGE";
export interface ElectricalLayoutImportPlan {
  rooms: Room[];
  electricalLayout: ElectricalLayoutData;
  assetInstances: AssetInstance[];
  assets: AssetDefinition[];
  assetBlobs: Map<string, Blob>;
  attachmentBlobs: Map<string, Blob>;
  warnings: string[];
  replacedCounts: { fittings: number; connections: number; circuits: number };
}

function id(prefix: string): string { return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`; }

function pointInRoom(point: { x: number; y: number }, room: Room): boolean {
  let inside = false;
  for (let index = 0, previous = room.vertices.length - 1; index < room.vertices.length; previous = index, index += 1) {
    const a = room.vertices[index]; const b = room.vertices[previous];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x) inside = !inside;
  }
  return inside;
}

export function planElectricalLayoutImport(
  archive: ElectricalLayoutPackage,
  currentRooms: readonly Room[],
  currentLayout: ElectricalLayoutData,
  currentAssets: readonly AssetDefinition[],
  currentAssetInstances: readonly AssetInstance[],
  mode: ElectricalLayoutImportMode,
  attachmentBlobs: Map<string, Blob>,
  importedAssetBlobs: Map<string, Blob> = new Map(),
): ElectricalLayoutImportPlan {
  const warnings: string[] = [];
  const replacedCounts = {
    fittings: currentRooms.reduce((sum, room) => sum + room.obstacles.filter(isElectricalObstacle).length, 0) + currentAssetInstances.filter((instance) => ["electric", "electrical"].includes((currentAssets.find((asset) => asset.assetId === instance.assetId)?.categoryId ?? "").toLowerCase())).length,
    connections: currentLayout.connections.length,
    circuits: currentLayout.circuits.length,
  };
  const rooms = currentRooms.map((room) => ({ ...room, obstacles: room.obstacles.filter((obstacle) => mode === "REPLACE" && isElectricalObstacle(obstacle) ? false : true).map((obstacle) => ({ ...obstacle })) }));
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const remappedItemIds = new Map<string, string>();
  const retained = new Set(rooms.flatMap((room) => room.obstacles.map((obstacle) => obstacle.id)));
  let unresolvedItems = 0;
  let unresolvedWallMounts = 0;
  for (const item of archive.items) {
    const exactRoom = roomById.get(item.roomId);
    const containingRooms = exactRoom ? [exactRoom] : rooms.filter((room) => pointInRoom(item.obstacle.center, room));
    const targetRoom = containingRooms.length === 1 ? containingRooms[0] : undefined;
    if (!targetRoom) { unresolvedItems += 1; continue; }
    let obstacleId = item.obstacle.id;
    if (retained.has(obstacleId)) obstacleId = id("electrical-fitting");
    retained.add(obstacleId);
    remappedItemIds.set(item.obstacle.id, obstacleId);
    const obstacle = { ...item.obstacle, id: obstacleId, center: { ...item.obstacle.center }, dimensions: { ...item.obstacle.dimensions }, ...(item.obstacle.wall_lock ? { wall_lock: false } : {}) };
    if (item.obstacle.wall_lock) unresolvedWallMounts += 1;
    targetRoom.obstacles.push(obstacle);
  }
  if (unresolvedItems) warnings.push(`${unresolvedItems} electrical fittings could not be matched to their original room and were not imported.`);
  if (unresolvedWallMounts) warnings.push(`${unresolvedWallMounts} wall-mounted fitting${unresolvedWallMounts === 1 ? " was" : "s were"} imported at the saved position as free-positioned items because this layout file has no stable wall reference.`);

  const isElectricalInstance = (instance: AssetInstance) => ["electric", "electrical"].includes((currentAssets.find((asset) => asset.assetId === instance.assetId)?.categoryId ?? "").toLowerCase());
  const retainedInstances = currentAssetInstances.filter((instance) => mode === "MERGE" || !isElectricalInstance(instance));
  const existingElectricalInstances = mode === "REPLACE" ? retainedInstances : currentAssetInstances;
  const remappedAssetIds = new Map<string, string>();
  const occupiedInstanceIds = new Set(existingElectricalInstances.map((instance) => instance.instanceId));
  const nextElectricalInstances: AssetInstance[] = [];
  const assets: AssetDefinition[] = [];
  const assetBlobs = new Map<string, Blob>();
  const resolvedDefinitions = new Map<string, AssetDefinition>();
  const occupiedDefinitionIds = new Set(currentAssets.map((asset) => asset.assetId));
  let missingAssets = 0;
  for (const instance of archive.assetInstances) {
    const archivedAsset = archive.assets.find((asset) => asset.assetId === instance.assetId);
    if (!archivedAsset) { missingAssets += 1; continue; }
    let targetAsset = resolvedDefinitions.get(archivedAsset.assetId);
    if (!targetAsset) {
      targetAsset = currentAssets.find((asset) => asset.contentHash === archivedAsset.contentHash && ["electric", "electrical"].includes((asset.categoryId ?? "").toLowerCase()));
      if (!targetAsset) {
        const model = importedAssetBlobs.get(archivedAsset.assetId);
        if (!model || model.size !== archivedAsset.byteSize) { missingAssets += 1; continue; }
        const nextAssetId = occupiedDefinitionIds.has(archivedAsset.assetId) ? id("electrical-asset-definition") : archivedAsset.assetId;
        targetAsset = { ...archivedAsset, assetId: nextAssetId };
        assets.push(targetAsset); assetBlobs.set(nextAssetId, model); occupiedDefinitionIds.add(nextAssetId);
      }
      resolvedDefinitions.set(archivedAsset.assetId, targetAsset);
    }
    const nextId = occupiedInstanceIds.has(instance.instanceId) ? id("electrical-asset") : instance.instanceId;
    occupiedInstanceIds.add(nextId);
    remappedAssetIds.set(instance.instanceId, nextId);
    nextElectricalInstances.push({ ...instance, instanceId: nextId, assetId: targetAsset.assetId, assetVersion: targetAsset.assetVersion, positionMm: { ...instance.positionMm }, rotationDeg: { ...instance.rotationDeg }, scale: { ...instance.scale } });
  }
  if (missingAssets) warnings.push(`${missingAssets} placed electrical asset${missingAssets === 1 ? "" : "s"} could not be matched to this project’s local catalogue and were not imported.`);
  const assetInstances = [...retainedInstances, ...nextElectricalInstances];

  const archivedCircuits = archive.electricalLayout.circuits.length ? archive.electricalLayout.circuits : [{ ...DEFAULT_ELECTRICAL_CIRCUIT }];
  const occupiedCircuitIds = new Set((mode === "REPLACE" ? [] : currentLayout.circuits).map((circuit) => circuit.id));
  const remappedCircuitIds = new Map<string, string>();
  const circuits = archivedCircuits.map((circuit) => {
    const nextId = occupiedCircuitIds.has(circuit.id) ? id("electrical-circuit") : circuit.id;
    occupiedCircuitIds.add(nextId); remappedCircuitIds.set(circuit.id, nextId);
    return { ...circuit, id: nextId };
  });
  const fallbackCircuitId = remappedCircuitIds.get(archivedCircuits[0].id)!;
  const occupiedConnectionIds = new Set((mode === "REPLACE" ? [] : currentLayout.connections).map((connection) => connection.id));
  const remappedConnectionIds = new Map<string, string>();
  let skippedConnections = 0;
  const connections = archive.electricalLayout.connections.flatMap((connection) => {
    const fromId = remappedItemIds.get(connection.fromId);
    const toId = remappedItemIds.get(connection.toId);
    if (!fromId || !toId) { skippedConnections += 1; return []; }
    const nextId = occupiedConnectionIds.has(connection.id) ? id("electrical-connection") : connection.id;
    occupiedConnectionIds.add(nextId);
    remappedConnectionIds.set(connection.id, nextId);
    return [{ ...connection, id: nextId, fromId, toId, circuitId: remappedCircuitIds.get(connection.circuitId) ?? fallbackCircuitId, waypoints: connection.waypoints.map((point) => ({ ...point })) }];
  });
  if (skippedConnections) warnings.push(`${skippedConnections} connection${skippedConnections === 1 ? " was" : "s were"} not imported because one or both fittings could not be matched.`);
  const importedDocs = archive.electricalLayout.documentation;
  const remappedConnectionNotes = Object.fromEntries(Object.entries(importedDocs.connectionNotes).flatMap(([oldId, note]) => remappedConnectionIds.has(oldId) ? [[remappedConnectionIds.get(oldId)!, note]] : []));
  const remappedCircuitNotes = Object.fromEntries(Object.entries(importedDocs.circuitNotes).flatMap(([oldId, note]) => remappedCircuitIds.has(oldId) ? [[remappedCircuitIds.get(oldId)!, note]] : []));
  const docs = mode === "REPLACE" ? { ...structuredClone(importedDocs), connectionNotes: remappedConnectionNotes, circuitNotes: remappedCircuitNotes } : structuredClone(currentLayout.documentation);
  const remappedManualIds = new Map<string, string>();
  if (mode === "MERGE") {
    const merged = docs;
    Object.entries(importedDocs.bomOverrides).forEach(([key, value]) => { if (!(key in merged.bomOverrides)) merged.bomOverrides[key] = value; });
    const manualIds = new Set(merged.manualBomItems.map((item) => item.bomRowId));
    for (const item of importedDocs.manualBomItems) {
      const bomRowId = manualIds.has(item.bomRowId) ? id("bom-row") : item.bomRowId;
      manualIds.add(bomRowId); remappedManualIds.set(item.bomRowId, bomRowId);
      merged.manualBomItems.push({ ...item, bomRowId });
    }
    for (const [newId, note] of Object.entries(remappedConnectionNotes)) if (!merged.connectionNotes[newId]) merged.connectionNotes[newId] = note;
    for (const [newId, note] of Object.entries(remappedCircuitNotes)) if (!merged.circuitNotes[newId]) merged.circuitNotes[newId] = note;
    merged.hiddenBomKeys = [...new Set([...merged.hiddenBomKeys, ...importedDocs.hiddenBomKeys])];
    merged.generalNotes = [merged.generalNotes, importedDocs.generalNotes].filter(Boolean).join("\n\n").slice(0, 10000);
    merged.exportMetadata = { ...importedDocs.exportMetadata, ...merged.exportMetadata };
  }
  const occupiedAttachmentIds = new Set(mode === "MERGE" ? docs.attachments.map((item) => item.attachmentId) : []);
  const importedAttachments = importedDocs.attachments.map((attachment) => {
    let attachmentId = attachment.attachmentId;
    if (occupiedAttachmentIds.has(attachmentId)) attachmentId = id("electrical-photo");
    occupiedAttachmentIds.add(attachmentId);
    const relation = attachment.relation.kind === "ASSET" ? (remappedItemIds.get(attachment.relation.id) ?? remappedAssetIds.get(attachment.relation.id) ? { kind: "ASSET" as const, id: remappedItemIds.get(attachment.relation.id) ?? remappedAssetIds.get(attachment.relation.id)! } : { kind: "LAYOUT" as const })
      : attachment.relation.kind === "CONNECTION" ? { kind: "CONNECTION" as const, id: remappedConnectionIds.get(attachment.relation.id) ?? attachment.relation.id }
        : attachment.relation.kind === "CIRCUIT" ? { kind: "CIRCUIT" as const, id: remappedCircuitIds.get(attachment.relation.id) ?? attachment.relation.id }
          : attachment.relation.kind === "BOM" ? { kind: "BOM" as const, id: remappedManualIds.get(attachment.relation.id) ?? attachment.relation.id }
          : attachment.relation;
    return { ...attachment, attachmentId, relation };
  });
  if (mode === "REPLACE") docs.attachments = importedAttachments;
  else docs.attachments.push(...importedAttachments);

  const layout: ElectricalLayoutData = mode === "REPLACE"
    ? { forceOrthogonalRouting: archive.electricalLayout.forceOrthogonalRouting, connections, circuits, documentation: docs }
    : { forceOrthogonalRouting: currentLayout.forceOrthogonalRouting, connections: [...currentLayout.connections, ...connections], circuits: [...currentLayout.circuits, ...circuits], documentation: docs };
  const attachmentRemap = new Map(importedDocs.attachments.map((attachment, index) => [attachment.attachmentId, importedAttachments[index].attachmentId]));
  const junctions = mode === "MERGE" ? structuredClone(currentLayout.junctions ?? []) : [];
  const occupiedJunctionIds = new Set(junctions.map(junction => junction.id));
  for (const junction of archive.electricalLayout.junctions ?? []) {
    const connectionIds = junction.connectionIds.flatMap(oldId => remappedConnectionIds.has(oldId) ? [remappedConnectionIds.get(oldId)!] : []);
    if (connectionIds.length < 2) continue;
    const junctionId = occupiedJunctionIds.has(junction.id) ? id("electrical-junction") : junction.id;
    occupiedJunctionIds.add(junctionId);
    junctions.push({ ...junction, id: junctionId, position: { ...junction.position }, connectionIds });
  }
  if (junctions.length) layout.junctions = junctions;
  const plannedBlobs = new Map<string, Blob>();
  for (const [oldId, blob] of attachmentBlobs) plannedBlobs.set(attachmentRemap.get(oldId) ?? oldId, blob);
  return { rooms, electricalLayout: layout, assetInstances, assets, assetBlobs, attachmentBlobs: plannedBlobs, warnings, replacedCounts };
}

export async function persistElectricalImportFiles(assetFiles: Map<string, Blob>, assets: readonly AssetDefinition[], pictureFiles: Map<string, Blob>, layout: ElectricalLayoutData): Promise<void> {
  const assetRecords: Array<{ id: string; metadata: AssetDefinition; blob: Blob }> = [];
  for (const [id, blob] of assetFiles) {
    const metadata = assets.find((asset) => asset.assetId === id);
    if (!metadata || blob.size !== metadata.byteSize) throw new Error("Imported electrical model metadata is inconsistent.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (await contentHash(bytes) !== metadata.contentHash) throw new Error("Imported electrical model failed its integrity check.");
    assetRecords.push({ id, metadata, blob: new Blob([bytes], { type: "model/gltf-binary" }) });
  }
  const pictureRecords = [...pictureFiles].map(([id, blob]) => {
    const metadata = layout.documentation.attachments.find((attachment) => attachment.attachmentId === id);
    if (!metadata || blob.size !== metadata.sizeBytes || blob.type !== metadata.mediaType) throw new Error("Imported electrical picture metadata is inconsistent.");
    return { id, record: { blob, mediaType: metadata.mediaType, sizeBytes: blob.size, fileName: metadata.fileName } };
  });
  if (!assetRecords.length && !pictureRecords.length) return;
  const db = await localDatabase(); const transaction = db.transaction(["assets", "electricalAttachments"], "readwrite"); const done = completed(transaction);
  for (const asset of assetRecords) transaction.objectStore("assets").put({ metadata: asset.metadata, blob: asset.blob }, asset.id);
  for (const picture of pictureRecords) transaction.objectStore("electricalAttachments").put(picture.record, picture.id);
  await done;
}
