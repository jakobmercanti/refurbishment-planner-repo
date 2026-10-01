import type { AssetDefinition, AssetInstance } from "./projectDocument";
import { containsPoint } from "./elementPlacement";
import type { Opening, Point2D, Room } from "./types";

export const PLANNER_BUILD_CATEGORIES = [
  "PRE-CONSTRUCTION", "PROCUREMENT", "SITE SETUP", "STRIP-OUT / DEMOLITION", "STRUCTURAL",
  "BUILDING ENVELOPE", "FIRST FIX", "INTERNAL CONSTRUCTION", "WATERPROOFING / WET AREAS",
  "FINISHES", "SECOND FIX", "KITCHEN / FITTED FURNITURE", "EXTERNAL WORKS",
  "TESTING & COMMISSIONING", "COMPLIANCE / INSPECTIONS", "COMPLETION", "HANDOVER",
] as const;

export type PlannerBuildActivityType = "task" | "milestone" | "delivery" | "inspection" | "decision" | "waiting" | "appointment" | "payment";
export type PlannerBuildActivityStatus = "not_started" | "in_progress" | "completed" | "blocked" | "delayed";
export type PlannerBuildDeliveryStatus = "not_ordered" | "ordered" | "confirmed" | "dispatched" | "delivered" | "delayed";
export type PlannerBuildInspectionStatus = "pending" | "passed" | "failed";
export type PlannerBuildPaymentStatus = "unpaid" | "paid";

export const PLANNER_BUILD_ACTIVITY_TYPES: readonly PlannerBuildActivityType[] = ["task", "milestone", "delivery", "inspection", "decision", "waiting", "appointment", "payment"];
export const PLANNER_BUILD_ACTIVITY_STATUSES: readonly PlannerBuildActivityStatus[] = ["not_started", "in_progress", "completed", "blocked", "delayed"];
export const PLANNER_BUILD_DELIVERY_STATUSES: readonly PlannerBuildDeliveryStatus[] = ["not_ordered", "ordered", "confirmed", "dispatched", "delivered", "delayed"];

export interface PlannerBuildActivity {
  activityId: string;
  name: string;
  startDate: string;
  endDate: string;
  actualStartDate?: string;
  actualEndDate?: string;
  colour: string;
  category?: string;
  roomId: string | null;
  progress: number;
  type: PlannerBuildActivityType;
  status: PlannerBuildActivityStatus;
  dependencyIds: string[];
  trade?: string;
  notes?: string;
  supplier?: string;
  orderDate?: string;
  leadTimeDays?: number;
  expectedDeliveryDate?: string;
  actualDeliveryDate?: string;
  orderReference?: string;
  deliveryStatus?: PlannerBuildDeliveryStatus;
  decisionDeadline?: string;
  inspectionStatus?: PlannerBuildInspectionStatus;
  paymentDueDate?: string;
  amount?: number;
  currency?: string;
  paymentStatus?: PlannerBuildPaymentStatus;
  estimatedCost?: number;
  actualCost?: number;
  isBlocking?: boolean;
  blockedReason?: string;
  sortOrder: number;
}

export interface PlannerBuildWarning { warningId: string; activityId: string; message: string; severity: "warning" | "urgent" }
export interface PlannerBuildScheduleSummary {
  countsByCategory: Array<{ name: string; count: number }>;
  countsByTrade: Array<{ name: string; count: number }>;
  countsByRoom: Array<{ roomId: string | null; count: number }>;
  countsByStatus: Array<{ name: PlannerBuildActivityStatus; count: number }>;
  countsByType: Array<{ name: PlannerBuildActivityType; count: number }>;
  nextMilestone: PlannerBuildActivity | null;
  nextDelivery: PlannerBuildActivity | null;
  delayedDeliveries: PlannerBuildActivity[];
  pendingInspections: PlannerBuildActivity[];
  pendingDecisions: PlannerBuildActivity[];
  blockedActivities: PlannerBuildActivity[];
  paymentsDue: PlannerBuildActivity[];
  upcoming: PlannerBuildActivity[];
}

export interface PlannerBuildData {
  activities: PlannerBuildActivity[];
  projectStartDate?: string;
  targetCompletionDate?: string;
}

export const DEFAULT_PLANNER_BUILD: PlannerBuildData = { activities: [] };

const ID_PATTERN = /^[\w:-]{1,150}$/;
const COLOUR_PATTERN = /^#[\da-f]{6}$/i;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Accepts additive/legacy project data safely and drops malformed schedule entries only. */
export function normalizePlannerBuild(input: unknown): PlannerBuildData {
  const source = record(input);
  const rawActivities = Array.isArray(source?.activities) ? source.activities : [];
  const activities: PlannerBuildActivity[] = [];
  const usedIds = new Set<string>();

  rawActivities.forEach((raw, index) => {
    const item = record(raw);
    if (!item || typeof item.activityId !== "string" || !ID_PATTERN.test(item.activityId)) return;
    if (typeof item.name !== "string" || !item.name.trim() || !isIsoDate(item.startDate) || !isIsoDate(item.endDate)) return;
    if (calendarDaysBetween(item.startDate, item.endDate) < 0) return;

    let activityId = item.activityId;
    if (usedIds.has(activityId)) {
      let suffix = 2;
      const base = activityId.slice(0, 130);
      while (usedIds.has(`${base}-duplicate-${suffix}`)) suffix += 1;
      activityId = `${base}-duplicate-${suffix}`;
    }
    usedIds.add(activityId);

    const rawProgress = typeof item.progress === "number" && Number.isFinite(item.progress) ? item.progress : 0;
    const category = typeof item.category === "string" && item.category.trim() ? item.category.trim().slice(0, 80) : undefined;
    const roomId = typeof item.roomId === "string" && ID_PATTERN.test(item.roomId) ? item.roomId : null;
    const notes = typeof item.notes === "string" && item.notes.trim() ? item.notes.slice(0, 5000) : undefined;
    const sortOrder = typeof item.sortOrder === "number" && Number.isFinite(item.sortOrder) ? item.sortOrder : index;
    const type = PLANNER_BUILD_ACTIVITY_TYPES.includes(item.type as PlannerBuildActivityType) ? item.type as PlannerBuildActivityType : "task";
    const progress = Math.max(0, Math.min(100, Math.round(rawProgress)));
    const fallbackStatus: PlannerBuildActivityStatus = progress >= 100 ? "completed" : progress > 0 ? "in_progress" : "not_started";
    const status = PLANNER_BUILD_ACTIVITY_STATUSES.includes(item.status as PlannerBuildActivityStatus) ? item.status as PlannerBuildActivityStatus : fallbackStatus;
    const optionalDate = (value: unknown) => isIsoDate(value) ? value : undefined;
    const actualStartDate = optionalDate(item.actualStartDate);
    const actualEndDate = optionalDate(item.actualEndDate);
    const optionalText = (value: unknown, max = 200) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
    const optionalNumber = (value: unknown, max = Number.MAX_SAFE_INTEGER) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? value : undefined;
    const deliveryStatus = PLANNER_BUILD_DELIVERY_STATUSES.includes(item.deliveryStatus as PlannerBuildDeliveryStatus) ? item.deliveryStatus as PlannerBuildDeliveryStatus : undefined;
    const inspectionStatus = ["pending", "passed", "failed"].includes(String(item.inspectionStatus)) ? item.inspectionStatus as PlannerBuildInspectionStatus : undefined;
    const paymentStatus = ["unpaid", "paid"].includes(String(item.paymentStatus)) ? item.paymentStatus as PlannerBuildPaymentStatus : undefined;
    activities.push({
      activityId,
      name: item.name.trim().slice(0, 200),
      startDate: item.startDate,
      endDate: item.endDate,
      ...(actualStartDate ? { actualStartDate } : {}),
      ...(actualEndDate && (!actualStartDate || actualEndDate >= actualStartDate) ? { actualEndDate } : {}),
      colour: typeof item.colour === "string" && COLOUR_PATTERN.test(item.colour) ? item.colour.toUpperCase() : "#287FB8",
      ...(category ? { category } : {}),
      roomId,
      progress,
      type,
      status,
      dependencyIds: Array.isArray(item.dependencyIds) ? [...new Set(item.dependencyIds.filter((id): id is string => typeof id === "string" && ID_PATTERN.test(id) && id !== activityId))] : [],
      ...(optionalText(item.trade, 100) ? { trade: optionalText(item.trade, 100) } : {}),
      ...(notes ? { notes } : {}),
      ...(optionalText(item.supplier, 200) ? { supplier: optionalText(item.supplier, 200) } : {}),
      ...(optionalDate(item.orderDate) ? { orderDate: optionalDate(item.orderDate) } : {}),
      ...(optionalNumber(item.leadTimeDays, 3650) !== undefined ? { leadTimeDays: Math.floor(optionalNumber(item.leadTimeDays, 3650)!) } : {}),
      ...(optionalDate(item.expectedDeliveryDate) ? { expectedDeliveryDate: optionalDate(item.expectedDeliveryDate) } : {}),
      ...(optionalDate(item.actualDeliveryDate) ? { actualDeliveryDate: optionalDate(item.actualDeliveryDate) } : {}),
      ...(optionalText(item.orderReference, 160) ? { orderReference: optionalText(item.orderReference, 160) } : {}),
      ...(deliveryStatus ? { deliveryStatus } : {}),
      ...(optionalDate(item.decisionDeadline) ? { decisionDeadline: optionalDate(item.decisionDeadline) } : {}),
      ...(inspectionStatus ? { inspectionStatus } : {}),
      ...(optionalDate(item.paymentDueDate) ? { paymentDueDate: optionalDate(item.paymentDueDate) } : {}),
      ...(optionalNumber(item.amount) !== undefined ? { amount: optionalNumber(item.amount)! } : {}),
      ...(optionalText(item.currency, 3) ? { currency: optionalText(item.currency, 3)!.toUpperCase() } : {}),
      ...(paymentStatus ? { paymentStatus } : {}),
      ...(optionalNumber(item.estimatedCost) !== undefined ? { estimatedCost: optionalNumber(item.estimatedCost)! } : {}),
      ...(optionalNumber(item.actualCost) !== undefined ? { actualCost: optionalNumber(item.actualCost)! } : {}),
      ...(typeof item.isBlocking === "boolean" ? { isBlocking: item.isBlocking } : {}),
      ...(optionalText(item.blockedReason, 1000) ? { blockedReason: optionalText(item.blockedReason, 1000) } : {}),
      sortOrder,
    });
  });

  const knownIds = new Set(activities.map((activity) => activity.activityId));
  for (const activity of activities) activity.dependencyIds = activity.dependencyIds.filter((id) => knownIds.has(id));
  const accepted: PlannerBuildActivity[] = [];
  for (const activity of activities) {
    const dependencies: string[] = [];
    for (const dependencyId of activity.dependencyIds) {
      if (!wouldCreateDependencyCycle([...accepted, { ...activity, dependencyIds: dependencies }], activity.activityId, dependencyId)) dependencies.push(dependencyId);
    }
    activity.dependencyIds = dependencies;
    accepted.push(activity);
  }

  const projectStartDate = isIsoDate(source?.projectStartDate) ? source.projectStartDate : undefined;
  const targetCompletionDate = isIsoDate(source?.targetCompletionDate) ? source.targetCompletionDate : undefined;
  return {
    activities: activities.sort((first, second) => first.sortOrder - second.sortOrder || first.activityId.localeCompare(second.activityId)),
    ...(projectStartDate ? { projectStartDate } : {}),
    ...(targetCompletionDate ? { targetCompletionDate } : {}),
  };
}

export function wouldCreateDependencyCycle(activities: readonly PlannerBuildActivity[], activityId: string, dependencyId: string): boolean {
  if (activityId === dependencyId) return true;
  const byId = new Map(activities.map((activity) => [activity.activityId, activity]));
  const pending = [dependencyId], seen = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    if (current === activityId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    pending.push(...(byId.get(current)?.dependencyIds ?? []));
  }
  return false;
}

export function expectedDeliveryDate(activity: PlannerBuildActivity): string | null {
  if (activity.actualDeliveryDate) return activity.actualDeliveryDate;
  if (activity.expectedDeliveryDate) return activity.expectedDeliveryDate;
  return activity.orderDate && activity.leadTimeDays !== undefined ? addCalendarDays(activity.orderDate, activity.leadTimeDays) : null;
}

export function getPlannerBuildWarnings(activities: readonly PlannerBuildActivity[], today = localDateKey()): PlannerBuildWarning[] {
  const byId = new Map(activities.map((activity) => [activity.activityId, activity]));
  const warnings: PlannerBuildWarning[] = [];
  for (const activity of activities) {
    for (const dependencyId of activity.dependencyIds) {
      const prerequisite = byId.get(dependencyId);
      if (!prerequisite) continue;
      const deliveryDate = prerequisite.type === "delivery" ? expectedDeliveryDate(prerequisite) : null;
      const decisionDeadline = prerequisite.type === "decision" ? prerequisite.decisionDeadline : null;
      const conflict = deliveryDate ? activity.startDate < deliveryDate : decisionDeadline ? activity.startDate <= decisionDeadline : activity.startDate <= prerequisite.endDate;
      if (!conflict) continue;
      const message = deliveryDate
        ? "“" + activity.name + "” starts before “" + prerequisite.name + "” is expected to arrive."
        : decisionDeadline
          ? "“" + activity.name + "” starts before the decision deadline for “" + prerequisite.name + "”."
          : "“" + activity.name + "” starts before prerequisite “" + prerequisite.name + "” is due to finish.";
      warnings.push({ warningId: activity.activityId + ":" + dependencyId, activityId: activity.activityId, message, severity: prerequisite.status === "delayed" || prerequisite.status === "blocked" ? "urgent" : "warning" });
    }
    if (activity.status === "blocked" && activity.isBlocking) warnings.push({ warningId: activity.activityId + ":blocked", activityId: activity.activityId, message: activity.blockedReason ? activity.name + " is blocking: " + activity.blockedReason : activity.name + " is blocking other work.", severity: "urgent" });
    if (activity.type === "delivery" && activity.deliveryStatus === "delayed") warnings.push({ warningId: activity.activityId + ":delivery-delayed", activityId: activity.activityId, message: activity.name + " delivery is delayed.", severity: "urgent" });
    if (activity.type === "decision" && activity.decisionDeadline && activity.decisionDeadline < today && activity.status !== "completed") warnings.push({ warningId: activity.activityId + ":decision-overdue", activityId: activity.activityId, message: activity.name + " decision deadline has passed.", severity: "warning" });
  }
  return warnings;
}

export function getPlannerBuildScheduleSummary(activities: readonly PlannerBuildActivity[], today = localDateKey(), upcomingDays = 7): PlannerBuildScheduleSummary {
  const countBy = <T extends string>(values: T[]) => [...values.reduce((counts, value) => counts.set(value, (counts.get(value) ?? 0) + 1), new Map<T, number>())].map(([name, count]) => ({ name, count }));
  const dueDate = (activity: PlannerBuildActivity) => activity.type === "delivery" ? expectedDeliveryDate(activity) : activity.type === "decision" ? activity.decisionDeadline ?? activity.startDate : activity.type === "payment" ? activity.paymentDueDate ?? activity.startDate : activity.startDate;
  const next = (type: PlannerBuildActivityType) => [...activities].filter((activity) => activity.type === type && (dueDate(activity) ?? activity.startDate) >= today && activity.status !== "completed" && !(type === "delivery" && activity.deliveryStatus === "delivered")).sort((a, b) => (dueDate(a) ?? a.startDate).localeCompare(dueDate(b) ?? b.startDate))[0] ?? null;
  return {
    countsByCategory: countBy(activities.map((item) => item.category || "Uncategorised")),
    countsByTrade: countBy(activities.map((item) => item.trade || "Unassigned")),
    countsByRoom: [...activities.reduce((counts, item) => counts.set(item.roomId, (counts.get(item.roomId) ?? 0) + 1), new Map<string | null, number>())].map(([roomId, count]) => ({ roomId, count })),
    countsByStatus: countBy(activities.map((item) => item.status)),
    countsByType: countBy(activities.map((item) => item.type)),
    nextMilestone: next("milestone"), nextDelivery: next("delivery"),
    delayedDeliveries: activities.filter((item) => item.type === "delivery" && item.deliveryStatus === "delayed"),
    pendingInspections: activities.filter((item) => item.type === "inspection" && (item.inspectionStatus ?? "pending") === "pending" && item.status !== "completed"),
    pendingDecisions: activities.filter((item) => item.type === "decision" && item.status !== "completed"),
    blockedActivities: activities.filter((item) => item.status === "blocked"),
    paymentsDue: activities.filter((item) => item.type === "payment" && item.paymentStatus !== "paid" && (item.paymentDueDate ?? item.startDate) <= addCalendarDays(today, upcomingDays)),
    upcoming: [...activities].filter((item) => { const due = dueDate(item); return Boolean(due && due >= today && due <= addCalendarDays(today, upcomingDays)) && item.status !== "completed" && !(item.type === "delivery" && item.deliveryStatus === "delivered"); }).sort((a, b) => (dueDate(a) ?? a.startDate).localeCompare(dueDate(b) ?? b.startDate)),
  };
}

/** Date-only arithmetic is UTC-based so local timezone offsets cannot shift schedule days. */
export function calendarDayNumber(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function calendarDaysBetween(startDate: string, endDate: string): number {
  return calendarDayNumber(endDate) - calendarDayNumber(startDate);
}

export function addCalendarDays(dateKey: string, amount: number): string {
  const date = new Date(calendarDayNumber(dateKey) * 86_400_000 + amount * 86_400_000);
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date.getUTCMonth() + 1).toString().padStart(2, "0")}-${date.getUTCDate().toString().padStart(2, "0")}`;
}

export function localDateKey(date = new Date()): string {
  return `${date.getFullYear().toString().padStart(4, "0")}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
}

export function formatDateKey(dateKey: string, options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" }): string {
  if (!isIsoDate(dateKey)) return "—";
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", options).format(new Date(year, month - 1, day, 12));
}

type PlannerBuildRoomSource = {
  id: string;
  name: string;
  vertices: Point2D[];
  wallHeightMm: number | null;
  openings: Opening[];
  obstacles: Room["obstacles"];
  finishes?: Room["finishes"];
};

export interface PlannerBuildWallSurfaceMetric {
  id: string;
  roomId: string;
  roomName: string;
  boundaryIndex: number;
  lengthMm: number;
  heightMm: number | null;
  grossAreaMm2: number | null;
  openingAreaMm2: number;
  netAreaMm2: number | null;
  finishName: string | null;
  finishColour: string | null;
}

export interface PlannerBuildRoomMetric {
  roomId: string;
  name: string;
  areaMm2: number;
  perimeterMm: number;
  boundaryCount: number;
  grossWallAreaMm2: number | null;
  openingAreaMm2: number;
  netWallAreaMm2: number | null;
  doors: number;
  windows: number;
  electrical: number | null;
  plumbing: number | null;
  otherFittings: number;
  floorFinish: string | null;
}

export interface PlannerBuildMetrics {
  summary: {
    roomCount: number;
    totalFloorAreaMm2: number;
    totalRoomPerimeterMm: number;
    uniqueWallCount: number;
    totalWallLengthMm: number;
    grossWallAreaMm2: number | null;
    netWallAreaMm2: number | null;
    doorCount: number;
    windowCount: number;
    fittingCount: number;
    electricalCount: number;
    plumbingCount: number | null;
    activityCount: number;
    scheduledDays: number | null;
    earliestStart: string | null;
    latestFinish: string | null;
    completedActivities: number;
    inProgressActivities: number;
    notStartedActivities: number;
  };
  rooms: PlannerBuildRoomMetric[];
  wallSurfaces: PlannerBuildWallSurfaceMetric[];
  openings: { doors: number; windows: number; doorAreaMm2: number | null; windowAreaMm2: number | null };
  electricalByType: Array<{ name: string; count: number }>;
  plumbingByType: Array<{ name: string; count: number }>;
  plumbingClassificationAvailable: boolean;
  electricalConnections: number;
  electricalCircuits: number;
  paintedWallAreaMm2: number | null;
  floorFinishCount: number;
  importedAssetCount: number;
}

export interface PlannerBuildMetricsProject {
  rooms: Room[];
  floorplan: {
    walls: Array<{ id: string; points: Point2D[] }>;
    rooms: Array<{ id: string; name: string; vertices: Point2D[]; sourceWallId: string; sourceWallIds?: string[] }>;
    openings: Array<{ id: string; kind: "DOOR" | "WINDOW"; width: number; height: number }>;
    wallHeight?: number;
    roomFinishes?: Record<string, Room["finishes"]>;
  } | null;
  assets: AssetDefinition[];
  assetInstances: AssetInstance[];
  electricalLayout?: { connections: unknown[]; circuits: unknown[] };
  plannerBuild?: PlannerBuildData;
}

function roomSources(project: PlannerBuildMetricsProject): PlannerBuildRoomSource[] {
  if (project.rooms.length) return project.rooms.map((room) => ({
    id: room.id,
    name: room.name.trim() || "Unnamed room",
    vertices: room.vertices,
    wallHeightMm: Number.isFinite(room.wall_height?.value) && room.wall_height.value > 0 ? room.wall_height.value : null,
    openings: room.openings ?? [],
    obstacles: room.obstacles ?? [],
    ...(room.finishes ? { finishes: room.finishes } : {}),
  }));
  return (project.floorplan?.rooms ?? []).map((room) => ({
    id: room.id,
    name: room.name.trim() || "Unnamed room",
    vertices: room.vertices,
    wallHeightMm: Number.isFinite(project.floorplan?.wallHeight) && (project.floorplan?.wallHeight ?? 0) > 0 ? project.floorplan!.wallHeight! : null,
    openings: [],
    obstacles: [],
    ...(project.floorplan?.roomFinishes?.[room.id] ? { finishes: project.floorplan.roomFinishes[room.id] } : {}),
  }));
}

function polygonAreaMm2(vertices: Point2D[]): number {
  if (vertices.length < 3) return 0;
  return Math.abs(vertices.reduce((sum, point, index) => {
    const next = vertices[(index + 1) % vertices.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2);
}

function polygonPerimeterMm(vertices: Point2D[]): number {
  if (vertices.length < 2) return 0;
  return vertices.reduce((sum, point, index) => {
    const next = vertices[(index + 1) % vertices.length];
    return sum + Math.hypot(next.x - point.x, next.y - point.y);
  }, 0);
}

function uniqueWallSegments(project: PlannerBuildMetricsProject, sources: PlannerBuildRoomSource[]) {
  const segments = (project.floorplan?.walls ?? []).flatMap((wall) => wall.points.slice(0, -1).map((start, index) => ({
    start,
    end: wall.points[index + 1],
  })));
  const candidates = segments.length ? segments : sources.flatMap((room) => room.vertices.map((start, index) => ({ start, end: room.vertices[(index + 1) % room.vertices.length] })));
  const unique = new Map<string, { start: Point2D; end: Point2D; lengthMm: number }>();
  for (const { start, end } of candidates) {
    const lengthMm = Math.hypot(end.x - start.x, end.y - start.y);
    if (!Number.isFinite(lengthMm) || lengthMm <= 0.01) continue;
    const pointKey = (point: Point2D) => `${Math.round(point.x)}:${Math.round(point.y)}`;
    const first = pointKey(start), second = pointKey(end);
    const key = first < second ? `${first}|${second}` : `${second}|${first}`;
    if (!unique.has(key)) unique.set(key, { start, end, lengthMm });
  }
  return [...unique.values()];
}

function plumbingType(obstacle: Room["obstacles"][number]): string | null {
  if (obstacle.fixture_kind === "BASIN") return "Basin";
  if (obstacle.fixture_kind === "TOILET") return "WC";
  if (obstacle.fixture_kind === "SHOWER") return "Shower";
  const key = obstacle.representation_key ?? "";
  if (key.startsWith("bath-")) return "Bath";
  if (key.startsWith("basin-")) return "Basin";
  if (key.startsWith("toilet-")) return "WC";
  if (key.startsWith("shower-")) return "Shower";
  if (key.startsWith("kitchen-sink-")) return "Sink";
  if (key.startsWith("plumbing-")) return "Other plumbing";
  return null;
}

function assetPlumbingType(categoryId: string | undefined, subcategory: string | undefined): string | null {
  if (!categoryId) return null;
  const categories: Record<string, string> = { baths: "Bath", basins: "Basin", toilets: "WC", showers: "Shower", plumbing: "Other plumbing", "plumbing-fixtures": "Other plumbing" };
  return categories[categoryId] ?? (categoryId.startsWith("plumbing-") ? (subcategory?.trim() || "Other plumbing") : null);
}

function validOpeningArea(opening: Opening): number | null {
  const width = opening.width?.value, height = opening.height?.value;
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 ? width * height : null;
}

function pointRoom(point: Point2D, sources: PlannerBuildRoomSource[]): PlannerBuildRoomSource | undefined {
  return sources.find((room) => room.vertices.length >= 3 && containsPoint(point, room.vertices));
}

/** Pure deterministic summary over the current saved floorplan/project snapshot. */
export function calculatePlannerBuildMetrics(project: PlannerBuildMetricsProject): PlannerBuildMetrics {
  const sources = roomSources(project);
  const electricalTypes = new Map<string, number>();
  const plumbingTypes = new Map<string, number>();
  const electricalCounts = new Map<string, number>();
  const plumbingCounts = new Map<string, number>();
  const otherFittingCounts = new Map<string, number>();
  const openingsById = new Map<string, Opening>();
  const wallSurfaces: PlannerBuildWallSurfaceMetric[] = [];
  let paintedWallAreaMm2 = 0;
  let hasPaintedWall = false;
  let paintedWallAreaKnown = true;
  let classifiedPlumbingCount = 0;
  let fittingCount = 0;
  let importedAssetCount = 0;

  const roomMetrics = sources.map((room): PlannerBuildRoomMetric => {
    const areaMm2 = polygonAreaMm2(room.vertices);
    const perimeterMm = polygonPerimeterMm(room.vertices);
    const grossWallAreaMm2 = room.wallHeightMm === null ? null : perimeterMm * room.wallHeightMm;
    const roomOpenings = room.openings.filter((opening) => opening.kind === "DOOR" || opening.kind === "WINDOW");
    roomOpenings.forEach((opening) => { if (!openingsById.has(opening.id)) openingsById.set(opening.id, opening); });
    const openingAreaMm2 = roomOpenings.reduce((sum, opening) => sum + (validOpeningArea(opening) ?? 0), 0);
    const netWallAreaMm2 = grossWallAreaMm2 === null ? null : Math.max(0, grossWallAreaMm2 - openingAreaMm2);
    const roomElectrical = room.obstacles.filter((obstacle) => obstacle.representation_key?.startsWith("electrical-") ?? false);
    const roomPlumbing = room.obstacles.filter((obstacle) => plumbingType(obstacle) !== null);
    const roomOther = room.obstacles.filter((obstacle) => !(obstacle.representation_key?.startsWith("electrical-") ?? false) && plumbingType(obstacle) === null);
    electricalCounts.set(room.id, (electricalCounts.get(room.id) ?? 0) + roomElectrical.length);
    plumbingCounts.set(room.id, (plumbingCounts.get(room.id) ?? 0) + roomPlumbing.length);
    otherFittingCounts.set(room.id, (otherFittingCounts.get(room.id) ?? 0) + roomOther.length);
    fittingCount += roomOther.length;
    classifiedPlumbingCount += roomPlumbing.length;
    roomElectrical.forEach((obstacle) => {
      const type = obstacle.subcategory?.trim() || "Other";
      electricalTypes.set(type, (electricalTypes.get(type) ?? 0) + 1);
    });
    roomPlumbing.forEach((obstacle) => {
      const type = plumbingType(obstacle)!;
      plumbingTypes.set(type, (plumbingTypes.get(type) ?? 0) + 1);
    });

    room.vertices.forEach((start, index) => {
      const end = room.vertices[(index + 1) % room.vertices.length];
      const lengthMm = Math.hypot(end.x - start.x, end.y - start.y);
      const wallId = `wall-${String(index + 1).padStart(3, "0")}`;
      const openingsForWall = roomOpenings.filter((opening) => opening.parent_wall_id === wallId);
      const wallOpeningAreaMm2 = openingsForWall.reduce((sum, opening) => sum + (validOpeningArea(opening) ?? 0), 0);
      const grossAreaMm2 = room.wallHeightMm === null ? null : lengthMm * room.wallHeightMm;
      const finishColour = room.finishes?.wall_colors?.[wallId] ?? null;
      const finishName = room.finishes?.wall_color_codes?.[wallId] ?? finishColour;
      if (finishColour) {
        hasPaintedWall = true;
        if (grossAreaMm2 === null) paintedWallAreaKnown = false;
        else paintedWallAreaMm2 += Math.max(0, grossAreaMm2 - wallOpeningAreaMm2);
      }
      wallSurfaces.push({
        id: `${room.id}:${wallId}`,
        roomId: room.id,
        roomName: room.name,
        boundaryIndex: index + 1,
        lengthMm,
        heightMm: room.wallHeightMm,
        grossAreaMm2: grossAreaMm2,
        openingAreaMm2: wallOpeningAreaMm2,
        netAreaMm2: grossAreaMm2 === null ? null : Math.max(0, grossAreaMm2 - wallOpeningAreaMm2),
        finishName,
        finishColour,
      });
    });

    const floorDesign = room.finishes?.floor_design;
    const floorFinish = floorDesign
      ? floorDesign.pattern.startsWith("wood-") ? `Wood · ${floorDesign.wood_id}` : `Tile · ${floorDesign.tile_material_id ?? floorDesign.pattern}`
      : room.finishes?.floor_tile_id ?? null;
    return {
      roomId: room.id,
      name: room.name,
      areaMm2,
      perimeterMm,
      boundaryCount: room.vertices.length,
      grossWallAreaMm2,
      openingAreaMm2,
      netWallAreaMm2,
      doors: roomOpenings.filter((opening) => opening.kind === "DOOR").length,
      windows: roomOpenings.filter((opening) => opening.kind === "WINDOW").length,
      electrical: roomElectrical.length,
      plumbing: roomPlumbing.length,
      otherFittings: roomOther.length,
      floorFinish,
    };
  });

  const definitions = new Map(project.assets.map((asset) => [asset.assetId, asset]));
  const additionalOtherFittings = new Map<string, number>();
  for (const instance of project.assetInstances) {
    const definition = definitions.get(instance.assetId);
    if (!definition) continue;
    importedAssetCount += 1;
    const type = assetPlumbingType(definition.categoryId, definition.subcategory);
    const location = pointRoom({ x: instance.positionMm.x, y: instance.positionMm.y }, sources);
    if (definition.categoryId === "electric") {
      const label = definition.subcategory?.trim() || "Other";
      electricalTypes.set(label, (electricalTypes.get(label) ?? 0) + 1);
      if (location) electricalCounts.set(location.id, (electricalCounts.get(location.id) ?? 0) + 1);
    } else if (type) {
      plumbingTypes.set(type, (plumbingTypes.get(type) ?? 0) + 1);
      classifiedPlumbingCount += 1;
      if (location) plumbingCounts.set(location.id, (plumbingCounts.get(location.id) ?? 0) + 1);
    } else {
      fittingCount += 1;
      if (location) additionalOtherFittings.set(location.id, (additionalOtherFittings.get(location.id) ?? 0) + 1);
    }
  }

  const uniqueSegments = uniqueWallSegments(project, sources);
  const uniqueOpenings = new Map(openingsById);
  for (const opening of project.floorplan?.openings ?? []) {
    if (uniqueOpenings.has(opening.id)) continue;
    const roomOpening = {
      id: opening.id,
      kind: opening.kind,
      parent_wall_id: "",
      offset_mm: 0,
      width: { value: opening.width, uncertainty_mm: 0, verified: false, source_type: "PROJECT" },
      height: { value: opening.height, uncertainty_mm: 0, verified: false, source_type: "PROJECT" },
      sill_height_mm: 0,
    } satisfies Opening;
    uniqueOpenings.set(roomOpening.id, roomOpening);
  }
  const doors = [...uniqueOpenings.values()].filter((opening) => opening.kind === "DOOR");
  const windows = [...uniqueOpenings.values()].filter((opening) => opening.kind === "WINDOW");
  const sumOpeningArea = (items: Opening[]) => {
    const areas = items.map(validOpeningArea);
    return areas.some((area) => area === null) ? null : areas.reduce<number>((sum, area) => sum + area!, 0);
  };

  const activities = project.plannerBuild?.activities ?? [];
  const earliestStart = activities.length ? activities.map((activity) => activity.startDate).sort()[0] : null;
  const latestFinish = activities.length ? activities.map((activity) => activity.endDate).sort().at(-1)! : null;
  const wallAreasKnown = roomMetrics.length > 0 && roomMetrics.every((room) => room.grossWallAreaMm2 !== null);
  const plumbingClassificationAvailable = classifiedPlumbingCount > 0;
  const hasUnclassifiedFittings = fittingCount > 0;
  const projectPlumbingCount = plumbingClassificationAvailable ? classifiedPlumbingCount : hasUnclassifiedFittings ? null : 0;
  const projectRoomsHaveElectrical = sources.reduce((sum, room) => sum + room.obstacles.filter((obstacle) => obstacle.representation_key?.startsWith("electrical-") ?? false).length, 0);
  const totalElectrical = projectRoomsHaveElectrical + project.assetInstances.filter((instance) => definitions.get(instance.assetId)?.categoryId === "electric").length;
  const sumKnown = (values: Array<number | null>) => values.every((value): value is number => value !== null) ? values.reduce((sum, value) => sum + value, 0) : null;

  return {
    summary: {
      roomCount: sources.length,
      totalFloorAreaMm2: roomMetrics.reduce((sum, room) => sum + room.areaMm2, 0),
      totalRoomPerimeterMm: roomMetrics.reduce((sum, room) => sum + room.perimeterMm, 0),
      uniqueWallCount: uniqueSegments.length,
      totalWallLengthMm: uniqueSegments.reduce((sum, wall) => sum + wall.lengthMm, 0),
      grossWallAreaMm2: wallAreasKnown ? roomMetrics.reduce((sum, room) => sum + (room.grossWallAreaMm2 ?? 0), 0) : null,
      netWallAreaMm2: wallAreasKnown ? sumKnown(roomMetrics.map((room) => room.netWallAreaMm2)) : null,
      doorCount: doors.length,
      windowCount: windows.length,
      fittingCount,
      electricalCount: totalElectrical,
      plumbingCount: projectPlumbingCount,
      activityCount: activities.length,
      scheduledDays: earliestStart && latestFinish ? calendarDaysBetween(earliestStart, latestFinish) + 1 : null,
      earliestStart,
      latestFinish,
      completedActivities: activities.filter((activity) => activity.status === "completed").length,
      inProgressActivities: activities.filter((activity) => activity.status === "in_progress").length,
      notStartedActivities: activities.filter((activity) => activity.status === "not_started").length,
    },
    rooms: roomMetrics.map((room) => ({
      ...room,
      electrical: electricalCounts.get(room.roomId) ?? 0,
      plumbing: plumbingClassificationAvailable ? (plumbingCounts.get(room.roomId) ?? 0) : hasUnclassifiedFittings ? null : 0,
      otherFittings: (otherFittingCounts.get(room.roomId) ?? 0) + (additionalOtherFittings.get(room.roomId) ?? 0),
    })),
    wallSurfaces,
    openings: { doors: doors.length, windows: windows.length, doorAreaMm2: sumOpeningArea(doors), windowAreaMm2: sumOpeningArea(windows) },
    electricalByType: [...electricalTypes].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
    plumbingByType: [...plumbingTypes].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
    plumbingClassificationAvailable,
    electricalConnections: project.electricalLayout?.connections.length ?? 0,
    electricalCircuits: project.electricalLayout?.circuits.length ?? 0,
    paintedWallAreaMm2: hasPaintedWall ? paintedWallAreaKnown ? paintedWallAreaMm2 : null : 0,
    floorFinishCount: roomMetrics.filter((room) => room.floorFinish !== null).length,
    importedAssetCount,
  };
}
