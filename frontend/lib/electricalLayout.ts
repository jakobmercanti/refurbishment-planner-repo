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
  /** User-positioned label anchor in authoritative floorplan millimetres. */
  labelPosition?: Point2D;
  /** Logical switch gang for lighting checkout, not a wiring terminal designation. */
  fromSwitchGang?: number;
  toSwitchGang?: number;
  circuitId: string;
}

export interface ElectricalCircuit {
  id: string;
  name: string;
  color: string;
  description?: string;
}

export interface ElectricalBomOverride {
  description?: string;
  manufacturer?: string;
  model?: string;
  partNumber?: string;
  supplier?: string;
  unit?: string;
  orderQuantity?: number;
  unitCost?: number;
  currency?: string;
  notes?: string;
  hidden?: boolean;
}

export interface ElectricalManualBomItem extends ElectricalBomOverride {
  bomRowId: string;
  description: string;
  quantity: number;
}

export type ElectricalAttachmentRelation = { kind: "LAYOUT" } | { kind: "BOM" | "ASSET" | "CONNECTION" | "CIRCUIT"; id: string };
export interface ElectricalScheduleAttachment {
  attachmentId: string;
  fileName: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: number;
  title: string;
  caption: string;
  notes: string;
  includeInExport: boolean;
  relation: ElectricalAttachmentRelation;
}

export interface ElectricalConnectionNotes {
  description?: string;
  reference?: string;
  notes?: string;
  installationNote?: string;
  cableAllowanceM?: number;
}

export interface ElectricalExportMetadata {
  drawingTitle?: string;
  revision?: string;
  preparedBy?: string;
  checkedBy?: string;
  notes?: string;
}

export interface ElectricalLayoutDocumentation {
  bomOverrides: Record<string, ElectricalBomOverride>;
  hiddenBomKeys: string[];
  manualBomItems: ElectricalManualBomItem[];
  connectionNotes: Record<string, ElectricalConnectionNotes>;
  circuitNotes: Record<string, string>;
  generalNotes: string;
  attachments: ElectricalScheduleAttachment[];
  exportMetadata: ElectricalExportMetadata;
}

export interface ElectricalLayoutData {
  /** Render every connection leg with horizontal/vertical segments when enabled. */
  forceOrthogonalRouting: boolean;
  connections: ElectricalConnection[];
  circuits: ElectricalCircuit[];
  documentation: ElectricalLayoutDocumentation;
}

export interface ElectricalConnectionDefaults {
  color: string;
  lineStyle: ElectricalLineStyle;
  width: ElectricalLineWidth;
  routing: ElectricalRouting;
  type: ElectricalConnectionType;
}

export const DEFAULT_ELECTRICAL_DOCUMENTATION: ElectricalLayoutDocumentation = {
  bomOverrides: {}, hiddenBomKeys: [], manualBomItems: [], connectionNotes: {}, circuitNotes: {},
  generalNotes: "", attachments: [], exportMetadata: {},
};
export const DEFAULT_ELECTRICAL_CONNECTION: ElectricalConnectionDefaults = {
  color: "#287fb8",
  lineStyle: "DASHED",
  width: "MEDIUM",
  routing: "ORTHOGONAL",
  type: "GENERIC",
};
export const DEFAULT_ELECTRICAL_CIRCUIT: ElectricalCircuit = {
  id: "electrical-circuit-default",
  name: "Circuit 1",
  color: DEFAULT_ELECTRICAL_CONNECTION.color,
};
export const DEFAULT_ELECTRICAL_LAYOUT: ElectricalLayoutData = {
  forceOrthogonalRouting: true,
  connections: [],
  circuits: [{ ...DEFAULT_ELECTRICAL_CIRCUIT }],
  documentation: DEFAULT_ELECTRICAL_DOCUMENTATION,
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

function safeId(value: unknown): value is string {
  return typeof value === "string" && idPattern.test(value);
}

function safeText(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" ? value.slice(0, maxLength) : undefined;
}

function safeNonnegative(value: unknown, maximum = 1e9): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum ? value : undefined;
}

function normalizeBomOverride(value: unknown): ElectricalBomOverride {
  if (!value || typeof value !== "object") return {};
  const raw = value as ElectricalBomOverride;
  return {
    ...(safeText(raw.description, 500) !== undefined ? { description: safeText(raw.description, 500) } : {}),
    ...(safeText(raw.manufacturer, 200) !== undefined ? { manufacturer: safeText(raw.manufacturer, 200) } : {}),
    ...(safeText(raw.model, 200) !== undefined ? { model: safeText(raw.model, 200) } : {}),
    ...(safeText(raw.partNumber, 160) !== undefined ? { partNumber: safeText(raw.partNumber, 160) } : {}),
    ...(safeText(raw.supplier, 200) !== undefined ? { supplier: safeText(raw.supplier, 200) } : {}),
    ...(safeText(raw.unit, 40) !== undefined ? { unit: safeText(raw.unit, 40) } : {}),
    ...(safeNonnegative(raw.orderQuantity, 1e6) !== undefined ? { orderQuantity: safeNonnegative(raw.orderQuantity, 1e6) } : {}),
    ...(safeNonnegative(raw.unitCost) !== undefined ? { unitCost: safeNonnegative(raw.unitCost) } : {}),
    ...(typeof raw.currency === "string" && /^[A-Za-z]{3}$/.test(raw.currency) ? { currency: raw.currency.toUpperCase() } : {}),
    ...(safeText(raw.notes, 2000) !== undefined ? { notes: safeText(raw.notes, 2000) } : {}),
    ...(typeof raw.hidden === "boolean" ? { hidden: raw.hidden } : {}),
  };
}

function normalizeDocumentation(value: unknown): ElectricalLayoutDocumentation {
  if (!value || typeof value !== "object") return DEFAULT_ELECTRICAL_DOCUMENTATION;
  const raw = value as Partial<ElectricalLayoutDocumentation>;
  const bomOverrides: ElectricalLayoutDocumentation["bomOverrides"] = {};
  if (raw.bomOverrides && typeof raw.bomOverrides === "object" && !Array.isArray(raw.bomOverrides)) {
    Object.entries(raw.bomOverrides).slice(0, 1000).forEach(([key, item]) => {
      if (key.length > 300) return;
      bomOverrides[key] = normalizeBomOverride(item);
    });
  }
  const manualBomItems = Array.isArray(raw.manualBomItems) ? raw.manualBomItems.slice(0, 500).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Partial<ElectricalManualBomItem>;
    if (!safeId(item.bomRowId) || typeof item.description !== "string" || !item.description.trim()) return [];
    const quantity = safeNonnegative(item.quantity, 1e6);
    if (quantity === undefined) return [];
    return [{ ...normalizeBomOverride(item), bomRowId: item.bomRowId, description: item.description.trim().slice(0, 500), quantity }];
  }) : [];
  const connectionNotes: ElectricalLayoutDocumentation["connectionNotes"] = {};
  if (raw.connectionNotes && typeof raw.connectionNotes === "object" && !Array.isArray(raw.connectionNotes)) {
    Object.entries(raw.connectionNotes).slice(0, 10000).forEach(([id, item]) => {
      if (safeId(id) && item && typeof item === "object") {
        const note = item as ElectricalConnectionNotes;
        connectionNotes[id] = {
          ...(safeText(note.description, 500) !== undefined ? { description: safeText(note.description, 500) } : {}),
          ...(safeText(note.reference, 160) !== undefined ? { reference: safeText(note.reference, 160) } : {}),
          ...(safeText(note.notes, 2000) !== undefined ? { notes: safeText(note.notes, 2000) } : {}),
          ...(safeText(note.installationNote, 1000) !== undefined ? { installationNote: safeText(note.installationNote, 1000) } : {}),
          ...(safeNonnegative(note.cableAllowanceM, 1e6) !== undefined ? { cableAllowanceM: safeNonnegative(note.cableAllowanceM, 1e6) } : {}),
        };
      }
    });
  }
  const circuitNotes: ElectricalLayoutDocumentation["circuitNotes"] = {};
  if (raw.circuitNotes && typeof raw.circuitNotes === "object" && !Array.isArray(raw.circuitNotes)) {
    Object.entries(raw.circuitNotes).slice(0, 500).forEach(([id, note]) => { if (safeId(id) && typeof note === "string") circuitNotes[id] = note.slice(0, 2000); });
  }
  const attachments = Array.isArray(raw.attachments) ? raw.attachments.slice(0, 30).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Partial<ElectricalScheduleAttachment>;
    if (!safeId(item.attachmentId) || !["image/jpeg", "image/png", "image/webp"].includes(item.mediaType ?? "")
      || !Number.isSafeInteger(item.sizeBytes) || (item.sizeBytes ?? 0) <= 0 || (item.sizeBytes ?? 0) > 5 * 1024 * 1024) return [];
    const relation = item.relation;
    if (!relation || !["LAYOUT", "BOM", "ASSET", "CONNECTION", "CIRCUIT"].includes(relation.kind)
      || (relation.kind !== "LAYOUT" && !safeId(relation.id))) return [];
    const fileName = typeof item.fileName === "string" ? item.fileName.split(/[\\/]/).at(-1)?.replace(/[^\w.-]/g, "_").slice(0, 120) ?? "image" : "image";
    return [{ attachmentId: item.attachmentId, fileName, mediaType: item.mediaType as ElectricalScheduleAttachment["mediaType"], sizeBytes: item.sizeBytes!, title: safeText(item.title, 200) ?? "", caption: safeText(item.caption, 1000) ?? "", notes: safeText(item.notes, 2000) ?? "", includeInExport: item.includeInExport === true, relation: relation.kind === "LAYOUT" ? { kind: "LAYOUT" as const } : { kind: relation.kind, id: relation.id! } }];
  }) : [];
  const metadata = raw.exportMetadata && typeof raw.exportMetadata === "object" ? raw.exportMetadata : {};
  const exportMetadata = {
    ...(safeText(metadata.drawingTitle, 200) !== undefined ? { drawingTitle: safeText(metadata.drawingTitle, 200) } : {}),
    ...(safeText(metadata.revision, 40) !== undefined ? { revision: safeText(metadata.revision, 40) } : {}),
    ...(safeText(metadata.preparedBy, 160) !== undefined ? { preparedBy: safeText(metadata.preparedBy, 160) } : {}),
    ...(safeText(metadata.checkedBy, 160) !== undefined ? { checkedBy: safeText(metadata.checkedBy, 160) } : {}),
    ...(safeText(metadata.notes, 2000) !== undefined ? { notes: safeText(metadata.notes, 2000) } : {}),
  };
  return {
    bomOverrides,
    hiddenBomKeys: Array.isArray(raw.hiddenBomKeys) ? [...new Set(raw.hiddenBomKeys.filter((key): key is string => typeof key === "string" && key.length <= 300))].slice(0, 1000) : [],
    manualBomItems,
    connectionNotes,
    circuitNotes,
    generalNotes: typeof raw.generalNotes === "string" ? raw.generalNotes.slice(0, 10000) : "",
    attachments,
    exportMetadata,
  };
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
  input: Pick<ElectricalConnection, "fromId" | "toId" | "circuitId"> & Partial<Omit<ElectricalConnection, "fromId" | "toId" | "circuitId">>,
  existing: readonly ElectricalConnection[],
  defaults: ElectricalConnectionDefaults = DEFAULT_ELECTRICAL_CONNECTION,
): ElectricalConnection | null {
  const type = input.type ?? defaults.type;
  if (!safeId(input.fromId) || !safeId(input.toId) || !safeId(input.circuitId) || input.fromId === input.toId || !connectionTypes.has(type)) return null;
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
    ...(safePoint(input.labelPosition) ? { labelPosition: { ...input.labelPosition } } : {}),
    ...(Number.isInteger(input.fromSwitchGang) && input.fromSwitchGang! >= 1 && input.fromSwitchGang! <= 4 ? { fromSwitchGang: input.fromSwitchGang } : {}),
    ...(Number.isInteger(input.toSwitchGang) && input.toSwitchGang! >= 1 && input.toSwitchGang! <= 4 ? { toSwitchGang: input.toSwitchGang } : {}),
    circuitId: input.circuitId,
  };
}

export function normalizeElectricalLayout(value: unknown, validElectricalIds: ReadonlySet<string>): ElectricalLayoutData {
  if (!value || typeof value !== "object") return { ...DEFAULT_ELECTRICAL_LAYOUT, circuits: [{ ...DEFAULT_ELECTRICAL_CIRCUIT }] };
  const raw = value as { forceOrthogonalRouting?: unknown; connections?: unknown; circuits?: unknown; documentation?: unknown };
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
  if (!circuits.length) circuits.push({ ...DEFAULT_ELECTRICAL_CIRCUIT });
  const fallbackCircuitId = circuits[0].id;
  const connections: ElectricalConnection[] = [];
  const ids = new Set<string>();
  const pairs = new Set<string>();
  if (Array.isArray(raw.connections)) {
    for (const candidate of raw.connections.slice(0, 10000)) {
      if (!candidate || typeof candidate !== "object") continue;
      const item = candidate as Partial<ElectricalConnection>;
      if (!safeId(item.id) || ids.has(item.id) || !safeId(item.fromId) || !safeId(item.toId) || item.fromId === item.toId) continue;
      if (!validElectricalIds.has(item.fromId) || !validElectricalIds.has(item.toId) || !connectionTypes.has(item.type as ElectricalConnectionType)) continue;
      const circuitId = item.circuitId && circuitIds.has(item.circuitId) ? item.circuitId : fallbackCircuitId;
      const pair = `${item.fromId}\u0000${item.toId}\u0000${item.type}\u0000${circuitId}`;
      if (pairs.has(pair)) continue;
      const connection = createElectricalConnection({ ...item, circuitId } as ElectricalConnection, connections);
      if (!connection) continue;
      connection.id = item.id;
      if (typeof item.colorOverride === "boolean") connection.colorOverride = item.colorOverride;
      ids.add(item.id);
      pairs.add(pair);
      connections.push(connection);
    }
  }
  return { forceOrthogonalRouting: raw.forceOrthogonalRouting !== false, connections, circuits, documentation: normalizeDocumentation(raw.documentation) };
}

export function electricalConnectionPoints(connection: ElectricalConnection, from: Point2D, to: Point2D, forceOrthogonalRouting = false): Point2D[] {
  let route: Point2D[];
  if (connection.routing === "STRAIGHT") route = [from, to];
  else if (connection.waypoints.length) route = [from, ...connection.waypoints, to];
  else if (connection.routing === "MANUAL") route = [from, to];
  else {
    const midX = (from.x + to.x) / 2;
    route = [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to];
  }
  if (!forceOrthogonalRouting || route.length < 2) return route;

  return orthogonalisePath(route);
}

/** Shared schematic-routing policy for electrical and heating connections. */
export function orthogonalisePath(route: Point2D[]): Point2D[] {
  if (route.length < 2) return route;
  const orthogonal: Point2D[] = [route[0]];
  const append = (point: Point2D) => {
    const previous = orthogonal.at(-1)!;
    if (Math.abs(previous.x - point.x) > 1e-7 || Math.abs(previous.y - point.y) > 1e-7) orthogonal.push(point);
  };
  for (let index = 0; index < route.length - 1; index++) {
    const start = route[index];
    const end = route[index + 1];
    if (Math.abs(start.x - end.x) > 1e-7 && Math.abs(start.y - end.y) > 1e-7) append({ x: end.x, y: start.y });
    append(end);
  }
  return orthogonal;
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
