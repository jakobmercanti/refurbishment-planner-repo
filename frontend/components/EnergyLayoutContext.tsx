"use client";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { newEnergyProject, type EnergyProject } from "@/lib/energyDocument";
const EnergyContext = createContext({ data: newEnergyProject(), windowOpen: false, open: () => {}, close: () => {}, change: (_data: EnergyProject) => { void _data; } });
export function EnergyLayoutProvider({ data, onChange, onOpen, children, scopeKey="" }: { data: EnergyProject; onChange: (data: EnergyProject) => void; onOpen: () => void; children: ReactNode; scopeKey?:string }) {
  const [ui,setUi]=useState({scope:scopeKey,open:false});
  if(ui.scope!==scopeKey)setUi({scope:scopeKey,open:false});
  const windowOpen=ui.scope===scopeKey&&ui.open;
  const setWindowOpen=(open:boolean)=>setUi({scope:scopeKey,open});
  const presented = useMemo(() => ({ ...data, enabled: windowOpen }), [data, windowOpen]);
  // Window lifecycle owns the overlay, including when importing or undoing a saved state.
  return <EnergyContext.Provider value={{ data: presented, windowOpen, change: next => onChange({ ...next, enabled: windowOpen }), open: () => { onOpen();setWindowOpen(true);onChange({ ...data, enabled: true, display: { ...data.display, floors: true, roofs: true } }); }, close: () => { setWindowOpen(false);onChange({ ...data, enabled: false }); } }}>{children}</EnergyContext.Provider>;
}
export const useEnergyLayout = () => useContext(EnergyContext);
