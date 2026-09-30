"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { calendarDaysBetween, formatDateKey, type calculatePlannerBuildMetrics, type PlannerBuildActivity } from "@/lib/plannerBuild";
import { calculatePlannerBuildDashboard, dashboardDueDate, plannedDeliveryDate } from "@/lib/plannerBuildDashboard";
import { formatPlannerBuildArea } from "@/lib/plannerBuildPresentation";
import type { CurrencyCode } from "@/lib/appPreferences";
import styles from "./PlannerBuildDashboard.module.css";

type Metrics = ReturnType<typeof calculatePlannerBuildMetrics>;
type Detail = "COSTS" | "ACTIVITIES" | "ISSUES" | "FINISHES" | "QUANTITIES";
const money = (value: number | null, currency: string) => {
  if (value === null) return "—";
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${currency} ${value.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`; }
};
const date = (value: string | null | undefined) => value ? formatDateKey(value, { day: "numeric", month: "short", year: "numeric" }) : "Not set";

export function PlannerBuildDashboard({ activities, metrics, today, defaultCurrency = "GBP", onEdit, onOpen, onAddDelivery }: {
  activities: PlannerBuildActivity[]; metrics: Metrics; today: string; defaultCurrency?: CurrencyCode;
  onEdit: (activity: PlannerBuildActivity) => void; onOpen: (kind: Detail) => void; onAddDelivery: () => void;
}) {
  const data = useMemo(() => calculatePlannerBuildDashboard(activities, today, defaultCurrency), [activities, today, defaultCurrency]);
  const [allDeliveries, setAllDeliveries] = useState(false);
  const [allDates, setAllDates] = useState(false);
  const costs = data.costs.filter((row) => row.estimated !== null || row.actual !== null);
  const totalText = (field: "estimated" | "actual") => costs.filter((row) => row[field] !== null).map((row) => money(row[field], row.currency)).join(" · ") || "—";
  const estimateCount = costs.reduce((sum, row) => sum + row.estimatedCount, 0);
  const actualCount = costs.reduce((sum, row) => sum + row.actualCount, 0);
  const finish = metrics.summary.latestFinish;
  const remainingDays = finish ? calendarDaysBetween(today, finish) : null;
  const dateItems = [...data.overdue, ...data.upcoming];
  const deliveries = allDeliveries ? data.deliveries : data.deliveries.slice(0, 4);
  const progressGap = data.recordedProgress !== null && data.plannedProgress !== null ? data.recordedProgress - data.plannedProgress : null;
  const complete = activities.filter((activity) => activity.status === "completed").length;
  const blocked = activities.filter((activity) => activity.status === "blocked" || activity.status === "delayed");
  const gaps = [
    { label: "Activities without estimates", items: data.estimatesMissing },
    { label: "Completed items without actual costs", items: data.completedActualsMissing },
    { label: "Work without a trade", items: data.unassignedWork },
    { label: "Completed work without finish dates", items: activities.filter((activity) => (activity.type === "task" || activity.type === "waiting") && activity.status === "completed" && !activity.actualEndDate) },
  ];
  const action = (label: string, kind: Detail) => <button type="button" className="pb-inline-action" onClick={() => onOpen(kind)}>{label}</button>;

  return <div className={styles.dashboard}>
    <div className={styles.kpis} aria-label="Project performance">
      <article className={styles.kpi}><span>Predicted cost</span><strong>{totalText("estimated")}</strong><small>{estimateCount} of {activities.length} activities estimated</small>{action("Manage costs", "COSTS")}</article>
      <article className={styles.kpi}><span>Actual cost recorded</span><strong>{totalText("actual")}</strong><small>{actualCount} of {activities.length} activities with actuals</small>{action("Update actuals", "COSTS")}</article>
      <article className={`${styles.kpi} ${styles.progressKpi}`}><span>Overall work progress</span><strong>{data.recordedProgress === null ? "—" : `${data.recordedProgress}%`}</strong><small>{data.workCount ? `${data.workCount} work activities · weighted by duration` : "Add work activities to track progress"}</small>{action("Update progress", "ACTIVITIES")}</article>
      <article className={styles.kpi}><span>Scheduled finish</span><strong>{date(finish)}</strong><small>{remainingDays === null ? "Add dates to your programme" : remainingDays < 0 ? `${Math.abs(remainingDays)} days since planned finish` : remainingDays === 0 ? "Scheduled to finish today" : `${remainingDays} calendar days to planned finish`}</small>{action("Review programme", "ACTIVITIES")}</article>
    </div>

    <div className={styles.columns}>
      <section className={styles.card} aria-label="Predicted and actual costs">
        <header><div><span className="pb-eyebrow">Budget & spending</span><h2>Predicted vs actual</h2></div>{action("Cost register", "COSTS")}</header>
        <div className={styles.legend}><span><i className={styles.predictedSwatch} />Predicted</span><span><i className={styles.actualSwatch} />Actual recorded</span></div>
        {costs.length ? costs.map((row) => {
          const max = Math.max(row.estimated ?? 0, row.actual ?? 0, 1);
          const variance = row.pairedCount ? row.pairedActual - row.pairedEstimated : null;
          return <div className={styles.costGroup} key={row.currency}>
            <div className={styles.costHeading}><strong>{row.currency}</strong><span>{row.estimatedCount} estimates · {row.actualCount} actuals</span></div>
            {(["estimated", "actual"] as const).map((field) => <div className={styles.costLine} key={field}><span>{field === "estimated" ? "Predicted" : "Actual"}</span><div className={styles.barTrack} aria-hidden="true"><i className={field === "estimated" ? styles.predictedBar : styles.actualBar} style={{ width: `${(row[field] ?? 0) / max * 100}%` }} /></div><strong>{money(row[field], row.currency)}</strong></div>)}
            <p className={variance !== null && variance > 0 ? styles.problem : styles.caption}>{variance === null ? "Enter both costs on an activity to compare like-for-like." : `${money(Math.abs(variance), row.currency)} ${variance > 0 ? "above" : variance < 0 ? "below" : "difference from"} estimate on ${row.pairedCount} matched ${row.pairedCount === 1 ? "activity" : "activities"}.`}</p>
          </div>;
        }) : <div className={styles.empty}><strong>Start with an activity estimate</strong><p>Open an activity to add its predicted cost, then record actual spending as work proceeds.</p>{action("Open activities", "ACTIVITIES")}</div>}
        <p className={styles.caption}>Predicted costs are entered estimates. Actuals may be partial; a lower spend does not yet mean a saving. Currencies are shown separately.</p>
        {data.costs.some((row) => row.paid !== null || row.unpaid !== null) && <div className={styles.paymentStrip}><strong>Payment register</strong>{data.costs.filter((row) => row.paid !== null || row.unpaid !== null).map((row) => <span key={row.currency}>{money(row.paid, row.currency)} paid · {money(row.unpaid, row.currency)} unpaid</span>)}<small>Payment entries are separate from activity costs and are not added to spending twice.</small></div>}
      </section>

      <section className={styles.card} aria-label="Programme and progress">
        <header><div><span className="pb-eyebrow">Programme</span><h2>Progress & timing</h2></div>{action("Schedule checks", "ISSUES")}</header>
        <div className={styles.progressBody}>
          <div className={styles.ring} style={{ "--completion": `${data.recordedProgress ?? 0}%` } as CSSProperties} role="img" aria-label={`Recorded work progress: ${data.recordedProgress ?? "not set"}${data.recordedProgress === null ? "" : "%"}`}><div><strong>{data.recordedProgress === null ? "—" : `${data.recordedProgress}%`}</strong><span>recorded</span></div></div>
          <div className={styles.progressDetail}><strong>{progressGap === null ? "No work progress yet" : `${Math.abs(progressGap)} percentage points ${progressGap < 0 ? "behind" : progressGap > 0 ? "ahead of" : "from"} plan`}</strong><p>Planned by start of today: {data.plannedProgress === null ? "—" : `${data.plannedProgress}%`}</p><div className={styles.barTrack} aria-hidden="true"><i className={styles.predictedBar} style={{ width: `${data.plannedProgress ?? 0}%` }} /></div><small>Work and waiting activities, weighted by scheduled days. Planned progress assumes even progress across each date range.</small></div>
        </div>
        <dl className={styles.facts}><div><dt>Planned start</dt><dd>{date(metrics.summary.earliestStart)}</dd></div><div><dt>Planned finish</dt><dd>{date(finish)}</dd></div><div><dt>First actual work start</dt><dd>{date(data.actualStart)}</dd></div><div><dt>Actual work finish</dt><dd>{data.actualFinish ? date(data.actualFinish) : `${data.actualFinishesRecorded} / ${data.workCount} finish dates recorded`}</dd></div><div><dt>Programme length</dt><dd>{metrics.summary.scheduledDays === null ? "—" : `${metrics.summary.scheduledDays} days`}</dd></div><div><dt>Activities complete</dt><dd>{complete} / {activities.length}</dd></div></dl>
        <div className={styles.alertStrip}><span className={data.overdue.length ? styles.problem : styles.caption}>{data.overdue.length} overdue</span><span className={blocked.length ? styles.problem : styles.caption}>{blocked.length} blocked / delayed</span></div>
        <p className={styles.caption}>Record actual start and finish dates in each activity. The register compares each recorded finish with its planned date; overall work finish appears when all work has a finish date.</p>
      </section>

      <section className={styles.card} aria-label="Dates and priorities">
        <header><div><span className="pb-eyebrow">Your next actions</span><h2>Overdue & next 14 days</h2></div>{action("All activities", "ACTIVITIES")}</header>
        {dateItems.length ? <ul className={styles.agenda}>{(allDates ? dateItems : dateItems.slice(0, 5)).map((activity) => {
          const due = dashboardDueDate(activity), late = due < today;
          return <li key={activity.activityId} className={late ? styles.late : undefined}><div className={styles.dateStamp}><strong>{formatDateKey(due, { day: "2-digit" })}</strong><span>{formatDateKey(due, { month: "short" })}</span></div><div><button className="pb-link-button" type="button" onClick={() => onEdit(activity)}>{activity.name}</button><small>{activity.type} · {activity.trade || "No trade assigned"}</small></div><span className={styles.dueBadge}>{late ? `${calendarDaysBetween(due, today)}d overdue` : due === today ? "Today" : `In ${calendarDaysBetween(today, due)}d`}</span></li>;
        })}</ul> : <div className={styles.empty}><strong>No deadlines in the next fortnight</strong><p>Scheduled work, milestones, deliveries, decisions and payments appear here when due.</p></div>}
        {dateItems.length > 5 && <button type="button" className="pb-inline-action" aria-expanded={allDates} onClick={() => setAllDates(!allDates)}>{allDates ? "Show fewer dates" : `Show all ${dateItems.length} dates`}</button>}
      </section>

      <section className={styles.card} aria-label="Project data completeness">
        <header><div><span className="pb-eyebrow">Keep the dashboard useful</span><h2>Data to complete</h2></div>{action("Activity register", "ACTIVITIES")}</header>
        <ul className={styles.checklist}>{gaps.map(({ label, items }) => <li key={label}><div><strong>{items.length}</strong><span>{label}</span></div>{items[0] && <button type="button" className="pb-inline-action" onClick={() => onEdit(items[0])}>Update next</button>}</li>)}<li><div><strong>{metrics.wallSurfaces.filter((wall) => wall.heightMm === null).length}</strong><span>Wall surfaces without height</span></div>{action("View quantities", "QUANTITIES")}</li><li><div><strong>{metrics.rooms.filter((room) => !room.floorFinish).length}</strong><span>Rooms without a floor finish</span></div>{action("View finishes", "FINISHES")}</li></ul>
        <p className={styles.caption}>Leave costs blank when unknown. Enter 0 explicitly for activities with no cost. Geometry and finish assignments are edited in Floorplan.</p>
      </section>

      <section className={`${styles.card} ${styles.fullWidth}`} aria-label="Materials and procurement">
        <header><div><span className="pb-eyebrow">Materials & procurement</span><h2>Quantities, orders & deliveries</h2></div><div className={styles.actions}>{action("Finishes & paint", "FINISHES")}<button type="button" className="pb-inline-action" onClick={onAddDelivery}>＋ Delivery</button></div></header>
        <div className={styles.materialFacts}><div><span>Floor area</span><strong>{formatPlannerBuildArea(metrics.summary.totalFloorAreaMm2)}</strong></div><div><span>Finished wall area</span><strong>{metrics.paintedWallAreaMm2 === null ? "Height not set" : formatPlannerBuildArea(metrics.paintedWallAreaMm2)}</strong></div><div><span>Floor finishes specified</span><strong>{metrics.floorFinishCount} / {metrics.rooms.length} rooms</strong></div><div><span>Orders / procurement items</span><strong>{data.deliveries.length}</strong></div><div><span>Received</span><strong>{data.deliveredCount}</strong></div></div>
        {deliveries.length ? <div className={styles.tableScroll}><table><thead><tr><th>Material / order</th><th>Supplier · reference</th><th>Planned delivery</th><th>Actual delivery</th><th>Timing</th><th>Status</th><th /></tr></thead><tbody>{deliveries.map((activity) => {
          const planned = plannedDeliveryDate(activity), actual = activity.actualDeliveryDate;
          const delta = actual ? calendarDaysBetween(planned, actual) : null;
          const received = Boolean(actual) || activity.deliveryStatus === "delivered";
          const late = delta !== null ? delta > 0 : !received && planned < today;
          return <tr key={activity.activityId}><th scope="row">{activity.name}</th><td>{activity.supplier || "Not set"}<small>{activity.orderReference || "No reference"}</small></td><td>{date(planned)}</td><td>{date(actual)}</td><td className={late ? styles.problem : undefined}>{delta !== null ? delta === 0 ? "On date" : `${Math.abs(delta)}d ${delta > 0 ? "late" : "early"}` : received ? "Date not recorded" : late ? `${calendarDaysBetween(planned, today)}d overdue` : "Awaiting delivery"}</td><td><span className={`pb-status-pill ${received ? "status-completed" : late ? "status-delayed" : ""}`}>{received ? "Delivered" : (activity.deliveryStatus || "not_ordered").replaceAll("_", " ")}</span></td><td><button type="button" className="pb-inline-action" onClick={() => onEdit(activity)}>Update</button></td></tr>;
        })}</tbody></table></div> : <div className={styles.empty}><strong>No procurement items recorded</strong><p>Add deliveries to track suppliers, order references and planned versus actual arrival dates.</p></div>}
        {data.deliveries.length > 4 && <button type="button" className="pb-inline-action" aria-expanded={allDeliveries} onClick={() => setAllDeliveries(!allDeliveries)}>{allDeliveries ? "Show fewer orders" : `Show all ${data.deliveries.length} orders`}</button>}
        <p className={styles.caption}>Measured areas come from the floorplan. Paint litres need product coverage and coats; material prices and purchased quantities are not inferred from geometry.</p>
      </section>
    </div>
  </div>;
}
