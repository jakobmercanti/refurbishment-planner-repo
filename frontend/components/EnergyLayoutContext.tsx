"use client";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { newEnergyProject, type EnergyProject } from "@/lib/energyDocument";
export interface InsulationEditRequest { id: string; elementId: string; pointMm?: [number, number] }
const EnergyContext = createContext({ data: newEnergyProject(), windowOpen: false, editRequest: undefined as InsulationEditRequest | undefined, open: () => {}, close: () => {}, change: (_data: EnergyProject) => { void _data; } });
export function EnergyLayoutProvider({ data, onChange, onOpen, children, scopeKey="", visible=true, editRequest }: { data: EnergyProject; onChange: (data: EnergyProject) => void; onOpen: () => void; children: ReactNode; scopeKey?:string; visible?:boolean; editRequest?:InsulationEditRequest }) {
  const [ui,setUi]=useState({scope:scopeKey,open:!!editRequest,requestId:editRequest?.id});
  if(ui.scope!==scopeKey || editRequest && ui.requestId!==editRequest.id)setUi({scope:scopeKey,open:!!editRequest,requestId:editRequest?.id});
  const windowOpen=visible&&ui.scope===scopeKey&&ui.open;
  const setWindowOpen=(open:boolean)=>setUi({scope:scopeKey,open,requestId:editRequest?.id});
  const presented = useMemo(() => ({ ...data, enabled: windowOpen }), [data, windowOpen]);
  // Window lifecycle owns the overlay, including when importing or undoing a saved state.
  return <EnergyContext.Provider value={{ data: presented, windowOpen, editRequest, change: next => onChange({ ...next, enabled: windowOpen }), open: () => { onOpen();setWindowOpen(true);onChange({ ...data, enabled: true, display: { ...data.display, floors: true, roofs: true } }); }, close: () => { setWindowOpen(false);onChange({ ...data, enabled: false }); } }}>{children}</EnergyContext.Provider>;
}
export const useEnergyLayout = () => useContext(EnergyContext);
