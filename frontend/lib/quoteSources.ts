import { calculatePlannerBuildMetrics } from "./plannerBuild";
import { activityCurrency } from "./plannerBuildDashboard";
import { electricalBomRows } from "./electricalSchedule";
import { DEFAULT_ELECTRICAL_LAYOUT } from "./electricalLayout";
import type { ProjectDocument } from "./projectDocument";
import type { CurrencyCode } from "./appPreferences";
import { newQuoteItem, newQuoteSection, type QuoteDocument, type QuoteItem, type QuoteSourceValue } from "./quoteDocument";
import { parseMoney } from "./quoteCalculations";

export type QuoteSourceGroup = "Activities / trade costs" | "Materials / quantities" | "Electrical" | "Plumbing" | "Fittings / assets";
export interface QuoteCandidate { key: string; label: string; group: QuoteSourceGroup; section: string; category: QuoteItem["category"]; value: QuoteSourceValue }
const quantity = (value: number | null) => value === null || !Number.isFinite(value) ? null : value.toFixed(6).replace(/\.?0+$/, "") || "0";
function cost(value: number | undefined, currency: string, quoteCurrency: CurrencyCode): number | null {
  if (value === undefined || !Number.isFinite(value) || value < 0 || currency !== quoteCurrency) return null;
  try { return parseMoney(/[eE]/.test(String(value)) ? value.toFixed(6) : String(value), quoteCurrency); } catch { return null; }
}
/** Consume the same deterministic metrics and electrical BOM as Dashboard/Schedule. */
export function quoteCandidates(project: ProjectDocument, currency: CurrencyCode): QuoteCandidate[] {
  const metrics = calculatePlannerBuildMetrics(project), candidates: QuoteCandidate[] = [];
  const add = (key: string, group: QuoteSourceGroup, section: string, description: string, qty: string | null, unit: string, category: QuoteItem["category"] = "Materials", room = "", trade = "", internalCostMinor: number | null = null, sourceCurrency: string = currency) => candidates.push({ key, group, section, category, label: group === "Electrical" ? "Electrical schedule" : group === "Materials / quantities" ? "Room quantity" : group, value: { description, quantity: qty, unit, room, trade, internalCostMinor, currency: sourceCurrency } });
  for (const activity of project.plannerBuild.activities) {
    if (["payment", "decision", "milestone"].includes(activity.type)) continue;
    const sourceCurrency = activityCurrency(activity, currency);
    add(`activity:${activity.activityId}`, "Activities / trade costs", activity.category || "Work activities", activity.name, "1", "lot", "Fixed-price work", project.rooms.find(room => room.id === activity.roomId)?.name ?? "", activity.trade ?? "", cost(activity.estimatedCost ?? activity.actualCost, sourceCurrency, currency), sourceCurrency);
  }
  for (const room of metrics.rooms) {
    add(`room:${room.roomId}:floor`, "Materials / quantities", "Room quantities", `${room.name} · floor area${room.floorFinish ? ` · ${room.floorFinish}` : ""}`, (room.areaMm2 / 1e6).toFixed(1), "m²", "Materials", room.name);
    add(`room:${room.roomId}:walls`, "Materials / quantities", "Room quantities", `${room.name} · net wall area`, room.netWallAreaMm2 === null ? null : (room.netWallAreaMm2 / 1e6).toFixed(1), "m²", "Materials", room.name);
  }
  const layout = project.electricalLayout ?? DEFAULT_ELECTRICAL_LAYOUT;
  if (metrics.paintedWallAreaMm2 === null || metrics.paintedWallAreaMm2 > 0) add("materials:painted-walls", "Materials / quantities", "Decoration", "Painted wall surface area (may overlap room wall quantities)", metrics.paintedWallAreaMm2 === null ? null : (metrics.paintedWallAreaMm2 / 1e6).toFixed(1), "m²");
  for (const row of electricalBomRows(project.rooms, layout, project.assets, project.assetInstances)) {
    const override = layout.documentation.bomOverrides[row.bomKey];
    if (layout.documentation.hiddenBomKeys.includes(row.bomKey) || override?.hidden) continue;
    const sourceCurrency = override?.currency ?? currency;
    add(`electrical:${row.bomKey}`, "Electrical", "Electrical", override?.description || row.name, quantity(override?.orderQuantity ?? row.quantity), override?.unit || "items", "Materials", row.roomNames.join(", "), "", cost(override?.unitCost, sourceCurrency, currency), sourceCurrency);
  }
  for (const row of layout.documentation.manualBomItems) {
    if (row.hidden) continue;
    const sourceCurrency = row.currency ?? currency;
    add(`electrical:manual:${row.bomRowId}`, "Electrical", "Electrical", row.description, quantity(row.orderQuantity ?? row.quantity), row.unit || "items", "Materials", "", "", cost(row.unitCost, sourceCurrency, currency), sourceCurrency);
  }
  for (const row of metrics.plumbingByType) add(`plumbing:${row.name}`, "Plumbing", "Plumbing", row.name, quantity(row.count), "items");
  // Dashboard's other-fitting counts exclude electrical/plumbing to avoid importing them twice.
  for (const room of metrics.rooms) if (room.otherFittings) add(`fittings:${room.roomId}`, "Fittings / assets", "Fittings / assets", `${room.name} · other fittings / assets`, quantity(room.otherFittings), "items", "Materials", room.name);
  const located = metrics.rooms.reduce((sum, room) => sum + room.otherFittings, 0);
  if (metrics.summary.fittingCount > located) add("fittings:unassigned", "Fittings / assets", "Fittings / assets", "Unassigned fittings / assets", quantity(metrics.summary.fittingCount - located), "items");
  return candidates;
}
export function generateQuoteItems(quote: QuoteDocument, candidates: readonly QuoteCandidate[], selectedKeys: readonly string[], importPrices = false): QuoteDocument {
  const next = structuredClone(quote), selected = new Set(selectedKeys);
  const present = new Set(next.sections.flatMap(section => section.items.flatMap(item => item.source ? [item.source.key] : [])));
  for (const candidate of candidates) {
    if (!selected.has(candidate.key) || present.has(candidate.key)) continue;
    let section = next.sections.find(section => section.title === candidate.section);
    if (!section) { section = newQuoteSection(candidate.section); next.sections.push(section); }
    const value = candidate.value;
    section.items.push({ ...newQuoteItem(), description: value.description, quantity: value.quantity, unit: value.unit, category: candidate.category, room: value.room, trade: value.trade, internalCostMinor: value.internalCostMinor, unitPriceMinor: importPrices ? value.internalCostMinor : null, source: { key: candidate.key, label: candidate.label, baseline: structuredClone(value) } });
    present.add(candidate.key);
  }
  return next;
}
export function quoteSourceChanges(quote: QuoteDocument, candidates: readonly QuoteCandidate[]) {
  const byKey = new Map(candidates.map(candidate => [candidate.key, candidate]));
  return quote.sections.flatMap(section => section.items.flatMap(item => {
    if (!item.source) return [];
    const current = byKey.get(item.source.key)?.value ?? null;
    return JSON.stringify(item.source.baseline) === JSON.stringify(current) ? [] : [{ item, current }];
  }));
}
/** Explicitly refresh quantities/cost snapshots, preserving customer descriptions, prices and notes. */
export function refreshQuoteItem(item: QuoteItem, current: QuoteSourceValue): QuoteItem {
  return { ...item, quantity: current.quantity, unit: current.unit, internalCostMinor: current.internalCostMinor, source: item.source ? { ...item.source, baseline: structuredClone(current) } : undefined };
}
