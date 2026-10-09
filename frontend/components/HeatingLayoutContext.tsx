"use client";
import { createContext, useContext, useState, useMemo, type ReactNode } from "react";
import { newHeatingProject, type HeatingProject } from "@/lib/heatingDocument";
import { useEnergyLayout } from "./EnergyLayoutContext";
import { withEnergyFabric, withoutDerivedFabric } from "@/lib/energyCalculations";
import type { Room } from "@/lib/types";
const defaultHeating = newHeatingProject();
const HeatingContext = createContext({ data: defaultHeating, windowOpen: false, open: () => {}, close: () => {}, change: (_data: HeatingProject) => { void _data; } });
/** Module UI lifecycle only; authoritative heating inputs/geometry stay in ProjectDocument. */
export function HeatingLayoutProvider({ data: stored, rooms, onChange, onOpen, children }: { data: HeatingProject; rooms: Room[]; onChange: (data: HeatingProject) => void; onOpen: () => void; children: ReactNode }) {
  const energy = useEnergyLayout();
  const data = useMemo(() => withEnergyFabric(stored, energy.data, rooms), [stored, energy.data, rooms]);
  const change = (next: HeatingProject) => onChange(withoutDerivedFabric(next));
  const [windowOpen, setWindowOpen] = useState(false);
  return <HeatingContext.Provider value={{ data, windowOpen, change, open: () => { onOpen();setWindowOpen(true);change({ ...data, enabled: true }); }, close: () => { setWindowOpen(false);change({ ...data, enabled: false }); } }}>{children}</HeatingContext.Provider>;
}
export const useHeatingLayout = () => useContext(HeatingContext);
