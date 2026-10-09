"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { newEnergyProject, type EnergyProject } from "@/lib/energyDocument";
const EnergyContext = createContext({ data: newEnergyProject(), windowOpen: false, open: () => {}, close: () => {}, change: (_data: EnergyProject) => { void _data; } });
export function EnergyLayoutProvider({ data, onChange, onOpen, children }: { data: EnergyProject; onChange: (data: EnergyProject) => void; onOpen: () => void; children: ReactNode }) {
  const [windowOpen, setWindowOpen] = useState(false);
  return <EnergyContext.Provider value={{ data, windowOpen, change: onChange, open: () => { onOpen();setWindowOpen(true);onChange({ ...data, enabled: true }); }, close: () => { setWindowOpen(false); } }}>{children}</EnergyContext.Provider>;
}
export const useEnergyLayout = () => useContext(EnergyContext);
