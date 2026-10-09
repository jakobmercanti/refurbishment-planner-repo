"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { WindowHelpButton } from "@/components/WindowHelpButton";
import type { CSSProperties, FormEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { ProjectDocument } from "@/lib/projectDocument";
import {
  addCalendarDays, calculatePlannerBuildMetrics, calendarDaysBetween, expectedDeliveryDate, formatDateKey, getPlannerBuildScheduleSummary,
  getPlannerBuildWarnings, isIsoDate, localDateKey, PLANNER_BUILD_ACTIVITY_STATUSES, PLANNER_BUILD_ACTIVITY_TYPES,
  PLANNER_BUILD_CATEGORIES, PLANNER_BUILD_DELIVERY_STATUSES, wouldCreateDependencyCycle, type PlannerBuildActivity,
  type PlannerBuildActivityType,
} from "@/lib/plannerBuild";
import { PLANNER_BUILD_ACTIVITY_LIBRARY, searchPlannerBuildActivityLibrary, type PlannerBuildActivityTemplate } from "@/lib/plannerBuildActivityLibrary";
import type { DisplayUnits } from "@/lib/units";
import { currencySymbol, type CurrencyCode } from "@/lib/appPreferences";
import { formatPlannerBuildArea, formatPlannerBuildLength } from "@/lib/plannerBuildPresentation";
import { ViewToggle } from "@/components/ViewToggle";
import { PlannerBuildDashboard } from "@/components/PlannerBuildDashboard";
import { canAddPlannerActivityInDemo, PLANNER_BUILD_DEMO_MAX_ACTIVITIES } from "@/lib/freeModuleDemo";

export type { PlannerBuildView } from "@/lib/plannerBuildView";
import type { PlannerBuildView } from "@/lib/plannerBuildView";
import dynamic from "next/dynamic";
const QuoteGenerator = dynamic(() => import("@/components/QuoteGenerator").then(module => module.QuoteGenerator));
import type { QuoteDocument } from "@/lib/quoteDocument";
interface Props { project: ProjectDocument; view: PlannerBuildView; displayUnits: DisplayUnits; defaultCurrency?: CurrencyCode; onQuotesChange: (quotes: QuoteDocument[]) => void; onActivitiesChange: (activities: PlannerBuildActivity[]) => void; demoMode?: boolean; onDemoLimitReached?: () => void }
type ActivityDraft = {
  activityId: string | null; name: string; startDate: string; endDate: string; colour: string; category: string;
  roomId: string; progress: number; notes: string; type: PlannerBuildActivityType; status: PlannerBuildActivity["status"];
  dependencyIds: string[]; trade: string; supplier: string; orderDate: string; leadTimeDays: string;
  expectedDeliveryDate: string; actualDeliveryDate: string; orderReference: string;
  deliveryStatus: NonNullable<PlannerBuildActivity["deliveryStatus"]>; decisionDeadline: string;
  inspectionStatus: NonNullable<PlannerBuildActivity["inspectionStatus"]>; paymentDueDate: string;
  amount: string; currency: string; paymentStatus: NonNullable<PlannerBuildActivity["paymentStatus"]>;
  estimatedCost: string; actualCost: string; isBlocking: boolean; blockedReason: string;
  actualStartDate: string; actualEndDate: string;
};
type GanttScale = "DAY" | "WEEK" | "MONTH";
type DragKind = "MOVE" | "START" | "END";
type GanttGrouping = "NONE" | "CATEGORY" | "ROOM" | "TRADE";
type GanttEntry = { kind: "GROUP"; key: string; label: string } | { kind: "ACTIVITY"; activity: PlannerBuildActivity };
type DragState = { activityId: string; kind: DragKind; pointerId: number; originX: number; startDate: string; endDate: string };
type ActivityRange = { activityId: string; startDate: string; endDate: string };
type ActivityContextMenu = { activityId: string; x: number; y: number };
const COLOUR_PRESETS = ["#2563EB", "#EA580C", "#0F766E", "#C026D3", "#65A30D", "#DC2626", "#0891B2", "#7C3AED", "#B45309", "#DB2777", "#15803D", "#475569"];
const SCALE_DAY_WIDTH: Record<GanttScale, number> = { DAY: 42, WEEK: 18, MONTH: 5 };
const LABEL_WIDTH = 290;
const EMPTY_ACTIVITIES: PlannerBuildActivity[] = [];

function newDraft(activity?: PlannerBuildActivity, template?: PlannerBuildActivityTemplate, defaultCurrency: CurrencyCode = "GBP"): ActivityDraft {
  return {
    activityId: activity?.activityId ?? null, name: activity?.name ?? template?.name ?? "",
    startDate: activity?.startDate ?? "", endDate: activity?.endDate ?? "", colour: activity?.colour ?? template?.colour ?? COLOUR_PRESETS[0],
    actualStartDate: activity?.actualStartDate ?? "", actualEndDate: activity?.actualEndDate ?? "",
    category: activity?.category ?? template?.category ?? "", roomId: activity?.roomId ?? "", progress: activity?.progress ?? 0,
    notes: activity?.notes ?? "", type: activity?.type ?? template?.type ?? "task",
    status: activity?.status ?? "not_started", dependencyIds: activity?.dependencyIds ?? [], trade: activity?.trade ?? template?.trade ?? "",
    supplier: activity?.supplier ?? "", orderDate: activity?.orderDate ?? "", leadTimeDays: activity?.leadTimeDays?.toString() ?? "",
    expectedDeliveryDate: activity?.expectedDeliveryDate ?? "", actualDeliveryDate: activity?.actualDeliveryDate ?? "",
    orderReference: activity?.orderReference ?? "", deliveryStatus: activity?.deliveryStatus ?? "not_ordered",
    decisionDeadline: activity?.decisionDeadline ?? "", inspectionStatus: activity?.inspectionStatus ?? "pending",
    paymentDueDate: activity?.paymentDueDate ?? "", amount: activity?.amount?.toString() ?? "", currency: activity?.currency ?? defaultCurrency,
    paymentStatus: activity?.paymentStatus ?? "unpaid", estimatedCost: activity?.estimatedCost?.toString() ?? "",
    actualCost: activity?.actualCost?.toString() ?? "", isBlocking: activity?.isBlocking ?? false, blockedReason: activity?.blockedReason ?? "",
  };
}
function stableId() { return globalThis.crypto?.randomUUID?.() ?? `activity-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
function progressLabel(activity: PlannerBuildActivity) { return activity.status.replaceAll("_", " "); }
function activityTypeLabel(type: PlannerBuildActivityType) { return type[0].toUpperCase() + type.slice(1); }
function activityTypeMark(type: PlannerBuildActivityType, currency: string = "GBP") {
  return type === "payment" ? currencySymbol(currency) : ({ milestone: "◆", delivery: "↓", inspection: "✓", decision: "?", waiting: "Ⅱ", appointment: "◷" } as Partial<Record<PlannerBuildActivityType, string>>)[type] ?? "•";
}

export function PlannerBuildWorkspace({ project, view, onQuotesChange, onActivitiesChange, defaultCurrency = "GBP", demoMode = false, onDemoLimitReached }: Props) {
  const activities = project.plannerBuild?.activities ?? EMPTY_ACTIVITIES;
  const rooms = project.rooms;
  const metrics = useMemo(() => calculatePlannerBuildMetrics(project), [project]);
  const [draft, setDraft] = useState<ActivityDraft | null>(null);
  const [formError, setFormError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scale, setScale] = useState<GanttScale>("WEEK");
  const [roomFilter, setRoomFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [tradeFilter, setTradeFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [grouping, setGrouping] = useState<GanttGrouping>("CATEGORY");
  const [showDependencyArrows, setShowDependencyArrows] = useState(true);
  const [addStep, setAddStep] = useState<"CHOICE" | "LIBRARY" | null>(null);
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryCategory, setLibraryCategory] = useState("ALL");
  const [past, setPast] = useState<PlannerBuildActivity[][]>([]);
  const [future, setFuture] = useState<PlannerBuildActivity[][]>([]);
  const [activityContextMenu, setActivityContextMenu] = useState<ActivityContextMenu | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [previewRange, setPreviewRange] = useState<ActivityRange | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const previewRef = useRef<ActivityRange | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!draft && !addStep) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setDraft(null); setAddStep(null); setFormError(""); } };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [draft, addStep]);

  useEffect(() => {
    if (!activityContextMenu) return;
    const dismissOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".pb-activity-context-menu")) return;
      setActivityContextMenu(null);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setActivityContextMenu(null);
    };
    const dismissOnBlur = () => setActivityContextMenu(null);
    window.addEventListener("pointerdown", dismissOnOutsidePointer);
    window.addEventListener("keydown", dismissOnEscape);
    window.addEventListener("blur", dismissOnBlur);
    return () => {
      window.removeEventListener("pointerdown", dismissOnOutsidePointer);
      window.removeEventListener("keydown", dismissOnEscape);
      window.removeEventListener("blur", dismissOnBlur);
    };
  }, [activityContextMenu]);

  function commitActivities(next: PlannerBuildActivity[]) {
    setPast((items) => [...items.slice(-39), activities]);
    setFuture([]);
    onActivitiesChange(next);
  }
  function undo() {
    const previous = past.at(-1); if (!previous) return;
    setPast((items) => items.slice(0, -1)); setFuture((items) => [activities, ...items].slice(0, 40)); onActivitiesChange(previous);
  }
  function redo() {
    const next = future[0]; if (!next) return;
    setFuture((items) => items.slice(1)); setPast((items) => [...items.slice(-39), activities]); onActivitiesChange(next);
  }
  function openEditor(activity?: PlannerBuildActivity) { setSelectedId(activity?.activityId ?? null); setDraft(newDraft(activity, undefined, defaultCurrency)); setAddStep(null); setFormError(""); }
  function startAdd() {
    if (!canAddPlannerActivityInDemo(demoMode, activities.length)) { onDemoLimitReached?.(); return; }
    setAddStep("CHOICE"); setLibrarySearch(""); setLibraryCategory("ALL"); setFormError("");
  }
  function openCustomDraft() { setAddStep(null); setDraft(newDraft(undefined, undefined, defaultCurrency)); setSelectedId(null); setFormError(""); }
  function openDeliveryDraft() {
    if (!canAddPlannerActivityInDemo(demoMode, activities.length)) { onDemoLimitReached?.(); return; }
    setAddStep(null); setDraft({ ...newDraft(undefined, undefined, defaultCurrency), type: "delivery", category: "PROCUREMENT" }); setSelectedId(null); setFormError("");
  }
  function openTemplateDraft(template: PlannerBuildActivityTemplate) { setAddStep(null); setDraft(newDraft(undefined, template, defaultCurrency)); setSelectedId(null); setFormError(""); }
  function saveActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!draft) return;
    if (!draft.name.trim()) { setFormError("Enter an activity name."); return; }
    const eventOnly = ["milestone", "delivery", "inspection", "decision", "appointment", "payment"].includes(draft.type);
    const startDate = eventOnly ? draft.startDate || draft.endDate : draft.startDate;
    const endDate = eventOnly ? startDate : draft.endDate;
    if (!isIsoDate(startDate) || !isIsoDate(endDate)) { setFormError(eventOnly ? "Choose a valid date." : "Choose valid start and end dates."); return; }
    if (calendarDaysBetween(startDate, endDate) < 0) { setFormError("The end date must be on or after the start date."); return; }
    if ([draft.actualStartDate, draft.actualEndDate].some((date) => date && (!isIsoDate(date) || date > localDateKey()))) { setFormError("Actual dates must be valid dates on or before today."); return; }
    if (draft.actualStartDate && draft.actualEndDate && draft.actualEndDate < draft.actualStartDate) { setFormError("Actual finish must be on or after actual start."); return; }
    if (draft.leadTimeDays && (!Number.isInteger(Number(draft.leadTimeDays)) || Number(draft.leadTimeDays) < 0 || Number(draft.leadTimeDays) > 3650)) { setFormError("Lead time must be a whole number of days from 0 to 3650."); return; }
    const optionalMoney = (value: string) => value.trim() ? Number(value) : undefined;
    const amount = optionalMoney(draft.amount), estimatedCost = optionalMoney(draft.estimatedCost), actualCost = optionalMoney(draft.actualCost);
    if ([amount, estimatedCost, actualCost].some((value) => value !== undefined && (!Number.isFinite(value) || value < 0))) { setFormError("Amounts and costs must be zero or greater."); return; }
    const activityId = draft.activityId ?? stableId();
    const dependencies = [...new Set(draft.dependencyIds)].filter((id) => id !== activityId);
    if (dependencies.length !== draft.dependencyIds.length) { setFormError("A dependency cannot point to the same activity twice or to itself."); return; }
    if (dependencies.some((id) => wouldCreateDependencyCycle(activities, activityId, id))) { setFormError("That dependency would create a circular schedule."); return; }
    const existing = activities.find((item) => item.activityId === draft.activityId);
    if (!existing && !canAddPlannerActivityInDemo(demoMode, activities.length)) {
      setDraft(null);
      onDemoLimitReached?.();
      return;
    }
    const savedStatus = draft.actualEndDate ? "completed" : draft.status;
    const item: PlannerBuildActivity = {
      activityId, name: draft.name.trim().slice(0, 200), startDate, endDate,
      ...(draft.actualStartDate ? { actualStartDate: draft.actualStartDate } : {}),
      ...(draft.actualEndDate ? { actualEndDate: draft.actualEndDate } : {}),
      colour: draft.colour.toUpperCase(), ...(draft.category ? { category: draft.category } : {}), roomId: draft.roomId || null,
      progress: savedStatus === "completed" ? 100 : Math.max(0, Math.min(100, Math.round(draft.progress))),
      type: draft.type, status: savedStatus, dependencyIds: dependencies,
      ...(draft.trade.trim() ? { trade: draft.trade.trim().slice(0, 100) } : {}),
      ...(draft.notes.trim() ? { notes: draft.notes.trim().slice(0, 5000) } : {}),
      ...(draft.supplier.trim() ? { supplier: draft.supplier.trim().slice(0, 200) } : {}),
      ...(draft.orderDate ? { orderDate: draft.orderDate } : {}),
      ...(draft.leadTimeDays ? { leadTimeDays: Number(draft.leadTimeDays) } : {}),
      ...(draft.expectedDeliveryDate ? { expectedDeliveryDate: draft.expectedDeliveryDate } : {}),
      ...(draft.actualDeliveryDate ? { actualDeliveryDate: draft.actualDeliveryDate } : {}),
      ...(draft.orderReference.trim() ? { orderReference: draft.orderReference.trim().slice(0, 160) } : {}),
      ...(draft.type === "delivery" || draft.category === "PROCUREMENT" ? { deliveryStatus: draft.deliveryStatus } : {}),
      ...(draft.decisionDeadline ? { decisionDeadline: draft.decisionDeadline } : {}),
      ...(draft.type === "inspection" ? { inspectionStatus: draft.inspectionStatus } : {}),
      ...(draft.paymentDueDate ? { paymentDueDate: draft.paymentDueDate } : {}),
      ...(amount !== undefined ? { amount, currency: (draft.currency || defaultCurrency).toUpperCase().slice(0, 3) } : {}),
      ...(draft.type === "payment" ? { paymentStatus: draft.paymentStatus } : {}),
      ...(estimatedCost !== undefined ? { estimatedCost, currency: (draft.currency || defaultCurrency).toUpperCase().slice(0, 3) } : {}),
      ...(actualCost !== undefined ? { actualCost, currency: (draft.currency || defaultCurrency).toUpperCase().slice(0, 3) } : {}),
      ...(savedStatus === "blocked" ? { isBlocking: draft.isBlocking, ...(draft.blockedReason.trim() ? { blockedReason: draft.blockedReason.trim().slice(0, 1000) } : {}) } : {}),
      sortOrder: existing?.sortOrder ?? activities.reduce((max, current) => Math.max(max, current.sortOrder), -1) + 1,
    };
    commitActivities(existing ? activities.map((current) => current.activityId === existing.activityId ? item : current) : [...activities, item]);
    setSelectedId(item.activityId); setDraft(null);
  }
  function deleteActivity() {
    if (!draft?.activityId) return;
    commitActivities(activities.filter((item) => item.activityId !== draft.activityId).map((item) => ({ ...item, dependencyIds: item.dependencyIds.filter((id) => id !== draft.activityId) }))); setSelectedId(null); setDraft(null);
  }
  function openActivityContextMenu(event: ReactMouseEvent<HTMLButtonElement>, activity: PlannerBuildActivity) {
    event.preventDefault();
    setSelectedId(activity.activityId);
    setActivityContextMenu({
      activityId: activity.activityId,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 184)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 112)),
    });
  }
  function duplicateActivity(activityId: string) {
    const original = activities.find((item) => item.activityId === activityId);
    setActivityContextMenu(null);
    if (!original) return;
    if (!canAddPlannerActivityInDemo(demoMode, activities.length)) { onDemoLimitReached?.(); return; }
    let copyNumber = 1;
    let name = "";
    do {
      const suffix = copyNumber === 1 ? " (copy)" : ` (copy ${copyNumber})`;
      name = `${original.name.slice(0, 200 - suffix.length)}${suffix}`;
      copyNumber += 1;
    } while (activities.some((item) => item.name === name));
    const activityIdForCopy = stableId();
    const duplicate: PlannerBuildActivity = {
      ...original,
      activityId: activityIdForCopy,
      name,
      dependencyIds: [...original.dependencyIds],
      sortOrder: activities.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1,
    };
    commitActivities([...activities, duplicate]);
    setSelectedId(activityIdForCopy);
  }
  function deleteActivityById(activityId: string) {
    if (!activities.some((item) => item.activityId === activityId)) return;
    commitActivities(activities.filter((item) => item.activityId !== activityId).map((item) => ({ ...item, dependencyIds: item.dependencyIds.filter((id) => id !== activityId) })));
    setSelectedId((current) => current === activityId ? null : current);
    setActivityContextMenu(null);
  }

  const sortedActivities = useMemo(() => [...activities].sort((a, b) => a.sortOrder - b.sortOrder || a.activityId.localeCompare(b.activityId)), [activities]);
  const visibleActivities = sortedActivities.filter((item) =>
    (roomFilter === "ALL" || (item.roomId ?? "") === roomFilter) &&
    (categoryFilter === "ALL" || (item.category ?? "") === categoryFilter) &&
    (tradeFilter === "ALL" || (item.trade ?? "") === tradeFilter) &&
    (typeFilter === "ALL" || item.type === typeFilter) &&
    (statusFilter === "ALL" || item.status === statusFilter),
  );
  const categories = [...new Set(sortedActivities.map((item) => item.category).filter((value): value is string => Boolean(value)))];
  const trades = [...new Set(sortedActivities.map((item) => item.trade).filter((value): value is string => Boolean(value)))];
  const filteredTemplates = useMemo(() => searchPlannerBuildActivityLibrary(librarySearch, libraryCategory), [librarySearch, libraryCategory]);
  const scheduleWarnings = useMemo(() => getPlannerBuildWarnings(activities), [activities]);
  const dependencyWarningIds = useMemo(() => {
    const edgeIds = new Set(activities.flatMap((activity) => activity.dependencyIds.map((dependencyId) => `${activity.activityId}:${dependencyId}`)));
    return new Set(scheduleWarnings.filter((warning) => edgeIds.has(warning.warningId)).map((warning) => warning.warningId));
  }, [activities, scheduleWarnings]);
  const ganttEntries = useMemo<GanttEntry[]>(() => {
    if (grouping === "NONE") return visibleActivities.map((activity) => ({ kind: "ACTIVITY", activity }));
    const result: GanttEntry[] = [];
    const groups = new Map<string, PlannerBuildActivity[]>();
    const labelFor = (activity: PlannerBuildActivity) => grouping === "CATEGORY" ? activity.category || "Uncategorised"
      : grouping === "ROOM" ? rooms.find((room) => room.id === activity.roomId)?.name ?? (activity.roomId ? "Room unavailable" : "All project")
        : activity.trade || "Unassigned";
    visibleActivities.forEach((activity) => {
      const label = labelFor(activity);
      groups.set(label, [...(groups.get(label) ?? []), activity]);
    });
    for (const [label, grouped] of groups) {
      result.push({ kind: "GROUP", key: label, label });
      result.push(...grouped.map((activity) => ({ kind: "ACTIVITY" as const, activity })));
    }
    return result;
  }, [visibleActivities, grouping, rooms]);
  const activityTop = useMemo(() => {
    let top = 0;
    const offsets = new Map<string, number>();
    for (const entry of ganttEntries) {
      if (entry.kind === "GROUP") top += 29;
      else { offsets.set(entry.activity.activityId, top); top += 52; }
    }
    return { offsets, height: top };
  }, [ganttEntries]);
  const starts = activities.map((item) => item.startDate).sort();
  const ends = activities.map((item) => item.endDate).sort();
  const today = localDateKey();
  const projectStart = project.plannerBuild?.projectStartDate;
  const projectEnd = project.plannerBuild?.targetCompletionDate;
  const initialStart = starts[0] && projectStart ? (projectStart < starts[0] ? projectStart : starts[0]) : projectStart ?? starts[0] ?? today;
  const initialEnd = ends.at(-1) && projectEnd ? (projectEnd > ends.at(-1)! ? projectEnd : ends.at(-1)!) : projectEnd ?? ends.at(-1) ?? today;
  const timelineStart = activities.length ? addCalendarDays(initialStart, -7) : today;
  const timelineEnd = activities.length ? addCalendarDays(initialEnd, 7) : today;
  const totalDays = activities.length ? Math.max(1, calendarDaysBetween(timelineStart, timelineEnd) + 1) : 1;
  const dayWidth = SCALE_DAY_WIDTH[scale];
  const timelineWidth = Math.max(560, totalDays * dayWidth);
  const todayOffset = calendarDaysBetween(timelineStart, today);
  const todayVisible = activities.length > 0 && todayOffset >= 0 && todayOffset < totalDays;
  const timelineStyle = { "--pb-label-width": `${LABEL_WIDTH}px`, "--pb-timeline-width": `${timelineWidth}px`, "--pb-day-width": `${dayWidth}px` } as CSSProperties;
  const ticks = useMemo(() => {
    const result: Array<{ offset: number; label: string }> = [];
    const step = scale === "DAY" ? (totalDays > 120 ? 7 : 1) : scale === "WEEK" ? 7 : 1;
    for (let offset = 0; offset < totalDays; offset += 1) {
      const date = addCalendarDays(timelineStart, offset);
      if (scale === "MONTH" && offset !== 0 && !date.endsWith("-01")) continue;
      if (scale !== "MONTH" && offset % step !== 0) continue;
      result.push({ offset, label: formatDateKey(date, scale === "MONTH" ? { month: "short", year: "numeric" } : { day: "numeric", month: "short" }) });
    }
    return result;
  }, [scale, timelineStart, totalDays]);

  function scrollToToday() {
    const element = scrollRef.current; if (!element || !todayVisible) return;
    const labelWidth = element.querySelector<HTMLElement>(".pb-gantt-header-label")?.offsetWidth ?? LABEL_WIDTH;
    element.scrollTo({ left: Math.max(0, labelWidth + (todayOffset + 0.5) * dayWidth - element.clientWidth / 2), behavior: "smooth" });
  }
  function beginDrag(event: ReactPointerEvent<HTMLElement>, activity: PlannerBuildActivity, kind: DragKind) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture may be unavailable in embedded browsers. */ }
    const state: DragState = { activityId: activity.activityId, kind, pointerId: event.pointerId, originX: event.clientX, startDate: activity.startDate, endDate: activity.endDate };
    const initial = { activityId: activity.activityId, startDate: activity.startDate, endDate: activity.endDate };
    dragRef.current = state; previewRef.current = initial; setDrag(state); setPreviewRange(initial); setSelectedId(activity.activityId);
  }
  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragRef.current; if (!state || state.pointerId !== event.pointerId) return;
    const days = Math.round((event.clientX - state.originX) / dayWidth);
    let startDate = state.startDate, endDate = state.endDate;
    if (state.kind === "MOVE") { startDate = addCalendarDays(startDate, days); endDate = addCalendarDays(endDate, days); }
    else if (state.kind === "START") { const next = addCalendarDays(startDate, days); startDate = calendarDaysBetween(next, endDate) < 0 ? endDate : next; }
    else { const next = addCalendarDays(endDate, days); endDate = calendarDaysBetween(startDate, next) < 0 ? startDate : next; }
    const range = { activityId: state.activityId, startDate, endDate }; previewRef.current = range; setPreviewRange(range);
  }
  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragRef.current, range = previewRef.current; if (!state || state.pointerId !== event.pointerId) return;
    if (range && (range.startDate !== state.startDate || range.endDate !== state.endDate)) commitActivities(activities.map((item) => item.activityId === state.activityId ? { ...item, startDate: range.startDate, endDate: range.endDate } : item));
    dragRef.current = null; previewRef.current = null; setDrag(null); setPreviewRange(null);
  }

  const rendered = <><div hidden={view !== "GANTT"}>
    <section className="planner-build-gantt" aria-label="Project programme Gantt view">
      <div className="pb-view-heading"><div><span className="pb-eyebrow">PlannerBuild · Programme</span><h1>Project programme</h1><p>Plan and update the timing of work in this project.</p></div></div>
      <div className="pb-gantt-toolbar">
        <button type="button" className="pb-primary-button" onClick={startAdd}>＋ Activity</button>
        <button type="button" className="pb-secondary-button" disabled={!todayVisible} onClick={scrollToToday}>Today</button>
        <label><span>Zoom</span><select value={scale} onChange={(event) => setScale(event.target.value as GanttScale)}><option value="DAY">Day</option><option value="WEEK">Week</option><option value="MONTH">Month</option></select></label>
        <label><span>Group by</span><select value={grouping} onChange={(event) => setGrouping(event.target.value as GanttGrouping)}><option value="CATEGORY">Phase</option><option value="ROOM">Room</option><option value="TRADE">Trade</option><option value="NONE">No grouping</option></select></label>
        <ViewToggle label="Dependencies" active={showDependencyArrows} onToggle={() => setShowDependencyArrows((current) => !current)} />
        <details className="pb-filter-details"><summary>Filters</summary><div>
          <label><span>Room</span><select value={roomFilter} onChange={(event) => setRoomFilter(event.target.value)}><option value="ALL">All rooms</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name || "Unnamed room"}</option>)}</select></label>
          <label><span>Phase</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="ALL">All phases</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
          <label><span>Trade</span><select value={tradeFilter} onChange={(event) => setTradeFilter(event.target.value)}><option value="ALL">All trades</option>{trades.map((trade) => <option key={trade} value={trade}>{trade}</option>)}</select></label>
          <label><span>Type</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="ALL">All types</option>{PLANNER_BUILD_ACTIVITY_TYPES.map((type) => <option key={type} value={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}</select></label>
          <label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">All statuses</option>{PLANNER_BUILD_ACTIVITY_STATUSES.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label>
        </div></details>
        <div className="pb-history-actions" aria-label="Schedule history"><button type="button" disabled={!past.length} onClick={undo}>Undo</button><button type="button" disabled={!future.length} onClick={redo}>Redo</button></div>
      </div>
      {scheduleWarnings.length > 0 && <div className="pb-schedule-warnings" role="status"><strong>Schedule checks</strong>{scheduleWarnings.slice(0, 3).map((warning) => <span key={warning.warningId} className={`pb-schedule-warning ${warning.severity}`}>{warning.message}</span>)}{scheduleWarnings.length > 3 && <small>and {scheduleWarnings.length - 3} more</small>}</div>}
      {!activities.length ? <div className="pb-empty-state"><span className="pb-empty-icon" aria-hidden="true">▤</span><h2>No activities yet</h2><p>Add activities to build a project programme alongside your floorplan.</p><button type="button" className="pb-primary-button" onClick={startAdd}>Add first activity</button></div>
      : !visibleActivities.length ? <div className="pb-empty-state"><h2>No matching activities</h2><p>Change the filters to see more of the schedule.</p></div>
      : <div className="pb-gantt-scroll" ref={scrollRef} aria-label="Scrollable Gantt schedule">
        <div className="pb-gantt-grid" style={timelineStyle} role="table" aria-label="Project activity schedule">
          <div className="pb-gantt-header" role="row"><div className="pb-gantt-header-label" role="columnheader">Activity <span>Start · End</span></div>
            <div className="pb-gantt-timeline-head" role="columnheader" style={{ width: timelineWidth, backgroundSize: `${dayWidth}px 100%` }}>
              {ticks.map((tick) => <span key={tick.offset} style={{ left: tick.offset * dayWidth }}>{tick.label}</span>)}
              {todayVisible && <i className="pb-today-head-marker" style={{ left: (todayOffset + 0.5) * dayWidth }} title="Today" />}
            </div>
          </div>
          <div className="pb-gantt-body" style={{ minHeight: activityTop.height }} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
            {showDependencyArrows && <svg className="pb-gantt-dependencies" aria-hidden="true" width={timelineWidth} height={activityTop.height} viewBox={"0 0 " + timelineWidth + " " + activityTop.height}>
              <defs>
                <marker id="pb-dependency-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" /></marker>
                <marker id="pb-dependency-arrow-conflict" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" /></marker>
              </defs>
              {visibleActivities.flatMap((activity) => activity.dependencyIds.flatMap((dependencyId) => {
                const prerequisite = visibleActivities.find((candidate) => candidate.activityId === dependencyId);
                const fromTop = activityTop.offsets.get(dependencyId), toTop = activityTop.offsets.get(activity.activityId);
                if (!prerequisite || fromTop === undefined || toTop === undefined) return [];
                const sourceShown = previewRange?.activityId === dependencyId ? previewRange : prerequisite;
                const targetShown = previewRange?.activityId === activity.activityId ? previewRange : activity;
                const fromX = (calendarDaysBetween(timelineStart, sourceShown.endDate) + 1) * dayWidth - 2;
                const toX = calendarDaysBetween(timelineStart, targetShown.startDate) * dayWidth + 2;
                const fromY = fromTop + 26, toY = toTop + 26, bend = Math.max(16, Math.abs(toX - fromX) * .4);
                const edgeId = activity.activityId + ":" + dependencyId;
                const hasConflict = dependencyWarningIds.has(edgeId);
                return [<path key={edgeId} className={`pb-dependency-path${hasConflict ? " conflict" : ""}`} d={"M " + fromX + " " + fromY + " C " + (fromX + bend) + " " + fromY + ", " + (toX - bend) + " " + toY + ", " + toX + " " + toY} markerEnd={hasConflict ? "url(#pb-dependency-arrow-conflict)" : "url(#pb-dependency-arrow)"} />];
              }))}
            </svg>}
            {ganttEntries.map((entry) => {
              if (entry.kind === "GROUP") return <div className="pb-gantt-group-row" key={"group:" + entry.key} style={{ gridColumn: "1 / -1" }}><strong>{entry.label}</strong></div>;
              const activity = entry.activity;
              const shown = previewRange?.activityId === activity.activityId ? previewRange : activity;
              const left = calendarDaysBetween(timelineStart, shown.startDate) * dayWidth;
              const width = Math.max(14, (calendarDaysBetween(shown.startDate, shown.endDate) + 1) * dayWidth - Math.max(2, Math.min(6, dayWidth / 5)));
              const selected = selectedId === activity.activityId;
              const isEvent = activity.type !== "task" && activity.type !== "waiting";
              return <div className={`pb-gantt-row ${selected ? "selected" : ""}`} key={activity.activityId} role="row">
                <div className="pb-gantt-activity-cell" role="rowheader">
                  <button type="button" className="pb-activity-name" onClick={() => setSelectedId(activity.activityId)} onDoubleClick={() => openEditor(activity)} onContextMenu={(event) => openActivityContextMenu(event, activity)} aria-label={activity.name + ", " + progressLabel(activity) + ". " + activityTypeLabel(activity.type) + ". Double-click to edit."}><strong><i className={"pb-type-mark type-" + activity.type} aria-hidden="true">{activityTypeMark(activity.type, activity.currency ?? defaultCurrency)}</i>{activity.name}</strong><span>{formatDateKey(activity.startDate, { day: "2-digit", month: "short" })} – {formatDateKey(activity.endDate, { day: "2-digit", month: "short" })} · {progressLabel(activity)}</span></button>
                  <button type="button" className="pb-edit-activity" onClick={() => openEditor(activity)} aria-label={`Edit ${activity.name}`} title="Edit activity">···</button>
                </div>
                <div className="pb-gantt-lane" role="cell" style={{ width: timelineWidth, backgroundSize: `${dayWidth}px 100%` }}>
                  <div className={`pb-gantt-bar status-${activity.status} ${isEvent ? "event-type-" + activity.type : ""} ${selected ? "selected" : ""} ${drag?.activityId === activity.activityId ? "dragging" : ""}`} style={{ left, width, backgroundColor: activity.colour }} role="group" aria-label={activity.name + ": " + formatDateKey(shown.startDate) + " to " + formatDateKey(shown.endDate) + ", " + activityTypeLabel(activity.type) + ", " + activity.progress + "% complete, " + progressLabel(activity)} tabIndex={0} onPointerDown={(event) => beginDrag(event, activity, "MOVE")} onClick={() => setSelectedId(activity.activityId)} onDoubleClick={() => openEditor(activity)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openEditor(activity); } }} title={activity.name + " - " + activity.progress + "% · drag to move · double-click to edit"}>
                    <span className="pb-gantt-progress" style={{ width: activity.progress + "%" }} />{isEvent ? <span className="pb-gantt-event-mark" aria-hidden="true">{activityTypeMark(activity.type, activity.currency ?? defaultCurrency)}</span> : width > 76 && <span className="pb-gantt-bar-label" aria-hidden="true"><span className="pb-gantt-bar-name">{activity.name}</span><span className="pb-gantt-bar-progress-label">- {activity.progress}%</span></span>}
                    {!isEvent && <><button type="button" className="pb-gantt-resize pb-gantt-resize-start" aria-label={"Change start date for " + activity.name} onPointerDown={(event) => beginDrag(event, activity, "START")} /><button type="button" className="pb-gantt-resize pb-gantt-resize-end" aria-label={"Change end date for " + activity.name} onPointerDown={(event) => beginDrag(event, activity, "END")} /></>}
                  </div>
                </div>
              </div>;
            })}
            {todayVisible && <div className="pb-today-line" style={{ left: `calc(var(--pb-label-width) + ${(todayOffset + 0.5) * dayWidth}px)` }} aria-hidden="true" />}
          </div>
        </div>
      </div>}
    </section>
  </div><div hidden={view !== "DASHBOARD"}><PlannerBuildTable project={project} metrics={metrics} defaultCurrency={defaultCurrency} onEditActivity={openEditor} onAddActivity={startAdd} onAddDelivery={openDeliveryDraft} historyActions={<div className="pb-history-actions" aria-label="Schedule history"><button type="button" disabled={!past.length} onClick={undo}>Undo</button><button type="button" disabled={!future.length} onClick={redo}>Redo</button></div>} /></div>
      {addStep && <div className="pb-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAddStep(null); }}>
        {addStep === "CHOICE" ? <section className="pb-library-dialog" role="dialog" aria-modal="true" aria-labelledby="pb-add-choice-title">
          <header><div><span className="pb-eyebrow">PlannerBuild · Schedule</span><h2 id="pb-add-choice-title">Add activity</h2></div><div className="window-header-actions"><WindowHelpButton title="Add activity" /><button type="button" className="pb-close-button" aria-label="Close" onClick={() => setAddStep(null)}>×</button></div></header>
          <div className="pb-add-choice">
            <button type="button" className="pb-add-choice-card" onClick={openCustomDraft}><strong>Create custom activity</strong><span>Start with a blank schedule item.</span></button>
            <button type="button" className="pb-add-choice-card" onClick={() => setAddStep("LIBRARY")}><strong>Choose from activity library</strong><span>Browse common renovation work, one activity at a time.</span><b>{PLANNER_BUILD_ACTIVITY_LIBRARY.length} templates</b></button>
          </div>
        </section> : <section className="pb-library-dialog" role="dialog" aria-modal="true" aria-labelledby="pb-library-title">
          <header><div><span className="pb-eyebrow">PlannerBuild · Activity library</span><h2 id="pb-library-title">Choose a template</h2></div><div className="window-header-actions"><WindowHelpButton title="Activity templates" /><button type="button" className="pb-close-button" aria-label="Close activity library" onClick={() => setAddStep(null)}>×</button></div></header>
          <div className="pb-library-controls"><label className="pb-field"><span>Search activities</span><input autoFocus type="search" value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} placeholder="Try “plastering” or “windows”" /></label><label className="pb-field"><span>Phase</span><select value={libraryCategory} onChange={(event) => setLibraryCategory(event.target.value)}><option value="ALL">All phases</option>{PLANNER_BUILD_CATEGORIES.map((category) => <option value={category} key={category}>{category}</option>)}</select></label></div>
          <div className="pb-library-results" role="list" aria-label="Activity templates">{filteredTemplates.map((template) => <button type="button" role="listitem" key={template.id} className="pb-library-template" onClick={() => openTemplateDraft(template)}><i style={{ backgroundColor: template.colour }} /><span><strong>{template.name}</strong><small>{template.category}{template.trade ? " · " + template.trade : ""}</small></span><em>{activityTypeLabel(template.type)}</em></button>)}{!filteredTemplates.length && <p className="pb-table-note">No templates match that search.</p>}</div>
          <footer><button type="button" className="pb-secondary-button" onClick={() => setAddStep("CHOICE")}>Back</button><button type="button" className="pb-secondary-button" onClick={openCustomDraft}>Create custom instead</button></footer>
        </section>}
      </div>}
      {draft && <div className="pb-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setDraft(null); setFormError(""); } }}>
        <section className="pb-activity-dialog" role="dialog" aria-modal="true" aria-labelledby="pb-activity-dialog-title">
          <header><div><span className="pb-eyebrow">PlannerBuild · Schedule</span><h2 id="pb-activity-dialog-title">{draft.activityId ? "Edit activity" : "Add activity"}</h2></div><div className="window-header-actions"><WindowHelpButton title={draft.activityId ? "Edit activity" : "Add activity"} /><button type="button" className="pb-close-button" aria-label="Close activity editor" onClick={() => { setDraft(null); setFormError(""); }}>×</button></div></header>
          <form onSubmit={saveActivity}>
            <label className="pb-field"><span>Activity name <b>*</b></span><input autoFocus maxLength={200} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. Electrical first fix" /></label>
            <div className="pb-field-grid"><label className="pb-field"><span>Activity type</span><select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as PlannerBuildActivityType })}>{PLANNER_BUILD_ACTIVITY_TYPES.map((type) => <option key={type} value={type}>{activityTypeLabel(type)}</option>)}</select></label><label className="pb-field"><span>Status</span><select value={draft.status} onChange={(event) => { const status = event.target.value as PlannerBuildActivity["status"]; const progress = status === "completed" ? 100 : status === "not_started" ? 0 : status === "in_progress" && draft.progress >= 100 ? 50 : draft.progress; setDraft({ ...draft, status, progress }); }}>{PLANNER_BUILD_ACTIVITY_STATUSES.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label></div>
            {["milestone", "delivery", "inspection", "decision", "appointment", "payment"].includes(draft.type)
              ? <label className="pb-field"><span>{activityTypeLabel(draft.type)} date <b>*</b></span><input required type="date" value={draft.startDate || draft.endDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value, endDate: event.target.value })} /></label>
              : <div className="pb-field-grid"><label className="pb-field"><span>Start date <b>*</b></span><input required type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} /></label><label className="pb-field"><span>End date <b>*</b></span><input required type="date" min={draft.startDate || undefined} value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} /></label></div>}
            <label className="pb-field"><span>Colour <b>*</b></span><div className="pb-colour-picker"><div className="pb-colour-presets">{COLOUR_PRESETS.map((colour) => <button type="button" key={colour} className={draft.colour.toUpperCase() === colour ? "selected" : ""} style={{ backgroundColor: colour }} aria-label={`Use ${colour} activity colour`} aria-pressed={draft.colour.toUpperCase() === colour} onClick={() => setDraft({ ...draft, colour })} />)}</div><input type="color" aria-label="Custom activity colour" value={draft.colour} onChange={(event) => setDraft({ ...draft, colour: event.target.value })} /></div></label>
            <div className="pb-field-grid"><label className="pb-field"><span>Category</span><select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}><option value="">No category</option>{PLANNER_BUILD_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}{draft.category && !PLANNER_BUILD_CATEGORIES.includes(draft.category as typeof PLANNER_BUILD_CATEGORIES[number]) && <option value={draft.category}>{draft.category}</option>}</select></label>
              <label className="pb-field"><span>Room</span><select value={draft.roomId} onChange={(event) => setDraft({ ...draft, roomId: event.target.value })}><option value="">All project</option>{draft.roomId && !rooms.some((room) => room.id === draft.roomId) && <option value={draft.roomId}>Room unavailable · unassigned</option>}{rooms.map((room) => <option key={room.id} value={room.id}>{room.name || "Unnamed room"}</option>)}</select></label></div>
            <label className="pb-field"><span>Trade</span><input list="pb-trades" maxLength={100} value={draft.trade} onChange={(event) => setDraft({ ...draft, trade: event.target.value })} placeholder="e.g. Electrician" /><datalist id="pb-trades">{["Builder", "Carpenter", "Electrician", "Plumber", "Heating engineer", "HVAC installer", "Plasterer", "Decorator", "Tiler", "Flooring installer", "Roofer", "Glazier", "Kitchen fitter", "Inspector", "Client"].map((trade) => <option value={trade} key={trade} />)}</datalist></label>
            {["task", "waiting"].includes(draft.type) && <label className="pb-field"><span>Progress <strong>{draft.progress}%</strong></span><input type="range" min={0} max={100} step={5} value={draft.progress} onChange={(event) => { const progress = Number(event.target.value); const status = draft.status === "blocked" || draft.status === "delayed" ? draft.status : progress >= 100 ? "completed" : progress > 0 ? "in_progress" : "not_started"; setDraft({ ...draft, progress, status }); }} /></label>}
            {["task", "waiting"].includes(draft.type) && <details className="pb-activity-details" open={view === "DASHBOARD"}><summary>Actual timing</summary><div className="pb-field-grid"><label className="pb-field"><span>Actual start</span><input type="date" max={draft.actualEndDate || localDateKey()} value={draft.actualStartDate} onChange={(event) => setDraft({ ...draft, actualStartDate: event.target.value })} /></label><label className="pb-field"><span>Actual finish</span><input type="date" min={draft.actualStartDate || undefined} max={localDateKey()} value={draft.actualEndDate} onChange={(event) => setDraft({ ...draft, actualEndDate: event.target.value })} /></label></div><p className="pb-table-note">Record known dates only. Saving an actual finish marks this activity complete.</p></details>}
            {draft.status === "blocked" && <div className="pb-field-grid"><label className="pb-check-control"><input type="checkbox" checked={draft.isBlocking} onChange={(event) => setDraft({ ...draft, isBlocking: event.target.checked })} />Blocking other work</label><label className="pb-field"><span>Blocked reason</span><input maxLength={1000} value={draft.blockedReason} onChange={(event) => setDraft({ ...draft, blockedReason: event.target.value })} /></label></div>}
            <details className="pb-activity-details"><summary>Dependencies <small>{draft.dependencyIds.length} selected · finish-to-start</small></summary><div className="pb-dependency-options">{activities.filter((item) => item.activityId !== draft.activityId).map((item) => {
              const checked = draft.dependencyIds.includes(item.activityId);
              const cyclic = !checked && Boolean(draft.activityId) && wouldCreateDependencyCycle(activities, draft.activityId!, item.activityId);
              return <label key={item.activityId}><input type="checkbox" checked={checked} disabled={cyclic} onChange={(event) => setDraft({ ...draft, dependencyIds: event.target.checked ? [...draft.dependencyIds, item.activityId] : draft.dependencyIds.filter((id) => id !== item.activityId) })} /><span>{item.name}<small>{item.category || "Uncategorised"}{cyclic ? " · would create a cycle" : ""}</small></span></label>;
            })}{activities.length <= (draft.activityId ? 1 : 0) && <small>Add another activity first to create a dependency.</small>}</div></details>
            {(draft.category === "PROCUREMENT" || draft.type === "delivery") && <details className="pb-activity-details" open={draft.type === "delivery"}><summary>Procurement &amp; delivery</summary><div className="pb-field-grid"><label className="pb-field"><span>Supplier</span><input maxLength={200} value={draft.supplier} onChange={(event) => setDraft({ ...draft, supplier: event.target.value })} /></label><label className="pb-field"><span>Order reference</span><input maxLength={160} value={draft.orderReference} onChange={(event) => setDraft({ ...draft, orderReference: event.target.value })} /></label><label className="pb-field"><span>Order date</span><input type="date" value={draft.orderDate} onChange={(event) => setDraft({ ...draft, orderDate: event.target.value })} /></label><label className="pb-field"><span>Lead time (days)</span><input type="number" min="0" max="3650" step="1" value={draft.leadTimeDays} onChange={(event) => setDraft({ ...draft, leadTimeDays: event.target.value })} /></label><label className="pb-field"><span>Expected delivery override</span><input type="date" value={draft.expectedDeliveryDate} onChange={(event) => setDraft({ ...draft, expectedDeliveryDate: event.target.value })} /><small>{draft.orderDate && draft.leadTimeDays ? "Calculated: " + formatDateKey(addCalendarDays(draft.orderDate, Number(draft.leadTimeDays))) : "Set order date and lead time to calculate."}</small></label><label className="pb-field"><span>Actual delivery date</span><input type="date" value={draft.actualDeliveryDate} onChange={(event) => setDraft({ ...draft, actualDeliveryDate: event.target.value })} /></label><label className="pb-field"><span>Delivery status</span><select value={draft.deliveryStatus} onChange={(event) => setDraft({ ...draft, deliveryStatus: event.target.value as NonNullable<PlannerBuildActivity["deliveryStatus"]> })}>{PLANNER_BUILD_DELIVERY_STATUSES.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label></div></details>}
            {draft.type === "decision" && <label className="pb-field"><span>Decision deadline</span><input type="date" value={draft.decisionDeadline} onChange={(event) => setDraft({ ...draft, decisionDeadline: event.target.value })} /></label>}
            {draft.type === "inspection" && <label className="pb-field"><span>Inspection result</span><select value={draft.inspectionStatus} onChange={(event) => setDraft({ ...draft, inspectionStatus: event.target.value as NonNullable<PlannerBuildActivity["inspectionStatus"]> })}><option value="pending">Pending</option><option value="passed">Passed</option><option value="failed">Failed</option></select></label>}
            {draft.type === "payment" && <div className="pb-activity-details"><strong>Payment details</strong><div className="pb-field-grid"><label className="pb-field"><span>Due date</span><input type="date" value={draft.paymentDueDate} onChange={(event) => setDraft({ ...draft, paymentDueDate: event.target.value })} /></label><label className="pb-field"><span>Amount</span><input type="number" min="0" step="0.01" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></label><label className="pb-field"><span>Currency</span><input maxLength={3} value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value })} /></label><label className="pb-field"><span>Payment status</span><select value={draft.paymentStatus} onChange={(event) => setDraft({ ...draft, paymentStatus: event.target.value as NonNullable<PlannerBuildActivity["paymentStatus"]> })}><option value="unpaid">Unpaid</option><option value="paid">Paid</option></select></label></div></div>}
            <details className="pb-activity-details" open={view === "DASHBOARD"}><summary>Costs</summary><div className="pb-field-grid"><label className="pb-field"><span>Estimated cost</span><input type="number" min="0" step="0.01" value={draft.estimatedCost} onChange={(event) => setDraft({ ...draft, estimatedCost: event.target.value })} /></label><label className="pb-field"><span>Actual cost</span><input type="number" min="0" step="0.01" value={draft.actualCost} onChange={(event) => setDraft({ ...draft, actualCost: event.target.value })} /></label><label className="pb-field"><span>Currency</span><input maxLength={3} value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value })} /></label></div></details>
            <details className="pb-activity-details"><summary>Notes</summary><label className="pb-field pb-activity-notes"><span>Notes</span><textarea rows={3} maxLength={5000} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Optional notes" /></label><div className="pb-photo-storage-note" role="note"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7.5h3l1.3-2h7.4l1.3 2h3A1.5 1.5 0 0 1 21.5 9v9a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18V9A1.5 1.5 0 0 1 4 7.5Z" /><circle cx="12" cy="13" r="3.5" /></svg><span><strong>Photo attachments</strong><small>Photo uploads require cloud storage and will be available with a paid plan.</small></span><span className="pb-photo-paid-badge">Paid plans</span></div></details>
            {formError && <p className="pb-form-error" role="alert">{formError}</p>}
            <footer>{draft.activityId && <button type="button" className="pb-danger-button" onClick={deleteActivity}>Delete activity</button>}<span /><button type="button" className="pb-secondary-button" onClick={() => { setDraft(null); setFormError(""); }}>Cancel</button><button type="submit" className="pb-primary-button">{draft.activityId ? "Save changes" : "Add activity"}</button></footer>
          </form>
        </section>
      </div>}
  </>;
  return <div className="planner-build-content">
    {demoMode && view !== "QUOTE" && <div className="pb-free-demo-banner" role="status"><span>PlannerBuild demo · {activities.length}/{PLANNER_BUILD_DEMO_MAX_ACTIVITIES} activities saved. Studio includes the full module with unlimited activities.</span><button type="button" className="pb-secondary-button" onClick={onDemoLimitReached}>See plans</button></div>}
    <div hidden={view === "QUOTE"}>{rendered}</div>
    <div hidden={view !== "QUOTE"}><QuoteGenerator key={project.projectId} project={project} defaultCurrency={defaultCurrency} onQuotesChange={onQuotesChange} /></div>
    {view !== "QUOTE" && activityContextMenu && activities.some((item) => item.activityId === activityContextMenu.activityId) && <div className="floorplan-context-menu pb-activity-context-menu" role="group" aria-label="Activity actions" style={{ left: activityContextMenu.x, top: activityContextMenu.y }} onContextMenu={(event) => event.preventDefault()}>
      <strong>Activity</strong>
      <button type="button" onClick={() => duplicateActivity(activityContextMenu.activityId)}>Duplicate</button>
      <button type="button" className="danger-button" onClick={() => deleteActivityById(activityContextMenu.activityId)}>Delete activity</button>
    </div>}
  </div>;
}

function MetricCard({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return <article className="pb-metric-card"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</article>;
}

function QuantityTable({ children, className = "", tableClassName = "" }: { children: ReactNode; className?: string; tableClassName?: string }) {
  return <div className={`pb-table-scroll ${className}`}><table className={`pb-quantity-table ${tableClassName}`}>{children}</table></div>;
}

function PlannerBuildQuantityTables({ project, metrics }: { project: ProjectDocument; metrics: ReturnType<typeof calculatePlannerBuildMetrics> }) {
  const summary = metrics.summary;
  const activities = project.plannerBuild?.activities ?? [];
  const schedule = getPlannerBuildScheduleSummary(activities);
  const warnings = getPlannerBuildWarnings(activities);
  const roomName = (roomId: string | null) => roomId ? project.rooms.find((room) => room.id === roomId)?.name ?? "Room unavailable" : "All project";
  const area = (value: number | null) => value === null ? "Not set" : formatPlannerBuildArea(value);
  const length = (value: number | null) => value === null ? "Not set" : formatPlannerBuildLength(value);
  const wallArea = (value: number | null) => value !== null ? formatPlannerBuildArea(value) : metrics.rooms.length ? "Height not set" : "—";
  const count = (value: number | null) => value === null ? "Not classified" : value.toLocaleString("en-GB");
  const openingArea = (value: number | null) => value === null ? "Dimensions incomplete" : area(value);
  const totalOpeningAreaMm2 = metrics.openings.doorAreaMm2 === null || metrics.openings.windowAreaMm2 === null
    ? null : metrics.openings.doorAreaMm2 + metrics.openings.windowAreaMm2;
  const finishedFloorAreaMm2 = metrics.rooms.filter((room) => room.floorFinish).reduce((total, room) => total + room.areaMm2, 0);
  const [scheduleBreakdown, setScheduleBreakdown] = useState<"PHASE" | "TRADE" | "ROOM" | "STATUS">("PHASE");
  const importedByCategory = new Map<string, { name: string; count: number }>();
  const definitions = new Map(project.assets.map((asset) => [asset.assetId, asset]));
  for (const instance of project.assetInstances) {
    const definition = definitions.get(instance.assetId);
    if (!definition || definition.categoryId === "electric" || definition.categoryId?.startsWith("plumbing-") || ["baths", "basins", "toilets", "showers", "plumbing", "plumbing-fixtures"].includes(definition.categoryId ?? "")) continue;
    const name = definition.categoryName || definition.categoryId || "Uncategorised";
    const current = importedByCategory.get(name) ?? { name, count: 0 };
    current.count += 1;
    importedByCategory.set(name, current);
  }
  const paintedWalls = metrics.wallSurfaces.filter((wall) => wall.finishName || wall.finishColour);
  const paintedAreaLabel = paintedWalls.length ? metrics.paintedWallAreaMm2 === null ? "Height not set" : area(metrics.paintedWallAreaMm2) : "Not set";
  const breakdownRows = scheduleBreakdown === "PHASE"
    ? schedule.countsByCategory.map((item) => ({ key: item.name, label: item.name, count: item.count }))
    : scheduleBreakdown === "TRADE"
      ? schedule.countsByTrade.map((item) => ({ key: item.name, label: item.name, count: item.count }))
      : scheduleBreakdown === "ROOM"
        ? schedule.countsByRoom.map((item) => ({ key: item.roomId ?? "all", label: roomName(item.roomId), count: item.count }))
        : schedule.countsByStatus.map((item) => ({ key: item.name, label: item.name.replaceAll("_", " "), count: item.count }));
  const completedCount = schedule.countsByStatus.find((item) => item.name === "completed")?.count ?? 0;
  const inProgressCount = schedule.countsByStatus.find((item) => item.name === "in_progress")?.count ?? 0;
  const blockedCount = schedule.countsByStatus.find((item) => item.name === "blocked")?.count ?? 0;
  const notStartedCount = schedule.countsByStatus.find((item) => item.name === "not_started")?.count ?? 0;

  return <section className="planner-build-table-view" aria-label="PlannerBuild quantities and project summary">
    <div className="pb-view-heading"><div><span className="pb-eyebrow">PlannerBuild · Quantities</span><h1>Project quantities</h1><p>Live quantities derived from the current floorplan and project data.</p></div></div>
    <section className="pb-summary-section" aria-labelledby="pb-summary-heading">
      <div className="pb-section-heading"><div><span className="pb-eyebrow">At a glance</span><h2 id="pb-summary-heading">Project overview</h2></div></div>
      <div className="pb-metric-grid pb-primary-metric-grid">
        <MetricCard label="Rooms" value={summary.roomCount} />
        <MetricCard label="Floor area" value={area(summary.totalFloorAreaMm2)} />
        <MetricCard label="Net wall area" value={wallArea(summary.netWallAreaMm2)} detail="After known openings" />
        <MetricCard label="Activities" value={summary.activityCount} detail={summary.scheduledDays === null ? "No scheduled range" : `${summary.scheduledDays} calendar days`} />
      </div>
      <div className="pb-quantity-facts" aria-label="Additional project quantities">
        <div><span>Total room perimeter</span><strong>{length(summary.totalRoomPerimeterMm)}</strong></div>
        <div><span>Unique walls · length</span><strong>{summary.uniqueWallCount} · {length(summary.totalWallLengthMm)}</strong></div>
        <div><span>Gross wall area</span><strong>{wallArea(summary.grossWallAreaMm2)}</strong></div>
        <div><span>Doors · windows</span><strong>{summary.doorCount} · {summary.windowCount}</strong></div>
        <div><span>Electrical</span><strong>{summary.electricalCount}</strong></div>
        <div><span>Plumbing</span><strong>{count(summary.plumbingCount)}</strong></div>
        <div><span>Ordinary fittings</span><strong>{summary.fittingCount}</strong></div>
      </div>
    </section>

    <details className="pb-data-section" open>
      <summary><span><span className="pb-eyebrow">Floorplan</span><strong>Rooms</strong></span><small>{metrics.rooms.length} rooms</small></summary>
      {metrics.rooms.length ? <QuantityTable className="pb-rooms-scroll" tableClassName="pb-rooms-table"><thead><tr><th>Room</th><th>Floor area</th><th>Perimeter</th><th>Walls</th><th>Net wall area</th><th>Doors</th><th>Windows</th><th>Electrical</th><th>Plumbing</th><th>Fittings</th></tr></thead><tbody>
        {metrics.rooms.map((room) => <tr key={room.roomId}><th scope="row">{room.name}</th><td>{area(room.areaMm2)}</td><td>{length(room.perimeterMm)}</td><td>{room.boundaryCount}</td><td>{wallArea(room.netWallAreaMm2)}</td><td>{room.doors}</td><td>{room.windows}</td><td>{count(room.electrical)}</td><td>{count(room.plumbing)}</td><td>{room.otherFittings}</td></tr>)}
        <tr className="pb-total-row"><th scope="row">Total</th><td>{area(summary.totalFloorAreaMm2)}</td><td>{length(summary.totalRoomPerimeterMm)}</td><td title="Unique physical wall segments">{summary.uniqueWallCount} unique</td><td>{wallArea(summary.netWallAreaMm2)}</td><td>{summary.doorCount}</td><td>{summary.windowCount}</td><td>{summary.electricalCount}</td><td>{count(summary.plumbingCount)}</td><td>{summary.fittingCount}</td></tr>
      </tbody></QuantityTable> : <p className="pb-table-note">No rooms have been added to this project.</p>}
      <p className="pb-table-note">Project wall totals count unique physical segments; room wall counts show boundaries and can include shared walls.</p>
    </details>

    <details className="pb-data-section" open>
      <summary><span><span className="pb-eyebrow">Construction</span><strong>Walls &amp; openings</strong></span><small>{summary.uniqueWallCount} walls · {summary.doorCount + summary.windowCount} openings</small></summary>
      <div className="pb-quantity-facts pb-section-facts">
        <div><span>Unique wall length</span><strong>{length(summary.totalWallLengthMm)}</strong></div>
        <div><span>Gross wall area</span><strong>{wallArea(summary.grossWallAreaMm2)}</strong></div>
        <div><span>Opening area</span><strong>{openingArea(totalOpeningAreaMm2)}</strong></div>
        <div><span>Net wall area</span><strong>{wallArea(summary.netWallAreaMm2)}</strong></div>
        <div><span>Door opening area</span><strong>{openingArea(metrics.openings.doorAreaMm2)}</strong></div>
        <div><span>Window opening area</span><strong>{openingArea(metrics.openings.windowAreaMm2)}</strong></div>
      </div>
      {metrics.wallSurfaces.length ? <QuantityTable className="pb-walls-scroll" tableClassName="pb-walls-table"><thead><tr><th>Wall</th><th>Room</th><th>Length</th><th>Height</th><th>Gross area</th><th>Opening area</th><th>Net area</th><th>Finish</th></tr></thead><tbody>
        {metrics.wallSurfaces.map((wall) => <tr key={wall.id}><th scope="row">Wall {wall.boundaryIndex}</th><td>{wall.roomName}</td><td>{length(wall.lengthMm)}</td><td>{wall.heightMm === null ? "Height not set" : length(wall.heightMm)}</td><td>{wallArea(wall.grossAreaMm2)}</td><td>{area(wall.openingAreaMm2)}</td><td>{wallArea(wall.netAreaMm2)}</td><td>{wall.finishName ? <span className="pb-finish-value"><i style={{ backgroundColor: wall.finishColour ?? "transparent" }} />{wall.finishName}</span> : "Not set"}</td></tr>)}
      </tbody></QuantityTable> : <p className="pb-table-note">Wall geometry is not available yet.</p>}
      <p className="pb-table-note">Surface quantities are per room boundary, so a shared wall can have an interior surface in each room. Missing heights and opening dimensions are not estimated.</p>
    </details>

    <details className="pb-data-section" open={paintedWalls.length > 0 || metrics.floorFinishCount > 0}>
      <summary><span><span className="pb-eyebrow">Materials</span><strong>Finishes &amp; paint</strong></span><small>{paintedWalls.length} finished wall surfaces · {metrics.floorFinishCount} floor finishes</small></summary>
      <div className="pb-quantity-facts pb-section-facts">
        <div><span>Painted wall area</span><strong>{paintedAreaLabel}</strong></div>
        <div><span>Floor finish coverage</span><strong>{formatPlannerBuildArea(finishedFloorAreaMm2)}</strong></div>
        <div><span>Rooms with floor finish</span><strong>{metrics.floorFinishCount} of {metrics.rooms.length}</strong></div>
      </div>
      {paintedWalls.length ? <QuantityTable><thead><tr><th>Room</th><th>Surface</th><th>Paint / finish</th><th>Colour</th><th>Area</th><th>Required paint</th></tr></thead><tbody>
        {paintedWalls.map((wall) => <tr key={wall.id}><td>{wall.roomName}</td><td>Wall {wall.boundaryIndex}</td><td>{wall.finishName ?? "Colour only"}</td><td>{wall.finishColour ? <span className="pb-finish-value"><i style={{ backgroundColor: wall.finishColour }} />{wall.finishColour}</span> : "Not set"}</td><td>{wallArea(wall.netAreaMm2)}</td><td title="Paint coverage and coat count are not stored in this project">— · Coverage / coats not set</td></tr>)}
      </tbody></QuantityTable> : <p className="pb-table-note">No wall paint or finish data is set.</p>}
      <p className="pb-table-note">Paint quantity is unavailable because coverage and coat count are not stored. Floor finish area follows each room’s measured polygon.</p>
      {metrics.rooms.some((room) => room.floorFinish) && <QuantityTable><thead><tr><th>Room</th><th>Floor area</th><th>Floor finish</th></tr></thead><tbody>{metrics.rooms.filter((room) => room.floorFinish).map((room) => <tr key={room.roomId}><th scope="row">{room.name}</th><td>{area(room.areaMm2)}</td><td>{room.floorFinish}</td></tr>)}</tbody></QuantityTable>}
    </details>

    <details className="pb-data-section">
      <summary><span><span className="pb-eyebrow">Services</span><strong>Electrical</strong></span><small>{summary.electricalCount} items · {metrics.electricalConnections} connections · {metrics.electricalCircuits} circuits</small></summary>
      {metrics.electricalByType.length ? <QuantityTable><thead><tr><th>Catalogue type</th><th>Count</th></tr></thead><tbody>{metrics.electricalByType.map((item) => <tr key={item.name}><th scope="row">{item.name}</th><td>{item.count}</td></tr>)}</tbody></QuantityTable> : <p className="pb-table-note">No electrical fittings are placed.</p>}
    </details>

    <details className="pb-data-section">
      <summary><span><span className="pb-eyebrow">Services</span><strong>Plumbing</strong></span><small>{count(summary.plumbingCount)} items</small></summary>
      {metrics.plumbingClassificationAvailable ? <QuantityTable><thead><tr><th>Structured catalogue type</th><th>Count</th></tr></thead><tbody>{metrics.plumbingByType.map((item) => <tr key={item.name}><th scope="row">{item.name}</th><td>{item.count}</td></tr>)}</tbody></QuantityTable> : <p className="pb-table-note">Plumbing quantities are unavailable until assets carry a structured plumbing category. Items are not inferred from display names.</p>}
    </details>

    <details className="pb-data-section">
      <summary><span><span className="pb-eyebrow">Catalogue</span><strong>Fittings &amp; assets</strong></span><small>{summary.fittingCount} ordinary fittings · {metrics.importedAssetCount} imported assets total</small></summary>
      {importedByCategory.size ? <QuantityTable><thead><tr><th>Catalogue category</th><th>Imported asset count</th></tr></thead><tbody>{[...importedByCategory.values()].sort((a, b) => a.name.localeCompare(b.name)).map((item) => <tr key={item.name}><th scope="row">{item.name}</th><td>{item.count}</td></tr>)}</tbody></QuantityTable> : <p className="pb-table-note">No imported non-electrical or non-plumbing assets.</p>}
    </details>

    <details className="pb-data-section">
      <summary><span><span className="pb-eyebrow">Programme</span><strong>Schedule</strong></span><small>{summary.activityCount} activities · {summary.scheduledDays === null ? "no date range" : `${summary.scheduledDays} days`}</small></summary>
      <div className="pb-programme-content">
        <div className="pb-programme-stats" aria-label="Schedule status summary">
          <div><span>Complete</span><strong>{completedCount}</strong></div>
          <div><span>In progress</span><strong>{inProgressCount}</strong></div>
          <div><span>Blocked</span><strong>{blockedCount}</strong></div>
          <div><span>Not started</span><strong>{notStartedCount}</strong></div>
          <div><span>Delayed deliveries</span><strong>{schedule.delayedDeliveries.length}</strong></div>
        </div>
        <div className="pb-programme-highlights">
          <div><span>Next milestone</span><strong>{schedule.nextMilestone?.name ?? "None scheduled"}</strong><small>{schedule.nextMilestone ? formatDateKey(schedule.nextMilestone.startDate) : ""}</small></div>
          <div><span>Next delivery</span><strong>{schedule.nextDelivery?.name ?? "None scheduled"}</strong><small>{schedule.nextDelivery ? formatDateKey(expectedDeliveryDate(schedule.nextDelivery) ?? schedule.nextDelivery.startDate) : ""}</small></div>
        </div>
        <div className="pb-dashboard-columns">
          <section><h3>Upcoming · next 7 days</h3>{schedule.upcoming.length ? <ul>{schedule.upcoming.slice(0, 8).map((activity) => <li key={activity.activityId}><span className="pb-activity-table-name"><i style={{ backgroundColor: activity.colour }} />{activity.name}</span><small>{activityTypeLabel(activity.type)} · {formatDateKey(activity.type === "delivery" ? expectedDeliveryDate(activity) ?? activity.startDate : activity.type === "decision" ? activity.decisionDeadline ?? activity.startDate : activity.type === "payment" ? activity.paymentDueDate ?? activity.startDate : activity.startDate)}</small></li>)}</ul> : <p className="pb-table-note">Nothing due in the next 7 days.</p>}</section>
          <section><h3>Schedule checks</h3>{warnings.length ? <ul>{warnings.slice(0, 6).map((warning) => <li className={warning.severity} key={warning.warningId}>{warning.message}</li>)}</ul> : <p className="pb-table-note">No schedule conflicts detected.</p>}</section>
        </div>
        <section className="pb-breakdown-section" aria-label="Activity breakdown">
          <label>Break down by<select value={scheduleBreakdown} onChange={(event) => setScheduleBreakdown(event.target.value as typeof scheduleBreakdown)}>
            <option value="PHASE">Phase</option><option value="TRADE">Trade</option><option value="ROOM">Room</option><option value="STATUS">Status</option>
          </select></label>
          {breakdownRows.length ? <div className="pb-breakdown-items">{breakdownRows.map((item) => <span key={item.key}>{item.label}<b>{item.count}</b></span>)}</div> : <p className="pb-table-note">No activity breakdown yet.</p>}
        </section>
      </div>
      {activities.length > 0 && <QuantityTable className="pb-schedule-scroll" tableClassName="pb-schedule-table"><thead><tr><th>Activity</th><th>Start</th><th>End</th><th>Category</th><th>Room</th><th>Progress</th></tr></thead><tbody>{activities.map((activity) => <tr key={activity.activityId}><th scope="row"><span className="pb-activity-table-name"><i style={{ backgroundColor: activity.colour }} />{activity.name}</span></th><td>{formatDateKey(activity.startDate)}</td><td>{formatDateKey(activity.endDate)}</td><td>{activity.category || "—"}</td><td>{activity.roomId ? project.rooms.find((room) => room.id === activity.roomId)?.name ?? "Room unavailable" : "All project"}</td><td>{activity.progress}%</td></tr>)}</tbody></QuantityTable>}
    </details>
  </section>;
}

type DashboardSectionId = "rooms" | "walls" | "finishes" | "electrical" | "plumbing" | "assets" | "programme" | "costs";
type DashboardPanel = { kind: "ROOM" | "WALL" | "FINISHES" | "ELECTRICAL" | "PLUMBING" | "ASSETS" | "ACTIVITIES" | "COSTS" | "ISSUES" | "QUANTITIES"; id?: string };
type DashboardCostGroup = { label: string; currency: string; estimated: number | null; actual: number | null; activityCount: number };
const DEFAULT_DASHBOARD_SECTIONS: Record<DashboardSectionId, boolean> = { rooms: false, walls: false, finishes: false, electrical: false, plumbing: false, assets: false, programme: false, costs: false };

function formatPlannerBuildCost(value: number, currency: string, defaultCurrency = "GBP") {
  const code = currency.trim().toUpperCase() || defaultCurrency;
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: code, maximumFractionDigits: 2 }).format(value); }
  catch { return code + " " + value.toLocaleString("en-GB", { maximumFractionDigits: 2 }); }
}

function PlannerBuildTable({ project, metrics, defaultCurrency, onEditActivity, onAddActivity, onAddDelivery, historyActions }: {
  project: ProjectDocument; metrics: ReturnType<typeof calculatePlannerBuildMetrics>; onEditActivity: (activity?: PlannerBuildActivity) => void;
  defaultCurrency: CurrencyCode; onAddActivity: () => void; onAddDelivery: () => void; historyActions: ReactNode;
}) {
  const [panel, setPanel] = useState<DashboardPanel | null>(null);
  const [costBreakdown, setCostBreakdown] = useState<"PHASE" | "TRADE" | "ROOM">("PHASE");
  const [expanded, setExpanded] = useState(DEFAULT_DASHBOARD_SECTIONS);
  const activities = project.plannerBuild?.activities ?? EMPTY_ACTIVITIES;
  const summary = metrics.summary;
  const [today, setToday] = useState(localDateKey);
  const schedule = useMemo(() => getPlannerBuildScheduleSummary(activities, today), [activities, today]);
  const warnings = useMemo(() => getPlannerBuildWarnings(activities, today), [activities, today]);
  useEffect(() => {
    const refreshDate = () => setToday(localDateKey());
    const timer = window.setInterval(refreshDate, 60_000);
    document.addEventListener("visibilitychange", refreshDate);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refreshDate); };
  }, []);
  const roomName = (id: string | null) => id ? project.rooms.find((room) => room.id === id)?.name ?? "Room unavailable" : "All project";
  const area = (value: number | null) => value === null ? "Not set" : formatPlannerBuildArea(value);
  const length = (value: number | null) => value === null ? "Not set" : formatPlannerBuildLength(value);
  const wallArea = (value: number | null) => value !== null ? formatPlannerBuildArea(value) : metrics.rooms.length ? "Height not set" : "—";
  const count = (value: number | null) => value === null ? "Not classified" : value.toLocaleString("en-GB");
  const paintedWalls = metrics.wallSurfaces.filter((wall) => wall.finishName || wall.finishColour);
  const importedByCategory = new Map<string, number>();
  const definitions = new Map(project.assets.map((asset) => [asset.assetId, asset]));
  for (const instance of project.assetInstances) {
    const definition = definitions.get(instance.assetId);
    if (!definition || definition.categoryId === "electric" || definition.categoryId?.startsWith("plumbing-") || ["baths", "basins", "toilets", "showers", "plumbing", "plumbing-fixtures"].includes(definition.categoryId ?? "")) continue;
    const name = definition.categoryName || definition.categoryId || "Uncategorised";
    importedByCategory.set(name, (importedByCategory.get(name) ?? 0) + 1);
  }
  const costTotals = (field: "estimatedCost" | "actualCost") => {
    const totals = new Map<string, number>();
    activities.forEach((activity) => { const value = activity[field]; if (typeof value === "number" && Number.isFinite(value)) { const currency = activity.currency?.trim().toUpperCase() || defaultCurrency; totals.set(currency, (totals.get(currency) ?? 0) + value); } });
    return [...totals].sort(([a], [b]) => a.localeCompare(b));
  };
  const estimatedTotals = costTotals("estimatedCost");
  const actualTotals = costTotals("actualCost");
  const costText = (totals: Array<[string, number]>) => totals.length ? totals.map(([currency, value]) => formatPlannerBuildCost(value, currency, defaultCurrency)).join(" · ") : "—";
  const statusCount = (status: PlannerBuildActivity["status"]) => schedule.countsByStatus.find((item) => item.name === status)?.count ?? 0;
  const completedCount = statusCount("completed");
  const inProgressCount = statusCount("in_progress");
  const notStartedCount = statusCount("not_started");
  const blockedCount = statusCount("blocked");
  const delayedCount = statusCount("delayed");
  const tradeCount = new Set(activities.map((item) => item.trade?.trim()).filter((trade): trade is string => Boolean(trade))).size;
  const openPanel = (kind: DashboardPanel["kind"], id?: string) => setPanel({ kind, id });
  const editActivity = (activity: PlannerBuildActivity) => { setPanel(null); onEditActivity(activity); };
  const sectionToggle = (key: DashboardSectionId, open: boolean) => {
    setExpanded((current) => ({ ...current, [key]: open }));
  };
  useEffect(() => {
    if (!panel) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setPanel(null); };
    window.addEventListener("keydown", closeOnEscape); return () => window.removeEventListener("keydown", closeOnEscape);
  }, [panel]);
  const costGroups = (): DashboardCostGroup[] => {
    const groups = new Map<string, DashboardCostGroup>();
    activities.forEach((activity) => {
      const label = costBreakdown === "PHASE" ? activity.category || "Uncategorised" : costBreakdown === "TRADE" ? activity.trade || "Unassigned" : roomName(activity.roomId);
      if (activity.estimatedCost === undefined && activity.actualCost === undefined) return;
      const currency = activity.currency?.trim().toUpperCase() || defaultCurrency; const key = label + "|" + currency;
      const row = groups.get(key) ?? { label, currency, estimated: null, actual: null, activityCount: 0 };
      if (typeof activity.estimatedCost === "number" && Number.isFinite(activity.estimatedCost)) row.estimated = (row.estimated ?? 0) + activity.estimatedCost;
      if (typeof activity.actualCost === "number" && Number.isFinite(activity.actualCost)) row.actual = (row.actual ?? 0) + activity.actualCost;
      row.activityCount += 1; groups.set(key, row);
    });
    return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label) || a.currency.localeCompare(b.currency));
  };
  const duration = (activity: PlannerBuildActivity) => activity.type === "milestone" ? "Milestone" : (calendarDaysBetween(activity.startDate, activity.endDate) + 1) + " days";
  const activityRegister = (items: PlannerBuildActivity[]) => items.length ? <QuantityTable className="pb-register-scroll" tableClassName="pb-register-table"><thead><tr><th>Activity</th><th>Type</th><th>Phase</th><th>Room</th><th>Planned start</th><th>Planned finish</th><th>Actual start</th><th>Actual finish</th><th>Finish variance</th><th>Duration</th><th>Status</th><th>Progress</th><th>Trade</th><th>Estimate</th><th>Actual cost</th><th>Dependencies</th></tr></thead><tbody>{items.map((activity) => <tr key={activity.activityId}>
      <th scope="row"><button type="button" className="pb-link-button" onClick={() => editActivity(activity)}><i style={{ backgroundColor: activity.colour }} aria-hidden="true" />{activity.name}</button></th>
      <td>{activityTypeLabel(activity.type)}</td><td>{activity.category || "—"}</td><td>{roomName(activity.roomId)}</td><td>{formatDateKey(activity.startDate)}</td><td>{formatDateKey(activity.endDate)}</td><td>{activity.actualStartDate ? formatDateKey(activity.actualStartDate) : "—"}</td><td>{activity.actualEndDate ? formatDateKey(activity.actualEndDate) : "—"}</td><td>{activity.actualEndDate ? `${calendarDaysBetween(activity.endDate, activity.actualEndDate)} days` : "—"}</td><td>{duration(activity)}</td>
      <td><span className={"pb-status-pill status-" + activity.status}>{activity.status.replaceAll("_", " ")}</span></td><td>{Number.isFinite(activity.progress) ? activity.progress + "%" : "—"}</td><td>{activity.trade || "—"}</td>
      <td>{typeof activity.estimatedCost === "number" ? formatPlannerBuildCost(activity.estimatedCost, activity.currency || defaultCurrency, defaultCurrency) : "—"}</td>
      <td>{typeof activity.actualCost === "number" ? formatPlannerBuildCost(activity.actualCost, activity.currency || defaultCurrency, defaultCurrency) : "—"}</td>
      <td>{activity.dependencyIds.length ? activity.dependencyIds.map((id) => activities.find((candidate) => candidate.activityId === id)?.name ?? "Unavailable").join(", ") : "—"}</td>
    </tr>)}</tbody></QuantityTable> : <p className="pb-table-note">No activities yet.</p>;
  const roomPanel = panel?.kind === "ROOM" ? metrics.rooms.find((room) => room.roomId === panel.id) : undefined;
  const wallPanel = panel?.kind === "WALL" ? metrics.wallSurfaces.find((wall) => wall.id === panel.id) : undefined;
  const panelTitles: Record<DashboardPanel["kind"], string> = {
    ROOM: roomPanel?.name ?? "Room details", WALL: wallPanel ? "Wall " + wallPanel.boundaryIndex : "Wall details",
    FINISHES: "Finishes & paint", ELECTRICAL: "Electrical summary", PLUMBING: "Plumbing summary", ASSETS: "Fittings & assets",
    ACTIVITIES: "Activity register", COSTS: "Costs & resources", ISSUES: "Schedule checks", QUANTITIES: "Full quantity tables",
  };
  let panelContent: ReactNode = null;
  if (panel?.kind === "ROOM") {
    const linked = activities.filter((activity) => activity.roomId === panel.id);
    const roomCosts = new Map<string, number>();
    linked.forEach((activity) => { if (typeof activity.estimatedCost === "number" && Number.isFinite(activity.estimatedCost)) { const code = activity.currency?.toUpperCase() || defaultCurrency; roomCosts.set(code, (roomCosts.get(code) ?? 0) + activity.estimatedCost); } });
    panelContent = roomPanel ? <><div className="pb-detail-facts"><div><span>Floor area</span><strong>{area(roomPanel.areaMm2)}</strong></div><div><span>Perimeter</span><strong>{length(roomPanel.perimeterMm)}</strong></div><div><span>Wall boundaries</span><strong>{roomPanel.boundaryCount}</strong></div><div><span>Net wall area</span><strong>{wallArea(roomPanel.netWallAreaMm2)}</strong></div><div><span>Doors · windows</span><strong>{roomPanel.doors} · {roomPanel.windows}</strong></div><div><span>Electrical · plumbing</span><strong>{count(roomPanel.electrical)} · {count(roomPanel.plumbing)}</strong></div><div><span>Other fittings</span><strong>{roomPanel.otherFittings}</strong></div><div><span>Floor finish</span><strong>{roomPanel.floorFinish ?? "Not set"}</strong></div><div><span>Linked estimates</span><strong>{roomCosts.size ? costText([...roomCosts]) : "—"}</strong></div></div><h3 className="pb-detail-subheading">Room activities</h3>{activityRegister(linked)}</> : <p className="pb-table-note">This room is no longer available. Its schedule records remain intact.</p>;
  } else if (panel?.kind === "WALL") {
    const linked = wallPanel ? activities.filter((activity) => activity.roomId === wallPanel.roomId) : [];
    panelContent = wallPanel ? <><div className="pb-detail-facts"><div><span>Room</span><strong>{wallPanel.roomName}</strong></div><div><span>Length</span><strong>{length(wallPanel.lengthMm)}</strong></div><div><span>Height</span><strong>{wallPanel.heightMm === null ? "Height not set" : length(wallPanel.heightMm)}</strong></div><div><span>Gross area</span><strong>{wallArea(wallPanel.grossAreaMm2)}</strong></div><div><span>Opening area</span><strong>{area(wallPanel.openingAreaMm2)}</strong></div><div><span>Net area</span><strong>{wallArea(wallPanel.netAreaMm2)}</strong></div><div><span>Finish</span><strong>{wallPanel.finishName ?? "Not set"}</strong></div><div><span>Colour</span><strong>{wallPanel.finishColour ?? "Not set"}</strong></div></div><p className="pb-table-note">Related activities are shown at room level; the schedule has no wall-specific link.</p><h3 className="pb-detail-subheading">Room activities</h3>{activityRegister(linked)}</> : <p className="pb-table-note">This wall surface is unavailable.</p>;
  } else if (panel?.kind === "FINISHES") {
    const floorRooms = metrics.rooms.filter((room) => room.floorFinish);
    panelContent = <><p className="pb-table-note">Paint quantities remain unavailable when coverage, coats, or measured area are missing. No product coverage is assumed.</p>{paintedWalls.length ? <QuantityTable><thead><tr><th>Room</th><th>Surface</th><th>Finish</th><th>Colour</th><th>Net area</th><th>Paint quantity</th></tr></thead><tbody>{paintedWalls.map((wall) => <tr key={wall.id}><td>{wall.roomName}</td><td>Wall {wall.boundaryIndex}</td><td>{wall.finishName ?? "Colour only"}</td><td>{wall.finishColour ?? "—"}</td><td>{wallArea(wall.netAreaMm2)}</td><td>— · Coverage / coats not set</td></tr>)}</tbody></QuantityTable> : <p className="pb-table-note">No wall finishes are set.</p>}{floorRooms.length > 0 && <><h3 className="pb-detail-subheading">Floor finishes</h3><QuantityTable><thead><tr><th>Room</th><th>Floor area</th><th>Finish</th></tr></thead><tbody>{floorRooms.map((room) => <tr key={room.roomId}><td>{room.name}</td><td>{area(room.areaMm2)}</td><td>{room.floorFinish}</td></tr>)}</tbody></QuantityTable></>}</>;
  } else if (panel?.kind === "ELECTRICAL") {
    panelContent = <><div className="pb-detail-facts"><div><span>Electrical assets</span><strong>{summary.electricalCount}</strong></div><div><span>Connections</span><strong>{metrics.electricalConnections}</strong></div><div><span>Circuits</span><strong>{metrics.electricalCircuits}</strong></div></div>{metrics.electricalByType.length ? <QuantityTable><thead><tr><th>Catalogue type</th><th>Count</th></tr></thead><tbody>{metrics.electricalByType.map((item) => <tr key={item.name}><th scope="row">{item.name}</th><td>{item.count}</td></tr>)}</tbody></QuantityTable> : <p className="pb-table-note">No electrical fittings are placed.</p>}<h3 className="pb-detail-subheading">Electrical items by room</h3><QuantityTable><thead><tr><th>Room</th><th>Items</th></tr></thead><tbody>{metrics.rooms.map((room) => <tr key={room.roomId}><th scope="row">{room.name}</th><td>{count(room.electrical)}</td></tr>)}</tbody></QuantityTable></>;
  } else if (panel?.kind === "PLUMBING") {
    panelContent = metrics.plumbingClassificationAvailable ? <><p className="pb-table-note">These counts use structured catalogue classification and room containment.</p><QuantityTable><thead><tr><th>Catalogue type</th><th>Project total</th></tr></thead><tbody>{metrics.plumbingByType.map((item) => <tr key={item.name}><th scope="row">{item.name}</th><td>{item.count}</td></tr>)}</tbody></QuantityTable><QuantityTable><thead><tr><th>Room</th><th>Plumbing items</th></tr></thead><tbody>{metrics.rooms.map((room) => <tr key={room.roomId}><th scope="row">{room.name}</th><td>{count(room.plumbing)}</td></tr>)}</tbody></QuantityTable></> : <p className="pb-table-note">Structured plumbing classifications are not available in this project. Items are not guessed from display names.</p>;
  } else if (panel?.kind === "ASSETS") {
    panelContent = <><div className="pb-detail-facts"><div><span>Ordinary fittings</span><strong>{summary.fittingCount}</strong></div><div><span>Imported assets</span><strong>{metrics.importedAssetCount}</strong></div></div>{importedByCategory.size ? <QuantityTable><thead><tr><th>Catalogue category</th><th>Placed assets</th></tr></thead><tbody>{[...importedByCategory].sort(([a], [b]) => a.localeCompare(b)).map(([name, total]) => <tr key={name}><th scope="row">{name}</th><td>{total}</td></tr>)}</tbody></QuantityTable> : <p className="pb-table-note">No imported non-electrical or non-plumbing assets.</p>}</>;
  }
  if (panel?.kind === "ACTIVITIES") {
    panelContent = <><div className="pb-detail-facts"><div><span>Activities</span><strong>{activities.length}</strong></div><div><span>Scheduled range</span><strong>{summary.scheduledDays === null ? "—" : summary.scheduledDays + " calendar days"}</strong></div><div><span>Complete</span><strong>{completedCount}</strong></div><div><span>In progress</span><strong>{inProgressCount}</strong></div><div><span>Blocked / delayed</span><strong>{blockedCount + delayedCount}</strong></div></div>{activityRegister(activities)}</>;
  } else if (panel?.kind === "COSTS") {
    const groups = costGroups();
    const workloads = new Map<string, { activities: number; days: number }>();
    activities.forEach((activity) => { const trade = activity.trade?.trim() || "Unassigned"; const row = workloads.get(trade) ?? { activities: 0, days: 0 }; row.activities += 1; row.days += Math.max(0, calendarDaysBetween(activity.startDate, activity.endDate) + 1); workloads.set(trade, row); });
    const payments = activities.filter((activity) => activity.type === "payment" && typeof activity.amount === "number");
    const paymentTotals = new Map<string, number>();
    payments.forEach((activity) => { const code = activity.currency?.toUpperCase() || defaultCurrency; paymentTotals.set(code, (paymentTotals.get(code) ?? 0) + (activity.amount ?? 0)); });
    panelContent = <><div className="pb-detail-facts"><div><span>Estimated</span><strong>{costText(estimatedTotals)}</strong></div><div><span>Actual recorded</span><strong>{costText(actualTotals)}</strong></div><div><span>Payment amounts recorded</span><strong>{costText([...paymentTotals])}</strong></div><div><span>Trades with activities</span><strong>{tradeCount}</strong></div></div>
      <div className="pb-detail-toolbar"><label>Group costs by<select value={costBreakdown} onChange={(event) => setCostBreakdown(event.target.value as typeof costBreakdown)}><option value="PHASE">Phase</option><option value="TRADE">Trade</option><option value="ROOM">Room</option></select></label></div>
      {groups.length ? <QuantityTable><thead><tr><th>{costBreakdown === "PHASE" ? "Phase" : costBreakdown === "TRADE" ? "Trade" : "Room"}</th><th>Currency</th><th>Estimated</th><th>Actual</th><th>Activities with costs</th></tr></thead><tbody>{groups.map((item) => <tr key={item.label + item.currency}><th scope="row">{item.label}</th><td>{item.currency}</td><td>{item.estimated === null ? "—" : formatPlannerBuildCost(item.estimated, item.currency, defaultCurrency)}</td><td>{item.actual === null ? "—" : formatPlannerBuildCost(item.actual, item.currency, defaultCurrency)}</td><td>{item.activityCount}</td></tr>)}</tbody></QuantityTable> : <p className="pb-table-note">No estimated or actual activity costs have been entered. A dash means unknown, not zero.</p>}
      <h3 className="pb-detail-subheading">Activity costs · update estimates and actual spending</h3>
      {activities.length ? <QuantityTable><thead><tr><th>Activity</th><th>Predicted</th><th>Actual recorded</th><th>Actual − predicted</th><th /></tr></thead><tbody>{activities.map((activity) => {
        const currency = activity.currency?.trim().toUpperCase() || defaultCurrency;
        const difference = activity.actualCost !== undefined && activity.estimatedCost !== undefined ? activity.actualCost - activity.estimatedCost : null;
        return <tr key={activity.activityId}><th scope="row">{activity.name}</th><td>{activity.estimatedCost === undefined ? "Not set" : formatPlannerBuildCost(activity.estimatedCost, currency, defaultCurrency)}</td><td>{activity.actualCost === undefined ? "Not set" : formatPlannerBuildCost(activity.actualCost, currency, defaultCurrency)}</td><td className={difference !== null && difference > 0 ? "pb-cost-overrun" : undefined}>{difference === null ? "—" : `${difference > 0 ? "+" : ""}${formatPlannerBuildCost(difference, currency, defaultCurrency)}`}</td><td><button type="button" className="pb-inline-action" onClick={() => editActivity(activity)}>Edit costs</button></td></tr>;
      })}</tbody></QuantityTable> : <p className="pb-table-note">Add an activity to start recording costs.</p>}
      <p className="pb-table-note">Differences compare entered values on the same activity. Actual spending may still be incomplete.</p>
      <h3 className="pb-detail-subheading">Trade workload</h3><QuantityTable><thead><tr><th>Trade</th><th>Activities</th><th>Scheduled activity-days</th></tr></thead><tbody>{[...workloads].sort(([a], [b]) => a.localeCompare(b)).map(([trade, row]) => <tr key={trade}><th scope="row">{trade}</th><td>{row.activities}</td><td>{row.days}</td></tr>)}</tbody></QuantityTable><p className="pb-table-note">Activity-days sum inclusive date ranges; overlapping work is not netted.</p>
    </>;
  } else if (panel?.kind === "ISSUES") {
    panelContent = <><div className="pb-detail-facts"><div><span>Schedule warnings</span><strong>{warnings.length}</strong></div><div><span>Blocked</span><strong>{schedule.blockedActivities.length}</strong></div><div><span>Delayed deliveries</span><strong>{schedule.delayedDeliveries.length}</strong></div><div><span>Pending inspections</span><strong>{schedule.pendingInspections.length}</strong></div><div><span>Pending decisions</span><strong>{schedule.pendingDecisions.length}</strong></div><div><span>Payments due soon</span><strong>{schedule.paymentsDue.length}</strong></div></div>
      {warnings.length ? <QuantityTable><thead><tr><th>Issue</th><th>Activity</th><th>Severity</th><th></th></tr></thead><tbody>{warnings.map((warning) => { const activity = activities.find((item) => item.activityId === warning.activityId); return <tr key={warning.warningId}><td>{warning.message}</td><td>{activity?.name ?? "Unavailable"}</td><td>{warning.severity}</td><td>{activity && <button type="button" className="pb-inline-action" onClick={() => editActivity(activity)}>Open activity</button>}</td></tr>; })}</tbody></QuantityTable> : <p className="pb-table-note">No schedule conflicts detected.</p>}
    </>;
  } else if (panel?.kind === "QUANTITIES") {
    panelContent = <PlannerBuildQuantityTables project={project} metrics={metrics} />;
  }
  const section = (key: DashboardSectionId, eyebrow: string, title: string, note: string, children: ReactNode) => <details className="pb-data-section pb-dashboard-section" open={expanded[key]} onToggle={(event) => sectionToggle(key, event.currentTarget.open)}><summary><span><span className="pb-eyebrow">{eyebrow}</span><strong>{title}</strong></span><small>{note}</small></summary>{children}</details>;
  const openButton = (label: string, kind: DashboardPanel["kind"], id?: string) => <button type="button" className="pb-inline-action" onClick={() => openPanel(kind, id)}>{label}</button>;
  const roomRows = metrics.rooms.slice(0, 8);
  const wallRows = metrics.wallSurfaces.slice(0, 8);
  const upcoming = schedule.upcoming.slice(0, 5);

  return <section className="planner-build-table-view pb-dashboard-view" aria-label="PlannerBuild project dashboard">
    <header className="pb-dashboard-heading"><div><span className="pb-eyebrow">PlannerBuild · {project.name}</span><h1>Project dashboard</h1><p>Track spending, programme progress and materials. Updated from your saved project.</p></div><div className="pb-dashboard-actions">{historyActions}<button type="button" className="pb-primary-button" onClick={onAddActivity}>＋ Activity</button>{openButton("Activity register", "ACTIVITIES")}{openButton("Full quantity tables", "QUANTITIES")}</div></header>
    <PlannerBuildDashboard activities={activities} metrics={metrics} today={today} defaultCurrency={defaultCurrency} onEdit={editActivity} onOpen={openPanel} onAddDelivery={onAddDelivery} />
    <div className="pb-dashboard-detail-heading"><div><span className="pb-eyebrow">Explore the project</span><h2>Detailed quantities & registers</h2></div><span>{summary.roomCount} rooms · {area(summary.totalFloorAreaMm2)} floor area · {summary.uniqueWallCount} walls</span></div>
    <div className="pb-dashboard-detail-grid">
    {section("rooms", "Floorplan", "Rooms", metrics.rooms.length + " rooms · " + area(summary.totalFloorAreaMm2) + " total floor area", <>
      {roomRows.length ? <QuantityTable><thead><tr><th>Room</th><th>Floor area</th><th>Perimeter</th><th>Net wall area</th><th>Services</th><th></th></tr></thead><tbody>{roomRows.map((room) => <tr key={room.roomId}><th scope="row">{room.name}</th><td>{area(room.areaMm2)}</td><td>{length(room.perimeterMm)}</td><td>{wallArea(room.netWallAreaMm2)}</td><td>{count(room.electrical)} electrical · {count(room.plumbing)} plumbing</td><td>{openButton("Details", "ROOM", room.roomId)}</td></tr>)}</tbody></QuantityTable> : <p className="pb-table-note">No rooms have been added to this project.</p>}
      {metrics.rooms.length > roomRows.length && <p className="pb-table-note">Showing {roomRows.length} of {metrics.rooms.length} rooms. Open full quantity tables for every room.</p>}
    </>)}
    {section("walls", "Construction", "Walls & openings", summary.uniqueWallCount + " unique walls · " + summary.doorCount + " doors · " + summary.windowCount + " windows", <>
      <div className="pb-quantity-facts pb-section-facts"><div><span>Wall length</span><strong>{length(summary.totalWallLengthMm)}</strong></div><div><span>Gross wall area</span><strong>{wallArea(summary.grossWallAreaMm2)}</strong></div><div><span>Net wall area</span><strong>{wallArea(summary.netWallAreaMm2)}</strong></div><div><span>Opening area</span><strong>{metrics.openings.doorAreaMm2 === null || metrics.openings.windowAreaMm2 === null ? "Dimensions incomplete" : area(metrics.openings.doorAreaMm2 + metrics.openings.windowAreaMm2)}</strong></div></div>
      {wallRows.length ? <QuantityTable><thead><tr><th>Wall</th><th>Room</th><th>Length</th><th>Height</th><th>Net area</th><th></th></tr></thead><tbody>{wallRows.map((wall) => <tr key={wall.id}><th scope="row">Wall {wall.boundaryIndex}</th><td>{wall.roomName}</td><td>{length(wall.lengthMm)}</td><td>{wall.heightMm === null ? "Height not set" : length(wall.heightMm)}</td><td>{wallArea(wall.netAreaMm2)}</td><td>{openButton("Details", "WALL", wall.id)}</td></tr>)}</tbody></QuantityTable> : <p className="pb-table-note">Wall geometry is not available yet.</p>}
      {metrics.wallSurfaces.length > wallRows.length && <p className="pb-table-note">Showing {wallRows.length} of {metrics.wallSurfaces.length} room-boundary surfaces; shared walls may appear once per room.</p>}
    </>)}
    {section("finishes", "Materials", "Finishes & paint", paintedWalls.length + " finished wall surfaces · " + metrics.floorFinishCount + " floor finishes", <>
      <div className="pb-service-summary"><span>Painted wall area: <strong>{paintedWalls.length ? metrics.paintedWallAreaMm2 === null ? "Height not set" : area(metrics.paintedWallAreaMm2) : "Not set"}</strong></span><span>Floor finish area: <strong>{formatPlannerBuildArea(metrics.rooms.filter((room) => room.floorFinish).reduce((sum, room) => sum + room.areaMm2, 0))}</strong></span><span>Required paint: <strong>Coverage / coats not set</strong></span></div>{openButton("Open finishes detail", "FINISHES")}
    </>)}
    {section("electrical", "Services", "Electrical", summary.electricalCount + " assets · " + metrics.electricalConnections + " connections · " + metrics.electricalCircuits + " circuits", <>
      <div className="pb-service-summary"><span>Placed items: <strong>{summary.electricalCount}</strong></span><span>Connections: <strong>{metrics.electricalConnections}</strong></span><span>Circuits: <strong>{metrics.electricalCircuits}</strong></span></div>{metrics.electricalByType.length > 0 && <div className="pb-breakdown-items">{metrics.electricalByType.slice(0, 8).map((item) => <span key={item.name}>{item.name}<b>{item.count}</b></span>)}</div>}{openButton("Open electrical detail", "ELECTRICAL")}
    </>)}
    {section("plumbing", "Services", "Plumbing", count(summary.plumbingCount) + " classified assets", <>{metrics.plumbingClassificationAvailable ? <div className="pb-breakdown-items">{metrics.plumbingByType.slice(0, 8).map((item) => <span key={item.name}>{item.name}<b>{item.count}</b></span>)}</div> : <p className="pb-table-note">Structured plumbing categories are unavailable; counts are not guessed from asset names.</p>}{openButton("Open plumbing detail", "PLUMBING")}</>)}
    {section("assets", "Catalogue", "Fittings & assets", summary.fittingCount + " ordinary fittings · " + metrics.importedAssetCount + " imported assets", <><div className="pb-service-summary"><span>Ordinary fittings: <strong>{summary.fittingCount}</strong></span><span>Imported assets: <strong>{metrics.importedAssetCount}</strong></span><span>Categories: <strong>{importedByCategory.size}</strong></span></div>{openButton("Open assets detail", "ASSETS")}</>)}
    {section("programme", "Programme", "Schedule & activity register", activities.length + " activities · " + (summary.scheduledDays === null ? "no date range" : summary.scheduledDays + " calendar days"), <>
      <div className="pb-programme-stats"><div><span>Complete</span><strong>{completedCount}</strong></div><div><span>In progress</span><strong>{inProgressCount}</strong></div><div><span>Not started</span><strong>{notStartedCount}</strong></div><div><span>Blocked</span><strong>{blockedCount}</strong></div><div><span>Delayed</span><strong>{delayedCount}</strong></div></div>
      <div className="pb-dashboard-columns"><section><h3>Upcoming · next 7 days</h3>{upcoming.length ? <ul>{upcoming.map((activity) => <li key={activity.activityId}><button className="pb-link-button" type="button" onClick={() => editActivity(activity)}><i style={{ backgroundColor: activity.colour }} aria-hidden="true" />{activity.name}</button><small>{activityTypeLabel(activity.type)} · {formatDateKey(activity.startDate)}</small></li>)}</ul> : <p className="pb-table-note">Nothing due in the next 7 days.</p>}</section><section><h3>Schedule checks</h3>{warnings.length ? <ul>{warnings.slice(0, 4).map((warning) => <li className={warning.severity} key={warning.warningId}>{warning.message}</li>)}</ul> : <p className="pb-table-note">No schedule conflicts detected.</p>}</section></div>
      <div className="pb-dashboard-section-actions">{openButton("Open full activity register", "ACTIVITIES")}{warnings.length > 0 && openButton("Review all schedule checks", "ISSUES")}</div>
    </>)}
    {section("costs", "Resources", "Costs & trade workload", estimatedTotals.length || actualTotals.length ? costText(estimatedTotals) + " estimated · " + costText(actualTotals) + " actual" : "No estimated or actual costs entered", <><div className="pb-service-summary"><span>Estimated: <strong>{costText(estimatedTotals)}</strong></span><span>Actual recorded: <strong>{costText(actualTotals)}</strong></span><span>Trades assigned: <strong>{tradeCount}</strong></span></div><p className="pb-table-note">Costs use values entered on schedule activities. Currencies stay separate; unknown costs are not treated as zero.</p>{openButton("Open costs & resources", "COSTS")}</>)}
    </div>
    <div className="pb-dashboard-footnote">Floorplan quantities update from the current project. Project wall totals count unique physical segments; room wall surfaces may include shared boundaries. Missing data remains unset rather than estimated.</div>
    {panel && <div className="pb-dashboard-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setPanel(null); }}><section className={"pb-dashboard-dialog " + (panel.kind === "QUANTITIES" ? "pb-dashboard-dialog-wide" : panel.kind === "ACTIVITIES" ? "pb-dashboard-dialog-register" : "")} role="dialog" aria-modal="true" aria-labelledby="pb-dashboard-dialog-title"><header><div><span className="pb-eyebrow">PlannerBuild · Project detail</span><h2 id="pb-dashboard-dialog-title">{panelTitles[panel.kind]}</h2></div><div className="window-header-actions"><WindowHelpButton title={panelTitles[panel.kind]} /><button type="button" className="pb-close-button" aria-label="Close details" onClick={() => setPanel(null)}>×</button></div></header><div className="pb-dashboard-dialog-content">{panelContent}</div></section></div>}
  </section>;
}
