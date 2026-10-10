"use client";

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { FixturePlanSymbol } from "@/components/FixturePlanSymbol";
import { electricalDevicePlanSize, electricalDevicePlanSymbol } from "@/lib/electricalPlanSymbols";
import { electricalConnectionPoints, electricalDashArray, electricalStrokeWidth, type ElectricalCircuit, type ElectricalConnection, type ElectricalConnectionDefaults } from "@/lib/electricalLayout";
import type { Obstacle, Point2D } from "@/lib/types";
import { crossingBridgePath, electricalCrossings } from "@/lib/electricalCrossings";
import { switchGangCount, type LightingSwitchGang } from "@/lib/electricalSimulation";
import { DEFAULT_ELECTRICAL_DOCUMENTATION, type ElectricalLayoutData } from "@/lib/electricalLayout";

interface Props {
  fixtures: Obstacle[];
  connections: ElectricalConnection[];
  circuits: ElectricalCircuit[];
  toScreen: (point: Point2D) => Point2D;
  showSymbols: boolean;
  showConnections: boolean;
  showLabels: boolean;
  active: boolean;
  selectedFixtureId: string | null;
  sourceId: string | null;
  selectedConnectionId: string | null;
  activeCircuitId: string;
  connecting: boolean;
  forceOrthogonalRouting: boolean;
  cursor: Point2D | null;
  defaults: ElectricalConnectionDefaults;
  onFixturePointerDown: (event: ReactPointerEvent<SVGGElement>, fixture: Obstacle) => void;
  onFixtureActivate: (fixture: Obstacle) => void;
  onFixtureContextMenu: (event: ReactMouseEvent<SVGGElement>, fixture: Obstacle) => void;
  onConnectionPointerDown: (event: ReactPointerEvent<SVGPolylineElement>, connection: ElectricalConnection) => void;
  onConnectionContextMenu: (event: ReactMouseEvent<SVGPolylineElement>, connection: ElectricalConnection) => void;
  onWaypointPointerDown: (event: ReactPointerEvent<SVGCircleElement>, connection: ElectricalConnection, index: number) => void;
  onWaypointContextMenu: (event: ReactMouseEvent<SVGCircleElement>, connection: ElectricalConnection, index: number) => void;
  onLabelPointerDown: (event: ReactPointerEvent<SVGTextElement>, connection: ElectricalConnection) => void;
  testing?: boolean;
  lightStates?: Record<string, boolean>;
  switchLabels?: Record<string, string>;
  switchGangs?: Record<string, LightingSwitchGang[]>;
  junctions?: ElectricalLayoutData["junctions"];
  onFixtureGangActivate?: (fixture: Obstacle, gang: number) => void;
}

export function ElectricalLayoutOverlay(props: Props) {
  const fixtures = new Map(props.fixtures.map((fixture) => [fixture.id, fixture]));
  const circuits = new Map(props.circuits.map((circuit) => [circuit.id, circuit]));
  const connectedFixtureIds = new Set(props.connections.flatMap((connection) => [connection.fromId, connection.toId]));
  const crossings = props.showConnections ? electricalCrossings({ forceOrthogonalRouting: props.forceOrthogonalRouting, connections: props.connections, circuits: props.circuits, documentation: DEFAULT_ELECTRICAL_DOCUMENTATION, junctions: props.junctions }, props.fixtures) : [];
  const polylinePoints = (points: Point2D[]) => points.map((point) => {
    const screen = props.toScreen(point);
    return screen.x + "," + screen.y;
  }).join(" ");
  return <g className="electrical-overlay" aria-label="Electrical layout overlay">
    {props.showConnections && props.connections.map((connection) => {
      const from = fixtures.get(connection.fromId)?.center;
      const to = fixtures.get(connection.toId)?.center;
      if (!from || !to) return null;
      const points = electricalConnectionPoints(connection, from, to, props.forceOrthogonalRouting);
      const circuit = connection.circuitId ? circuits.get(connection.circuitId) : undefined;
      const colour = connection.colorOverride === false && circuit ? circuit.color : connection.color;
      const selected = props.selectedConnectionId === connection.id;
      const path = polylinePoints(points);
      const label = props.showLabels ? connection.label || circuit?.name : undefined;
      const labelPoint = props.toScreen(connection.labelPosition ?? points[Math.floor(points.length / 2)]);
      return <g key={connection.id} className={selected ? "electrical-connection selected" : "electrical-connection"}>
        {selected && <polyline points={path} fill="none" stroke="#f59e0b" strokeWidth={electricalStrokeWidth(connection.width) + 4} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
        <polyline data-electrical-interactive="true" points={path} fill="none" stroke="transparent" strokeWidth="16" vectorEffect="non-scaling-stroke" pointerEvents="stroke" onPointerDown={(event) => props.onConnectionPointerDown(event, connection)} onContextMenu={(event) => props.onConnectionContextMenu(event, connection)} />
        <polyline points={path} fill="none" stroke={colour} strokeWidth={electricalStrokeWidth(connection.width)} strokeDasharray={electricalDashArray(connection.lineStyle)} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />
        {selected && connection.waypoints.map((waypoint, index) => {
          const point = props.toScreen(waypoint);
          return <circle key={index} data-electrical-interactive="true" className="electrical-route-waypoint" cx={point.x} cy={point.y} r="7" onPointerDown={(event) => props.onWaypointPointerDown(event, connection, index)} onContextMenu={(event) => props.onWaypointContextMenu(event, connection, index)} />;
        })}
        {label && <text data-electrical-interactive="true" className="electrical-circuit-label electrical-draggable-label" x={labelPoint.x} y={labelPoint.y - (connection.labelPosition ? 0 : 8)} textAnchor="middle" onPointerDown={event => props.onLabelPointerDown(event, connection)}><title>Drag to move this connection’s circuit label</title>{label}</text>}
      </g>;
    })}
    {props.connecting && props.sourceId && props.cursor && fixtures.get(props.sourceId) && props.showConnections && <polyline className="electrical-connection-preview" points={polylinePoints(electricalConnectionPoints({ ...props.defaults, id: "preview", fromId: props.sourceId, toId: "preview", circuitId: props.activeCircuitId, waypoints: [], label: undefined }, fixtures.get(props.sourceId)!.center, props.cursor, props.forceOrthogonalRouting))} fill="none" stroke={props.defaults.color} strokeWidth={electricalStrokeWidth(props.defaults.width)} strokeDasharray={electricalDashArray(props.defaults.lineStyle)} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
    {crossings.map(crossing => {
      const centre = props.toScreen(crossing.position);
      const screenDirection = (direction: Point2D) => { const next = props.toScreen({ x: crossing.position.x + direction.x, y: crossing.position.y + direction.y }); const length = Math.hypot(next.x - centre.x, next.y - centre.y); return { x: (next.x - centre.x) / length, y: (next.y - centre.y) / length }; };
      const direction = screenDirection(crossing.direction), other = screenDirection(crossing.otherDirection);
      const [a, b] = crossing.connectionIds.map(id => props.connections.find(connection => connection.id === id)!);
      const colour = (connection: ElectricalConnection) => connection.colorOverride === false ? circuits.get(connection.circuitId)?.color ?? connection.color : connection.color;
      return <g key={crossing.key} className={crossing.connected ? "electrical-junction" : "electrical-wire-bridge"} pointerEvents="none"><title>{crossing.connected ? "Connected wire junction" : "Wires cross without connection"}</title>{crossing.connected
        ? <circle cx={centre.x} cy={centre.y} r="4" fill={colour(a)} />
        : <><circle cx={centre.x} cy={centre.y} r="8" fill="var(--panel, #fff)" /><path d={`M${centre.x - other.x * 8},${centre.y - other.y * 8} L${centre.x + other.x * 8},${centre.y + other.y * 8}`} stroke={colour(b)} strokeWidth={electricalStrokeWidth(b.width)} /><path d={crossingBridgePath(centre, direction)} fill="none" stroke={colour(a)} strokeWidth={electricalStrokeWidth(a.width)} strokeLinecap="round" /></>}</g>;
    })}
    {props.showSymbols && props.fixtures.map((fixture) => {
      const topLeft = props.toScreen({ x: fixture.center.x - fixture.dimensions.width.value / 2, y: fixture.center.y + fixture.dimensions.depth.value / 2 });
      const bottomRight = props.toScreen({ x: fixture.center.x + fixture.dimensions.width.value / 2, y: fixture.center.y - fixture.dimensions.depth.value / 2 });
      const centre = props.toScreen(fixture.center);
      const selected = props.selectedFixtureId === fixture.id || props.sourceId === fixture.id;
      const actualWidth = Math.abs(bottomRight.x - topLeft.x);
      const actualDepth = Math.abs(bottomRight.y - topLeft.y);
      const deviceSymbol = electricalDevicePlanSymbol(fixture.representation_key, props.active);
      const readableSymbol = props.active || Boolean(deviceSymbol);
      const deviceSize = electricalDevicePlanSize(fixture.representation_key, actualWidth, actualDepth, props.active);
      const symbolWidth = Math.max(deviceSize.width, props.active ? 26 : 0);
      const symbolDepth = Math.max(deviceSize.depth, props.active ? 26 : 0);
      const hitWidth = readableSymbol ? Math.max(symbolWidth + (props.active ? 12 : 8), props.active ? 44 : 28) : actualWidth;
      const hitDepth = readableSymbol ? Math.max(symbolDepth + (props.active ? 12 : 8), props.active ? 44 : 24) : actualDepth;
      const connected = connectedFixtureIds.has(fixture.id);
      const classes = ["floorplan-fixture", "electrical-fixture", props.active ? "is-active" : "", readableSymbol ? "is-readable" : "", connected ? "is-connected" : "", selected ? "selected" : ""].filter(Boolean).join(" ");
      return <g key={fixture.id} data-electrical-interactive="true" className={classes} role="button" tabIndex={0} aria-label={`Electrical fitting: ${fixture.name}${connected ? ", connected" : ""}`} aria-pressed={selected} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); props.onFixtureActivate(fixture); } }} onPointerDown={(event) => props.onFixturePointerDown(event, fixture)} onContextMenu={(event) => props.onFixtureContextMenu(event, fixture)}>
        <title>{fixture.name}</title>
        {props.testing && Object.hasOwn(props.lightStates ?? {}, fixture.id) && <g className="electrical-test-state" pointerEvents="none"><circle cx={centre.x} cy={centre.y} r={Math.max(symbolWidth, symbolDepth) / 2 + 12} fill={props.lightStates?.[fixture.id] ? "#facc15" : "none"} fillOpacity="0.35" stroke={props.lightStates?.[fixture.id] ? "#a16207" : "#64748b"} strokeWidth="2" /><text className="electrical-circuit-label" x={centre.x} y={centre.y + symbolDepth / 2 + 23} textAnchor="middle">{props.lightStates?.[fixture.id] ? "On" : "Off"}</text></g>}
        {props.testing && switchGangCount(fixture.representation_key) <= 1 && props.switchLabels?.[fixture.id] && <text className="electrical-circuit-label electrical-test-state" pointerEvents="none" x={centre.x} y={centre.y + symbolDepth / 2 + 23} textAnchor="middle">{props.switchLabels[fixture.id]}</text>}
        {readableSymbol && <g transform={`translate(${centre.x} ${centre.y}) rotate(${-fixture.rotation_deg})`}>
          <rect className="electrical-fixture-hit-area" x={-hitWidth / 2} y={-hitDepth / 2} width={hitWidth} height={hitDepth} rx={Math.min(10, hitDepth / 3)} />
          {props.active && <rect className="electrical-fixture-backplate" x={-symbolWidth / 2 - 3} y={-symbolDepth / 2 - 3} width={symbolWidth + 6} height={symbolDepth + 6} rx={Math.min(8, symbolDepth / 3)} />}
        </g>}
        {props.sourceId === fixture.id && <circle className="electrical-source-highlight" cx={centre.x} cy={centre.y} r={Math.max(18, Math.max(symbolWidth, symbolDepth) / 2 + 8)} />}
        <FixturePlanSymbol obstacle={fixture} x={centre.x} y={centre.y} width={symbolWidth} depth={symbolDepth} selected={selected} electricalMode={props.active} />
        {(props.testing || props.connecting) && switchGangCount(fixture.representation_key) > 1 && <g transform={`translate(${centre.x} ${centre.y}) rotate(${-fixture.rotation_deg})`}>{Array.from({ length: switchGangCount(fixture.representation_key) }, (_, index) => {
          const count = switchGangCount(fixture.representation_key), gang = index + 1, state = props.switchGangs?.[fixture.id]?.[index];
          const x = -symbolWidth / 2 + index * symbolWidth / count;
          const activate = () => props.onFixtureGangActivate?.(fixture, gang);
          return <g key={gang} data-electrical-gang={gang} role="button" tabIndex={0} aria-label={`${fixture.name} · Gang ${gang}${props.testing ? ` · ${state?.label ?? "Not connected"}` : " · Connect this rocker"}`} onPointerDown={event => { event.preventDefault(); event.stopPropagation(); if (event.button === 0) activate(); }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); activate(); } }}>
            <title>{props.testing ? `Operate only rocker ${gang}` : `Connect rocker ${gang}`}</title><rect x={x} y={-symbolDepth / 2} width={symbolWidth / count} height={symbolDepth} rx="4" fill={props.testing && state?.on ? "#22c55e" : "transparent"} fillOpacity="0.3" stroke="transparent" />
            <text className="electrical-circuit-label" pointerEvents="none" x={x + symbolWidth / count / 2} y={symbolDepth / 2 + 20 + index * 16} textAnchor="middle">{`G${gang}${props.testing ? ` ${state?.label ?? "Not connected"}` : ""}`}</text>
          </g>;
        })}</g>}
      </g>;
    })}
  </g>;
}
