"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bounds, OrbitControls, useBounds } from "@react-three/drei";
import { useViewerNavigation } from "@/lib/viewerNavigation";
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Plane,
  Vector3,
} from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { StableCanvas } from "./StableCanvas";
import { createPortal } from "react-dom";
import { ReadOnlyBuildingScene } from "./EngineeringViewer";
import {
  requestScene,
  sceneInput,
  scenePositions,
  type CFDScene,
  type CFDViewPatch,
} from "@/lib/climoptixScene";
import { projectFloors } from "@/lib/buildingDocument";
import type { ProjectDocument } from "@/lib/projectDocument";
import type { CFDPatch, CFDReport, Vec3 } from "@/lib/climoptix";
import type { CFDScenario, CFDVent } from "@/lib/climoptixDocument";
import type { BoundaryDisplayGroup } from "@/lib/climoptixGroups";
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
  active: boolean;
  apiUrl: string;
  viewSettingsOpen: boolean;
  viewTarget: HTMLElement | null;
  onViewSettings: (open: boolean) => void;
  stale: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  picking: boolean;
  onHostPick: (patchId: string, u: number, v: number) => void;
  onMoveVent: (id: string, u: number, v: number) => void;
  canMoveVents: boolean;
  showSamplingPlanes?: boolean;
  showRefinements: boolean;
  onShowRefinements: (show: boolean) => void;
  onReturnToSetup?: () => void;
  thermalSurfaces?: ThermalSurface[];
  thermalMetric?: ThermalMetric;
  thermalSelected?: string | null;
  onThermalSelect?: (id: string) => void;
  boundaryGroups?: BoundaryDisplayGroup[];
  boundarySelection?: string;
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
        if (e.button !== 0) return;
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
  colour,
  highlighted = false,
}: {
  patch: CFDViewPatch;
  positions: number[];
  selected: boolean;
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
  onPointerMove: (e: ThreeEvent<PointerEvent>) => void;
  onPointerUp: (e: ThreeEvent<PointerEvent>) => void;
  offset?: Vec3;
  colour?: string;
  highlighted?: boolean;
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
        color={selected ? "#ffcc64" : colour ?? (COLORS[patch.kind] ?? "#8b9eac")}
        side={DoubleSide}
        transparent={!vent && !selected}
        opacity={vent || selected ? 1 : highlighted ? 0.66 : 0.34}
        roughness={0.85}
        depthWrite={vent || selected}
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
  colour,
}: {
  vent: CFDVent;
  host: CFDPatch;
  selected: boolean;
  offset?: Vec3;
  onDown: (e: ThreeEvent<PointerEvent>) => void;
  onMove: (e: ThreeEvent<PointerEvent>) => void;
  onUp: (e: ThreeEvent<PointerEvent>) => void;
  onCancel: () => void;
  colour?: string;
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
          color={selected ? "#ffcc64" : colour ?? COLORS[vent.role]}
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
  active,
  apiUrl,
  viewSettingsOpen,
  viewTarget,
  onViewSettings,
  stale,
  selected,
  onSelect,
  picking,
  onHostPick,
  onMoveVent,
  canMoveVents,
  showSamplingPlanes = false,
  showRefinements,
  onShowRefinements,
  onReturnToSetup,
  thermalSurfaces = [],
  thermalMetric = "off",
  thermalSelected = null,
  onThermalSelect,
  boundaryGroups = [],
  boundarySelection,
}: Props) {
  const mouseButtons = useViewerNavigation();
  const thermalVisible = thermalMetric !== "off" && thermalSurfaces.length > 0;
  const thermalPatchIds = useMemo(
    () => new Set(thermalSurfaces.map((f) => f.patchId)),
    [thermalSurfaces],
  );
  const [ceilings, setCeilings] = useState(false);
  const [detailed, setDetailed] = useState(false);
  const [isolate, setIsolate] = useState(false);
  const [fit, setFit] = useState(0);
  const [scope, setScope] = useState("building");
  const [retry, setRetry] = useState(0);
  const [sceneState, setSceneState] = useState<{
    input: string;
    data: CFDScene | null;
    error: string;
  }>({ input: "", data: null, error: "" });
  const source = useMemo(() => sceneInput(project), [project]);
  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let cancelled = false;
    void requestScene(apiUrl, projectRef.current, controller.signal)
      .then((data) => {
        if (!cancelled) setSceneState({ input: source, data, error: "" });
      })
      .catch((error) => {
        if (!cancelled)
          setSceneState({
            input: source,
            data: null,
            error:
              error instanceof Error
                ? error.message
                : "Cannot load building geometry.",
          });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [active, apiUrl, source, retry]);
  const buildingScene = sceneState.input === source ? sceneState.data : null;
  const floors = projectFloors(project);
  const rooms = floors.flatMap((f) =>
    f.content.rooms.map((r) => ({
      id: r.id,
      floorId: f.id,
      label: `${f.name} · ${r.name}`,
    })),
  );
  const volumes = buildingScene?.airVolumes ?? [];
  const scopes = [
    { id: "building", label: "Whole building", rooms: rooms.map((r) => r.id) },
    ...rooms.map((r) => ({
      id: `room:${r.id}`,
      label: r.label,
      rooms: [r.id],
    })),
    ...volumes.map((ids, i) => ({
      id: `air:${JSON.stringify(ids)}`,
      label: `Air volume ${i + 1} · ${ids.length} ${ids.length === 1 ? "room" : "rooms"}`,
      rooms: ids,
    })),
  ];
  const viewScope = scopes.find((s) => s.id === scope) ?? scopes[0];
  const visibleRooms = new Set(viewScope.rooms);
  const [drag, setDrag] = useState<{ id: string; u: number; v: number } | null>(
    null,
  );
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
  useEffect(() => {
    dragRef.current = null;
    // Release the interaction immediately; clear the rendered handle next frame.
    const frame = requestAnimationFrame(() => setDrag(null));
    return () => cancelAnimationFrame(frame);
  }, [scenario.id, source, viewScope.id]);
  const prepared =
    buildingScene && report?.validation.sourceHash === buildingScene.sourceHash
      ? report
      : null;
  const patches = prepared?.patches ?? [];
  const groupColours = new Map(prepared ? boundaryGroups.flatMap(g => g.patchIds.map(id => [id, g.colour] as const)) : []);
  const groupSelection = new Set(boundaryGroups.find(g => g.id === boundarySelection)?.patchIds);
  const positions = useMemo(() => patchPositions(prepared), [prepared]);
  const basePositions = useMemo(
    () =>
      buildingScene
        ? scenePositions(buildingScene)
        : new Map<string, number[]>(),
    [buildingScene],
  );
  const displayPatches = [
    ...(buildingScene?.patches.map(
      (p) => patches.find((prepared) => prepared.id === p.id) ?? p,
    ) ?? []),
    ...patches.filter((p) => p.kind === "object"),
  ].filter((p) => visibleRooms.has(p.roomId));
  const refinements = refinementPreviews(scenario, report);
  const refinementLegend = [
    ...new Map(refinements.map((region) => [region.level, region.cellMm])),
  ].sort(([a], [b]) => a - b);
  const selectedPatch = patches.find(
    (p) => p.id === selected || p.sourceId === selected,
  );
  const isolated =
    isolate && Boolean(selectedPatch || selected?.startsWith("vent:"));
  const onMeshDown = (e: ThreeEvent<PointerEvent>, patch: CFDViewPatch) => {
    if (e.button !== 0) return;
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
    const hostPatch = patches.find((p) => p.id === patch.id);
    if (picking && hostPatch?.host) {
      const location = hostLocation(hostPatch, millimetres(e.point));
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
      <div className="cfx-view-selector">
        {onReturnToSetup && <button type="button" autoFocus onClick={onReturnToSetup} title="Return to simulation setup (Escape)">Return to setup</button>}
        <label htmlFor="cfx-view-scope">View</label>
        <select
          id="cfx-view-scope"
          aria-label="CFD view scope"
          value={viewScope.id}
          onChange={(e) => {
            setScope(e.target.value);
            setIsolate(false);
          }}
        >
          <option value="building">Whole building</option>
          <optgroup label="Rooms">
            {scopes
              .filter((s) => s.id.startsWith("room:"))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
          </optgroup>
          <optgroup label="Connected air volumes">
            {scopes
              .filter((s) => s.id.startsWith("air:"))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
          </optgroup>
        </select>
        <button type="button" onClick={() => setFit((x) => x + 1)}>
          Fit
        </button>
        <button
          type="button"
          aria-expanded={viewSettingsOpen}
          onClick={() => onViewSettings(!viewSettingsOpen)}
        >
          View properties
        </button>
      </div>
      {viewTarget &&
        createPortal(
          <div className="cfx-inspector" aria-label="CFD view properties">
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
            <label className="cfx-check">
              <input
                type="checkbox"
                checked={showRefinements}
                onChange={(e) => onShowRefinements(e.target.checked)}
              />
              Refinement intent
            </label>
            <button type="button" onClick={() => setFit((x) => x + 1)}>
              Fit view
            </button>
          </div>,
          viewTarget,
        )}
      {!buildingScene && rooms.length > 0 && (
        <div className="cfx-geometry-notice" role="status">
          <span>
            {sceneState.input === source && sceneState.error
              ? "Building shown from your project · connectivity service unavailable"
              : "Building shown from your project · checking air volumes…"}
          </span>
          {sceneState.input === source && sceneState.error && (
            <button onClick={() => setRetry((x) => x + 1)}>
              Retry geometry
            </button>
          )}
        </div>
      )}
      {stale && report && (
        <p className="cfx-stale" role="status">
          Simulation setup changed · overlays not yet checked
        </p>
      )}
      <div
        className="cfx-viewport"
        data-view="3D"
        data-visible-rooms={viewScope.rooms.join(",")}
        data-scope={viewScope.id}
        data-geometry-source={buildingScene ? "validated" : "project-display"}
        data-boundary-groups={JSON.stringify(boundaryGroups.map(g => ({ id: g.id, colour: g.colour, patchIds: g.patchIds })))}
      >
        {rooms.length > 0 ? (
          <StableCanvas
            frameloop="demand"
            dpr={[1, 1.5]}
            camera={{ position: [10, 8, 11], fov: 42 }}
          >
            <ambientLight intensity={1.6} />
            <directionalLight position={[5, 10, 7]} intensity={2.5} />
            <Bounds fit clip observe margin={1.15} maxDuration={0.25}>
              {!buildingScene && (
                <ReadOnlyBuildingScene
                  project={project}
                  roomIds={viewScope.rooms}
                  showRoof={ceilings}
                  assets={detailed}
                />
              )}
              <Frame
                request={`${source}:${buildingScene?.sourceHash ?? "local"}:${viewScope.id}:${fit}`}
              />
              {displayPatches
                .filter(
                  (p) =>
                    (ceilings || boundaryGroups.length > 0 || p.kind !== "ceiling" || p.id === selected) &&
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
                    positions={
                      positions.get(p.id) ??
                      basePositions.get(p.id) ??
                      EMPTY_POSITIONS
                    }
                    selected={
                      p.id === selected ||
                      (p.kind === "object" && p.sourceId === selected)
                    }
                    offset={dragOffset(p.id)}
                    colour={groupColours.get(p.id)}
                    highlighted={groupSelection.has(p.id)}
                    onPointerDown={(e) => onMeshDown(e, p)}
                    onPointerMove={onMeshMove}
                    onPointerUp={onMeshUp}
                  />
                ))}
              {thermalVisible &&
                thermalSurfaces
                  .filter(
                    (f) =>
                      visibleRooms.has(f.roomId) &&
                      (ceilings ||
                        f.kind !== "ceiling" ||
                        f.surfaceId === thermalSelected),
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
                if (!host?.host || !visibleRooms.has(host.roomId)) return null;
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
                    colour={groupColours.get(marker.id)}
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
                      if (e.button !== 0) return;
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
              {detailed &&
                floors.flatMap((f) =>
                  f.content.rooms
                    .filter((r) => visibleRooms.has(r.id))
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
                              if (e.button !== 0) return;
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
              mouseButtons={mouseButtons}
              enabled={!drag}
              minDistance={0.2}
              maxDistance={1000}
            />
          </StableCanvas>
        ) : (
          <div className="cfx-empty">
            <strong>
              {sceneState.input === source && sceneState.error
                ? "Building preview unavailable"
                : buildingScene
                  ? "No measured rooms yet"
                  : "Loading building geometry…"}
            </strong>
            <p>
              {(sceneState.input === source && sceneState.error) ||
                "No measured geometry available."}
            </p>
            {sceneState.error && (
              <button onClick={() => setRetry((x) => x + 1)}>
                Retry geometry
              </button>
            )}
          </div>
        )}
      </div>
      <footer>
        {boundaryGroups.length > 0 && <ul className="cfx-refinement-legend" aria-label="Boundary group colours">
          {boundaryGroups.map(g => <li key={g.id}><i style={{ background: g.colour }} aria-hidden="true" />{g.name} · {g.patchIds.length}</li>)}
        </ul>}
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
        <ul className="cfx-refinement-legend" aria-label="Flow and boundary legend">
          <li><i style={{ background: COLORS.supply }} />Supply</li>
          <li><i style={{ background: COLORS.extract }} />Extract</li>
          <li><i style={{ background: COLORS.door }} />Boundary cap</li>
        </ul>
        {showRefinements && refinements.length > 0 && <small>Dashed/wireframe = refinement intent</small>}
        <small>Arrows: prescribed flow, not solved results</small>
      </footer>
    </section>
  );
}
