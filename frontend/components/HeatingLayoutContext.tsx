"use client";
import { createContext, useContext, useState, useMemo, type ReactNode } from "react";
import { newHeatingProject, type HeatingProject } from "@/lib/heatingDocument";
import { useEnergyLayout } from "./EnergyLayoutContext";
import { withEnergyFabric, withoutDerivedFabric } from "@/lib/energyCalculations";
import type { Room } from "@/lib/types";
import { withHeatingElements } from "@/lib/heatingElements";
import { refreshHeatingPipeEndpoints } from "@/lib/heatingPipes";
import { RadiatorEditorWindow } from "./RadiatorEditorWindow";
import { refreshHeatingRoomResizes } from "@/lib/heatingRoomResize";
const defaultHeating = newHeatingProject();
const HeatingContext = createContext({ data: defaultHeating, windowOpen: false, resizeWarning: "", dismissResizeWarning: () => {}, editRadiator: (_id: string, _commit?: (data: HeatingProject) => void) => { void [_id, _commit]; }, open: () => {}, close: () => {}, change: (_data: HeatingProject) => { void _data; } });
/** Module UI lifecycle only; authoritative heating inputs/geometry stay in ProjectDocument. */
export function HeatingLayoutProvider({ data: stored, rooms, onChange, onOpen, children, scopeKey="", visible=true }: { data: HeatingProject; rooms: Room[]; onChange: (data: HeatingProject, refreshedResize?: boolean) => void; onOpen: () => void; children: ReactNode; scopeKey?:string; visible?:boolean }) {
  const energy = useEnergyLayout();
  const [ui,setUi]=useState<{scope:string;open:boolean;editingId:string|null;commit:((data:HeatingProject)=>void)|null}>({scope:scopeKey,open:false,editingId:null,commit:null});
  const [resizeError, setResizeError] = useState<{ scope: string; messages: string[] } | null>(null);
  if(ui.scope!==scopeKey)setUi({scope:scopeKey,open:false,editingId:null,commit:null});
  // Presentation only: a view switch must hide detached editors without saving a project edit.
  const windowOpen=visible&&ui.scope===scopeKey&&ui.open,editingRadiatorId=visible&&ui.scope===scopeKey?ui.editingId:null;
  const setWindowOpen=(open:boolean)=>setUi(current=>({...current,scope:scopeKey,open}));
  const data = useMemo(() => ({ ...withEnergyFabric(refreshHeatingPipeEndpoints(withHeatingElements(stored, rooms)), energy.data, rooms), enabled: windowOpen }), [stored, energy.data, rooms, windowOpen]);
  // Mode belongs to the window lifecycle, never to imported files or undo snapshots.
  const persist = (next: HeatingProject, enabled: boolean, refreshedResize = false) => onChange(withoutDerivedFabric(refreshHeatingPipeEndpoints({ ...next, enabled })), refreshedResize);
  const change = (next: HeatingProject) => persist(next, windowOpen);
  const open = () => {
    const refreshed = refreshHeatingRoomResizes(rooms, data);
    setResizeError(refreshed.errors.length ? { scope: scopeKey, messages: refreshed.errors } : null);
    onOpen(); setWindowOpen(true); persist(refreshed.heating, true, refreshed.heating !== data);
  };
  const resizeWarning = resizeError?.scope === scopeKey && data.pendingRoomResize ? resizeError.messages.join(" ") : "";
  return <HeatingContext.Provider value={{ data, windowOpen, resizeWarning, dismissResizeWarning: () => setResizeError(null), change, editRadiator: (id, commit) => setUi(current=>({...current,scope:scopeKey,editingId:id,commit:commit??null})), open, close: () => { setWindowOpen(false);persist(data, false); } }}>{children}{editingRadiatorId && <RadiatorEditorWindow key={editingRadiatorId} id={editingRadiatorId} rooms={rooms} data={data} onChange={next => (ui.commit ?? change)(next)} onClose={()=>setUi(current=>({...current,editingId:null,commit:null}))} />}</HeatingContext.Provider>;
}
export const useHeatingLayout = () => useContext(HeatingContext);
