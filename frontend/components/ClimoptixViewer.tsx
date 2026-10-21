"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Bounds, OrbitControls, useBounds } from "@react-three/drei";
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  ExtrudeGeometry,
  Shape,
  Plane,
  Vector3,
} from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { StableCanvas } from "./StableCanvas";
import { projectFloors } from "@/lib/buildingDocument";
import type { ProjectDocument } from "@/lib/projectDocument";
import type { CFDPatch, CFDRegion, CFDReport, Vec3 } from "@/lib/climoptix";
import type { CFDScenario, CFDVent } from "@/lib/climoptixDocument";
import {
  thermalColour,
  type ThermalMetric,
  type ThermalSurface,
} from "@/lib/thermalDocument";
import { ParametricFixture } from "./ParametricFixture";
import { samplingPlanes, refinementColour } from "@/lib/climoptixWorkflow";
import {
  previewScene as scene,
  patchPositions,
  refinementPreviews,
  ventCenter,
  ventDirection,
  ventFootprint,
} from "@/lib/climoptixPreview";

const COLORS: Record<string, string> = {
  wall: "#8b9eac",
  floor: "#c3beaa",
  ceiling: "#c1d3dc",
  door: "#ddab50",
  window: "#65bedb",
  cap: "#deac58",
  supply: "#278ade",
  extract: "#be5b9d",
  object: "#83a793",
  slabSide: "#aaa389",
};
const EMPTY_POSITIONS: number[] = [];
const millimetres = (p: Vector3): Vec3 => [p.x * 1000, -p.z * 1000, p.y * 1000];
const dot = (a: Vec3, b: Vec3) => a.reduce((s, x, i) => s + x * b[i], 0);
function hostLocation(patch: CFDPatch, p: Vec3): [number, number] | null {
  const h = patch.host;
  if (!h) return null;
  const delta = p.map((x, i) => x - h.originMm[i]) as Vec3;
  return [
    Math.max(0, Math.min(1, dot(delta, h.uAxis) / h.widthMm)),
    Math.max(0, Math.min(1, dot(delta, h.vAxis) / h.heightMm)),
  ];
}
function Frame({ request }: { request: string }) {
  const bounds = useBounds();
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      bounds.refresh().clip().fit();
    });
    return () => cancelAnimationFrame(id);
  }, [bounds, request]);
  return null;
}
interface Props {
  project: ProjectDocument;
  scenario: CFDScenario;
  report: CFDReport | null;
  view: "2D" | "3D";
  stale: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  onSeed: (floorId: string, roomId: string) => void;
  picking: boolean;
  onHostPick: (patchId: string, u: number, v: number) => void;
  onMoveVent: (id: string, u: number, v: number) => void;
  canMoveVents: boolean;
  showSamplingPlanes?: boolean;
  showRefinements: boolean;
  onShowRefinements: (show: boolean) => void;
  thermalSurfaces?: ThermalSurface[];
  thermalMetric?: ThermalMetric;
  thermalSelected?: string | null;
  onThermalSelect?: (id: string) => void;
  thermalNorthDeg?: number;
}
function ThermalFaceMesh({
  face,
  metric,
  selected,
  onSelect,
}: {
  face: ThermalSurface;
  metric: ThermalMetric;
  selected: boolean;
  onSelect: () => void;
}) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    const positions = face.triangles.flatMap((t) =>
      t.flatMap((index) => scene(face.verticesMm[index] as Vec3)),
    );
    g.setAttribute("position", new Float32BufferAttribute(positions, 3));
    g.computeVertexNormals();
    return g;
  }, [face]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh
      name={face.surfaceId}
      geometry={geometry}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <meshStandardMaterial
        color={selected ? "#ffcc64" : thermalColour(face, metric)}
        side={DoubleSide}
        transparent
        opacity={selected ? 0.95 : 0.66}
        roughness={0.9}
      />
    </mesh>
  );
}
function PatchMesh({
  patch,
  positions,
  selected,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  offset,
}: {
  patch: CFDPatch;
  positions: number[];
  selected: boolean;
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
  onPointerMove: (e: ThreeEvent<PointerEvent>) => void;
  onPointerUp: (e: ThreeEvent<PointerEvent>) => void;
  offset?: Vec3;
}) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(positions, 3));
    g.computeVertexNormals();
    return g;
  }, [positions]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const vent = patch.kind === "supply" || patch.kind === "extract";
  return (
    <mesh
      name={patch.id}
      geometry={geometry}
      position={offset ?? [0, 0, 0]}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <meshStandardMaterial
        color={selected ? "#ffcc64" : (COLORS[patch.kind] ?? "#8b9eac")}
        side={DoubleSide}
        transparent={!vent && !selected}
        opacity={vent || selected ? 1 : 0.34}
        roughness={0.85}
        depthWrite={vent || selected}
      />
    </mesh>
  );
}
function GhostRegion({
  region,
  onSelect,
}: {
  region: CFDRegion;
  onSelect: () => void;
}) {
  const geometry = useMemo(() => {
    const shape = new Shape();
    region.verticesMm.forEach(([x, y], i) => {
      if (i === 0) shape.moveTo(x * 0.001, y * 0.001);
      else shape.lineTo(x * 0.001, y * 0.001);
    });
    const g = new ExtrudeGeometry(shape, {
      depth: (region.ceilingRangeMm[0] - region.baseMm) * 0.001,
      bevelEnabled: false,
    });
    g.rotateX(-Math.PI / 2);
    return g;
  }, [region]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh
      name={`excluded:${region.id}`}
      geometry={geometry}
      position={[0, region.baseMm * 0.001, 0]}
      onPointerDown={(e) => {
        if (e.intersections.some((hit) => hit.object.name.startsWith("vent:")))
          return;
        e.stopPropagation();
        onSelect();
      }}
    >
      <meshBasicMaterial
        color="#8495a5"
        wireframe
        transparent
        opacity={0.14}
        depthWrite={false}
      />
    </mesh>
  );
}
function VentIntent({
  vent,
  host,
  selected,
  offset,
  onDown,
  onMove,
  onUp,
  onCancel,
}: {
  vent: CFDVent;
  host: CFDPatch;
  selected: boolean;
  offset?: Vec3;
  onDown: (e: ThreeEvent<PointerEvent>) => void;
  onMove: (e: ThreeEvent<PointerEvent>) => void;
  onUp: (e: ThreeEvent<PointerEvent>) => void;
  onCancel: () => void;
}) {
  const geometry = useMemo(() => {
    const h = host.host!,
      points = ventFootprint(vent, h);
    const positions = points.flatMap((p) =>
      scene(p.map((v, i) => v - h.normal[i] * 2) as Vec3),
    );
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(positions, 3));
    g.setIndex(
      Array.from({ length: points.length - 2 }, (_, i) => [
        0,
        i + 1,
        i + 2,
      ]).flat(),
    );
    g.computeVertexNormals();
    return g;
  }, [vent, host]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const direction = ventDirection(vent, host.host!);
  return (
    <group position={offset ?? [0, 0, 0]}>
      <mesh
        name={`vent:${vent.id}`}
        userData={{ intentOnly: true }}
        geometry={geometry}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
      >
        <meshStandardMaterial
          color={selected ? "#ffcc64" : COLORS[vent.role]}
          side={DoubleSide}
          roughness={0.8}
        />
      </mesh>
      <arrowHelper
        args={[
          new Vector3(direction[0], direction[2], -direction[1]),
          new Vector3(...scene(ventCenter(vent, host.host!))),
          0.65,
          COLORS[vent.role],
          0.12,
          0.07,
        ]}
      />
    </group>
  );
}
export function ClimoptixViewer({
  project,
  scenario,
  report,
  view,
  stale,
  selected,
  onSelect,
  onSeed,
  picking,
  onHostPick,
  onMoveVent,
  canMoveVents,
  showSamplingPlanes = false,
  showRefinements,
  onShowRefinements,
  thermalSurfaces = [],
  thermalMetric = "off",
  thermalSelected = null,
  onThermalSelect,
  thermalNorthDeg,
}: Props) {
  const thermalVisible = thermalMetric !== "off" && thermalSurfaces.length > 0;
  const thermalPatchIds = useMemo(
    () => new Set(thermalSurfaces.map((f) => f.patchId)),
    [thermalSurfaces],
  );
  const [floorId, setFloorId] = useState(""),
    [ceilings, setCeilings] = useState(false),
    [context, setContext] = useState(true),
    [detailed, setDetailed] = useState(false),
    [isolate, setIsolate] = useState(false),
    [fit, setFit] = useState(0);
  const [drag, setDrag] = useState<{ id: string; u: number; v: number } | null>(
    null,
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0 && entry.contentRect.height > 0)
        setViewportSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  const dragRef = useRef<{
    id: string;
    patch: CFDPatch;
    u: number;
    v: number;
  } | null>(null);
  useEffect(() => {
    const cancel = () => {
      dragRef.current = null;
      setDrag(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dragRef.current) {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key);
    };
  }, []);
  const floors = projectFloors(project),
    floor =
      floors.find((f) => f.id === floorId) ??
      floors.find((f) => f.id === scenario.seed?.floorId) ??
      floors[0];
  const coordinates = floor.content.rooms.flatMap((r) => r.vertices),
    xs = coordinates.map((p) => p.x),
    ys = coordinates.map((p) => p.y);
  const left = coordinates.length ? Math.min(...xs) - 400 : 0,
    top = coordinates.length ? Math.min(...ys) - 400 : 0;
  const width = coordinates.length ? Math.max(...xs) - left + 400 : 8000,
    height = coordinates.length ? Math.max(...ys) - top + 400 : 6000;
  // Text is screen-sized annotation, not physical geometry. Keep it readable
  // when a whole multi-room floor is fitted into a narrow viewport.
  const planPixelMm = Math.max(
    width / viewportSize.width,
    height / viewportSize.height,
  );
  const included = new Set(report?.domain.includedRoomIds ?? []);
  const patches = report?.patches ?? [];
  const positions = useMemo(() => patchPositions(report), [report]);
  const refinements = refinementPreviews(scenario, report);
  const refinementLegend = [
    ...new Map(refinements.map((region) => [region.level, region.cellMm])),
  ].sort(([a], [b]) => a - b);
  const selectedPatch = patches.find(
    (p) => p.id === selected || p.sourceId === selected,
  );
  const isolated =
    isolate && Boolean(selectedPatch || selected?.startsWith("vent:"));
  const intentVents = scenario.vents.flatMap((vent) => {
    const host = patches.find((p) => p.id === vent.host.patchId);
    if (!host?.host) return [];
    const h = host.host,
      u = drag?.id === vent.id ? drag.u : vent.host.u,
      v = drag?.id === vent.id ? drag.v : vent.host.v;
    return [
      {
        vent,
        host,
        center: ventCenter(vent, h, u, v),
        footprint: ventFootprint(vent, h, u, v),
        direction: ventDirection(vent, h),
      },
    ];
  });
  const onMeshDown = (e: ThreeEvent<PointerEvent>, patch: CFDPatch) => {
    if (
      !picking &&
      !patch.id.startsWith("vent:") &&
      e.intersections.some((hit) => hit.object.name.startsWith("vent:"))
    )
      return;
    e.stopPropagation();
    onSelect(patch.id);
    const vent = scenario.vents.find((v) => `vent:${v.id}` === patch.id);
    if (canMoveVents && vent) {
      const host = patches.find((p) => p.id === vent.host.patchId);
      if (host?.host) {
        dragRef.current = {
          id: vent.id,
          patch: host,
          u: vent.host.u,
          v: vent.host.v,
        };
        setDrag({ id: vent.id, u: vent.host.u, v: vent.host.v });
        (e.target as HTMLElement)?.setPointerCapture(e.pointerId);
      }
      return;
    }
    if (picking && patch.host) {
      const location = hostLocation(patch, millimetres(e.point));
      if (location) onHostPick(patch.id, ...location);
    }
  };
  const onMeshMove = (e: ThreeEvent<PointerEvent>) => {
    const current = dragRef.current;
    if (!current?.patch.host) return;
    e.stopPropagation();
    const h = current.patch.host,
      n = h.normal,
      plane = new Plane().setFromNormalAndCoplanarPoint(
        new Vector3(n[0], n[2], -n[1]),
        new Vector3(...scene(h.originMm)),
      );
    const point = e.ray.intersectPlane(plane, new Vector3());
    if (!point) return;
    const uv = hostLocation(current.patch, millimetres(point));
    if (uv) {
      current.u = uv[0];
      current.v = uv[1];
      setDrag({ id: current.id, u: uv[0], v: uv[1] });
    }
  };
  const onMeshUp = (e: ThreeEvent<PointerEvent>) => {
    const current = dragRef.current;
    if (!current) return;
    e.stopPropagation();
    (e.target as HTMLElement)?.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setDrag(null);
    onMoveVent(current.id, current.u, current.v);
  };
  const onPlanMove = (e: ReactPointerEvent<SVGGElement>) => {
    const current = dragRef.current,
      h = current?.patch.host,
      svg = e.currentTarget.ownerSVGElement,
      matrix = svg?.getScreenCTM();
    if (!current || !h || !svg || !matrix) return;
    e.stopPropagation();
    const point = svg.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    const xy = point.matrixTransform(matrix.inverse());
    const z =
      Math.abs(h.normal[2]) > 1e-8
        ? (dot(h.originMm, h.normal) -
            h.normal[0] * xy.x -
            h.normal[1] * xy.y) /
          h.normal[2]
        : h.originMm[2] +
          h.uAxis[2] * current.u * h.widthMm +
          h.vAxis[2] * current.v * h.heightMm;
    const location = hostLocation(current.patch, [xy.x, xy.y, z]);
    if (location) {
      current.u = location[0];
      current.v = location[1];
      setDrag({ id: current.id, u: current.u, v: current.v });
    }
  };
  const dragOffset = (pid: string): Vec3 | undefined => {
    if (!drag || `vent:${drag.id}` !== pid) return;
    const vent = scenario.vents.find((v) => v.id === drag.id),
      h = patches.find((p) => p.id === vent?.host.patchId)?.host;
    if (!vent || !h) return;
    const delta = h.uAxis.map(
      (v, i) =>
        v * h.widthMm * (drag.u - vent.host.u) +
        h.vAxis[i] * h.heightMm * (drag.v - vent.host.v),
    ) as Vec3;
    return scene(delta);
  };
  return (
    <section className="cfx-viewer" aria-label="Climoptix geometry viewer">
      <header>
        <strong>
          {view === "2D" ? "Plan & connectivity" : "Air boundary preview"}
        </strong>
        <div className="cfx-inline">
          {view === "2D" ? (
            <label>
              Floor
              <select
                aria-label="Climoptix view floor"
                value={floor.id}
                onChange={(e) => setFloorId(e.target.value)}
              >
                {floors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="cfx-check">
                <input
                  type="checkbox"
                  checked={ceilings}
                  onChange={(e) => setCeilings(e.target.checked)}
                />
                Ceilings
              </label>
              <label className="cfx-check">
                <input
                  type="checkbox"
                  checked={context}
                  onChange={(e) => setContext(e.target.checked)}
                />
                Context
              </label>
              <label className="cfx-check">
                <input
                  type="checkbox"
                  checked={detailed}
                  onChange={(e) => setDetailed(e.target.checked)}
                />
                Visual assets
              </label>
              <label className="cfx-check">
                <input
                  type="checkbox"
                  checked={isolate}
                  disabled={!selectedPatch && !selected?.startsWith("vent:")}
                  onChange={(e) => setIsolate(e.target.checked)}
                />
                Isolate selection
              </label>
            </>
          )}
          {!!refinements.length && (
            <label className="cfx-check">
              <input
                type="checkbox"
                checked={showRefinements}
                onChange={(e) => onShowRefinements(e.target.checked)}
              />
              Refinement intent
            </label>
          )}
          <button onClick={() => setFit((x) => x + 1)}>Fit</button>
        </div>
      </header>
      {stale && report && (
        <p className="cfx-stale" role="status">
          Source or setup changed · validate to refresh this preview
        </p>
      )}
      <div className="cfx-viewport" data-view={view} ref={viewportRef}>
        {thermalNorthDeg !== undefined && view === "2D" && (
          <div
            className="thermal-view-north"
            aria-label={`Plan north bearing ${thermalNorthDeg} degrees`}
          >
            <span style={{ transform: `rotate(${thermalNorthDeg}deg)` }}>
              ↓ N
            </span>
          </div>
        )}
        {view === "2D" ? (
          <svg
            aria-label="CFD room plan"
            viewBox={`${left} ${top} ${width} ${height}`}
          >
            {floor.content.rooms.map((room) => (
              <g
                key={room.id}
                role="button"
                tabIndex={0}
                aria-label={`Use ${room.name} as seed`}
                onClick={() => onSeed(floor.id, room.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSeed(floor.id, room.id);
                  }
                }}
              >
                <polygon
                  points={room.vertices.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill={
                    included.has(room.id)
                      ? "var(--cfx-plan-air)"
                      : "var(--surface-muted)"
                  }
                  fillOpacity={included.has(room.id) ? 1 : 0.5}
                  stroke={
                    scenario.seed?.roomId === room.id ? "#0b74bd" : "#8b9eac"
                  }
                  strokeWidth={scenario.seed?.roomId === room.id ? 25 : 12}
                />
                <text
                  x={
                    room.vertices.reduce((s, p) => s + p.x, 0) /
                    room.vertices.length
                  }
                  y={
                    room.vertices.reduce((s, p) => s + p.y, 0) /
                    room.vertices.length
                  }
                  fontSize={12 * planPixelMm}
                  className="cfx-room-label"
                  textAnchor="middle"
                  fill="currentColor"
                >
                  {room.name}
                </text>
              </g>
            ))}
            {floor.content.floorplan?.walls.map((w) => (
              <polyline
                key={`source:${w.id}`}
                data-source-wall={w.id}
                points={w.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke={selected === w.id ? "#b74646" : "#8b9eac"}
                strokeWidth={selected === w.id ? 40 : 12}
                pointerEvents="none"
              />
            ))}
            {floor.openings.map((opening) => (
              <g
                key={opening.id}
                role="button"
                tabIndex={0}
                aria-label={`Slab void ${opening.name}`}
                onClick={() => onSelect(opening.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSelect(opening.id);
                }}
              >
                <polygon
                  points={opening.vertices
                    .map((p) => `${p.x},${p.y}`)
                    .join(" ")}
                  fill="var(--paper)"
                  stroke="var(--accent)"
                  strokeWidth={18}
                  strokeDasharray="60 35"
                />
                <text
                  x={
                    opening.vertices.reduce((s, p) => s + p.x, 0) /
                    opening.vertices.length
                  }
                  y={
                    opening.vertices.reduce((s, p) => s + p.y, 0) /
                    opening.vertices.length
                  }
                  textAnchor="middle"
                  fontSize={11 * planPixelMm}
                  fill="currentColor"
                >
                  ↕ {opening.name}
                </text>
              </g>
            ))}
            {report?.domain.portals
              .filter((p) =>
                p.rooms.some((id) =>
                  floor.content.rooms.some((r) => r.id === id),
                ),
              )
              .map((portal) => {
                const ring = Object.values(portal.ringsMm)[0];
                if (!ring?.length) return null;
                const p = ring[0],
                  q = ring[1];
                return (
                  <g
                    key={portal.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${portal.traversed ? "Passage" : "STOP"}: ${portal.id}`}
                    onClick={() => onSelect(portal.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onSelect(portal.id);
                    }}
                  >
                    <line
                      x1={p[0]}
                      y1={p[1]}
                      x2={q[0]}
                      y2={q[1]}
                      stroke={portal.traversed ? "#16846b" : "#b74646"}
                      strokeWidth={65}
                    />
                    <text
                      x={(p[0] + q[0]) / 2}
                      y={(p[1] + q[1]) / 2 - 80}
                      fontSize={11 * planPixelMm}
                      textAnchor="middle"
                      fill={portal.traversed ? "#16846b" : "#b74646"}
                    >
                      {portal.traversed ? "↔" : "STOP"}
                    </text>
                  </g>
                );
              })}
            {showRefinements &&
              refinements
                .filter(
                  (r) =>
                    r.centerMm[2] + r.sizeMm[2] / 2 >= floor.elevationMm &&
                    r.centerMm[2] - r.sizeMm[2] / 2 <=
                      floor.elevationMm + floor.heightMm,
                )
                .map((r) => (
                  <g
                    key={r.id}
                    data-refinement={r.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Select refinement ${r.name}`}
                    onClick={() => onSelect(`refinement:${r.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onSelect(`refinement:${r.id}`);
                    }}
                  >
                    {r.shape === "sphere" ? (
                      <circle
                        cx={r.centerMm[0]}
                        cy={r.centerMm[1]}
                        r={r.sizeMm[0] / 2}
                        fill="none"
                        stroke={r.colour}
                        strokeWidth={
                          selected === `refinement:${r.id}` ? 30 : 20
                        }
                        strokeDasharray="60 35"
                      />
                    ) : (
                      <rect
                        x={r.centerMm[0] - r.sizeMm[0] / 2}
                        y={r.centerMm[1] - r.sizeMm[1] / 2}
                        width={r.sizeMm[0]}
                        height={r.sizeMm[1]}
                        fill="none"
                        stroke={r.colour}
                        strokeWidth={
                          selected === `refinement:${r.id}` ? 30 : 20
                        }
                        strokeDasharray="60 35"
                      />
                    )}
                    <text
                      x={r.centerMm[0]}
                      y={r.centerMm[1] - r.sizeMm[1] / 2 - 60}
                      textAnchor="middle"
                      fill="currentColor"
                      fontSize={11 * planPixelMm}
                    >
                      {r.name} · L{r.level} · {r.cellMm} mm intent
                    </text>
                  </g>
                ))}
            {intentVents
              .filter((v) => v.host.floorId === floor.id)
              .map(({ vent, host, center, footprint, direction }) => (
                <g
                  key={vent.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Select ${vent.name}`}
                  style={{ touchAction: canMoveVents ? "none" : "auto" }}
                  onClick={() => onSelect(`vent:${vent.id}`)}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelect(`vent:${vent.id}`);
                    if (canMoveVents) {
                      e.preventDefault();
                      dragRef.current = {
                        id: vent.id,
                        patch: host,
                        u: vent.host.u,
                        v: vent.host.v,
                      };
                      setDrag({ id: vent.id, u: vent.host.u, v: vent.host.v });
                      e.currentTarget.setPointerCapture(e.pointerId);
                    }
                  }}
                  onPointerMove={onPlanMove}
                  onPointerUp={(e) => {
                    const current = dragRef.current;
                    if (!current) return;
                    e.stopPropagation();
                    e.currentTarget.releasePointerCapture(e.pointerId);
                    dragRef.current = null;
                    setDrag(null);
                    onMoveVent(current.id, current.u, current.v);
                  }}
                  onPointerCancel={() => {
                    dragRef.current = null;
                    setDrag(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSelect(`vent:${vent.id}`);
                  }}
                >
                  <title>
                    {vent.name} · {vent.role} · prescribed direction, not a
                    solved field
                  </title>
                  <polygon
                    data-vent-footprint={vent.id}
                    points={footprint.map((p) => `${p[0]},${p[1]}`).join(" ")}
                    fill={COLORS[vent.role]}
                    fillOpacity={0.7}
                    stroke={
                      selected === `vent:${vent.id}` ? "#ffcc64" : "white"
                    }
                    strokeWidth={20}
                  />
                  {Math.hypot(direction[0], direction[1]) > 0.05 ? (
                    <g
                      pointerEvents="none"
                      stroke={COLORS[vent.role]}
                      strokeWidth={25}
                      fill="none"
                    >
                      <path
                        d={`M ${center[0]} ${center[1]} l ${direction[0] * 650} ${direction[1] * 650}`}
                      />
                      <path
                        d={`M ${center[0] + direction[0] * 500 - direction[1] * 80} ${center[1] + direction[1] * 500 + direction[0] * 80} L ${center[0] + direction[0] * 650} ${center[1] + direction[1] * 650} L ${center[0] + direction[0] * 500 + direction[1] * 80} ${center[1] + direction[1] * 500 - direction[0] * 80}`}
                      />
                    </g>
                  ) : (
                    <text
                      pointerEvents="none"
                      x={center[0] + 80}
                      y={center[1] - 80}
                      fontSize={12 * planPixelMm}
                      fill="currentColor"
                    >
                      {direction[2] > 0 ? "↑" : "↓"}
                    </text>
                  )}
                  <circle
                    data-vent-handle={vent.id}
                    cx={center[0]}
                    cy={center[1]}
                    r={70}
                    fill={vent.role === "supply" ? "#278ade" : "#be5b9d"}
                    stroke={
                      selected === `vent:${vent.id}` ? "#ffcc64" : "white"
                    }
                    strokeWidth={25}
                  />
                </g>
              ))}
            {thermalVisible &&
              thermalSurfaces
                .filter((f) => f.floorId === floor.id)
                .map((face) => (
                  <g
                    key={face.surfaceId}
                    role="button"
                    tabIndex={0}
                    aria-label={`Thermal ${face.roomName} ${face.elementId.split("|")[1]}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onThermalSelect?.(face.surfaceId);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onThermalSelect?.(face.surfaceId);
                      }
                    }}
                  >
                    {face.triangles.map((triangle, index) => (
                      <polygon
                        key={index}
                        points={triangle
                          .map(
                            (i) =>
                              `${face.verticesMm[i][0]},${face.verticesMm[i][1]}`,
                          )
                          .join(" ")}
                        fill={thermalColour(face, thermalMetric)}
                        fillOpacity={0.2}
                        stroke={
                          thermalSelected === face.surfaceId
                            ? "#ffcc64"
                            : thermalColour(face, thermalMetric)
                        }
                        strokeWidth={
                          thermalSelected === face.surfaceId ? 35 : 15
                        }
                      />
                    ))}
                  </g>
                ))}
          </svg>
        ) : report?.surface.triangles.length || thermalVisible ? (
          <StableCanvas
            frameloop="demand"
            dpr={[1, 1.5]}
            camera={{ position: [10, 8, 11], fov: 42 }}
          >
            <ambientLight intensity={1.6} />
            <directionalLight position={[5, 10, 7]} intensity={2.5} />
            <Bounds fit clip observe margin={1.15} maxDuration={0.25}>
              <Frame
                request={`${scenario.id}:${report?.validation.sourceHash ?? thermalSurfaces[0]?.surfaceId}:${fit}`}
              />
              {patches
                .filter(
                  (p) =>
                    (ceilings || p.kind !== "ceiling" || p.id === selected) &&
                    p.kind !== "supply" &&
                    p.kind !== "extract" &&
                    (!detailed || p.kind !== "object"),
                )
                .filter((p) => !isolated || p.id === selectedPatch?.id)
                .filter((p) => !thermalVisible || !thermalPatchIds.has(p.id))
                .map((p) => (
                  <PatchMesh
                    key={p.id}
                    patch={p}
                    positions={positions.get(p.id) ?? EMPTY_POSITIONS}
                    selected={
                      p.id === selected ||
                      (p.kind === "object" && p.sourceId === selected)
                    }
                    offset={dragOffset(p.id)}
                    onPointerDown={(e) => onMeshDown(e, p)}
                    onPointerMove={onMeshMove}
                    onPointerUp={onMeshUp}
                  />
                ))}
              {thermalVisible &&
                thermalSurfaces
                  .filter(
                    (f) =>
                      ceilings ||
                      f.kind !== "ceiling" ||
                      f.surfaceId === thermalSelected,
                  )
                  .map((face) => (
                    <ThermalFaceMesh
                      key={face.surfaceId}
                      face={face}
                      metric={thermalMetric}
                      selected={face.surfaceId === thermalSelected}
                      onSelect={() => onThermalSelect?.(face.surfaceId)}
                    />
                  ))}
              {scenario.vents.map((vent) => {
                if (isolated && selected !== `vent:${vent.id}`) return null;
                const host = patches.find((p) => p.id === vent.host.patchId);
                if (!host?.host) return null;
                const marker = {
                  ...host,
                  id: `vent:${vent.id}`,
                  kind: vent.role,
                };
                return (
                  <VentIntent
                    key={vent.id}
                    vent={vent}
                    host={host}
                    selected={selected === marker.id}
                    offset={dragOffset(marker.id)}
                    onDown={(e) => onMeshDown(e, marker)}
                    onMove={onMeshMove}
                    onUp={onMeshUp}
                    onCancel={() => {
                      dragRef.current = null;
                      setDrag(null);
                    }}
                  />
                );
              })}
              {showSamplingPlanes &&
                report?.domain.boundsMm &&
                samplingPlanes(
                  report.domain.boundsMm,
                  scenario.postProcessing,
                ).map((p) => {
                  const axis = ["X", "Y", "Z"].indexOf(p.axis);
                  const size = report.domain.boundsMm![0].map((low, i) =>
                    i === axis ? 1 : report.domain.boundsMm![1][i] - low,
                  );
                  return (
                    <mesh
                      key={p.id}
                      name={p.id}
                      position={scene(p.pointMm)}
                      raycast={() => {}}
                    >
                      <boxGeometry
                        args={[size[0] / 1000, size[2] / 1000, size[1] / 1000]}
                      />
                      <meshBasicMaterial
                        color={["#e47d20", "#009c9a", "#7754d1"][axis]}
                        transparent
                        opacity={0.12}
                        depthWrite={false}
                        side={DoubleSide}
                      />
                    </mesh>
                  );
                })}
              {showRefinements &&
                !isolated &&
                refinements.map((r) => (
                  <mesh
                    key={r.id}
                    name={`refinement:${r.id}`}
                    position={scene(r.centerMm)}
                    onPointerDown={(e) => {
                      if (
                        e.intersections.some((hit) =>
                          hit.object.name.startsWith("vent:"),
                        )
                      )
                        return;
                      e.stopPropagation();
                      onSelect(`refinement:${r.id}`);
                    }}
                  >
                    {r.shape === "sphere" ? (
                      <sphereGeometry args={[r.sizeMm[0] * 0.0005, 16, 8]} />
                    ) : (
                      <boxGeometry
                        args={[
                          r.sizeMm[0] * 0.001,
                          r.sizeMm[2] * 0.001,
                          r.sizeMm[1] * 0.001,
                        ]}
                      />
                    )}
                    <meshBasicMaterial
                      color={r.colour}
                      wireframe
                      transparent
                      opacity={selected === `refinement:${r.id}` ? 1 : 0.65}
                      depthWrite={false}
                    />
                  </mesh>
                ))}
              {context &&
                !isolated &&
                report?.domain.regions
                  .filter((r) => !r.included)
                  .map((region) => (
                    <GhostRegion
                      key={region.id}
                      region={region}
                      onSelect={() => onSeed(region.floorId, region.id)}
                    />
                  ))}
              {detailed &&
                floors.flatMap((f) =>
                  f.content.rooms
                    .filter((r) => included.has(r.id))
                    .flatMap((r) =>
                      r.obstacles
                        .filter(
                          (o) => !isolated || selectedPatch?.sourceId === o.id,
                        )
                        .map((object) => (
                          <group
                            key={object.id}
                            name={`visual:${object.id}`}
                            position={[
                              object.center.x * 0.001,
                              (f.elevationMm + object.base_z_mm) * 0.001,
                              -object.center.y * 0.001,
                            ]}
                            rotation={[
                              0,
                              (object.rotation_deg * Math.PI) / 180,
                              0,
                            ]}
                            onPointerDown={(e) => {
                              if (
                                e.intersections.some((hit) =>
                                  hit.object.name.startsWith("vent:"),
                                )
                              )
                                return;
                              e.stopPropagation();
                              onSelect(object.id);
                            }}
                          >
                            <ParametricFixture
                              obstacle={object}
                              width={object.dimensions.width.value * 0.001}
                              depth={object.dimensions.depth.value * 0.001}
                              height={object.dimensions.height.value * 0.001}
                            />
                          </group>
                        )),
                    ),
                )}
            </Bounds>
            <OrbitControls
              makeDefault
              enabled={!drag}
              minDistance={0.2}
              maxDistance={1000}
            />
          </StableCanvas>
        ) : (
          <div className="cfx-empty">
            <strong>
              {report
                ? "No surface could be prepared"
                : "Prepare the measured building"}
            </strong>
            <p>
              Select a seed room, then Validate &amp; refresh. No display mesh
              is used to decide connectivity.
            </p>
          </div>
        )}
      </div>
      <footer>
        {thermalVisible && (
          <p className="cfx-caption" aria-label="Thermal overlay legend">
            Thermal {thermalMetric} · estimate, not CFD.{" "}
            {thermalMetric === "heat"
              ? "Orange: gain · blue: loss · green: balanced · grey: unavailable"
              : thermalMetric === "u"
                ? "Green ≤0.3 · amber ≤0.7 · orange >0.7 W/m²K · red: missing"
                : thermalMetric === "missing"
                  ? "Red: incomplete / stale · green: available or inapplicable"
                  : "Blue: outdoors · brown: ground · purple: adjacent · green: internal · grey: adiabatic"}
          </p>
        )}
        {showRefinements && !isolated && refinements.length > 0 && (
          <ul
            className="cfx-refinement-legend"
            aria-label="Refinement colour legend"
          >
            {refinementLegend.map(([level, cellMm]) => (
              <li key={level}>
                <i
                  style={{ background: refinementColour(level) }}
                  aria-hidden="true"
                />
                Level {level} · {cellMm.toLocaleString()} mm
              </li>
            ))}
          </ul>
        )}
        <span>
          <i style={{ background: COLORS.supply }} />
          Supply <i style={{ background: COLORS.extract }} />
          Extract <i style={{ background: COLORS.door }} />
          Boundary cap
          {showRefinements &&
            refinements.length > 0 &&
            " · Dashed/wireframe = refinement intent"}
        </span>
        <small>
          {picking
            ? "Click a planar host in 3D to place the vent."
            : view === "3D"
              ? "Orbit/zoom · select a face or drag a vent · arrows show prescribed directions, not solved flow"
              : "Green passages connect; STOP boundaries do not. Arrows are prescribed directions, not results."}
        </small>
      </footer>
    </section>
  );
}
