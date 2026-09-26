import type { Obstacle, Point2D, Room } from "./types";

export type ElectricalConnectionType = "CONTROL" | "POWER" | "GENERIC";
export type ElectricalLineStyle = "SOLID" | "DASHED" | "DOTTED" | "DASH_DOT";
export type ElectricalLineWidth = "THIN" | "MEDIUM" | "THICK";
export type ElectricalRouting = "STRAIGHT" | "ORTHOGONAL" | "MANUAL";

export interface ElectricalConnection {
  id: string;
  fromId: string;
  toId: string;
  type: ElectricalConnectionType;
  color: string;
  lineStyle: ElectricalLineStyle;
  width: ElectricalLineWidth;
  routing: ElectricalRouting;
  waypoints: Point2D[];
  /** False means the assigned circuit supplies the displayed colour. */
  colorOverride?: boolean;
  label?: string;
  circuitId?: string;
}

export interface ElectricalCircuit {
  id: string;
  name: string;
  color: string;
  description?: string;
}

export interface ElectricalLayoutData {
  connections: ElectricalConnection[];
  circuits: ElectricalCircuit[];
}

export interface ElectricalConnectionDefaults {
  color: string;
  lineStyle: ElectricalLineStyle;
  width: ElectricalLineWidth;
  routing: ElectricalRouting;
  type: ElectricalConnectionType;
}

export const DEFAULT_ELECTRICAL_LAYOUT: ElectricalLayoutData = { connections: [], circuits: [] };
export const DEFAULT_ELECTRICAL_CONNECTION: ElectricalConnectionDefaults = {
  color: "#287fb8",
  lineStyle: "DASHED",
  width: "MEDIUM",
  routing: "ORTHOGONAL",
  type: "GENERIC",
};

const colours = /^#[\da-f]{6}$/i;
const idPattern = /^[\w:-]{1,150}$/;
const connectionTypes = new Set<ElectricalConnectionType>(["CONTROL", "POWER", "GENERIC"]);
const lineStyles = new Set<ElectricalLineStyle>(["SOLID", "DASHED", "DOTTED", "DASH_DOT"]);
const widths = new Set<ElectricalLineWidth>(["THIN", "MEDIUM", "THICK"]);
const routings = new Set<ElectricalRouting>(["STRAIGHT", "ORTHOGONAL", "MANUAL"]);

export function isElectricalObstacle(obstacle: Pick<Obstacle, "representation_key">): boolean {
  return obstacle.representation_key?.startsWith("electrical-") ?? false;
}

export function electricalObstacleIds(rooms: readonly Room[]): Set<string> {
  return new Set(rooms.flatMap((room) => room.obstacles.filter(isElectricalObstacle).map((obstacle) => obstacle.id)));
}

export function canAddElectricalObstacle(rooms: readonly Room[], obstacle: Obstacle, maximum: number | null): boolean {
  if (!isElectricalObstacle(obstacle) || maximum === null) return true;
  const ids = electricalObstacleIds(rooms);
  return ids.has(obstacle.id) || ids.size < maximum;
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && idPattern.test(value);
}

function safePoint(value: unknown): value is Point2D {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<Point2D>;
  return typeof point.x === "number" && Number.isFinite(point.x) && Math.abs(point.x) <= 1e7
    && typeof point.y === "number" && Number.isFinite(point.y) && Math.abs(point.y) <= 1e7;
}

function fallbackId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

export function createElectricalConnection(
  input: Pick<ElectricalConnection, "fromId" | "toId"> & Partial<Omit<ElectricalConnection, "fromId" | "toId">>,
  existing: readonly ElectricalConnection[],
  defaults: ElectricalConnectionDefaults = DEFAULT_ELECTRICAL_CONNECTION,
): ElectricalConnection | null {
  const type = input.type ?? defaults.type;
  if (!input.fromId || !input.toId || input.fromId === input.toId || !connectionTypes.has(type)) return null;
  if (existing.some((item) => item.fromId === input.fromId && item.toId === input.toId && item.type === type && item.circuitId === input.circuitId)) return null;
  return {
    id: input.id && safeId(input.id) ? input.id : fallbackId("electrical-connection"),
    fromId: input.fromId,
    toId: input.toId,
    type,
    color: input.color && colours.test(input.color) ? input.color : defaults.color,
    lineStyle: input.lineStyle && lineStyles.has(input.lineStyle) ? input.lineStyle : defaults.lineStyle,
    width: input.width && widths.has(input.width) ? input.width : defaults.width,
    routing: input.routing && routings.has(input.routing) ? input.routing : defaults.routing,
    waypoints: (input.waypoints ?? []).filter(safePoint).map((point) => ({ ...point })).slice(0, 500),
    ...(typeof input.colorOverride === "boolean" ? { colorOverride: input.colorOverride } : {}),
    ...(typeof input.label === "string" && input.label.trim() ? { label: input.label.trim().slice(0, 100) } : {}),
    ...(input.circuitId ? { circuitId: input.circuitId } : {}),
  };
}

export function normalizeElectricalLayout(value: unknown, validElectricalIds: ReadonlySet<string>): ElectricalLayoutData {
  if (!value || typeof value !== "object") return { connections: [], circuits: [] };
  const raw = value as { connections?: unknown; circuits?: unknown };
  const circuits: ElectricalCircuit[] = [];
  const circuitIds = new Set<string>();
  if (Array.isArray(raw.circuits)) {
    for (const candidate of raw.circuits.slice(0, 500)) {
      if (!candidate || typeof candidate !== "object") continue;
      const item = candidate as Partial<ElectricalCircuit>;
      if (!safeId(item.id) || circuitIds.has(item.id) || typeof item.name !== "string" || !item.name.trim()) continue;
      circuitIds.add(item.id);
      circuits.push({ id: item.id, name: item.name.trim().slice(0, 100), color: typeof item.color === "string" && colours.test(item.color) ? item.color : DEFAULT_ELECTRICAL_CONNECTION.color, ...(typeof item.description === "string" ? { description: item.description.slice(0, 500) } : {}) });
    }
  }
  const connections: ElectricalConnection[] = [];
  const ids = new Set<string>();
  const pairs = new Set<string>();
  if (Array.isArray(raw.connections)) {
    for (const candidate of raw.connections.slice(0, 10000)) {
      if (!candidate || typeof candidate !== "object") continue;
      const item = candidate as Partial<ElectricalConnection>;
      if (!safeId(item.id) || ids.has(item.id) || !safeId(item.fromId) || !safeId(item.toId) || item.fromId === item.toId) continue;
      if (!validElectricalIds.has(item.fromId) || !validElectricalIds.has(item.toId) || !connectionTypes.has(item.type as ElectricalConnectionType)) continue;
      if (item.circuitId && !circuitIds.has(item.circuitId)) continue;
      const pair = `${item.fromId}\u0000${item.toId}\u0000${item.type}\u0000${item.circuitId ?? ""}`;
      if (pairs.has(pair)) continue;
      const connection = createElectricalConnection(item as Pick<ElectricalConnection, "fromId" | "toId"> & Partial<Omit<ElectricalConnection, "id" | "fromId" | "toId">> & { id: string }, connections);
      if (!connection) continue;
      connection.id = item.id;
      if (typeof item.colorOverride === "boolean") connection.colorOverride = item.colorOverride;
      ids.add(item.id);
      pairs.add(pair);
      connections.push(connection);
    }
  }
  return { connections, circuits };
}

export function electricalConnectionPoints(connection: ElectricalConnection, from: Point2D, to: Point2D): Point2D[] {
  if (connection.routing === "STRAIGHT") return [from, to];
  if (connection.waypoints.length) return [from, ...connection.waypoints, to];
  if (connection.routing === "MANUAL") return [from, to];
  const midX = (from.x + to.x) / 2;
  return [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to];
}

export function electricalDashArray(style: ElectricalLineStyle): string | undefined {
  switch (style) {
    case "DASHED": return "8 5";
    case "DOTTED": return "1 5";
    case "DASH_DOT": return "9 4 1 4";
    default: return undefined;
  }
}

export function electricalStrokeWidth(width: ElectricalLineWidth): number {
  switch (width) {
    case "THIN": return 1.5;
    case "THICK": return 4;
    default: return 2.5;
  }
}
