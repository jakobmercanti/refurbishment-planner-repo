import { ELECTRICAL_ASSETS } from "./electricalAssets";
import { electricalConnectionPoints, isElectricalObstacle, type ElectricalConnection, type ElectricalLayoutData } from "./electricalLayout";
import type { AssetDefinition, AssetInstance } from "./projectDocument";
import type { Point2D, Room } from "./types";

export interface ElectricalPlacedItem {
  id: string;
  identityKey: string;
  name: string;
  category: string;
  roomNames: string[];
  circuitNames: string[];
  catalogueItem?: typeof ELECTRICAL_ASSETS[number];
}

export interface ElectricalBomRow {
  bomKey: string;
  name: string;
  category: string;
  quantity: number;
  roomNames: string[];
  circuitNames: string[];
  objectIds: string[];
  catalogueItem?: typeof ELECTRICAL_ASSETS[number];
}

export interface ElectricalConnectionSegment {
  from: Point2D;
  to: Point2D;
  orientation: "Horizontal" | "Vertical" | "Diagonal";
  lengthMm: number;
}

export interface ElectricalConnectionScheduleRow {
  number: string;
  connection: ElectricalConnection;
  fromName: string;
  toName: string;
  circuitName: string;
  drawingLengthMm: number | null;
  segments: ElectricalConnectionSegment[] | null;
  roomNames: string[];
}

function pointInPolygon(point: Point2D, vertices: readonly Point2D[]): boolean {
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index, index += 1) {
    const a = vertices[index]; const b = vertices[previous];
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function roomForAsset(instance: AssetInstance, rooms: readonly Room[]): Room | undefined {
  const point = { x: instance.positionMm.x, y: instance.positionMm.y };
  return rooms.find((room) => pointInPolygon(point, room.vertices));
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function electricalPlacedItems(
  rooms: readonly Room[],
  assets: readonly AssetDefinition[] = [],
  instances: readonly AssetInstance[] = [],
): ElectricalPlacedItem[] {
  const records: ElectricalPlacedItem[] = [];
  const electricalAssets = new Map(ELECTRICAL_ASSETS.map((asset) => [asset.key, asset]));
  for (const room of rooms) for (const obstacle of room.obstacles) {
    if (!isElectricalObstacle(obstacle)) continue;
    const key = obstacle.representation_key?.slice(0, 250) ?? obstacle.model_id?.slice(0, 250) ?? `instance:${obstacle.id}`;
    const identityKey = obstacle.representation_key ? `catalogue:${key}` : obstacle.model_id ? `model:${key}` : key;
    const catalogueItem = electricalAssets.get(obstacle.representation_key ?? "");
    records.push({
      id: obstacle.id,
      identityKey,
      name: catalogueItem?.name ?? obstacle.name,
      category: catalogueItem?.subcategory ?? obstacle.subcategory ?? "Electrical item",
      roomNames: [room.name || "Unnamed room"],
      circuitNames: [],
      ...(catalogueItem ? { catalogueItem } : {}),
    });
  }
  const definitions = new Map(assets.map((asset) => [asset.assetId, asset]));
  for (const instance of instances) {
    const definition = definitions.get(instance.assetId);
    if (!definition || !["electric", "electrical"].includes((definition.categoryId ?? "").toLowerCase())) continue;
    const identityKey = `asset:${definition.assetId}@${definition.assetVersion}`;
    const room = roomForAsset(instance, rooms);
    records.push({
      id: instance.instanceId,
      identityKey,
      name: definition.name,
      category: definition.subcategory ?? definition.categoryName ?? "Electrical asset",
      roomNames: [room?.name || "Unassigned room"],
      circuitNames: [],
    });
  }
  return records.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name) || a.identityKey.localeCompare(b.identityKey) || a.id.localeCompare(b.id));
}

export function electricalBomRows(
  rooms: readonly Room[],
  layout: ElectricalLayoutData,
  assets: readonly AssetDefinition[] = [],
  instances: readonly AssetInstance[] = [],
): ElectricalBomRow[] {
  const items = electricalPlacedItems(rooms, assets, instances);
  const itemById = new Map<string, ElectricalPlacedItem>();
  const rows = new Map<string, ElectricalBomRow>();
  for (const item of items) {
    const existing = rows.get(item.identityKey);
    const row = existing ?? { bomKey: item.identityKey, name: item.name, category: item.category, quantity: 0, roomNames: [], circuitNames: [], objectIds: [], ...(item.catalogueItem ? { catalogueItem: item.catalogueItem } : {}) };
    row.quantity += 1;
    row.roomNames = uniqueSorted([...row.roomNames, ...item.roomNames]);
    row.objectIds.push(item.id);
    rows.set(item.identityKey, row);
    itemById.set(item.id, item);
  }
  const circuits = new Map(layout.circuits.map((circuit) => [circuit.id, circuit.name]));
  for (const connection of layout.connections) {
    const circuitName = connection.circuitId ? circuits.get(connection.circuitId) : undefined;
    if (!circuitName) continue;
    for (const id of [connection.fromId, connection.toId]) {
      const item = itemById.get(id);
      if (!item) continue;
      const row = rows.get(item.identityKey);
      if (row) row.circuitNames = uniqueSorted([...row.circuitNames, circuitName]);
    }
  }
  return [...rows.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name) || a.bomKey.localeCompare(b.bomKey));
}

export function electricalConnectionRows(
  layout: ElectricalLayoutData,
  rooms: readonly Room[],
): ElectricalConnectionScheduleRow[] {
  const fixtures = new Map(rooms.flatMap((room) => room.obstacles.filter(isElectricalObstacle).map((obstacle) => [obstacle.id, { obstacle, room }] as const)));
  const names = new Map<string, string>();
  for (const room of rooms) for (const obstacle of room.obstacles) if (isElectricalObstacle(obstacle)) names.set(obstacle.id, obstacle.name);
  const circuits = new Map(layout.circuits.map((circuit) => [circuit.id, circuit.name]));
  return layout.connections.map((connection, index) => {
    const from = fixtures.get(connection.fromId);
    const to = fixtures.get(connection.toId);
    const endpoints = from && to ? electricalConnectionPoints(connection, from.obstacle.center, to.obstacle.center, layout.forceOrthogonalRouting) : null;
    const segments = endpoints ? endpoints.slice(0, -1).map((start, segmentIndex) => {
      const end = endpoints[segmentIndex + 1];
      const dx = end.x - start.x; const dy = end.y - start.y;
      return { from: start, to: end, orientation: Math.abs(dx) < 1e-7 ? "Vertical" as const : Math.abs(dy) < 1e-7 ? "Horizontal" as const : "Diagonal" as const, lengthMm: Math.hypot(dx, dy) };
    }) : null;
    return {
      number: `C${String(index + 1).padStart(3, "0")}`,
      connection,
      fromName: names.get(connection.fromId) ?? "Missing fitting",
      toName: names.get(connection.toId) ?? "Missing fitting",
      circuitName: connection.circuitId ? circuits.get(connection.circuitId) ?? "Circuit unavailable" : "—",
      drawingLengthMm: segments ? segments.reduce((sum, segment) => sum + segment.lengthMm, 0) : null,
      segments,
      roomNames: uniqueSorted([from?.room.name ?? "", to?.room.name ?? ""]),
    };
  });
}

export function formatDrawingLength(lengthMm: number | null): string {
  return lengthMm === null ? "—" : `${(lengthMm / 1000).toFixed(1)} m`;
}

export function scheduleItemName(id: string, rooms: readonly Room[], assets: readonly AssetDefinition[] = [], instances: readonly AssetInstance[] = []): string {
  for (const room of rooms) {
    const found = room.obstacles.find((obstacle) => obstacle.id === id && isElectricalObstacle(obstacle));
    if (found) return found.name;
  }
  const instance = instances.find((candidate) => candidate.instanceId === id);
  return instance ? assets.find((asset) => asset.assetId === instance.assetId)?.name ?? "Missing fitting" : "Missing fitting";
}
