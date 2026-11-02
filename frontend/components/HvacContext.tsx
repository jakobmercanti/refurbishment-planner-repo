"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import type { ProjectDocument } from "@/lib/projectDocument";
import type { CFDScenario } from "@/lib/climoptixDocument";
import type { HvacProject } from "@/lib/hvacDocument";
import type { CFDReport } from "@/lib/climoptix";
import type { FlowUnit } from "@/lib/cfdUnits";
import { useEffect } from "react";
import { useHeatingLayout } from "./HeatingLayoutContext";

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
}
const Context = createContext<HvacContextValue | null>(null);
export function HvacProvider({ children, ...value }: Omit<HvacContextValue, "tab" | "setTab" | "selectedVentId" | "selectVent" | "geometryReport" | "setGeometryReport" | "heatingRequest" | "requestHeating" | "flowUnit" | "setFlowUnit"> & { children: ReactNode }) {
  const [tab, setTab] = useState<"Heating" | "Ventilation">("Heating");
  const [selectedVentId, selectVent] = useState<string | null>(null), [geometryReport, setGeometryReport] = useState<CFDReport | null>(null);
  const [heatingRequest, setHeatingRequest] = useState(0);
  const [flowUnit, setFlowUnit] = useState<FlowUnit | null>(null);
  return <Context.Provider value={{ ...value, tab, setTab, selectedVentId, selectVent, geometryReport, setGeometryReport, heatingRequest, requestHeating: () => setHeatingRequest(n => n + 1), flowUnit, setFlowUnit }}>{children}</Context.Provider>;
}
export const useHvac = () => useContext(Context);
export function HvacNavigationBridge() {
  const ctx = useHvac(), heating = useHeatingLayout();
  const request = ctx?.heatingRequest ?? 0;
  useEffect(() => { if (request) queueMicrotask(() => heating.open()); }, [request]); // eslint-disable-line react-hooks/exhaustive-deps -- navigation event, not a subscription to editor data
  return null;
}
