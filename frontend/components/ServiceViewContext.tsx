"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Point2D } from "@/lib/types";
import type { FloorPlanViewport } from "./FloorPlanCanvas";
import type { HeatingSelection } from "./HeatingLayoutPanel";

export interface ServiceSceneHost {
  svg: SVGSVGElement;
  labels: SVGSVGElement;
  fromClient: (x: number, y: number) => Point2D;
  canPick: (x: number, y: number) => boolean;
}
export type ServiceLabelPortal = (anchor: Point2D, node: ReactNode) => ReactNode;
export interface ServiceSceneActions {
  selectObject?: (id: string) => "edit" | "consume" | false;
  ownsObject?: (id: string) => boolean;
  recordObjectMove?: (id: string) => void;
  clear?: () => void;
}
function useServiceViewState(active: boolean, in3D: boolean) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const [scene, setScene] = useState<ServiceSceneHost | null>(null);
  const [frame, setFrame] = useState<FloorPlanViewport | null>(null);
  const [energySelection, setEnergySelection] = useState<string[]>([]);
  const [heatingSelection, setHeatingSelection] = useState<HeatingSelection>(null);
  const [heatingFabricVisible, setHeatingFabricVisible] = useState(false);
  const [floorActive, setFloorActive] = useState(false);
  const actions = useRef<ServiceSceneActions>({});
  return { active, in3D, target, setTarget, scene, setScene, frame, setFrame, energySelection, setEnergySelection, heatingSelection, setHeatingSelection, heatingFabricVisible, setHeatingFabricVisible, floorActive, setFloorActive, actions };
}
const Context = createContext<ReturnType<typeof useServiceViewState> | null>(null);

/** One editor session and one measured document, shared by the two viewers. */
export function ServiceViewProvider({ active, in3D, children }: { active: boolean; in3D: boolean; children: ReactNode }) {
  const value = useServiceViewState(active, in3D);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useServiceView() { return useContext(Context); }
export function ServiceWindow({ children, showIn3D = true }: { children: ReactNode; showIn3D?: boolean }) {
  const view = useServiceView();
  if (!view?.target) return null;
  return createPortal(<div className="service-window-host" hidden={!view.active || view.in3D && !showIn3D}>{children}</div>, view.target);
}
export function ServiceWindowTarget() {
  const view = useServiceView();
  return <div ref={view?.setTarget} className="service-window-target" />;
}
