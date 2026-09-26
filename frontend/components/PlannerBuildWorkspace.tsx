"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { ProjectDocument } from "@/lib/projectDocument";
import {
  addCalendarDays, calculatePlannerBuildMetrics, calendarDaysBetween, formatDateKey, isIsoDate,
  localDateKey, PLANNER_BUILD_CATEGORIES, type PlannerBuildActivity,
} from "@/lib/plannerBuild";
import { formatArea, formatLength, type DisplayUnits } from "@/lib/units";

export type PlannerBuildView = "GANTT" | "TABLE";
interface Props { project: ProjectDocument; view: PlannerBuildView; displayUnits: DisplayUnits; onActivitiesChange: (activities: PlannerBuildActivity[]) => void }
type ActivityDraft = { activityId: string | null; name: string; startDate: string; endDate: string; colour: string; category: string; roomId: string; progress: number; notes: string };
type GanttScale = "DAY" | "WEEK" | "MONTH";
type DragKind = "MOVE" | "START" | "END";
type DragState = { activityId: string; kind: DragKind; pointerId: number; originX: number; startDate: string; endDate: string };
type ActivityRange = { activityId: string; startDate: string; endDate: string };
const COLOUR_PRESETS = ["#287FB8", "#D97832", "#3F8C66", "#C54C4C", "#8059A5", "#C29A27", "#68746E"];
const SCALE_DAY_WIDTH: Record<GanttScale, number> = { DAY: 42, WEEK: 18, MONTH: 5 };
const LABEL_WIDTH = 290;
const EMPTY_ACTIVITIES: PlannerBuildActivity[] = [];

function newDraft(activity?: PlannerBuildActivity): ActivityDraft {
  const today = localDateKey();
  return activity
    ? { activityId: activity.activityId, name: activity.name, startDate: activity.startDate, endDate: activity.endDate, colour: activity.colour, category: activity.category ?? "", roomId: activity.roomId ?? "", progress: activity.progress, notes: activity.notes ?? "" }
    : { activityId: null, name: "", startDate: today, endDate: today, colour: COLOUR_PRESETS[0], category: "", roomId: "", progress: 0, notes: "" };
}
function stableId() { return globalThis.crypto?.randomUUID?.() ?? `activity-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
function progressLabel(activity: PlannerBuildActivity) { return activity.progress >= 100 ? "Complete" : activity.progress > 0 ? "In progress" : "Not started"; }

export function PlannerBuildWorkspace({ project, view, displayUnits, onActivitiesChange }: Props) {
  const activities = project.plannerBuild?.activities ?? EMPTY_ACTIVITIES;
  const rooms = project.rooms;
  const metrics = useMemo(() => calculatePlannerBuildMetrics(project), [project]);
  const [draft, setDraft] = useState<ActivityDraft | null>(null);
  const [formError, setFormError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scale, setScale] = useState<GanttScale>("WEEK");
  const [roomFilter, setRoomFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [past, setPast] = useState<PlannerBuildActivity[][]>([]);
  const [future, setFuture] = useState<PlannerBuildActivity[][]>([]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [previewRange, setPreviewRange] = useState<ActivityRange | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const previewRef = useRef<ActivityRange | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!draft) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setDraft(null); setFormError(""); } };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [draft]);

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
  function openEditor(activity?: PlannerBuildActivity) { setSelectedId(activity?.activityId ?? null); setDraft(newDraft(activity)); setFormError(""); }
  function saveActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!draft) return;
    if (!draft.name.trim()) { setFormError("Enter an activity name."); return; }
    if (!isIsoDate(draft.startDate) || !isIsoDate(draft.endDate)) { setFormError("Choose valid start and end dates."); return; }
    if (calendarDaysBetween(draft.startDate, draft.endDate) < 0) { setFormError("The end date must be on or after the start date."); return; }
    const existing = activities.find((item) => item.activityId === draft.activityId);
    const item: PlannerBuildActivity = {
      activityId: draft.activityId ?? stableId(), name: draft.name.trim().slice(0, 200), startDate: draft.startDate, endDate: draft.endDate,
      colour: draft.colour.toUpperCase(), ...(draft.category ? { category: draft.category } : {}), roomId: draft.roomId || null,
      progress: Math.max(0, Math.min(100, Math.round(draft.progress))), ...(draft.notes.trim() ? { notes: draft.notes.trim().slice(0, 5000) } : {}),
      sortOrder: existing?.sortOrder ?? activities.reduce((max, current) => Math.max(max, current.sortOrder), -1) + 1,
    };
    commitActivities(existing ? activities.map((current) => current.activityId === existing.activityId ? item : current) : [...activities, item]);
    setSelectedId(item.activityId); setDraft(null);
  }
  function deleteActivity() {
    if (!draft?.activityId) return;
    commitActivities(activities.filter((item) => item.activityId !== draft.activityId)); setSelectedId(null); setDraft(null);
  }

  const sortedActivities = useMemo(() => [...activities].sort((a, b) => a.sortOrder - b.sortOrder || a.activityId.localeCompare(b.activityId)), [activities]);
  const visibleActivities = sortedActivities.filter((item) => (roomFilter === "ALL" || (item.roomId ?? "") === roomFilter) && (categoryFilter === "ALL" || (item.category ?? "") === categoryFilter));
  const categories = [...new Set(sortedActivities.map((item) => item.category).filter((value): value is string => Boolean(value)))];
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

  const rendered = view === "GANTT" ? (
    <section className="planner-build-gantt" aria-label="Project programme Gantt view">
      <div className="pb-view-heading"><div><span className="pb-eyebrow">PlannerBuild · Programme</span><h1>Project programme</h1><p>Plan and update the timing of work in this project.</p></div></div>
      <div className="pb-gantt-toolbar">
        <button type="button" className="pb-primary-button" onClick={() => openEditor()}>＋ Activity</button>
        <button type="button" className="pb-secondary-button" disabled={!todayVisible} onClick={scrollToToday}>Today</button>
        <label><span>Zoom</span><select value={scale} onChange={(event) => setScale(event.target.value as GanttScale)}><option value="DAY">Day</option><option value="WEEK">Week</option><option value="MONTH">Month</option></select></label>
        <label><span>Room</span><select value={roomFilter} onChange={(event) => setRoomFilter(event.target.value)}><option value="ALL">All rooms</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name || "Unnamed room"}</option>)}</select></label>
        <label><span>Category</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="ALL">All categories</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
        <div className="pb-history-actions" aria-label="Schedule history"><button type="button" disabled={!past.length} onClick={undo}>Undo</button><button type="button" disabled={!future.length} onClick={redo}>Redo</button></div>
      </div>
      {!activities.length ? <div className="pb-empty-state"><span className="pb-empty-icon" aria-hidden="true">▤</span><h2>No activities yet</h2><p>Add activities to build a project programme alongside your floorplan.</p><button type="button" className="pb-primary-button" onClick={() => openEditor()}>Add first activity</button></div>
      : !visibleActivities.length ? <div className="pb-empty-state"><h2>No matching activities</h2><p>Change the room or category filter to see more of the schedule.</p></div>
      : <div className="pb-gantt-scroll" ref={scrollRef} aria-label="Scrollable Gantt schedule">
        <div className="pb-gantt-grid" style={timelineStyle} role="table" aria-label="Project activity schedule">
          <div className="pb-gantt-header" role="row"><div className="pb-gantt-header-label" role="columnheader">Activity <span>Start · End</span></div>
            <div className="pb-gantt-timeline-head" role="columnheader" style={{ width: timelineWidth, backgroundSize: `${dayWidth}px 100%` }}>
              {ticks.map((tick) => <span key={tick.offset} style={{ left: tick.offset * dayWidth }}>{tick.label}</span>)}
              {todayVisible && <i className="pb-today-head-marker" style={{ left: (todayOffset + 0.5) * dayWidth }} title="Today" />}
            </div>
          </div>
          <div className="pb-gantt-body" onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
            {visibleActivities.map((activity) => {
              const shown = previewRange?.activityId === activity.activityId ? previewRange : activity;
              const left = calendarDaysBetween(timelineStart, shown.startDate) * dayWidth;
              const width = Math.max(14, (calendarDaysBetween(shown.startDate, shown.endDate) + 1) * dayWidth - Math.max(2, Math.min(6, dayWidth / 5)));
              const selected = selectedId === activity.activityId;
              return <div className={`pb-gantt-row ${selected ? "selected" : ""}`} key={activity.activityId} role="row">
                <div className="pb-gantt-activity-cell" role="rowheader">
                  <button type="button" className="pb-activity-name" onClick={() => setSelectedId(activity.activityId)} onDoubleClick={() => openEditor(activity)} aria-label={`${activity.name}, ${progressLabel(activity)}. Double-click to edit.`}><strong>{activity.name}</strong><span>{formatDateKey(activity.startDate, { day: "2-digit", month: "short" })} – {formatDateKey(activity.endDate, { day: "2-digit", month: "short" })}</span></button>
                  <button type="button" className="pb-edit-activity" onClick={() => openEditor(activity)} aria-label={`Edit ${activity.name}`} title="Edit activity">···</button>
                </div>
                <div className="pb-gantt-lane" role="cell" style={{ width: timelineWidth, backgroundSize: `${dayWidth}px 100%` }}>
                  <div className={`pb-gantt-bar ${selected ? "selected" : ""} ${drag?.activityId === activity.activityId ? "dragging" : ""}`} style={{ left, width, backgroundColor: activity.colour }} role="group" aria-label={`${activity.name}: ${formatDateKey(shown.startDate)} to ${formatDateKey(shown.endDate)}, ${activity.progress}% complete`} tabIndex={0} onPointerDown={(event) => beginDrag(event, activity, "MOVE")} onClick={() => setSelectedId(activity.activityId)} onDoubleClick={() => openEditor(activity)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openEditor(activity); } }} title={`${activity.name} · drag to move · double-click to edit`}>
                    <span className="pb-gantt-progress" style={{ width: `${activity.progress}%` }} /><span className="pb-gantt-bar-label">{width > 76 ? activity.name : ""}</span>
                    <button type="button" className="pb-gantt-resize pb-gantt-resize-start" aria-label={`Change start date for ${activity.name}`} onPointerDown={(event) => beginDrag(event, activity, "START")} />
                    <button type="button" className="pb-gantt-resize pb-gantt-resize-end" aria-label={`Change end date for ${activity.name}`} onPointerDown={(event) => beginDrag(event, activity, "END")} />
                  </div>
                </div>
              </div>;
            })}
            {todayVisible && <div className="pb-today-line" style={{ left: `calc(var(--pb-label-width) + ${(todayOffset + 0.5) * dayWidth}px)` }} aria-hidden="true" />}
          </div>
        </div>
      </div>}
      {draft && <div className="pb-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setDraft(null); setFormError(""); } }}>
        <section className="pb-activity-dialog" role="dialog" aria-modal="true" aria-labelledby="pb-activity-dialog-title">
          <header><div><span className="pb-eyebrow">PlannerBuild · Schedule</span><h2 id="pb-activity-dialog-title">{draft.activityId ? "Edit activity" : "Add activity"}</h2></div><button type="button" className="pb-close-button" aria-label="Close activity editor" onClick={() => { setDraft(null); setFormError(""); }}>×</button></header>
          <form onSubmit={saveActivity}>
            <label className="pb-field"><span>Activity name <b>*</b></span><input autoFocus maxLength={200} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. Electrical first fix" /></label>
            <div className="pb-field-grid"><label className="pb-field"><span>Start date <b>*</b></span><input required type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} /></label><label className="pb-field"><span>End date <b>*</b></span><input required type="date" min={draft.startDate || undefined} value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} /></label></div>
            <label className="pb-field"><span>Colour <b>*</b></span><div className="pb-colour-picker"><div className="pb-colour-presets">{COLOUR_PRESETS.map((colour) => <button type="button" key={colour} className={draft.colour.toUpperCase() === colour ? "selected" : ""} style={{ backgroundColor: colour }} aria-label={`Use ${colour} activity colour`} aria-pressed={draft.colour.toUpperCase() === colour} onClick={() => setDraft({ ...draft, colour })} />)}</div><input type="color" aria-label="Custom activity colour" value={draft.colour} onChange={(event) => setDraft({ ...draft, colour: event.target.value })} /></div></label>
            <div className="pb-field-grid"><label className="pb-field"><span>Category</span><select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}><option value="">No category</option>{PLANNER_BUILD_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}{draft.category && !PLANNER_BUILD_CATEGORIES.includes(draft.category as typeof PLANNER_BUILD_CATEGORIES[number]) && <option value={draft.category}>{draft.category}</option>}</select></label>
              <label className="pb-field"><span>Room</span><select value={draft.roomId} onChange={(event) => setDraft({ ...draft, roomId: event.target.value })}><option value="">All project</option>{draft.roomId && !rooms.some((room) => room.id === draft.roomId) && <option value={draft.roomId}>Room unavailable · unassigned</option>}{rooms.map((room) => <option key={room.id} value={room.id}>{room.name || "Unnamed room"}</option>)}</select></label></div>
            <label className="pb-field"><span>Progress <strong>{draft.progress}%</strong></span><input type="range" min={0} max={100} step={5} value={draft.progress} onChange={(event) => setDraft({ ...draft, progress: Number(event.target.value) })} /></label>
            <label className="pb-field"><span>Notes</span><textarea rows={3} maxLength={5000} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Optional notes" /></label>
            {formError && <p className="pb-form-error" role="alert">{formError}</p>}
            <footer>{draft.activityId && <button type="button" className="pb-danger-button" onClick={deleteActivity}>Delete activity</button>}<span /><button type="button" className="pb-secondary-button" onClick={() => { setDraft(null); setFormError(""); }}>Cancel</button><button type="submit" className="pb-primary-button">{draft.activityId ? "Save changes" : "Add activity"}</button></footer>
          </form>
        </section>
      </div>}
    </section>
  ) : <PlannerBuildTable project={project} metrics={metrics} displayUnits={displayUnits} />;
  return <div className="planner-build-content">{rendered}</div>;
}

function MetricCard({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return <article className="pb-metric-card"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</article>;
}

function QuantityTable({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`pb-table-scroll ${className}`}><table className="pb-quantity-table">{children}</table></div>;
}

function PlannerBuildTable({ project, metrics, displayUnits }: { project: ProjectDocument; metrics: ReturnType<typeof calculatePlannerBuildMetrics>; displayUnits: DisplayUnits }) {
  const summary = metrics.summary;
  const activities = project.plannerBuild?.activities ?? [];
  const area = (value: number | null) => value === null ? "Not set" : formatArea(value, displayUnits);
  const length = (value: number | null) => value === null ? "Not set" : formatLength(value, displayUnits);
  const wallArea = (value: number | null) => value !== null ? formatArea(value, displayUnits) : metrics.rooms.length ? "Height not set" : "—";
  const count = (value: number | null) => value === null ? "Not classified" : value.toLocaleString("en-GB");
  const openingArea = (value: number | null) => value === null ? "Dimensions incomplete" : area(value);
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

  return <section className="planner-build-table-view" aria-label="PlannerBuild quantities and project summary">
    <div className="pb-view-heading"><div><span className="pb-eyebrow">PlannerBuild · Quantities</span><h1>Project summary</h1><p>Live quantities derived from the current floorplan and project data.</p></div></div>
    <section className="pb-summary-section" aria-labelledby="pb-summary-heading">
      <div className="pb-section-heading"><div><span className="pb-eyebrow">At a glance</span><h2 id="pb-summary-heading">Project summary</h2></div></div>
      <div className="pb-metric-grid">
        <MetricCard label="Rooms" value={summary.roomCount} />
        <MetricCard label="Floor area" value={area(summary.totalFloorAreaMm2)} />
        <MetricCard label="Room perimeter" value={length(summary.totalRoomPerimeterMm)} />
        <MetricCard label="Unique walls" value={summary.uniqueWallCount} detail={length(summary.totalWallLengthMm)} />
        <MetricCard label="Gross wall area" value={wallArea(summary.grossWallAreaMm2)} />
        <MetricCard label="Net wall area" value={wallArea(summary.netWallAreaMm2)} detail="After known openings" />
        <MetricCard label="Doors · windows" value={`${summary.doorCount} · ${summary.windowCount}`} detail={`Opening area ${openingArea(metrics.openings.doorAreaMm2)} · ${openingArea(metrics.openings.windowAreaMm2)}`} />
        <MetricCard label="Fittings · electrical" value={`${summary.fittingCount} · ${summary.electricalCount}`} />
        <MetricCard label="Plumbing" value={count(summary.plumbingCount)} detail={metrics.plumbingClassificationAvailable ? "Structured catalogue classifications" : "No structured plumbing classification"} />
        <MetricCard label="Activities" value={summary.activityCount} detail={summary.scheduledDays === null ? "No scheduled range" : `${summary.scheduledDays} calendar days`} />
      </div>
    </section>

    <details className="pb-data-section" open>
      <summary><span><span className="pb-eyebrow">Floorplan</span><strong>Rooms</strong></span><small>{metrics.rooms.length} rooms</small></summary>
      {metrics.rooms.length ? <QuantityTable><thead><tr><th>Room</th><th>Floor area</th><th>Perimeter</th><th>Walls</th><th>Wall area</th><th>Doors</th><th>Windows</th><th>Electrical</th><th>Plumbing</th><th>Other fittings</th></tr></thead><tbody>
        {metrics.rooms.map((room) => <tr key={room.roomId}><th scope="row">{room.name}</th><td>{area(room.areaMm2)}</td><td>{length(room.perimeterMm)}</td><td>{room.boundaryCount}</td><td>{wallArea(room.netWallAreaMm2)}</td><td>{room.doors}</td><td>{room.windows}</td><td>{count(room.electrical)}</td><td>{count(room.plumbing)}</td><td>{room.otherFittings}</td></tr>)}
      </tbody></QuantityTable> : <p className="pb-table-note">No rooms have been added to this project.</p>}
    </details>

    <details className="pb-data-section">
      <summary><span><span className="pb-eyebrow">Construction</span><strong>Walls</strong></span><small>{summary.uniqueWallCount} unique wall segments</small></summary>
      {metrics.wallSurfaces.length ? <QuantityTable><thead><tr><th>Wall</th><th>Room</th><th>Length</th><th>Height</th><th>Gross area</th><th>Opening area</th><th>Net area</th><th>Finish</th></tr></thead><tbody>
        {metrics.wallSurfaces.map((wall) => <tr key={wall.id}><th scope="row">Wall {wall.boundaryIndex}</th><td>{wall.roomName}</td><td>{length(wall.lengthMm)}</td><td>{length(wall.heightMm) === "Not set" ? "Height not set" : length(wall.heightMm)}</td><td>{wallArea(wall.grossAreaMm2)}</td><td>{area(wall.openingAreaMm2)}</td><td>{wallArea(wall.netAreaMm2)}</td><td>{wall.finishName ? <span className="pb-finish-value"><i style={{ backgroundColor: wall.finishColour ?? "transparent" }} />{wall.finishName}</span> : "Not set"}</td></tr>)}
      </tbody></QuantityTable> : <p className="pb-table-note">Wall geometry is not available yet.</p>}
      <p className="pb-table-note">Project wall count and length use unique physical segments. Wall surface quantities are shown per room boundary, so a shared wall can have an interior surface in each room. Missing wall heights are not estimated.</p>
    </details>

    <details className="pb-data-section">
      <summary><span><span className="pb-eyebrow">Openings</span><strong>Doors &amp; windows</strong></span><small>{summary.doorCount + summary.windowCount} openings</small></summary>
      <div className="pb-metric-grid pb-opening-grid"><MetricCard label="Doors" value={metrics.openings.doors} detail={`Known opening area · ${openingArea(metrics.openings.doorAreaMm2)}`} /><MetricCard label="Windows" value={metrics.openings.windows} detail={`Known opening area · ${openingArea(metrics.openings.windowAreaMm2)}`} /></div>
    </details>

    <details className="pb-data-section">
      <summary><span><span className="pb-eyebrow">Materials</span><strong>Finishes &amp; paint</strong></span><small>{paintedWalls.length} finished wall surfaces</small></summary>
      <div className="pb-metric-grid pb-opening-grid"><MetricCard label="Painted wall area" value={paintedAreaLabel} detail="Known finished wall surfaces, after known openings" /><MetricCard label="Rooms with floor finish" value={`${metrics.floorFinishCount} of ${metrics.rooms.length}`} /></div>
      {paintedWalls.length ? <QuantityTable><thead><tr><th>Room</th><th>Surface</th><th>Paint / finish</th><th>Colour</th><th>Area</th><th>Required paint</th></tr></thead><tbody>
        {paintedWalls.map((wall) => <tr key={wall.id}><td>{wall.roomName}</td><td>Wall {wall.boundaryIndex}</td><td>{wall.finishName ?? "Colour only"}</td><td>{wall.finishColour ? <span className="pb-finish-value"><i style={{ backgroundColor: wall.finishColour }} />{wall.finishColour}</span> : "Not set"}</td><td>{wallArea(wall.netAreaMm2)}</td><td title="Paint coverage and coat count are not stored in this project">— · Coverage / coats not set</td></tr>)}
      </tbody></QuantityTable> : <p className="pb-table-note">No wall paint/finish data is set. Floor finishes are assigned in {metrics.floorFinishCount} of {metrics.rooms.length} rooms.</p>}
      <p className="pb-table-note">Paint litres are not estimated: this project has no structured coverage-per-litre or coat-count values. Floor finish area follows each room’s measured polygon.</p>
      {metrics.rooms.some((room) => room.floorFinish) && <QuantityTable><thead><tr><th>Room</th><th>Floor area</th><th>Floor finish</th></tr></thead><tbody>{metrics.rooms.filter((room) => room.floorFinish).map((room) => <tr key={room.roomId}><th scope="row">{room.name}</th><td>{area(room.areaMm2)}</td><td>{room.floorFinish}</td></tr>)}</tbody></QuantityTable>}
    </details>

    <details className="pb-data-section">
      <summary><span><span className="pb-eyebrow">Services</span><strong>Electrical</strong></span><small>{summary.electricalCount} items · {metrics.electricalConnections} connections · {metrics.electricalCircuits} circuits</small></summary>
      {metrics.electricalByType.length ? <QuantityTable><thead><tr><th>Catalogue type</th><th>Count</th></tr></thead><tbody>{metrics.electricalByType.map((item) => <tr key={item.name}><th scope="row">{item.name}</th><td>{item.count}</td></tr>)}</tbody></QuantityTable> : <p className="pb-table-note">No electrical fittings are placed.</p>}
      <div className="pb-service-summary"><span><strong>{summary.electricalCount}</strong> electrical fittings</span><span><strong>{metrics.electricalConnections}</strong> schematic connections</span><span><strong>{metrics.electricalCircuits}</strong> circuits</span></div>
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
      <summary><span><span className="pb-eyebrow">Programme</span><strong>Schedule</strong></span><small>{summary.activityCount} activities</small></summary>
      <div className="pb-metric-grid pb-schedule-grid"><MetricCard label="Earliest start" value={summary.earliestStart ? formatDateKey(summary.earliestStart) : "—"} /><MetricCard label="Latest finish" value={summary.latestFinish ? formatDateKey(summary.latestFinish) : "—"} /><MetricCard label="Calendar duration" value={summary.scheduledDays === null ? "—" : `${summary.scheduledDays} days`} /><MetricCard label="Progress" value={`${summary.completedActivities} complete`} detail={`${summary.inProgressActivities} in progress · ${summary.notStartedActivities} not started`} /></div>
      {activities.length > 0 && <QuantityTable><thead><tr><th>Activity</th><th>Start</th><th>End</th><th>Category</th><th>Room</th><th>Progress</th></tr></thead><tbody>{activities.map((activity) => <tr key={activity.activityId}><th scope="row"><span className="pb-activity-table-name"><i style={{ backgroundColor: activity.colour }} />{activity.name}</span></th><td>{formatDateKey(activity.startDate)}</td><td>{formatDateKey(activity.endDate)}</td><td>{activity.category || "—"}</td><td>{activity.roomId ? project.rooms.find((room) => room.id === activity.roomId)?.name ?? "Room unavailable" : "All project"}</td><td>{activity.progress}%</td></tr>)}</tbody></QuantityTable>}
    </details>
  </section>;
}
