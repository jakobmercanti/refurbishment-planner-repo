"use client";
import { createContext, useContext, useState, useMemo, type ReactNode } from "react";
import { newHeatingProject, type HeatingProject } from "@/lib/heatingDocument";
import { useEnergyLayout } from "./EnergyLayoutContext";
import { withEnergyFabric, withoutDerivedFabric } from "@/lib/energyCalculations";
import type { Room } from "@/lib/types";
import { withHeatingElements } from "@/lib/heatingElements";
import { refreshHeatingPipeEndpoints } from "@/lib/heatingPipes";
const defaultHeating = newHeatingProject();
const HeatingContext = createContext({ data: defaultHeating, windowOpen: false, open: () => {}, close: () => {}, change: (_data: HeatingProject) => { void _data; } });
/** Module UI lifecycle only; authoritative heating inputs/geometry stay in ProjectDocument. */
export function HeatingLayoutProvider({ data: stored, rooms, onChange, onOpen, children }: { data: HeatingProject; rooms: Room[]; onChange: (data: HeatingProject) => void; onOpen: () => void; children: ReactNode }) {
  const energy = useEnergyLayout();
  const [windowOpen, setWindowOpen] = useState(false);
  const data = useMemo(() => ({ ...withEnergyFabric(refreshHeatingPipeEndpoints(withHeatingElements(stored, rooms)), energy.data, rooms), enabled: windowOpen }), [stored, energy.data, rooms, windowOpen]);
  // Mode belongs to the window lifecycle, never to imported files or undo snapshots.
  const persist = (next: HeatingProject, enabled: boolean) => onChange(withoutDerivedFabric(refreshHeatingPipeEndpoints({ ...next, enabled })));
  const change = (next: HeatingProject) => persist(next, windowOpen);
  return <HeatingContext.Provider value={{ data, windowOpen, change, open: () => { onOpen();setWindowOpen(true);persist(data, true); }, close: () => { setWindowOpen(false);persist(data, false); } }}>{children}</HeatingContext.Provider>;
}
export const useHeatingLayout = () => useContext(HeatingContext);
