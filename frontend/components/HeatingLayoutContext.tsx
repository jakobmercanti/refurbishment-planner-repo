"use client";
import { createContext, useContext, useState, useMemo, useRef, type ReactNode } from "react";
import { newHeatingProject, type HeatingProject } from "@/lib/heatingDocument";
import { useEnergyLayout } from "./EnergyLayoutContext";
import { withEnergyFabric, withoutDerivedFabric } from "@/lib/energyCalculations";
import type { Room } from "@/lib/types";
import { withHeatingElements } from "@/lib/heatingElements";
import { refreshHeatingPipeEndpoints } from "@/lib/heatingPipes";
import { RadiatorEditorWindow } from "./RadiatorEditorWindow";
const defaultHeating = newHeatingProject();
const HeatingContext = createContext({ data: defaultHeating, windowOpen: false, editRadiator: (_id: string, _commit?: (data: HeatingProject) => void) => { void [_id, _commit]; }, open: () => {}, close: () => {}, change: (_data: HeatingProject) => { void _data; } });
/** Module UI lifecycle only; authoritative heating inputs/geometry stay in ProjectDocument. */
export function HeatingLayoutProvider({ data: stored, rooms, onChange, onOpen, children }: { data: HeatingProject; rooms: Room[]; onChange: (data: HeatingProject) => void; onOpen: () => void; children: ReactNode }) {
  const energy = useEnergyLayout();
  const [windowOpen, setWindowOpen] = useState(false);
  const [editingRadiatorId, setEditingRadiatorId] = useState<string | null>(null);
  const editorCommit = useRef<((data: HeatingProject) => void) | null>(null);
  const data = useMemo(() => ({ ...withEnergyFabric(refreshHeatingPipeEndpoints(withHeatingElements(stored, rooms)), energy.data, rooms), enabled: windowOpen }), [stored, energy.data, rooms, windowOpen]);
  // Mode belongs to the window lifecycle, never to imported files or undo snapshots.
  const persist = (next: HeatingProject, enabled: boolean) => onChange(withoutDerivedFabric(refreshHeatingPipeEndpoints({ ...next, enabled })));
  const change = (next: HeatingProject) => persist(next, windowOpen);
  return <HeatingContext.Provider value={{ data, windowOpen, change, editRadiator: (id, commit) => { editorCommit.current = commit ?? null; setEditingRadiatorId(id); }, open: () => { onOpen();setWindowOpen(true);persist(data, true); }, close: () => { setWindowOpen(false);persist(data, false); } }}>{children}{editingRadiatorId && <RadiatorEditorWindow key={editingRadiatorId} id={editingRadiatorId} rooms={rooms} data={data} onChange={next => (editorCommit.current ?? change)(next)} onClose={() => { setEditingRadiatorId(null); editorCommit.current = null; }} />}</HeatingContext.Provider>;
}
export const useHeatingLayout = () => useContext(HeatingContext);
