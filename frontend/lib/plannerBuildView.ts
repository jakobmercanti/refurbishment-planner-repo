"use client";
import { useSyncExternalStore } from "react";
export type PlannerBuildView = "GANTT" | "DASHBOARD" | "QUOTE";
const key = "freefloorplan3d:plannerbuild-view:v1";
let selected: PlannerBuildView = "GANTT";
const listeners = new Set<() => void>();
export function parsePlannerBuildView(value: string | null): PlannerBuildView {
  return value === "DASHBOARD" || value === "TABLE" ? "DASHBOARD" : value === "QUOTE" ? "QUOTE" : "GANTT";
}
function snapshot(): PlannerBuildView {
  try { selected = parsePlannerBuildView(localStorage.getItem(key) ?? selected); } catch { /* Session preference remains available. */ }
  return selected;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const changed = (event: StorageEvent) => { if (event.key === key) listener(); };
  window.addEventListener("storage", changed);
  return () => { listeners.delete(listener); window.removeEventListener("storage", changed); };
}
export function usePlannerBuildView(): [PlannerBuildView, (view: PlannerBuildView) => void] {
  const view = useSyncExternalStore(subscribe, snapshot, () => "GANTT" as const);
  return [view, next => { selected = next; try { localStorage.setItem(key, next); } catch { /* Local storage may be unavailable. */ } listeners.forEach(listener => listener()); }];
}
