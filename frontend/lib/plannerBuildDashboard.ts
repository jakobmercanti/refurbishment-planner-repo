import { addCalendarDays, calendarDaysBetween, type PlannerBuildActivity } from "./plannerBuild";

const knownAmount = (value: number | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
export const activityCurrency = (activity: PlannerBuildActivity) => activity.currency?.trim().toUpperCase() || "GBP";
export const plannedDeliveryDate = (activity: PlannerBuildActivity) => activity.expectedDeliveryDate || (activity.orderDate && activity.leadTimeDays !== undefined ? addCalendarDays(activity.orderDate, activity.leadTimeDays) : activity.startDate);
export const dashboardDueDate = (activity: PlannerBuildActivity) => activity.type === "delivery" ? plannedDeliveryDate(activity) : activity.type === "payment" ? activity.paymentDueDate || activity.startDate : activity.type === "decision" ? activity.decisionDeadline || activity.startDate : activity.endDate;
export const dashboardActivityDone = (activity: PlannerBuildActivity) => activity.status === "completed" || (activity.type === "delivery" && (activity.deliveryStatus === "delivered" || Boolean(activity.actualDeliveryDate))) || (activity.type === "payment" && activity.paymentStatus === "paid") || (activity.type === "inspection" && activity.inspectionStatus === "passed");

export interface DashboardCurrencyCosts {
  currency: string;
  estimated: number | null;
  actual: number | null;
  estimatedCount: number;
  actualCount: number;
  pairedCount: number;
  pairedEstimated: number;
  pairedActual: number;
  paid: number | null;
  unpaid: number | null;
}

/** Derived only: never persist totals, infer prices, or combine different currencies. */
export function calculatePlannerBuildDashboard(activities: readonly PlannerBuildActivity[], today: string) {
  const currencies = new Map<string, DashboardCurrencyCosts>();
  const work = activities.filter((activity) => activity.type === "task" || activity.type === "waiting");
  let totalDays = 0, recordedDays = 0, plannedDays = 0;
  for (const activity of activities) {
    if (!knownAmount(activity.estimatedCost) && !knownAmount(activity.actualCost) && !(activity.type === "payment" && knownAmount(activity.amount))) continue;
    const currency = activityCurrency(activity);
    const row = currencies.get(currency) ?? { currency, estimated: null, actual: null, estimatedCount: 0, actualCount: 0, pairedCount: 0, pairedEstimated: 0, pairedActual: 0, paid: null, unpaid: null };
    if (knownAmount(activity.estimatedCost)) { row.estimated = (row.estimated ?? 0) + activity.estimatedCost; row.estimatedCount++; }
    if (knownAmount(activity.actualCost)) { row.actual = (row.actual ?? 0) + activity.actualCost; row.actualCount++; }
    if (knownAmount(activity.estimatedCost) && knownAmount(activity.actualCost)) { row.pairedCount++; row.pairedEstimated += activity.estimatedCost; row.pairedActual += activity.actualCost; }
    if (activity.type === "payment" && knownAmount(activity.amount)) {
      const field = activity.paymentStatus === "paid" ? "paid" : "unpaid";
      row[field] = (row[field] ?? 0) + activity.amount;
    }
    currencies.set(currency, row);
  }
  for (const activity of work) {
    const days = Math.max(1, calendarDaysBetween(activity.startDate, activity.endDate) + 1);
    const progress = activity.status === "completed" ? 100 : Number.isFinite(activity.progress) ? Math.min(100, Math.max(0, activity.progress)) : 0;
    totalDays += days;
    recordedDays += days * progress / 100;
    plannedDays += Math.max(0, Math.min(days, calendarDaysBetween(activity.startDate, today)));
  }
  const pending = activities.filter((activity) => !dashboardActivityDone(activity));
  const overdue = pending.filter((activity) => dashboardDueDate(activity) < today).sort((a, b) => dashboardDueDate(a).localeCompare(dashboardDueDate(b)));
  const upcoming = pending.filter((activity) => dashboardDueDate(activity) >= today && dashboardDueDate(activity) <= addCalendarDays(today, 14)).sort((a, b) => dashboardDueDate(a).localeCompare(dashboardDueDate(b)));
  const deliveries = activities.filter((activity) => activity.type === "delivery" || activity.category === "PROCUREMENT").sort((a, b) => plannedDeliveryDate(a).localeCompare(plannedDeliveryDate(b)));
  const recordedStarts = work.flatMap((activity) => activity.actualStartDate ? [activity.actualStartDate] : []).sort();
  const recordedFinishes = work.flatMap((activity) => activity.actualEndDate ? [activity.actualEndDate] : []).sort();
  return {
    costs: [...currencies.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    recordedProgress: totalDays ? Math.round(recordedDays / totalDays * 100) : null,
    plannedProgress: totalDays ? Math.round(plannedDays / totalDays * 100) : null,
    workCount: work.length, overdue, upcoming, deliveries,
    actualStart: recordedStarts[0] ?? null,
    actualFinish: work.length && recordedFinishes.length === work.length ? recordedFinishes.at(-1)! : null,
    actualFinishesRecorded: recordedFinishes.length,
    deliveredCount: deliveries.filter((activity) => activity.deliveryStatus === "delivered" || activity.actualDeliveryDate).length,
    estimatesMissing: activities.filter((activity) => !knownAmount(activity.estimatedCost)),
    completedActualsMissing: activities.filter((activity) => dashboardActivityDone(activity) && !knownAmount(activity.actualCost)),
    unassignedWork: work.filter((activity) => !activity.trade?.trim()),
  };
}
