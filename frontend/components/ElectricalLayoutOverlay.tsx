"use client";

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { FixturePlanSymbol } from "@/components/FixturePlanSymbol";
import { electricalConnectionPoints, electricalDashArray, electricalStrokeWidth, type ElectricalCircuit, type ElectricalConnection, type ElectricalConnectionDefaults } from "@/lib/electricalLayout";
import type { Obstacle, Point2D } from "@/lib/types";

interface Props {
  fixtures: Obstacle[];
  connections: ElectricalConnection[];
  circuits: ElectricalCircuit[];
  toScreen: (point: Point2D) => Point2D;
  showSymbols: boolean;
  showConnections: boolean;
  showLabels: boolean;
  selectedFixtureId: string | null;
  sourceId: string | null;
  selectedConnectionId: string | null;
  connecting: boolean;
  cursor: Point2D | null;
  defaults: ElectricalConnectionDefaults;
  onFixturePointerDown: (event: ReactPointerEvent<SVGGElement>, fixture: Obstacle) => void;
  onFixtureActivate: (fixture: Obstacle) => void;
  onFixtureContextMenu: (event: ReactMouseEvent<SVGGElement>, fixture: Obstacle) => void;
  onConnectionPointerDown: (event: ReactPointerEvent<SVGPolylineElement>, connection: ElectricalConnection) => void;
  onConnectionDoubleClick: (event: ReactMouseEvent<SVGPolylineElement>, connection: ElectricalConnection) => void;
  onWaypointPointerDown: (event: ReactPointerEvent<SVGCircleElement>, connection: ElectricalConnection, index: number) => void;
  onWaypointDoubleClick: (event: ReactMouseEvent<SVGCircleElement>, connection: ElectricalConnection, index: number) => void;
}

export function ElectricalLayoutOverlay(props: Props) {
  const fixtures = new Map(props.fixtures.map((fixture) => [fixture.id, fixture]));
  const circuits = new Map(props.circuits.map((circuit) => [circuit.id, circuit]));
  const polylinePoints = (points: Point2D[]) => points.map((point) => {
    const screen = props.toScreen(point);
    return screen.x + "," + screen.y;
  }).join(" ");
  return <g className="electrical-overlay" aria-label="Electrical layout overlay">
    {props.showConnections && props.connections.map((connection) => {
      const from = fixtures.get(connection.fromId)?.center;
      const to = fixtures.get(connection.toId)?.center;
      if (!from || !to) return null;
      const points = electricalConnectionPoints(connection, from, to);
      const circuit = connection.circuitId ? circuits.get(connection.circuitId) : undefined;
      const colour = connection.colorOverride === false && circuit ? circuit.color : connection.color;
      const selected = props.selectedConnectionId === connection.id;
      const path = polylinePoints(points);
      const label = props.showLabels ? connection.label || circuit?.name : undefined;
      const labelPoint = props.toScreen(points[Math.floor(points.length / 2)]);
      return <g key={connection.id} className={selected ? "electrical-connection selected" : "electrical-connection"}>
        {selected && <polyline points={path} fill="none" stroke="#f59e0b" strokeWidth={electricalStrokeWidth(connection.width) + 4} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
        <polyline data-electrical-interactive="true" points={path} fill="none" stroke="transparent" strokeWidth="16" vectorEffect="non-scaling-stroke" pointerEvents="stroke" onPointerDown={(event) => props.onConnectionPointerDown(event, connection)} onDoubleClick={(event) => props.onConnectionDoubleClick(event, connection)} />
        <polyline points={path} fill="none" stroke={colour} strokeWidth={electricalStrokeWidth(connection.width)} strokeDasharray={electricalDashArray(connection.lineStyle)} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />
        {selected && connection.waypoints.map((waypoint, index) => {
          const point = props.toScreen(waypoint);
          return <circle key={index} data-electrical-interactive="true" className="electrical-route-waypoint" cx={point.x} cy={point.y} r="7" onPointerDown={(event) => props.onWaypointPointerDown(event, connection, index)} onDoubleClick={(event) => props.onWaypointDoubleClick(event, connection, index)} />;
        })}
        {label && <text className="electrical-circuit-label" x={labelPoint.x} y={labelPoint.y - 8} textAnchor="middle">{label}</text>}
      </g>;
    })}
    {props.connecting && props.sourceId && props.cursor && fixtures.get(props.sourceId) && props.showConnections && <polyline className="electrical-connection-preview" points={polylinePoints(electricalConnectionPoints({ ...props.defaults, id: "preview", fromId: props.sourceId, toId: "preview", waypoints: [], label: undefined }, fixtures.get(props.sourceId)!.center, props.cursor))} fill="none" stroke={props.defaults.color} strokeWidth={electricalStrokeWidth(props.defaults.width)} strokeDasharray={electricalDashArray(props.defaults.lineStyle)} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
    {props.showSymbols && props.fixtures.map((fixture) => {
      const topLeft = props.toScreen({ x: fixture.center.x - fixture.dimensions.width.value / 2, y: fixture.center.y + fixture.dimensions.depth.value / 2 });
      const bottomRight = props.toScreen({ x: fixture.center.x + fixture.dimensions.width.value / 2, y: fixture.center.y - fixture.dimensions.depth.value / 2 });
      const centre = props.toScreen(fixture.center);
      const selected = props.selectedFixtureId === fixture.id || props.sourceId === fixture.id;
      return <g key={fixture.id} data-electrical-interactive="true" className={"floorplan-fixture electrical-fixture" + (selected ? " selected" : "")} role="button" tabIndex={0} aria-label={`Electrical fitting: ${fixture.name}`} aria-pressed={selected} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); props.onFixtureActivate(fixture); } }} onPointerDown={(event) => props.onFixturePointerDown(event, fixture)} onContextMenu={(event) => props.onFixtureContextMenu(event, fixture)}>
        <title>{fixture.name}</title>
        {props.sourceId === fixture.id && <circle className="electrical-source-highlight" cx={centre.x} cy={centre.y} r={Math.max(18, (bottomRight.x - topLeft.x) / 2 + 8)} />}
        <FixturePlanSymbol obstacle={fixture} x={centre.x} y={centre.y} width={bottomRight.x - topLeft.x} depth={bottomRight.y - topLeft.y} selected={selected} />
      </g>;
    })}
  </g>;
}
