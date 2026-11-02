"use client";
import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { ProjectDocument } from "@/lib/projectDocument";
import type { CFDScenario } from "@/lib/climoptixDocument";
import type { HvacProject } from "@/lib/hvacDocument";
import type { CFDReport } from "@/lib/climoptix";
import type { FlowUnit } from "@/lib/cfdUnits";
import { useEffect } from "react";
import { useHeatingLayout } from "./HeatingLayoutContext";
import { sceneInput } from "@/lib/climoptixScene";

interface HvacContextValue {
  project: ProjectDocument; apiUrl: string;
  commit: (hvac: HvacProject, scenarios?: CFDScenario[]) => void;
  navigateCFD: (id: string) => void;
  tab: "Heating" | "Ventilation"; setTab: (tab: "Heating" | "Ventilation") => void;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean;
  selectedVentId: string | null; selectVent: (id: string | null) => void;
  geometryReport: CFDReport | null; setGeometryReport: (report: CFDReport) => void;
  heatingRequest: number; requestHeating: () => void;
  flowUnit: FlowUnit | null; setFlowUnit: (unit: FlowUnit) => void;
  focus: { floorId: string; roomId: string } | null;
  focusRoom: (room: { floorId: string; roomId: string }, ventId?: string) => void;
  geometryKey: string;
}
const Context = createContext<HvacContextValue | null>(null);
export function HvacProvider({ children, onFocusFloor, ...value }: Omit<HvacContextValue, "tab" | "setTab" | "selectedVentId" | "selectVent" | "geometryReport" | "setGeometryReport" | "heatingRequest" | "requestHeating" | "flowUnit" | "setFlowUnit" | "focus" | "focusRoom" | "geometryKey"> & { children: ReactNode; onFocusFloor?: (floorId: string) => void }) {
  const [tab, setTab] = useState<"Heating" | "Ventilation">("Heating");
  const [selectedVentId, selectVent] = useState<string | null>(null);
  const [geometry, setGeometry] = useState<{ report: CFDReport; key: string } | null>(null);
  const geometrySource = JSON.parse(sceneInput(value.project));
  // Hydraulic layouts/ratings do not define the measured host faces.
  for (const floor of geometrySource.floors ?? []) delete floor.heating;
  const geometryKey = JSON.stringify(geometrySource);
  const setGeometryReport = useCallback((report: CFDReport) => setGeometry(previous => previous?.report === report && previous.key === geometryKey ? previous : { report, key: geometryKey }), [geometryKey, setGeometry]);
  const geometryReport = geometry?.key === geometryKey ? geometry.report : null;
  const [focus, setFocus] = useState<{ floorId: string; roomId: string } | null>(null);
  const focusRoom = (room: { floorId: string; roomId: string }, ventId?: string) => { selectVent(ventId ?? null); setFocus({ ...room }); onFocusFloor?.(room.floorId); };
  const [heatingRequest, setHeatingRequest] = useState(0);
  const [flowUnit, setFlowUnit] = useState<FlowUnit | null>(null);
  return <Context.Provider value={{ ...value, tab, setTab, selectedVentId, selectVent, geometryReport, setGeometryReport, geometryKey, focus, focusRoom, heatingRequest, requestHeating: () => setHeatingRequest(n => n + 1), flowUnit, setFlowUnit }}>{children}</Context.Provider>;
}
export const useHvac = () => useContext(Context);
export function HvacNavigationBridge() {
  const ctx = useHvac(), heating = useHeatingLayout();
  const request = ctx?.heatingRequest ?? 0;
  useEffect(() => { if (request) queueMicrotask(() => heating.open()); }, [request]); // eslint-disable-line react-hooks/exhaustive-deps -- navigation event, not a subscription to editor data
  return null;
}
