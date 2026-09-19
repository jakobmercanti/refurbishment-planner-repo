"use client";

import { doorRepresentation } from "@/lib/doorModels";
import { componentColoursFromMetadata, resolvedPartColours } from "@/lib/assetColours";
import { DoorFixture } from "@/components/DoorFixture";
import { WindowFixture } from "@/components/ArchitecturalFixtures";
import { ParametricFixture } from "@/components/ParametricFixture";
import { Popup } from "@/components/Popup";
import { FlooringControls } from "@/components/FlooringControls";
import { SkirtingControls } from "@/components/SkirtingControls";
import { SkirtingBoards } from "@/components/SkirtingBoards";
import { RoomFurniture } from "@/components/RoomFurniture";
import { ProceduralFloorMaterial } from "@/components/ProceduralFloorMaterial";
import { floorDesignColour, flooringSwatch, normalizeFloorDesign, TILE_MATERIALS } from "@/lib/flooring";
import { Grid, Html, Line, OrbitControls, RoundedBox } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { fixtureKindForObstacle } from "@/lib/fixtureCatalog";
import { constrainPersonToRoom } from "@/lib/layoutInteraction";
import { constrainObstacleToRoom, resolveObstaclePlacement, resolvePlacement, type PlacementCandidate, type PlacementProps, type PlacementRequest, type PlacementWall } from "@/lib/elementPlacement";
import { DULUX_PAINT_FAMILIES, type DuluxPaintShade } from "@/lib/duluxPalette";
import { buildFloorFinishUpdates, type FloorTileScope } from "@/lib/floorFinishes";
import { buildWallFinishUpdates, type WallPaintScope } from "@/lib/wallFinishes";
import { buildSharedWallFinishFaces, buildIsolatedRoomWalls, buildRenderedWalls, type RenderedWall } from "@/lib/wallRendering";
import type { MaterialCollection, Obstacle, Opening, PersonMockup, Point2D, Room, RoomFinishes, TilePattern, WallViewMode } from "@/lib/types";
import { filledToolbarDock, FloatingToolbar, positionedToolbarDock, type ToolbarDock } from "@/components/FloatingToolbar";
import { ToolbarContextMenu } from "@/components/ToolbarContextMenu";
import { ViewToggle } from "@/components/ViewToggle";
import { VIEWER_TOOLBARS, type ToolbarId, type ToolbarVisibility } from "@/lib/toolbars";

const SCALE = 0.001;
const DEFAULT_WALL_COLOUR = "#c8c3b9";
const DISABLED_MESH_RAYCAST: THREE.Mesh["raycast"] = () => undefined;

interface Toggles {
  elements: boolean;
  openingImprints: boolean;
  collisions: boolean;
  person: boolean;
  clearance: boolean;
}

type CameraView = "perspective" | "top" | "bottom" | "left" | "right" | "eye";
type ProjectionMode = "perspective" | "parallel";
type CaptureFormat = "png" | "jpg" | "pdf";
const CAPTURE_ATTRIBUTION = "Made with FreeFloorplan3D.com";
const CAPTURE_ATTRIBUTION_FONT_SIZE = 18;
type LightingSettings = { intensity: number; shadows: number; direction: number; elevation: number };
const DEFAULT_LIGHTING: LightingSettings = { intensity: 100, shadows: 100, direction: 109, elevation: 55 };

type CameraQuaternionTuple = [number, number, number, number];
interface CameraViewSnapshot {
  position: VectorTuple;
  quaternion: CameraQuaternionTuple;
  up: VectorTuple;
  target: VectorTuple;
  zoom: number;
  distance: number;
  viewHeight: number;
}
interface ProjectionRestore extends CameraViewSnapshot {
  sourceProjection: ProjectionMode;
  token: number;
}

interface SaveFileWritable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface SaveFileHandle {
  createWritable(): Promise<SaveFileWritable>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{ description: string; accept: Record<string, string[]> }>;
}

type SaveFilePicker = (options?: SaveFilePickerOptions) => Promise<SaveFileHandle>;

interface ViewerProps extends PlacementProps {
  apiUrl: string;
  room: Room;
  sceneRooms?: Room[];
  roomSelection: string;
  roomSelectionOptions: Room[];
  fullFloorplanSelection: string;
  onRoomSelectionChange: (selection: string) => void;
  onOpenRoomSelection: () => void;
  collisionIds: string[];
  onObstaclesChange: (obstacles: Obstacle[], roomId?: string) => void;
  onFinishesChange: (finishes: RoomFinishes, roomId?: string) => void;
  onPersonChange: (person: PersonMockup | null, roomId?: string) => void;
  onOpeningSelected?: (selection: { id: string; roomId: string } | null) => void;
  onElementSelected?: (selection: { id: string; roomId: string } | null) => void;
  wallMode: WallViewMode;
  toolbarVisibility: ToolbarVisibility;
  toolbarAvailability: ToolbarVisibility;
  onToggleToolbar: (id: ToolbarId) => void;
  toolbarLayoutResetKey: number;
  fillToolbarLayout: boolean;
  fitRequest: number;
  saveViewRequest: number;
}

type Selection = { type: "OPENING"; id: string; roomId: string } | { type: "ELEMENT"; id: string; roomId: string } | { type: "PERSON"; roomId: string } | { type: "WALL"; id: string; ids: string[]; roomId: string } | { type: "FLOOR"; roomId: string } | null;

interface TileStyle {
  id: string;
  name: string;
  pattern: TilePattern;
  base: string;
  accent: string;
  grout: string;
  tileSize: number;
  preview: string;
}

const TILE_COLLECTION: TileStyle[] = [
  { id: "white-marble", name: "White marble", pattern: "MARBLE", base: "#eeeae2", accent: "#aeb5b3", grout: "#d0cdc7", tileSize: 600, preview: "linear-gradient(120deg,#f4f1ea 0 45%,#aeb5b3 47%,#f4f1ea 49% 100%)" },
  { id: "checker-black-white", name: "Black & white checker", pattern: "CHECKERBOARD", base: "#f2f0e9", accent: "#202523", grout: "#b9b7b0", tileSize: 400, preview: "conic-gradient(#202523 25%,#f2f0e9 0 50%,#202523 0 75%,#f2f0e9 0) 0/24px 24px" },
  { id: "terracotta-herringbone", name: "Terracotta herringbone", pattern: "HERRINGBONE", base: "#b96f4f", accent: "#8e4d39", grout: "#e2cbbd", tileSize: 260, preview: "repeating-linear-gradient(45deg,#b96f4f 0 8px,#e2cbbd 8px 10px,#8e4d39 10px 18px,#e2cbbd 18px 20px)" },
  { id: "blue-encaustic", name: "Blue encaustic", pattern: "DIAMOND", base: "#e8e5dc", accent: "#315f78", grout: "#c8c5bd", tileSize: 300, preview: "conic-gradient(from 45deg,#315f78 25%,#e8e5dc 0 50%,#315f78 0 75%,#e8e5dc 0) 0/28px 28px" },
  { id: "sage-kitkat", name: "Sage kit-kat", pattern: "KITKAT", base: "#789786", accent: "#5d796b", grout: "#d8d4ca", tileSize: 180, preview: "repeating-linear-gradient(90deg,#789786 0 7px,#d8d4ca 7px 9px,#5d796b 9px 16px,#d8d4ca 16px 18px)" },
  { id: "charcoal-slate", name: "Charcoal slate", pattern: "SQUARE_600", base: "#343c3b", accent: "#252b2a", grout: "#79817e", tileSize: 600, preview: "linear-gradient(#79817e 2px,transparent 2px),linear-gradient(90deg,#79817e 2px,#343c3b 2px) 0/26px 26px" },
  { id: "cream-terrazzo", name: "Cream terrazzo", pattern: "TERRAZZO", base: "#e6ddcc", accent: "#9d7867", grout: "#d5cbb9", tileSize: 500, preview: "radial-gradient(circle at 20% 30%,#9d7867 0 2px,transparent 3px),radial-gradient(circle at 70% 60%,#6d8580 0 2px,transparent 3px),#e6ddcc" },
  { id: "white-hexagon", name: "White hexagon", pattern: "HEXAGON", base: "#f3f1eb", accent: "#d3d0c9", grout: "#aaa9a5", tileSize: 220, preview: "conic-gradient(from 30deg,#d3d0c9 60deg,#f3f1eb 0 120deg,#d3d0c9 0 180deg,#f3f1eb 0 240deg,#d3d0c9 0 300deg,#f3f1eb 0)" },
];


const TILE_PATTERN_INDEX: Record<TilePattern, number> = {
  NONE: 0,
  SQUARE_300: 1,
  SQUARE_600: 1,
  CHECKERBOARD: 2,
  HERRINGBONE: 3,
  DIAMOND: 4,
  KITKAT: 5,
  TERRAZZO: 6,
  HEXAGON: 7,
  MARBLE: 8,
};

const FLOOR_VERTEX_SHADER = `
  varying vec2 vTileUv;

  void main() {
    vTileUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FLOOR_FRAGMENT_SHADER = `
  uniform vec3 baseColour;
  uniform vec3 accentColour;
  uniform vec3 groutColour;
  uniform vec3 selectionColour;
  uniform float selectedAmount;
  uniform float patternIndex;
  varying vec2 vTileUv;

  float random2d(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 tile = floor(vTileUv);
    vec2 local = fract(vTileUv);
    vec3 colour = baseColour;
    float grout = step(local.x, 0.035) + step(local.y, 0.035);

    if (patternIndex < 1.5) {
      float variation = random2d(tile) * 0.12;
      colour = mix(baseColour, accentColour, variation);
    } else if (patternIndex < 2.5) {
      float alternate = mod(tile.x + tile.y, 2.0);
      colour = mix(baseColour, accentColour, alternate);
    } else if (patternIndex < 3.5) {
      vec2 brick = fract(vTileUv * vec2(2.0, 4.0));
      float row = floor(vTileUv.y * 4.0);
      float diagonal = fract(brick.x + brick.y + mod(row, 2.0) * 0.5);
      grout += step(diagonal, 0.07) + step(brick.y, 0.06);
      colour = mix(baseColour, accentColour, mod(floor(vTileUv.x * 2.0) + row, 2.0));
    } else if (patternIndex < 4.5) {
      float distanceToCentre = abs(local.x - 0.5) + abs(local.y - 0.5);
      colour = distanceToCentre < 0.48 ? accentColour : baseColour;
      grout += 1.0 - step(0.045, abs(distanceToCentre - 0.48));
    } else if (patternIndex < 5.5) {
      vec2 strip = fract(vTileUv * vec2(5.0, 1.0));
      grout += step(strip.x, 0.09);
      float alternate = mod(floor(vTileUv.x * 5.0), 2.0);
      colour = mix(baseColour, accentColour, alternate * 0.55);
    } else if (patternIndex < 6.5) {
      vec2 speckleCell = floor(vTileUv * 14.0);
      float speckle = random2d(speckleCell);
      colour = speckle > 0.91 ? accentColour : (speckle < 0.055 ? groutColour : baseColour);
    } else if (patternIndex < 7.5) {
      vec2 hexUv = vTileUv * vec2(1.0, 1.1547);
      vec2 hexCell = floor(hexUv);
      vec2 hexLocal = fract(hexUv) - 0.5;
      hexLocal.x += mod(hexCell.y, 2.0) * 0.5;
      hexLocal.x = fract(hexLocal.x + 0.5) - 0.5;
      float hexEdge = max(abs(hexLocal.x) * 0.866025 + abs(hexLocal.y) * 0.5, abs(hexLocal.y));
      colour = mix(baseColour, accentColour, mod(hexCell.x + hexCell.y, 2.0) * 0.55);
      grout += smoothstep(0.43, 0.48, hexEdge);
    } else {
      float vein = abs(sin(vTileUv.x * 5.3 + vTileUv.y * 2.1) + sin(vTileUv.y * 8.7) * 0.35);
      colour = mix(baseColour, accentColour, smoothstep(1.02, 1.18, vein));
    }

    colour = mix(colour, groutColour, clamp(grout, 0.0, 1.0));
    colour = mix(colour, selectionColour, selectedAmount);
    gl_FragColor = vec4(colour, 1.0);
  }
`;

function signedPolygonArea(points: Point2D[]) {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}
function wallVector(start: Point2D, end: Point2D) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  return { dx: dx / length, dy: dy / length, length, angle: Math.atan2(dy, dx) };
}

function wallId(index: number): string {
  return `wall-${String(index + 1).padStart(3, "0")}`;
}

function wallSegmentKey(start: Point2D, end: Point2D): string {
  const pointKey = (point: Point2D) => `${Math.round(point.x * 1000)},${Math.round(point.y * 1000)}`;
  return [pointKey(start), pointKey(end)].sort().join("|");
}

function cross(a: Point2D, b: Point2D) {
  return a.x * b.y - a.y * b.x;
}

function wallThickness(room: Room, index: number): number {
  return room.wall_thickness_overrides_mm?.[wallId(index)] ?? room.wall_thickness.value;
}

function exteriorCorner(vertices: Point2D[], index: number, incomingThickness: number, outgoingThickness: number): Point2D {
  const vertex = vertices[index];
  const previous = vertices[(index - 1 + vertices.length) % vertices.length];
  const next = vertices[(index + 1) % vertices.length];
  const incoming = wallVector(previous, vertex);
  const outgoing = wallVector(vertex, next);
  const previousOffset = { x: vertex.x + incoming.dy * incomingThickness, y: vertex.y - incoming.dx * incomingThickness };
  const nextOffset = { x: vertex.x + outgoing.dy * outgoingThickness, y: vertex.y - outgoing.dx * outgoingThickness };
  const denominator = cross({ x: incoming.dx, y: incoming.dy }, { x: outgoing.dx, y: outgoing.dy });
  if (Math.abs(denominator) < 1e-9) {
    return { x: (previousOffset.x + nextOffset.x) / 2, y: (previousOffset.y + nextOffset.y) / 2 };
  }
  const between = { x: nextOffset.x - previousOffset.x, y: nextOffset.y - previousOffset.y };
  const distance = cross(between, { x: outgoing.dx, y: outgoing.dy }) / denominator;
  const corner = {
    x: previousOffset.x + incoming.dx * distance,
    y: previousOffset.y + incoming.dy * distance,
  };
  if (Math.hypot(corner.x - vertex.x, corner.y - vertex.y) > Math.max(incomingThickness, outgoingThickness) * 4) {
    return { x: (previousOffset.x + nextOffset.x) / 2, y: (previousOffset.y + nextOffset.y) / 2 };
  }
  return corner;
}

function WallPiece({
  start,
  end,
  from,
  length,
  base,
  height,
  thickness,
  outerStart,
  outerEnd,
  wallLength,
  colour,
  wallMode,
  selected,
  paintOnly = false,
  onSelect,
}: {
  start: Point2D;
  end: Point2D;
  from: number;
  length: number;
  base: number;
  height: number;
  thickness: number;
  outerStart: Point2D;
  outerEnd: Point2D;
  wallLength: number;
  colour: string;
  wallMode: WallViewMode;
  selected: boolean;
  paintOnly?: boolean;
  onSelect: (additive: boolean) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const solidMeshRef = useRef<THREE.Mesh>(null);
  const paintMeshRef = useRef<THREE.Mesh>(null);
  const fullLength = Math.hypot(end.x - start.x, end.y - start.y);
  const vector = fullLength > 0 ? wallVector(start, end) : { dx: 1, dy: 0, length: 0, angle: 0 };
  useFrame(({ camera }) => {
    if (!groupRef.current) return;
    let isVisible = true;
    if (wallMode !== "CUTAWAY_2D") {
      isVisible = true;
    } else {
      const centre = new THREE.Vector3((start.x + end.x) * SCALE / 2, 0, -(start.y + end.y) * SCALE / 2);
      const toCamera = camera.position.clone().sub(centre).setY(0);
      if (toCamera.lengthSq() >= 1e-6) {
        toCamera.normalize();
        const outward = new THREE.Vector3(vector.dy, 0, vector.dx);
        isVisible = outward.dot(toCamera) <= 0.05;
      }
    }
    groupRef.current.visible = isVisible;
    const raycast = isVisible ? THREE.Mesh.prototype.raycast : DISABLED_MESH_RAYCAST;
    if (solidMeshRef.current) solidMeshRef.current.raycast = raycast;
    if (paintMeshRef.current) paintMeshRef.current.raycast = raycast;
  });
  if (length <= 0 || height <= 0) return null;
  const exteriorX = vector.dy;
  const exteriorY = -vector.dx;
  const to = from + length;
  const innerFrom = { x: start.x + vector.dx * from, y: start.y + vector.dy * from };
  const innerTo = { x: start.x + vector.dx * to, y: start.y + vector.dy * to };
  const offsetAt = (distance: number, corner: Point2D, atCorner: boolean) => atCorner
    ? corner
    : {
        x: start.x + vector.dx * distance + exteriorX * thickness,
        y: start.y + vector.dy * distance + exteriorY * thickness,
      };
  const outsideFrom = offsetAt(from, outerStart, Math.abs(from) < 1e-6);
  const outsideTo = offsetAt(to, outerEnd, Math.abs(to - wallLength) < 1e-6);
  const shape = new THREE.Shape();
  // Rotating the shape's XY plane into XZ maps plan Y to negative world Z.
  shape.moveTo(innerFrom.x * SCALE, innerFrom.y * SCALE);
  shape.lineTo(innerTo.x * SCALE, innerTo.y * SCALE);
  shape.lineTo(outsideTo.x * SCALE, outsideTo.y * SCALE);
  shape.lineTo(outsideFrom.x * SCALE, outsideFrom.y * SCALE);
  shape.closePath();
  const innerCentre = { x: (innerFrom.x + innerTo.x) / 2, y: (innerFrom.y + innerTo.y) / 2 };
  const paintOffset = 0.0015;
  return (
    <group ref={groupRef}>
      {!paintOnly && wallMode !== "CUTAWAY_2D" && <mesh
        ref={solidMeshRef}
        castShadow={wallMode !== "TRANSPARENT"}
        receiveShadow
        position={[0, base * SCALE, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={(event) => { event.stopPropagation(); onSelect(event.ctrlKey || event.metaKey); }}
      >
        <extrudeGeometry args={[shape, { depth: height * SCALE, bevelEnabled: false }]} />
        <meshStandardMaterial color={DEFAULT_WALL_COLOUR} roughness={0.86} side={THREE.DoubleSide} transparent={wallMode === "TRANSPARENT"} opacity={wallMode === "TRANSPARENT" ? 0.2 : 1} depthWrite={wallMode !== "TRANSPARENT"} />
      </mesh>}
      {/* Paint is a thin overlay on the solid wall; shadow mapping it causes
          perspective self-shadow acne along the coplanar wall surfaces. */}
      <mesh
        ref={paintMeshRef}
        position={[
          innerCentre.x * SCALE - vector.dy * paintOffset,
          (base + height / 2) * SCALE,
          -innerCentre.y * SCALE - vector.dx * paintOffset,
        ]}
        rotation={[0, vector.angle, 0]}
        castShadow={false}
        receiveShadow={false}
        onPointerDown={(event) => { event.stopPropagation(); onSelect(event.ctrlKey || event.metaKey); }}
      >
        <planeGeometry args={[length * SCALE, height * SCALE]} />
        <meshStandardMaterial color={colour} roughness={0.88} metalness={0} emissive={selected ? "#b76d16" : "#000000"} emissiveIntensity={selected ? 0.12 : 0} side={THREE.DoubleSide} transparent={wallMode === "TRANSPARENT"} opacity={wallMode === "TRANSPARENT" ? 0.28 : 1} depthWrite={wallMode !== "TRANSPARENT"} />
      </mesh>
    </group>
  );
}

function WallWithOpenings({
  index,
  room,
  start,
  end,
  sourceOffsetMm,
  sourceLengthMm,
  capStart,
  capEnd,
  wallMode,
  selected,
  paintOnly = false,
  onSelect,
}: {
  index: number;
  room: Room;
  start: Point2D;
  end: Point2D;
  sourceOffsetMm: number;
  sourceLengthMm: number;
  capStart: boolean;
  capEnd: boolean;
  wallMode: WallViewMode;
  selected: boolean;
  paintOnly?: boolean;
  onSelect: (additive: boolean) => void;
}) {
  const vector = wallVector(start, end);
  const thickness = wallThickness(room, index);
  const offsetPoint = (point: Point2D) => ({ x: point.x + vector.dy * thickness, y: point.y - vector.dx * thickness });
  const outerStart = capStart
    ? offsetPoint(start)
    : exteriorCorner(room.vertices, index, wallThickness(room, (index - 1 + room.vertices.length) % room.vertices.length), thickness);
  const outerEnd = capEnd
    ? offsetPoint(end)
    : exteriorCorner(room.vertices, (index + 1) % room.vertices.length, thickness, wallThickness(room, (index + 1) % room.vertices.length));
  const currentWallId = wallId(index);
  const colour = room.finishes?.wall_colors?.[currentWallId] ?? DEFAULT_WALL_COLOUR;
  const openings = room.openings
    .filter((opening) => opening.parent_wall_id === currentWallId)
    .map((opening) => {
      const openingStart = opening.offset_mm - sourceOffsetMm;
      const openingEnd = openingStart + opening.width.value;
      const clippedStart = Math.max(0, openingStart);
      const clippedEnd = Math.min(vector.length, openingEnd);
      if (clippedEnd - clippedStart <= 1e-6 || openingStart >= sourceLengthMm || openingEnd <= 0) return null;
      return { ...opening, offset_mm: clippedStart, width: { ...opening.width, value: clippedEnd - clippedStart } };
    })
    .filter((opening): opening is Opening => Boolean(opening))
    .sort((a, b) => a.offset_mm - b.offset_mm);
  const pieces: React.ReactNode[] = [];
  let cursor = 0;
  openings.forEach((opening) => {
    pieces.push(
      <WallPiece
        key={`${opening.id}-before`}
        start={start}
        end={end}
        from={cursor}
        length={opening.offset_mm - cursor}
        base={0}
        height={room.wall_height.value}
        thickness={thickness}
        outerStart={outerStart}
        outerEnd={outerEnd}
        wallLength={vector.length}
        colour={colour}
        wallMode={wallMode}
        selected={selected}
        paintOnly={paintOnly}
        onSelect={onSelect}
      />,
    );
    if (opening.sill_height_mm > 0) {
      pieces.push(
        <WallPiece
          key={`${opening.id}-below`}
          start={start}
          end={end}
          from={opening.offset_mm}
          length={opening.width.value}
          base={0}
          height={opening.sill_height_mm}
          thickness={thickness}
          outerStart={outerStart}
          outerEnd={outerEnd}
          wallLength={vector.length}
          colour={colour}
          wallMode={wallMode}
          selected={selected}
        paintOnly={paintOnly}
          onSelect={onSelect}
        />,
      );
    }
    const top = opening.sill_height_mm + opening.height.value;
    pieces.push(
      <WallPiece
        key={`${opening.id}-above`}
        start={start}
        end={end}
        from={opening.offset_mm}
        length={opening.width.value}
        base={top}
        height={room.wall_height.value - top}
        thickness={thickness}
        outerStart={outerStart}
        outerEnd={outerEnd}
        wallLength={vector.length}
        colour={colour}
        wallMode={wallMode}
        selected={selected}
        paintOnly={paintOnly}
        onSelect={onSelect}
      />,
    );
    cursor = opening.offset_mm + opening.width.value;
  });
  pieces.push(
    <WallPiece
      key={`${currentWallId}-after`}
      start={start}
      end={end}
      from={cursor}
      length={vector.length - cursor}
      base={0}
      height={room.wall_height.value}
      thickness={thickness}
      outerStart={outerStart}
      outerEnd={outerEnd}
      wallLength={vector.length}
      colour={colour}
      wallMode={wallMode}
      selected={selected}
        paintOnly={paintOnly}
      onSelect={onSelect}
    />,
  );
  return <>{pieces}</>;
}

function Floor({ room, selected, onSelect }: { room: Room; selected: boolean; onSelect: () => void }) {
  const vertices = room.vertices;
  const shape = useMemo(() => {
    const next = new THREE.Shape();
    vertices.forEach((vertex, index) => {
      const x = vertex.x * SCALE;
      // The rotation below maps the shape's plan Y to negative world Z.
      const y = vertex.y * SCALE;
      if (index === 0) next.moveTo(x, y);
      else next.lineTo(x, y);
    });
    next.closePath();
    return next;
  }, [vertices]);
  const colour = room.finishes?.floor_color ?? "#ece9e1";
  const pattern = room.finishes?.floor_pattern ?? "NONE";
  const selectedTile = useMemo(() => TILE_COLLECTION.find((item) => item.id === room.finishes?.floor_tile_id), [room.finishes?.floor_tile_id]);
  const legacyTile = useMemo<TileStyle | null>(() => pattern === "NONE" ? null : ({ id: "legacy", name: "Custom tile", pattern, base: colour, accent: colour, grout: "#a8aaa5", tileSize: pattern === "SQUARE_600" ? 600 : 300, preview: colour }), [colour, pattern]);
  const tile = selectedTile ?? legacyTile;
  const savedColours = tile ? room.finishes?.floor_tile_colours?.[room.finishes?.floor_tile_id ?? tile.id] : undefined;
  const renderedTile = useMemo(() => tile ? { ...tile, ...savedColours } : null, [savedColours, tile]);
  const savedDesign = room.finishes?.floor_design;
  const design = useMemo(() => savedDesign ? normalizeFloorDesign(savedDesign) : null, [savedDesign]);
  const swatch = useMemo(() => design ? flooringSwatch(design) : null, [design]);
  const floorGeometry = useMemo(() => {
    const geometry = new THREE.ShapeGeometry(shape);
    const position = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    const tileSizeMetres = (renderedTile?.tileSize ?? 500) * SCALE;
    for (let index = 0; index < position.count; index += 1) {
      if (design && swatch) {
        const angle = design.rotation_deg * Math.PI / 180;
        const px = position.getX(index) / SCALE, py = position.getY(index) / SCALE;
        const x = px * Math.cos(angle) + py * Math.sin(angle), y = -px * Math.sin(angle) + py * Math.cos(angle);
        uv.setXY(index, (swatch.diagonal ? (x - y) / 2 : x) / swatch.width, 1 - (swatch.diagonal ? (x + y) / 2 : y) / swatch.height);
      } else uv.setXY(index, position.getX(index) / tileSizeMetres, position.getY(index) / tileSizeMetres);
    }
    uv.needsUpdate = true;
    return geometry;
  }, [renderedTile?.tileSize, shape, design, swatch]);
  useEffect(() => () => floorGeometry.dispose(), [floorGeometry]);
  const tileUniforms = useMemo(() => ({
    baseColour: { value: new THREE.Color(renderedTile?.base ?? colour) },
    accentColour: { value: new THREE.Color(renderedTile?.accent ?? colour) },
    groutColour: { value: new THREE.Color(renderedTile?.grout ?? colour) },
    selectionColour: { value: new THREE.Color("#b76d16") },
    selectedAmount: { value: selected ? 0.12 : 0 },
    patternIndex: { value: renderedTile ? TILE_PATTERN_INDEX[renderedTile.pattern] : 0 },
  }), [colour, renderedTile, selected]);
  return (
    <group>
      <mesh position={[0, -0.011, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <extrudeGeometry args={[shape, { depth: 0.01, bevelEnabled: false }]} />
        <meshStandardMaterial color="#b9b3a8" roughness={0.84} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={floorGeometry} position={[0, 0.0001, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow onPointerDown={(event) => { event.stopPropagation(); onSelect(); }}>
        {swatch ? <ProceduralFloorMaterial url={swatch.url} selected={selected} roughness={design && !design.pattern.startsWith("wood-") ? ({ polished: .18, gloss: .12, satin: .4, honed: .6, matt: .8, textured: .95, rustic: .9, tumbled: .9 }[TILE_MATERIALS.find((tile) => tile.id === design.tile_material_id)?.finish ?? "matt"] ?? .78) : .78} /> : renderedTile ? (
          <shaderMaterial
            uniforms={tileUniforms}
            vertexShader={FLOOR_VERTEX_SHADER}
            fragmentShader={FLOOR_FRAGMENT_SHADER}
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={-4}
            polygonOffsetUnits={-4}
          />
        ) : (
          <meshStandardMaterial color={colour} roughness={0.78} side={THREE.DoubleSide} emissive={selected ? "#b76d16" : "#000000"} emissiveIntensity={selected ? 0.12 : 0} />
        )}
      </mesh>
    </group>
  );
}

function StlFixture({ obstacle, width, depth, height, colour, fallback }: { obstacle: Obstacle; width: number; depth: number; height: number; colour: string; fallback: ReactNode }) {
  const geometry = useMemo(() => {
    if (!obstacle.stl_base64) return null;
    try {
      const source = obstacle.stl_base64.trim();
      const encoded = source.includes(",") ? source.slice(source.indexOf(",") + 1) : source;
      const normalized = encoded.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(normalized.length + (4 - normalized.length % 4) % 4, "=");
      const binary = window.atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const parsed = new STLLoader().parse(bytes.buffer);
      parsed.computeVertexNormals();
      parsed.computeBoundingBox();
      let box = parsed.boundingBox;
      if (!box) return null;
      const originalSize = box.getSize(new THREE.Vector3());
      if (originalSize.z > originalSize.y * 1.15 && height > Math.max(width, depth) * 1.1) {
        parsed.rotateX(-Math.PI / 2);
        parsed.computeBoundingBox();
        box = parsed.boundingBox;
        if (!box) return null;
      }
      const size = box.getSize(new THREE.Vector3());
      if (![size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 1e-6)) return null;
      const centre = box.getCenter(new THREE.Vector3());
      parsed.translate(-centre.x, -box.min.y, -centre.z);
      parsed.scale(width / size.x, height / size.y, depth / size.z);
      parsed.computeBoundingSphere();
      return parsed;
    } catch {
      return null;
    }
  }, [depth, height, obstacle.stl_base64, width]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return fallback;
  return <mesh geometry={geometry} castShadow receiveShadow><meshStandardMaterial color={colour} roughness={0.56} metalness={0.04} /></mesh>;
}

function safeRenderDimension(value: number, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function ProceduralFixture({ obstacle, width, depth, height }: { obstacle: Obstacle; width: number; depth: number; height: number }) {
  const fixtureKind = fixtureKindForObstacle(obstacle);
  const customColour = obstacle.color_hex;
  if (["SHOWER", "BASIN", "TOILET"].includes(fixtureKind) || (obstacle.representation_key === "furniture-storage-unit" || obstacle.representation_key?.startsWith("furniture-stair-") || obstacle.representation_key?.startsWith("furniture-radiator-") || /^furniture-(bath-|kitchen-|wardrobe-)/.test(obstacle.representation_key ?? ""))) {
    return <ParametricFixture obstacle={obstacle} width={width} depth={depth} height={height} />;
  }

  if (fixtureKind === "FURNITURE") {
    if (/^furniture-(sofa|armchair|chair|bed|table)-/.test(obstacle.representation_key ?? "")) {
      return <RoomFurniture materials={obstacle.component_materials} physicalSize={[width / SCALE, height / SCALE, depth / SCALE]} colours={resolvedPartColours(obstacle)} representation={obstacle.representation_key!} colour={customColour ?? "#b99b77"} secondaryColour={obstacle.secondary_color_hex} hardwareColour={obstacle.hardware_color_hex} width={width} depth={depth} height={height} />;
    }
    const isBench = obstacle.model_id?.includes("bench");
    return <>
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={customColour ?? (isBench ? "#a88762" : "#b99b77")} roughness={0.72} />
      </mesh>
      {!isBench && <>
        <mesh position={[0, height * 0.55, depth / 2 + 0.004]}>
          <boxGeometry args={[width * 0.88, height * 0.78, 0.012]} />
          <meshStandardMaterial color="#ceb798" roughness={0.66} />
        </mesh>
        <mesh position={[width * 0.34, height * 0.55, depth / 2 + 0.014]}>
          <sphereGeometry args={[0.018, 16, 12]} />
          <meshStandardMaterial color="#4e5755" metalness={0.55} roughness={0.3} />
        </mesh>
      </>}
    </>;
  }

  return <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
    <boxGeometry args={[width, height, depth]} />
    <meshStandardMaterial color="#8a7765" roughness={0.72} />
  </mesh>;
}

function FixtureMesh({ obstacle, selected, onPointerDown, onPointerMove, onPointerUp }: {
  obstacle: Obstacle;
  selected: boolean;
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMove?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerUp?: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const sourceDimensions = [obstacle.dimensions.width.value, obstacle.dimensions.depth.value, obstacle.dimensions.height.value].map(Number);
  const fallbackDimension = Math.max(...sourceDimensions.filter(value => Number.isFinite(value) && value > 0), 1000);
  const width = safeRenderDimension(obstacle.dimensions.width.value, fallbackDimension) * SCALE;
  const depth = safeRenderDimension(obstacle.dimensions.depth.value, fallbackDimension) * SCALE;
  const height = safeRenderDimension(obstacle.dimensions.height.value, fallbackDimension) * SCALE;
  const centerX = Number.isFinite(Number(obstacle.center.x)) ? Number(obstacle.center.x) : 0;
  const centerY = Number.isFinite(Number(obstacle.center.y)) ? Number(obstacle.center.y) : 0;
  const baseZ = Number.isFinite(Number(obstacle.base_z_mm)) && Number(obstacle.base_z_mm) >= 0 ? Number(obstacle.base_z_mm) : 0;
  const rotationValue = Number.isFinite(Number(obstacle.rotation_deg)) ? Number(obstacle.rotation_deg) : 0;
  const position: [number, number, number] = [centerX * SCALE, baseZ * SCALE, -centerY * SCALE];
  const rotation: [number, number, number] = [0, THREE.MathUtils.degToRad(rotationValue), 0];
  const interactionProps = { onPointerDown, onPointerMove, onPointerUp };
  const selectionRing = selected ? (
    <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[Math.max(width, depth) * 0.62, Math.max(width, depth) * 0.68, 48]} />
      <meshBasicMaterial color="#b8640c" transparent opacity={0.9} side={THREE.DoubleSide} />
    </mesh>
  ) : null;
  const procedural = <ProceduralFixture obstacle={obstacle} width={width} depth={depth} height={height} />;

  return <group position={position} rotation={rotation} {...interactionProps}>
    {selectionRing}
    {obstacle.stl_base64 ? <StlFixture obstacle={obstacle} width={width} depth={depth} height={height} colour={resolvedPartColours(obstacle).body ?? obstacle.color_hex ?? "#b99b77"} fallback={procedural} /> : procedural}
  </group>;
}
function DoorSwingLeaf({
  hinge,
  initial,
  direction,
  radius,
  colour,
}: {
  hinge: Point2D;
  initial: number;
  direction: number;
  radius: number;
  colour: string;
}) {
  const shape = new THREE.Shape();
  shape.moveTo(hinge.x * SCALE, hinge.y * SCALE);
  for (let step = 0; step <= 32; step += 1) {
    const angle = initial + direction * Math.PI / 2 * step / 32;
    shape.lineTo(
      (hinge.x + radius * Math.cos(angle)) * SCALE,
      (hinge.y + radius * Math.sin(angle)) * SCALE,
    );
  }
  shape.closePath();
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.018, 0]}>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial color={colour} transparent opacity={0.28} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function DoorSwing({ room, door }: { room: Room; door: Opening }) {
  const wallIndex = Number(door.parent_wall_id.split("-")[1]) - 1;
  const start = room.vertices[wallIndex];
  const end = room.vertices[(wallIndex + 1) % room.vertices.length];
  const vector = wallVector(start, end);
  const startX = start.x + vector.dx * door.offset_mm;
  const startY = start.y + vector.dy * door.offset_mm;
  const endX = startX + vector.dx * door.width.value;
  const endY = startY + vector.dy * door.width.value;
  const inward = door.opens_inward !== false;
  const colour = typeof door.metadata?.color_hex === "string" && /^#[\da-f]{6}$/i.test(door.metadata.color_hex) ? door.metadata.color_hex : "#e5a51b";
  if (door.door_type === "DOUBLE") {
    return (
      <>
        <DoorSwingLeaf hinge={{ x: startX, y: startY }} initial={vector.angle} direction={inward ? 1 : -1} radius={door.width.value / 2} colour={colour} />
        <DoorSwingLeaf hinge={{ x: endX, y: endY }} initial={vector.angle + Math.PI} direction={inward ? -1 : 1} radius={door.width.value / 2} colour={colour} />
      </>
    );
  }
  const hingeStart = door.hinge_side === "START";
  const hinge = hingeStart ? { x: startX, y: startY } : { x: endX, y: endY };
  const initial = Math.atan2(hingeStart ? vector.dy : -vector.dy, hingeStart ? vector.dx : -vector.dx);
  const direction = hingeStart ? (inward ? 1 : -1) : (inward ? -1 : 1);
  return <DoorSwingLeaf hinge={hinge} initial={initial} direction={direction} radius={door.width.value} colour={colour} />;
}

type VectorTuple = [number, number, number];

function OpeningFixture({ room, opening, selected, onSelect }: { room: Room; opening: Opening; selected: boolean; onSelect?: () => void }) {
  const wallIndex = Number(opening.parent_wall_id.split("-")[1]) - 1;
  const start = room.vertices[wallIndex];
  const end = room.vertices[(wallIndex + 1) % room.vertices.length];
  if (!start || !end || (opening.kind !== "DOOR" && opening.kind !== "WINDOW")) return null;
  const vector = wallVector(start, end);
  const width = opening.width.value * SCALE;
  const height = opening.height.value * SCALE;
  const sill = opening.sill_height_mm * SCALE;
  const depth = Math.max((opening.reveal_depth_mm ?? wallThickness(room, wallIndex)) * SCALE, 0.06);
  const centre = {
    x: start.x + vector.dx * (opening.offset_mm + opening.width.value / 2),
    y: start.y + vector.dy * (opening.offset_mm + opening.width.value / 2),
  };
  const windowKey = typeof opening.metadata?.representation_key === "string" ? opening.metadata.representation_key : "window-single-pane";
  const windowDepth = typeof opening.metadata?.window_depth_mm === "number" && Number.isFinite(opening.metadata.window_depth_mm) && opening.metadata.window_depth_mm > 0 ? opening.metadata.window_depth_mm * SCALE : depth;
  const windowProjection = windowKey === "window-bay" || windowKey === "window-bow";
  const doorColour = typeof opening.metadata?.color_hex === "string" && /^#[\da-f]{6}$/i.test(opening.metadata.color_hex) ? opening.metadata.color_hex : "#5b4330";
  // WindowPlanVertices places the bow depth on local -Z. For the CCW room
  // winding used by the 2D plan, local -Z points inward after the wall
  // rotation, so turn projected windows around to keep the bow outside.
  const openingRotation = windowProjection && signedPolygonArea(room.vertices) >= 0 ? vector.angle + Math.PI : vector.angle;
  return <group position={[centre.x * SCALE, 0, -centre.y * SCALE]} rotation={[0, openingRotation, 0]} onPointerDown={onSelect ? event => { event.stopPropagation(); onSelect(); } : undefined}>
    {selected && <Line points={[[-width / 2, sill, depth / 2], [-width / 2, sill + height, depth / 2], [width / 2, sill + height, depth / 2], [width / 2, sill, depth / 2]]} color="#1685dd" lineWidth={3} />}
    {opening.kind === "DOOR" ? (
      <group position={[0, sill, 0]} scale={[opening.hinge_side === "END" ? -1 : 1, 1, 1]}><DoorFixture colours={resolvedPartColours({ representation_key: doorRepresentation(typeof opening.metadata?.representation_key === "string" ? opening.metadata.representation_key : undefined, opening.door_type), color_hex: doorColour, component_colors: componentColoursFromMetadata(opening.metadata) })} representation={doorRepresentation(typeof opening.metadata?.representation_key === "string" ? opening.metadata.representation_key : undefined, opening.door_type)} width={width} depth={depth} height={height} colour={doorColour} frame /></group>
    ) : <group position={[0, sill, windowProjection ? -windowDepth * .44 : 0]}>
      <WindowFixture colours={resolvedPartColours({ representation_key: windowKey, color_hex: typeof opening.metadata?.color_hex === "string" ? opening.metadata.color_hex : "#F4F3EE", component_colors: componentColoursFromMetadata(opening.metadata) })} representation={windowKey} width={width} height={height} depth={windowDepth} colour={typeof opening.metadata?.color_hex === "string" ? opening.metadata.color_hex : "#F4F3EE"} />
    </group>}
  </group>;
}

function OpeningImprint({ room, opening }: { room: Room; opening: Opening }) {
  const wallIndex = Number(opening.parent_wall_id.split("-")[1]) - 1;
  const start = room.vertices[wallIndex];
  const end = room.vertices[(wallIndex + 1) % room.vertices.length];
  if (!start || !end) return null;
  const vector = wallVector(start, end);
  const width = opening.width.value * SCALE;
  const height = opening.height.value * SCALE;
  const sill = opening.sill_height_mm * SCALE;
  const centre = {
    x: start.x + vector.dx * (opening.offset_mm + opening.width.value / 2),
    y: start.y + vector.dy * (opening.offset_mm + opening.width.value / 2),
  };
  const points: VectorTuple[] = [[-width / 2, sill, 0.035], [width / 2, sill, 0.035], [width / 2, sill + height, 0.035], [-width / 2, sill + height, 0.035], [-width / 2, sill, 0.035]];
  return <group position={[centre.x * SCALE, 0, -centre.y * SCALE]} rotation={[0, vector.angle, 0]}>
    <Line points={points} color={opening.kind === "DOOR" ? "#e5a51b" : "#4a9cb8"} lineWidth={1.2} dashed dashSize={0.045} gapSize={0.025} />
  </group>;
}

function Limb({ from, to, radius, colour }: { from: VectorTuple; to: VectorTuple; radius: number; colour: string }) {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const direction = end.clone().sub(start);
  const length = direction.length();
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return <mesh position={midpoint.toArray()} quaternion={quaternion} castShadow><cylinderGeometry args={[radius * 0.88, radius, length, 16]} /><meshStandardMaterial color={colour} roughness={0.68} /></mesh>;
}

function PersonMesh({ person, showClearance, collision, selected, onPointerDown, onPointerMove, onPointerUp }: {
  person: PersonMockup;
  showClearance: boolean;
  collision: boolean;
  selected: boolean;
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMove?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerUp?: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const height = person.height_mm * SCALE;
  const width = person.shoulder_width_mm * SCALE;
  const depth = person.body_depth_mm * SCALE;
  const eye = person.eye_height_mm * SCALE;
  const clearance = person.movement_clearance_mm * SCALE;
  const headRadius = Math.min(width * 0.22, height * 0.07);
  const skin = "#d8a17c";
  const clothing = collision ? "#a92d2d" : "#315f78";
  const trousers = "#293a47";
  const shoe = "#303432";
  const limbRadius = Math.max(width * 0.06, 0.03);
  const standing = person.posture === "STANDING";
  const seated = person.posture === "SEATED";
  const crouching = person.posture === "CROUCHING";
  const footHeight = seated ? height * 0.055 : height * 0.07;
  const seatedLegZ = depth * 0.12;
  const headY = standing ? height * 0.91 : Math.min(eye + headRadius * 0.18, height - headRadius);
  const shoulderY = standing ? height * 0.84 : headY - headRadius * 1.15;
  const hipY = standing ? height * 0.48 : seated ? height * 0.35 : height * 0.31;
  const shoulderZ = crouching ? depth * 0.08 : 0;
  const hipZ = crouching ? -depth * 0.08 : 0;
  const torsoHeight = Math.max(shoulderY - hipY, height * 0.2);
  const torsoY = (shoulderY + hipY) / 2;
  const torsoZ = (shoulderZ + hipZ) / 2;
  const torsoTilt = person.posture === "CROUCHING" ? -0.34 : seated ? -0.06 : 0;
  const shoulderLeft: VectorTuple = [-width * 0.36, shoulderY, shoulderZ];
  const shoulderRight: VectorTuple = [width * 0.36, shoulderY, shoulderZ];
  const hipLeft: VectorTuple = [-width * 0.2, hipY, hipZ];
  const hipRight: VectorTuple = [width * 0.2, hipY, hipZ];
  const kneeLeft: VectorTuple = standing ? [-width * 0.18, height * 0.26, 0] : seated ? [-width * 0.2, height * 0.29, seatedLegZ] : [-width * 0.34, height * 0.14, depth * 0.16];
  const kneeRight: VectorTuple = standing ? [width * 0.18, height * 0.26, 0] : seated ? [width * 0.2, height * 0.29, seatedLegZ] : [width * 0.34, height * 0.14, depth * 0.16];
  const ankleLeft: VectorTuple = standing ? [-width * 0.18, height * 0.055, 0] : seated ? [-width * 0.2, footHeight * 0.8, seatedLegZ] : [-width * 0.27, height * 0.045, depth * 0.12];
  const ankleRight: VectorTuple = standing ? [width * 0.18, height * 0.055, 0] : seated ? [width * 0.2, footHeight * 0.8, seatedLegZ] : [width * 0.27, height * 0.045, depth * 0.12];
  const elbowY = standing ? height * 0.56 : seated ? height * 0.47 : height * 0.32;
  const handY = standing ? height * 0.39 : seated ? height * 0.34 : height * 0.12;
  const elbowZ = crouching ? depth * 0.18 : depth * 0.08;
  const handZ = crouching ? depth * 0.22 : depth * 0.12;
  const footForwardOffset = standing ? depth * 0.24 : 0;
  const clearanceWidth = width + clearance * 2;
  const clearanceDepth = depth + clearance * 2;
  const clearancePoints: VectorTuple[] = [[-clearanceWidth / 2, 0.017, -clearanceDepth / 2], [clearanceWidth / 2, 0.017, -clearanceDepth / 2], [clearanceWidth / 2, 0.017, clearanceDepth / 2], [-clearanceWidth / 2, 0.017, clearanceDepth / 2], [-clearanceWidth / 2, 0.017, -clearanceDepth / 2]];
  const clearanceTopPoints: VectorTuple[] = clearancePoints.map(([x, , z]) => [x, height, z]);
  const neckBottom = shoulderY - headRadius * 0.04;
  const neckTop = headY - headRadius * 0.92;
  const neckHeight = Math.max(neckTop - neckBottom, headRadius * 0.34);
  const interactionProps = { onPointerDown, onPointerMove, onPointerUp };

  return (
    <group position={[person.center.x * SCALE, 0, -person.center.y * SCALE]} rotation={[0, THREE.MathUtils.degToRad(person.rotation_deg), 0]} {...interactionProps}>
      {showClearance && <>
        <RoundedBox args={[clearanceWidth, height, clearanceDepth]} radius={Math.min(clearance, 0.18)} smoothness={4} position={[0, height / 2, 0]}>
          <meshBasicMaterial color={collision ? "#e04545" : "#e2a73a"} transparent opacity={0.055} depthWrite={false} />
        </RoundedBox>
        <Line points={clearancePoints} color={collision ? "#d63737" : "#bd7611"} lineWidth={1.6} dashed dashSize={0.07} gapSize={0.04} />
        <Line points={clearanceTopPoints} color={collision ? "#d63737" : "#bd7611"} lineWidth={1.6} dashed dashSize={0.07} gapSize={0.04} />
        {clearancePoints.slice(0, -1).map(([x, y, z], index) => <Line key={`clearance-side-${index}`} points={[[x, y, z], [x, height, z]]} color={collision ? "#d63737" : "#bd7611"} lineWidth={1.2} dashed dashSize={0.07} gapSize={0.04} />)}
      </>}
      {selected && <Line points={clearancePoints.map(([x, y, z]) => [x, y + 0.012, z] as VectorTuple)} color="#0d6b59" lineWidth={3} />}
      <RoundedBox args={[width * 0.72, torsoHeight, depth * 0.76]} radius={Math.min(width, depth) * 0.22} smoothness={5} position={[0, torsoY, torsoZ]} rotation={[torsoTilt, 0, 0]} castShadow>
        <meshStandardMaterial color={clothing} roughness={0.72} />
      </RoundedBox>
      <RoundedBox args={[width * 0.5, height * 0.11, depth * 0.72]} radius={Math.min(width, depth) * 0.18} smoothness={4} position={[0, hipY, hipZ]} castShadow><meshStandardMaterial color={trousers} roughness={0.76} /></RoundedBox>
      <mesh position={[0, neckBottom + neckHeight / 2, shoulderZ * 0.9]} castShadow><cylinderGeometry args={[headRadius * 0.34, headRadius * 0.42, neckHeight, 18]} /><meshStandardMaterial color={skin} roughness={0.64} /></mesh>
      <mesh position={[0, headY, shoulderZ]} scale={[0.92, 1.08, 0.96]} castShadow><sphereGeometry args={[headRadius, 28, 22]} /><meshStandardMaterial color={skin} roughness={0.62} /></mesh>
      <mesh position={[0, headY + headRadius * 0.45, shoulderZ - headRadius * 0.15]} scale={[0.94, 0.48, 0.96]} castShadow><sphereGeometry args={[headRadius, 24, 16]} /><meshStandardMaterial color="#4b3429" roughness={0.88} /></mesh>
      <mesh position={[0, headY - headRadius * 0.04, shoulderZ + headRadius * 0.94]} castShadow><sphereGeometry args={[headRadius * 0.13, 12, 10]} /><meshStandardMaterial color={skin} roughness={0.62} /></mesh>
      {[-1, 1].map((side) => <mesh key={`ear-${side}`} position={[side * headRadius * 0.94, headY, shoulderZ]}><sphereGeometry args={[headRadius * 0.18, 12, 10]} /><meshStandardMaterial color={skin} roughness={0.68} /></mesh>)}
      {[-1, 1].map((side) => <mesh key={`eye-${side}`} position={[side * headRadius * 0.33, headY + headRadius * 0.15, shoulderZ + headRadius * 0.88]}><sphereGeometry args={[headRadius * 0.045, 8, 8]} /><meshStandardMaterial color="#242a27" roughness={0.5} /></mesh>)}
      <Limb from={shoulderLeft} to={[-width * 0.44, elbowY, elbowZ]} radius={limbRadius} colour={skin} />
      <Limb from={[-width * 0.44, elbowY, elbowZ]} to={[-width * 0.4, handY, handZ]} radius={limbRadius * 0.88} colour={skin} />
      <Limb from={shoulderRight} to={[width * 0.44, elbowY, elbowZ]} radius={limbRadius} colour={skin} />
      <Limb from={[width * 0.44, elbowY, elbowZ]} to={[width * 0.4, handY, handZ]} radius={limbRadius * 0.88} colour={skin} />
      {[-1, 1].map((side) => <mesh key={`hand-${side}`} position={[side * width * 0.4, handY, handZ]} scale={[0.75, 1.15, 0.55]}><sphereGeometry args={[limbRadius, 14, 10]} /><meshStandardMaterial color={skin} roughness={0.65} /></mesh>)}
      <Limb from={hipLeft} to={kneeLeft} radius={limbRadius * 1.25} colour={trousers} />
      <Limb from={kneeLeft} to={ankleLeft} radius={limbRadius * 1.05} colour={trousers} />
      <Limb from={hipRight} to={kneeRight} radius={limbRadius * 1.25} colour={trousers} />
      <Limb from={kneeRight} to={ankleRight} radius={limbRadius * 1.05} colour={trousers} />
      {[ankleLeft, ankleRight].map((ankle, index) => <RoundedBox key={`foot-${index}`} args={[width * 0.23, footHeight, depth * 0.76]} radius={0.025} smoothness={3} position={[ankle[0], footHeight / 2, ankle[2] + footForwardOffset]} castShadow><meshStandardMaterial color={shoe} roughness={0.82} /></RoundedBox>)}
      <mesh position={[0, 0.023, depth * 0.7]} rotation={[-Math.PI / 2, 0, 0]}><coneGeometry args={[0.06, 0.16, 3]} /><meshStandardMaterial color="#e2a73a" emissive="#e2a73a" emissiveIntensity={0.25} /></mesh>
    </group>
  );
}

function eyeTarget(person: PersonMockup) {
  const angle = THREE.MathUtils.degToRad(person.rotation_deg);
  return new THREE.Vector3(person.center.x * SCALE + Math.sin(angle) * 2, person.eye_height_mm * SCALE, -person.center.y * SCALE + Math.cos(angle) * 2);
}

function setCameraZoom(camera: THREE.Camera, zoom: number) {
  if ("zoom" in camera) (camera as THREE.OrthographicCamera | THREE.PerspectiveCamera).zoom = zoom;
}

function cameraTuple(vector: THREE.Vector3): VectorTuple {
  return [vector.x, vector.y, vector.z];
}

function cameraQuaternionTuple(quaternion: THREE.Quaternion): CameraQuaternionTuple {
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

function cameraViewHeight(camera: THREE.Camera, distance: number) {
  if (camera instanceof THREE.PerspectiveCamera) {
    const fov = THREE.MathUtils.degToRad(camera.fov);
    return (2 * Math.tan(fov / 2) * distance) / Math.max(camera.zoom, 0.0001);
  }
  if (camera instanceof THREE.OrthographicCamera) {
    const frustumHeight = Math.abs(camera.top - camera.bottom);
    return frustumHeight > 0 ? frustumHeight / Math.max(camera.zoom, 0.0001) : 1;
  }
  return 1;
}

function controlsTarget(controls: THREE.EventDispatcher | null) {
  const target = (controls as (THREE.EventDispatcher & { target?: THREE.Vector3 }) | null)?.target;
  return target instanceof THREE.Vector3 ? target : null;
}

function presetBaseZoom(projection: ProjectionMode, preset: CameraView, size: { width: number; height: number }, span: [number, number, number]) {
  if (projection !== "parallel") return 1;
  const horizontalSpan = preset === "left" || preset === "right" ? span[2] : span[0];
  const verticalSpan = preset === "top" || preset === "bottom" ? span[2] : span[1];
  return Math.min(size.width / Math.max(horizontalSpan * 1.15, 0.001), size.height / Math.max(verticalSpan * 1.15, 0.001));
}

function sceneBoundsCorners(center: VectorTuple, span: [number, number, number]) {
  const [cx, cy, cz] = center;
  const [spanX, spanY, spanZ] = span;
  const halfX = spanX / 2;
  const halfY = spanY / 2;
  const halfZ = spanZ / 2;
  return [-1, 1].flatMap((xSign) => [-1, 1].flatMap((ySign) => [-1, 1].map((zSign) => new THREE.Vector3(cx + xSign * halfX, cy + ySign * halfY, cz + zSign * halfZ))));
}

function fitZoomForCurrentView(camera: THREE.Camera, size: { width: number; height: number }, center: VectorTuple, span: [number, number, number]) {
  camera.updateMatrixWorld(true);
  const corners = sceneBoundsCorners(center, span);
  const inverse = camera.matrixWorldInverse;
  const fitPadding = 0.96;

  if (camera instanceof THREE.OrthographicCamera) {
    const frustumHalfWidth = Math.abs(camera.right - camera.left) / 2;
    const frustumHalfHeight = Math.abs(camera.top - camera.bottom) / 2;
    const frustumCentreX = (camera.left + camera.right) / 2;
    const frustumCentreY = (camera.top + camera.bottom) / 2;
    let maxX = 0;
    let maxY = 0;
    corners.forEach((corner) => {
      const local = corner.applyMatrix4(inverse);
      maxX = Math.max(maxX, Math.abs(local.x - frustumCentreX));
      maxY = Math.max(maxY, Math.abs(local.y - frustumCentreY));
    });
    if (maxX <= 0 || maxY <= 0) return camera.zoom;
    return THREE.MathUtils.clamp(Math.min(frustumHalfWidth / maxX, frustumHalfHeight / maxY) * fitPadding, 0.0001, 1_000_000);
  }

  if (camera instanceof THREE.PerspectiveCamera) {
    const aspect = camera.aspect > 0 ? camera.aspect : Math.max(size.width / Math.max(size.height, 1), 0.1);
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const verticalTangent = Math.tan(verticalFov / 2);
    const horizontalTangent = Math.tan(horizontalFov / 2);
    let maxRatio = 0;
    let hasBehindPoint = false;
    corners.forEach((corner) => {
      const local = corner.applyMatrix4(inverse);
      const depth = -local.z;
      if (depth <= 0.001) {
        hasBehindPoint = true;
        return;
      }
      maxRatio = Math.max(maxRatio, Math.abs(local.x) / (depth * horizontalTangent), Math.abs(local.y) / (depth * verticalTangent));
    });
    // A camera inside the bounds cannot show every corner by changing zoom
    // alone. Use the widest useful view while preserving the current pose.
    if (hasBehindPoint) return 0.05;
    if (maxRatio <= 0) return camera.zoom;
    return THREE.MathUtils.clamp(fitPadding / maxRatio, 0.05, 10);
  }

  return "zoom" in camera ? (camera as THREE.OrthographicCamera | THREE.PerspectiveCamera).zoom : 1;
}

function CameraPreset({ preset, projection, person, target, span, resetKey, zoomPercent, restoreView }: { preset: CameraView; projection: ProjectionMode; person?: PersonMockup | null; target: VectorTuple; span: [number, number, number]; resetKey: number; zoomPercent: number; restoreView: ProjectionRestore | null }) {
  const { camera, size } = useThree();
  const restoredToken = useRef<number | null>(null);
  const skipZoomAfterRestore = useRef(false);
  const [targetX, targetY, targetZ] = target;
  const [spanX, spanY, spanZ] = span;
  useEffect(() => {
    // A projection toggle remounts the Canvas so that R3F can create the
    // correct camera type. The current camera is restored by CameraViewSync;
    // skip the normal preset fit for that transition.
    if (restoreView) {
      restoredToken.current = restoreView.token;
      return;
    }
    // Clearing the one-shot restore request must not immediately run the
    // preset effect and overwrite the restored pose.
    if (restoredToken.current !== null) {
      restoredToken.current = null;
      skipZoomAfterRestore.current = true;
      return;
    }
    const aspect = Math.max(size.width / Math.max(size.height, 1), 0.1);
    const verticalFov = THREE.MathUtils.degToRad(camera instanceof THREE.PerspectiveCamera ? camera.fov : 50);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const boundingRadius = Math.sqrt(spanX ** 2 + spanY ** 2 + spanZ ** 2) / 2;
    const fitDistance = Math.max(0.1, boundingRadius / Math.sin(Math.min(verticalFov, horizontalFov) / 2)) * 1.15;
    if (preset === "eye" && person?.enabled) {
      camera.up.set(0, 1, 0);
      camera.position.set(person.center.x * SCALE, person.eye_height_mm * SCALE, -person.center.y * SCALE);
      camera.lookAt(eyeTarget(person));
    } else {
      if (preset === "top") {
        // OrbitControls uses camera.up as its rotation axis. Keep world Y
        // consistent with the side views, just off the pole (the controls' .01
        // polar limit), with negative Z screen-up as in the floorplan.
        camera.up.set(0, 1, 0);
        camera.position.set(targetX, targetY + fitDistance * Math.cos(0.01), targetZ + fitDistance * Math.sin(0.01));
      } else if (preset === "bottom") {
        camera.up.set(0, 1, 0);
        camera.position.set(targetX, targetY - fitDistance * Math.cos(0.01), targetZ + fitDistance * Math.sin(0.01));
      } else if (preset === "left") {
        camera.up.set(0, 1, 0);
        camera.position.set(targetX - fitDistance, targetY, targetZ);
      } else if (preset === "right") {
        camera.up.set(0, 1, 0);
        camera.position.set(targetX + fitDistance, targetY, targetZ);
      } else {
        camera.up.set(0, 1, 0);
        camera.position.set(targetX + fitDistance, targetY + fitDistance * 0.85, targetZ + fitDistance);
      }
      camera.lookAt(targetX, targetY, targetZ);
    }
    camera.updateProjectionMatrix();
  }, [camera, person, preset, projection, resetKey, restoreView, size.height, size.width, spanX, spanY, spanZ, targetX, targetY, targetZ]);
  useEffect(() => {
    if (restoreView) return;
    if (skipZoomAfterRestore.current) {
      skipZoomAfterRestore.current = false;
      return;
    }
    const baseZoom = presetBaseZoom(projection, preset, size, [spanX, spanY, spanZ]);
    setCameraZoom(camera, baseZoom * zoomPercent / 100);
    camera.updateProjectionMatrix();
  }, [camera, preset, projection, restoreView, size.height, size.width, spanX, spanY, spanZ, zoomPercent]);
  return null;
}

function CameraFit({ request, preset, projection, center, span, onFit }: { request: number; preset: CameraView; projection: ProjectionMode; center: VectorTuple; span: [number, number, number]; onFit?: (zoomPercent: number) => void }) {
  const { camera, size } = useThree();
  const handledRequest = useRef(request);
  const [centerX, centerY, centerZ] = center;
  const [spanX, spanY, spanZ] = span;
  useEffect(() => {
    if (request === handledRequest.current) return;
    handledRequest.current = request;
    const nextZoom = fitZoomForCurrentView(camera, size, [centerX, centerY, centerZ], [spanX, spanY, spanZ]);
    setCameraZoom(camera, nextZoom);
    camera.updateProjectionMatrix();
    const baseZoom = presetBaseZoom(projection, preset, size, [spanX, spanY, spanZ]);
    if (Number.isFinite(nextZoom) && nextZoom > 0 && Number.isFinite(baseZoom) && baseZoom > 0) onFit?.(nextZoom / baseZoom * 100);
  }, [camera, centerX, centerY, centerZ, onFit, preset, projection, request, size.height, size.width, spanX, spanY, spanZ]);
  return null;
}

function CameraViewSync({ restoreView, fallbackTarget, stateRef, onRestored }: { restoreView: ProjectionRestore | null; fallbackTarget: VectorTuple; stateRef: { current: CameraViewSnapshot | null }; onRestored: (token: number) => void }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls);
  const restoredToken = useRef<number | null>(null);
  const fallbackTargetVector = useMemo(() => new THREE.Vector3(...fallbackTarget), [fallbackTarget]);

  useEffect(() => {
    if (!restoreView || restoredToken.current === restoreView.token) return;
    const targetControl = controlsTarget(controls);
    // OrbitControls owns the target used for orbiting and panning. Wait for
    // makeDefault to install it before completing the restore.
    if (!targetControl) return;

    const target = new THREE.Vector3(...restoreView.target);
    const savedQuaternion = new THREE.Quaternion(...restoreView.quaternion);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(savedQuaternion).normalize();
    const sourceIsParallel = restoreView.sourceProjection === "parallel";
    const targetIsParallel = camera instanceof THREE.OrthographicCamera;
    camera.up.fromArray(restoreView.up);
    camera.quaternion.copy(savedQuaternion);

    if (sourceIsParallel === targetIsParallel) {
      camera.position.fromArray(restoreView.position);
      setCameraZoom(camera, restoreView.zoom);
    } else if (targetIsParallel && camera instanceof THREE.OrthographicCamera) {
      camera.position.copy(target).addScaledVector(forward, -Math.max(0.001, restoreView.distance));
      const frustumHeight = Math.abs(camera.top - camera.bottom);
      setCameraZoom(camera, frustumHeight / Math.max(restoreView.viewHeight, 0.0001));
    } else if (!targetIsParallel && camera instanceof THREE.PerspectiveCamera) {
      const fov = THREE.MathUtils.degToRad(camera.fov);
      const distance = Math.max(0.001, restoreView.viewHeight * 0.5 / Math.tan(fov / 2));
      camera.position.copy(target).addScaledVector(forward, -distance);
      setCameraZoom(camera, 1);
    }

    camera.updateProjectionMatrix();
    targetControl.copy(target);
    const orbit = controls as THREE.EventDispatcher & { update?: () => void };
    orbit.update?.();
    restoredToken.current = restoreView.token;
    onRestored(restoreView.token);
  }, [camera, controls, onRestored, restoreView]);

  useFrame(() => {
    if (restoreView && restoredToken.current !== restoreView.token) return;
    const target = controlsTarget(controls) ?? fallbackTargetVector;
    const distance = camera.position.distanceTo(target);
    stateRef.current = {
      position: cameraTuple(camera.position),
      quaternion: cameraQuaternionTuple(camera.quaternion),
      up: cameraTuple(camera.up),
      target: cameraTuple(target),
      zoom: camera.zoom,
      distance,
      viewHeight: cameraViewHeight(camera, distance),
    };
  });
  return null;
}

/** Keep wheel input tied to the rendered camera in every projection mode. */
function WheelZoom({ onManualViewChange }: { onManualViewChange?: () => void }) {
  const { camera, gl } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    if (!canvas) return;
    const zoomWithWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.deltaY === 0) return;
      onManualViewChange?.();
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      camera.zoom = camera instanceof THREE.OrthographicCamera
        ? THREE.MathUtils.clamp(camera.zoom * factor, 0.0001, 1_000_000)
        : THREE.MathUtils.clamp(camera.zoom * factor, 0.35, 3);
      camera.updateProjectionMatrix();
    };
    canvas.addEventListener("wheel", zoomWithWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", zoomWithWheel);
  }, [camera, gl, onManualViewChange]);
  return null;
}

function pdfBlobFromJpeg(bytes: ArrayBuffer, width: number, height: number) {
  const encoder = new TextEncoder();
  const pageWidth = Math.max(72, width * 72 / 96);
  const pageHeight = Math.max(72, height * 72 / 96);
  const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`;
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  const push = (value: string | Uint8Array) => {
    const source = typeof value === "string" ? encoder.encode(value) : value;
    const next = new Uint8Array(source.byteLength);
    next.set(source);
    parts.push(next);
    length += next.byteLength;
  };
  const offsets: number[] = [0];
  push("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n");
  const object = (id: number, body: string) => { offsets[id] = length; push(`${id} 0 obj\n${body}\nendobj\n`); };
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = length;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.byteLength} >>\nstream\n`);
  push(new Uint8Array(bytes));
  push("\nendstream\nendobj\n");
  const contentBytes = encoder.encode(content);
  object(5, `<< /Length ${contentBytes.length} >>\nstream\n${content}endstream`);
  const xref = length;
  push("xref\n0 6\n0000000000 65535 f \n");
  for (let id = 1; id <= 5; id += 1) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, { type: "application/pdf" });
}

function drawCaptureAttribution(context: CanvasRenderingContext2D, width: number, height: number) {
  const scale = Math.max(1, width / 1640);
  const margin = 14 * scale;
  context.save();
  context.font = `700 ${CAPTURE_ATTRIBUTION_FONT_SIZE * scale}px Arial, sans-serif`;
  context.textAlign = "right";
  context.textBaseline = "bottom";
  context.fillStyle = "#000000";
  context.fillText(CAPTURE_ATTRIBUTION, width - margin, height - margin);
  context.restore();
}

function CaptureController({ request, format, fileHandle, includeAttribution, onError }: { request: number; format: CaptureFormat; fileHandle: SaveFileHandle | null; includeAttribution: boolean; onError: (message: string) => void }) {
  const { camera, gl, scene } = useThree();
  const capturedRequest = useRef(0);
  useEffect(() => {
    if (request === 0 || request === capturedRequest.current) return;
    capturedRequest.current = request;
    const previousClearColour = gl.getClearColor(new THREE.Color());
    const previousClearAlpha = gl.getClearAlpha();
    gl.setClearColor("#fff", 1);
    gl.render(scene, camera);
    const source = gl.domElement;
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext("2d");
    if (!context) {
      gl.setClearColor(previousClearColour, previousClearAlpha);
      onError("The browser could not create an export canvas.");
      return;
    }
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0);
    gl.setClearColor(previousClearColour, previousClearAlpha);
    if (includeAttribution) drawCaptureAttribution(context, canvas.width, canvas.height);
    const mimeType = format === "jpg" || format === "pdf" ? "image/jpeg" : "image/png";
    canvas.toBlob(async (blob) => {
      if (!blob) {
        onError("The view image could not be created.");
        return;
      }
      try {
        const output = format === "pdf" ? pdfBlobFromJpeg(await blob.arrayBuffer(), canvas.width, canvas.height) : blob;
        if (fileHandle) {
          const writable = await fileHandle.createWritable();
          await writable.write(output);
          await writable.close();
          return;
        }
        const url = URL.createObjectURL(output);
        const link = document.createElement("a");
        link.href = url;
        link.download = `renovation-fit-view-${request}.${format}`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (reason) {
        onError(reason instanceof Error ? reason.message : "Unable to save the view.");
      }
    }, mimeType, format === "jpg" || format === "pdf" ? 0.94 : undefined);
  }, [camera, fileHandle, format, gl, includeAttribution, onError, request, scene]);
  return null;
}
function PlacementCursor({ request, rooms, walls, onCommit, onCancel }: { request: PlacementRequest; rooms: Room[]; walls: PlacementWall[]; onCommit?: (candidate: PlacementCandidate)=>void; onCancel?: ()=>void }) {
  const { gl, camera }=useThree();
  const [point,setPoint]=useState<Point2D | null>(null);
  const client=useRef<{x:number;y:number}|null>(null);
  const previousPoint=useRef<Point2D|null>(null);
  const raycaster=useMemo(()=>new THREE.Raycaster(),[]);
  const pointAt=useCallback((x:number,y:number) => {
    const canvas = gl.domElement;
    if (!canvas) return null;
    const rect=canvas.getBoundingClientRect();
    if (x<rect.left || x>rect.right || y<rect.top || y>rect.bottom) return null;
    raycaster.setFromCamera(new THREE.Vector2((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1),camera);
    if (request.opening) {
      const hits=rooms.flatMap(room=>room.vertices.flatMap((a,index)=>{
        const b=room.vertices[(index+1)%room.vertices.length], length=Math.hypot(b.x-a.x,b.y-a.y);
        if (!length) return [];
        const normal=new THREE.Vector3((b.y-a.y)/length,0,(b.x-a.x)/length);
        const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(normal,new THREE.Vector3(a.x*SCALE,0,-a.y*SCALE));
        const hit=raycaster.ray.intersectPlane(plane,new THREE.Vector3());
        if (!hit || hit.y<0 || hit.y>room.wall_height.value*SCALE) return [];
        const p={x:hit.x/SCALE,y:-hit.z/SCALE},t=((p.x-a.x)*(b.x-a.x)+(p.y-a.y)*(b.y-a.y))/(length*length);
        return t>=0 && t<=1 ? [{point:p,distance:raycaster.ray.origin.distanceTo(hit)}] : [];
      }));
      const first=hits.sort((a,b)=>a.distance-b.distance)[0];
      if (first) return first.point;
    }
    const hit=raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),new THREE.Vector3());
    return hit ? {x:hit.x/SCALE,y:-hit.z/SCALE} : null;
  },[camera,gl,raycaster,request.opening,rooms]);
  const candidate=useMemo(()=>{
    const next=point?resolvePlacement(request,point,rooms,walls):null;
    return next?.roomId && !rooms.some(room=>room.id===next.roomId) ? null : next;
  },[point,request,rooms,walls]);
  useFrame(()=>{
    const mouse=client.current, next=mouse?pointAt(mouse.x,mouse.y):null, previous=previousPoint.current;
    if ((!next)!==(!previous) || (next && previous && Math.hypot(next.x-previous.x,next.y-previous.y)>.01)) {
      previousPoint.current=next; setPoint(next);
    }
  });
  useEffect(()=>{
    const canvas=gl.domElement;
    if (!canvas) return;
    const cursor=canvas.style.cursor;
    canvas.style.cursor="crosshair";
    let down: {x:number;y:number}|null=null;
    const move=(event:PointerEvent)=>{ event.stopImmediatePropagation(); client.current={x:event.clientX,y:event.clientY}; };
    const press=(event:PointerEvent)=>{
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.button===2) return; // Cancel in the context-menu event, before any menu can open.
      if (event.button===0) { down={x:event.clientX,y:event.clientY}; canvas.setPointerCapture(event.pointerId); }
    };
    const release=(event:PointerEvent)=>{
      event.preventDefault(); event.stopImmediatePropagation();
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      const start=down; down=null;
      if (event.type==="pointercancel" || event.button!==0 || !start || Math.hypot(event.clientX-start.x,event.clientY-start.y)>5) return;
      const p=pointAt(event.clientX,event.clientY), next=p?resolvePlacement(request,p,rooms,walls):null;
      if (next && (!next.roomId || rooms.some(room=>room.id===next.roomId))) {
        // Do not let the click generated after this pointer-up select a surface
        // beneath the preview once the placement controller has unmounted.
        const swallow=(click:MouseEvent)=>{click.preventDefault();click.stopImmediatePropagation();};
        canvas.addEventListener("click",swallow,{capture:true,once:true});
        window.setTimeout(()=>canvas.removeEventListener("click",swallow,true),0);
        onCommit?.(next);
      }
    };
    const leave=()=>{ client.current=null; };
    const context=(event:MouseEvent)=>{ event.preventDefault(); event.stopImmediatePropagation(); onCancel?.(); };
    canvas.addEventListener("pointermove",move,true); canvas.addEventListener("pointerdown",press,true);
    canvas.addEventListener("pointerup",release,true); canvas.addEventListener("pointercancel",release,true);
    canvas.addEventListener("pointerleave",leave); canvas.addEventListener("contextmenu",context,true);
    return ()=>{
      canvas.style.cursor=cursor;
      canvas.removeEventListener("pointermove",move,true); canvas.removeEventListener("pointerdown",press,true);
      canvas.removeEventListener("pointerup",release,true); canvas.removeEventListener("pointercancel",release,true);
      canvas.removeEventListener("pointerleave",leave); canvas.removeEventListener("contextmenu",context,true);
    };
  },[gl,pointAt,request,rooms,walls,onCommit,onCancel]);
  if (!point) return null;
  const obstacle=candidate?.obstacle??{...request.obstacle,center:point};
  const width=obstacle.dimensions.width.value*SCALE, depth=obstacle.dimensions.depth.value*SCALE, height=obstacle.dimensions.height.value*SCALE;
  return <group>
    {candidate?.openingModel ? <OpeningFixture room={candidate.openingModel.room} opening={candidate.openingModel.opening} selected={false}/> : request.opening ? <group position={[obstacle.center.x*SCALE,obstacle.base_z_mm*SCALE,-obstacle.center.y*SCALE]} rotation={[0,obstacle.rotation_deg*Math.PI/180,0]}><ParametricFixture obstacle={obstacle} width={width} depth={depth} height={height}/></group> : <FixtureMesh obstacle={obstacle} selected={false}/>}
    <mesh position={[obstacle.center.x*SCALE,(obstacle.base_z_mm*SCALE)+height/2,-obstacle.center.y*SCALE]} rotation={[0,obstacle.rotation_deg*Math.PI/180,0]} renderOrder={1000}>
      <boxGeometry args={[width+.006,height+.006,depth+.006]}/><meshBasicMaterial color={candidate?"#2cb887":"#e25b55"} wireframe depthTest={false} transparent opacity={.75}/>
    </mesh>
    <Html position={[obstacle.center.x*SCALE,(obstacle.base_z_mm*SCALE)+height+.12,-obstacle.center.y*SCALE]} center style={{pointerEvents:"none",whiteSpace:"nowrap"}}><span className={candidate?"placement-label":"placement-label invalid"}>{candidate?"Click to place":request.opening?"Move to a free wall":"Move inside a room with enough space"}</span></Html>
  </group>;
}

function Scene({ placementWalls = [], placement, onCommitPlacement, onCancelPlacement, onTransferObstacle, room, sceneRooms, collisionIds, onObstaclesChange, onPersonChange, wallMode, toggles, preset, projection, selection, onSelectionChange, showGrid, cameraResetKey, fitRequest, fitViewRequest, zoomPercent, lighting, onManualViewChange, restoreView, cameraStateRef, onCameraViewRestored, onFitComplete }: ViewerProps & {
  lighting: LightingSettings;
  toggles: Toggles;
  preset: CameraView;
  projection: ProjectionMode;
  selection: Selection;
  onSelectionChange: (selection: Selection) => void;
  showGrid: boolean;
  cameraResetKey: number;
  fitViewRequest: number;
  zoomPercent: number;
  onManualViewChange: () => void;
  restoreView: ProjectionRestore | null;
  cameraStateRef: { current: CameraViewSnapshot | null };
  onCameraViewRestored: (token: number) => void;
  onFitComplete: (zoomPercent: number) => void;
}) {
  const [dragging, setDragging] = useState<{ id: string; offset: Point2D; original: Obstacle } | null>(null);
  const dragCandidate = useRef<PlacementCandidate | null>(null);
  const dragCapture = useRef<{ target: { releasePointerCapture: (id: number)=>void }; pointerId: number } | null>(null);
  const orbitInteraction = useRef(false);
  const { gl } = useThree();
  useEffect(() => {
    const cancel = () => {
      if (dragCapture.current) {
        try { dragCapture.current.target.releasePointerCapture(dragCapture.current.pointerId); } catch {}
      }
      dragCapture.current=null; dragCandidate.current=null;
      setDragging(null); setPreviewObstacles({});
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    const canvas=gl.domElement;
    if (!canvas) return;
    canvas.addEventListener("pointercancel",cancel);
    window.addEventListener("keydown",key);
    window.addEventListener("blur",cancel);
    return () => { canvas.removeEventListener("pointercancel",cancel); window.removeEventListener("keydown",key); window.removeEventListener("blur",cancel); };
  }, [gl]);
  const [personDragging, setPersonDragging] = useState<{ offset: Point2D } | null>(null);
  const [previewObstacles, setPreviewObstacles] = useState<Record<string, Obstacle>>({});
  const [previewPerson, setPreviewPerson] = useState<PersonMockup | null>(null);
  const dragPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const displayedObstacles = room.obstacles.map((obstacle) => previewObstacles[obstacle.id] ?? obstacle);
  const displayedPerson = previewPerson ?? room.person_mockup;
  const renderedRooms = useMemo(() => sceneRooms?.length ? sceneRooms : [room], [room, sceneRooms]);
  const multiRoom = renderedRooms.length > 1;
  const sceneBounds = useMemo(() => {
    const points = renderedRooms.flatMap((sceneRoom) => sceneRoom.vertices);
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const wallHeight = Math.max(...renderedRooms.map((sceneRoom) => sceneRoom.wall_height.value));
    return { minX, maxX, minY, maxY, wallHeight };
  }, [renderedRooms]);
  const roomTarget = useMemo<VectorTuple>(() => {
    return [(sceneBounds.minX + sceneBounds.maxX) * SCALE / 2, sceneBounds.wallHeight * SCALE / 2, -(sceneBounds.minY + sceneBounds.maxY) * SCALE / 2];
  }, [sceneBounds]);
  const renderedWalls = useMemo<RenderedWall[]>(
    () => {
      if (renderedRooms.length === 1) return buildIsolatedRoomWalls(renderedRooms[0]);
      const solids = buildRenderedWalls(renderedRooms);
      return [...solids, ...buildSharedWallFinishFaces(renderedRooms, solids)];
    },
    [renderedRooms],
  );
  const roomSpan = useMemo<[number, number, number]>(() => [
    (sceneBounds.maxX - sceneBounds.minX) * SCALE,
    sceneBounds.wallHeight * SCALE,
    (sceneBounds.maxY - sceneBounds.minY) * SCALE,
  ], [sceneBounds]);
  // Fit the light and its shadow camera to the complete plan, including plans
  // positioned far from the origin. The oblique key separates adjacent faces.
  const lightTarget = useMemo(() => {
    const target = new THREE.Object3D();
    target.position.set(...roomTarget);
    return target;
  }, [roomTarget]);
  const shadowExtent = Math.max(3, Math.hypot(...roomSpan) * 0.65);
  const lightAzimuth = THREE.MathUtils.degToRad(lighting.direction);
  const lightElevation = THREE.MathUtils.degToRad(lighting.elevation);
  const lightDistance = shadowExtent * 2;
  const lightPower = lighting.intensity / 100;
  const orbitTarget: [number, number, number] = preset === "eye" && !multiRoom && room.person_mockup?.enabled
    ? eyeTarget(room.person_mockup).toArray()
    : roomTarget;

  function floorPoint(event: ThreeEvent<PointerEvent>) {
    const point = event.ray.intersectPlane(dragPlane, new THREE.Vector3());
    return point ? { x: point.x / SCALE, y: -point.z / SCALE } : null;
  }

  function startDrag(event: ThreeEvent<PointerEvent>, sceneRoom: Room, obstacle: Obstacle) {
    if (event.button !== 0 || placement) return;
    event.stopPropagation();
    onSelectionChange({ type: "ELEMENT", id: obstacle.id, roomId: sceneRoom.id });
    const point = floorPoint(event);
    if (!point) return;
    (event.target as EventTarget & { setPointerCapture(pointerId: number): void }).setPointerCapture(event.pointerId);
    dragCandidate.current=null;
    dragCapture.current={target:event.target as EventTarget & {releasePointerCapture: (id:number)=>void},pointerId:event.pointerId};
    setDragging({ id: obstacle.id, original:obstacle, offset: { x: obstacle.center.x - point.x, y: obstacle.center.y - point.y } });
  }

  function moveDrag(event: ThreeEvent<PointerEvent>, sceneRoom: Room, obstacle: Obstacle) {
    if (dragging?.id !== obstacle.id) return;
    event.stopPropagation();
    const point = floorPoint(event);
    if (!point) return;
    const requested = { x: point.x + dragging.offset.x, y: point.y + dragging.offset.y };
    const candidate = resolveObstaclePlacement(dragging.original,requested,renderedRooms,placementWalls,dragCandidate.current?.roomId ?? sceneRoom.id);
    if (candidate) {
      dragCandidate.current=candidate;
      setPreviewObstacles((current) => ({ ...current, [obstacle.id]: candidate.obstacle }));
    }
  }

  function endDrag(event: ThreeEvent<PointerEvent>, sceneRoom: Room, obstacle: Obstacle) {
    if (dragging?.id !== obstacle.id) return;
    event.stopPropagation();
    const candidate = dragCandidate.current;
    if (candidate?.roomId) {
      if (onTransferObstacle) onTransferObstacle(candidate.obstacle,candidate.roomId);
      else onObstaclesChange(sceneRoom.obstacles.map(item=>item.id===obstacle.id?candidate.obstacle:item),sceneRoom.id);
      onSelectionChange({type:"ELEMENT",id:obstacle.id,roomId:candidate.roomId});
    }
    const captured=dragCapture.current;
    dragCapture.current=null; dragCandidate.current=null;
    if (captured) { try { captured.target.releasePointerCapture(captured.pointerId); } catch {} }
    setPreviewObstacles({});
    setDragging(null);
  }

  function startPersonDrag(event: ThreeEvent<PointerEvent>, sceneRoom: Room, person: PersonMockup) {
    event.stopPropagation();
    onSelectionChange({ type: "PERSON", roomId: sceneRoom.id });
    const point = floorPoint(event);
    if (!point) return;
    (event.target as EventTarget & { setPointerCapture(pointerId: number): void }).setPointerCapture(event.pointerId);
    setPersonDragging({ offset: { x: person.center.x - point.x, y: person.center.y - point.y } });
  }

  function movePersonDrag(event: ThreeEvent<PointerEvent>, sceneRoom: Room, person: PersonMockup) {
    if (!personDragging) return;
    event.stopPropagation();
    const point = floorPoint(event);
    if (!point) return;
    const requested = { x: point.x + personDragging.offset.x, y: point.y + personDragging.offset.y };
    const previous = previewPerson?.center ?? person.center;
    setPreviewPerson({ ...person, center: constrainPersonToRoom(person, sceneRoom.vertices, requested, previous) });
  }

  function endPersonDrag(event: ThreeEvent<PointerEvent>, sceneRoom: Room, person: PersonMockup) {
    if (!personDragging) return;
    event.stopPropagation();
    onPersonChange(previewPerson ?? person, sceneRoom.id);
    setPreviewPerson(null);
    setPersonDragging(null);
  }

  function selectWall(roomId: string, wallId: string, additive: boolean) {
    if (!additive || selection?.type !== "WALL" || selection.roomId !== roomId) {
      onSelectionChange({ type: "WALL", id: wallId, ids: [wallId], roomId });
      return;
    }
    const ids = selection.ids.includes(wallId)
      ? selection.ids.filter((id) => id !== wallId)
      : [...selection.ids, wallId];
    onSelectionChange(ids.length ? { type: "WALL", id: ids.at(-1) ?? wallId, ids, roomId } : null);
  }

  return (
    <>
      <CameraPreset preset={preset} projection={projection} person={multiRoom ? null : room.person_mockup} target={roomTarget} span={roomSpan} resetKey={cameraResetKey + fitRequest} zoomPercent={zoomPercent} restoreView={restoreView} />
      <CameraFit request={fitViewRequest} preset={preset} projection={projection} center={roomTarget} span={roomSpan} onFit={onFitComplete} />
      <ambientLight intensity={0.3 * lightPower} />
      <hemisphereLight args={["#F4F7FF", "#B6AA96", 0.65 * lightPower]} />
      <primitive object={lightTarget} />
      <directionalLight
        target={lightTarget}
        position={[
          roomTarget[0] + lightDistance * Math.cos(lightElevation) * Math.sin(lightAzimuth),
          roomTarget[1] + lightDistance * Math.sin(lightElevation),
          roomTarget[2] - lightDistance * Math.cos(lightElevation) * Math.cos(lightAzimuth),
        ]}
        color="#FFF5E6" intensity={2.6 * lightPower} castShadow
        shadow-intensity={lighting.shadows / 100}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-shadowExtent} shadow-camera-right={shadowExtent}
        shadow-camera-top={shadowExtent} shadow-camera-bottom={-shadowExtent}
        shadow-camera-near={0.1} shadow-camera-far={shadowExtent * 5}
        shadow-bias={0.001} shadow-normalBias={0.006} shadow-radius={3}
      />
      <directionalLight target={lightTarget} position={[roomTarget[0] - shadowExtent, roomTarget[1] + shadowExtent * 0.7, roomTarget[2] - shadowExtent]} color="#DFE9FF" intensity={0.35 * lightPower} />
      {renderedWalls.map(({ room: wallRoom, index, start, end, sourceOffsetMm, sourceLengthMm, capStart, capEnd, paintOnly }) => {
        if (wallMode === "INVISIBLE") return null;
        const sceneInteractive = multiRoom || wallRoom.id === room.id;
        return (
          <WallWithOpenings
            key={`wall-${wallRoom.id}-${index}-${Math.round(sourceOffsetMm)}-${wallSegmentKey(start, end)}`}
            index={index}
            room={wallRoom}
            start={start}
            end={end}
            sourceOffsetMm={sourceOffsetMm}
            sourceLengthMm={sourceLengthMm}
            capStart={capStart}
            capEnd={capEnd}
            paintOnly={paintOnly}
            wallMode={wallMode}
            selected={sceneInteractive && selection?.type === "WALL" && selection.roomId === wallRoom.id && selection.ids.includes(wallId(index))}
            onSelect={sceneInteractive ? (additive) => selectWall(wallRoom.id, wallId(index), additive) : () => undefined}
          />
        );
      })}
      <SkirtingBoards walls={renderedWalls} wallMode={wallMode} defaultWallColour={DEFAULT_WALL_COLOUR} />
      {renderedRooms.map((sceneRoom) => {
        const sceneInteractive = multiRoom || sceneRoom.id === room.id;
        const sceneObstacles = sceneRoom.id === room.id ? displayedObstacles : sceneRoom.obstacles.map((obstacle) => previewObstacles[obstacle.id] ?? obstacle);
        const scenePerson = sceneRoom.id === room.id ? displayedPerson : sceneRoom.person_mockup;
        return (
          <group key={`room-${sceneRoom.id}`}>
            <Floor room={sceneRoom} selected={sceneInteractive && selection?.type === "FLOOR" && selection.roomId === sceneRoom.id} onSelect={sceneInteractive ? () => onSelectionChange({ type: "FLOOR", roomId: sceneRoom.id }) : () => undefined} />
            {sceneRoom.openings.map((opening) => <OpeningFixture key={`fixture-${sceneRoom.id}-${opening.id}`} room={sceneRoom} opening={opening} selected={selection?.type === "OPENING" && selection.id === opening.id && selection.roomId === sceneRoom.id} onSelect={sceneInteractive ? () => onSelectionChange({ type: "OPENING", id: opening.id, roomId: sceneRoom.id }) : undefined} />)}
            {toggles.elements && sceneObstacles.map((obstacle) => (
              <FixtureMesh
                key={`${sceneRoom.id}-${obstacle.id}`}
                obstacle={obstacle}
                selected={sceneInteractive && selection?.type === "ELEMENT" && selection.roomId === sceneRoom.id && selection.id === obstacle.id}
                onPointerDown={sceneInteractive ? (event) => startDrag(event, sceneRoom, obstacle) : undefined}
                onPointerMove={sceneInteractive ? (event) => moveDrag(event, sceneRoom, obstacle) : undefined}
                onPointerUp={sceneInteractive ? (event) => endDrag(event, sceneRoom, obstacle) : undefined}
              />
            ))}
            {toggles.openingImprints && <>
              {sceneRoom.openings.map((opening) => <OpeningImprint key={`imprint-${sceneRoom.id}-${opening.id}`} room={sceneRoom} opening={opening} />)}
              {sceneRoom.openings.filter((item) => item.kind === "DOOR").map((door) => <DoorSwing key={`swing-${sceneRoom.id}-${door.id}`} room={sceneRoom} door={door} />)}
            </>}
            {toggles.person && scenePerson?.enabled && <PersonMesh person={scenePerson} showClearance={toggles.clearance && scenePerson.show_clearance !== false} collision={collisionIds.includes(scenePerson.id)} selected={sceneInteractive && selection?.type === "PERSON" && selection.roomId === sceneRoom.id} onPointerDown={sceneInteractive ? (event) => startPersonDrag(event, sceneRoom, scenePerson) : undefined} onPointerMove={sceneInteractive ? (event) => movePersonDrag(event, sceneRoom, scenePerson) : undefined} onPointerUp={sceneInteractive ? (event) => endPersonDrag(event, sceneRoom, scenePerson) : undefined} />}
            {toggles.collisions && sceneRoom.obstacles.filter((item) => collisionIds.includes(item.id)).map((obstacle) => (
              <mesh key={`collision-${sceneRoom.id}-${obstacle.id}`} position={[obstacle.center.x * SCALE, 0.9, -obstacle.center.y * SCALE]}>
                <sphereGeometry args={[0.11, 24, 24]} />
                <meshStandardMaterial color="#ff2d2d" emissive="#ff2d2d" emissiveIntensity={1.2} />
              </mesh>
            ))}
          </group>
        );
      })}
      {showGrid && <Grid position={[roomTarget[0], -0.002, roomTarget[2]]} args={[8, 8]} cellSize={0.1} cellThickness={0.4} cellColor="#a9b1ac" sectionSize={1} sectionColor="#65706a" fadeDistance={9} />}
      {placement && <PlacementCursor key={placement.id} request={placement} rooms={renderedRooms} walls={placementWalls} onCommit={candidate => { onCommitPlacement?.(candidate); if (!placement.opening && candidate.roomId) onSelectionChange({type:"ELEMENT",id:candidate.obstacle.id,roomId:candidate.roomId}); }} onCancel={onCancelPlacement} />}
      <OrbitControls makeDefault enableDamping enableZoom={false} enableRotate minPolarAngle={0.01} maxPolarAngle={Math.PI - 0.01} enabled={!placement && !dragging && !personDragging} target={orbitTarget} onStart={() => { orbitInteraction.current = true; }} onChange={() => { if (orbitInteraction.current) onManualViewChange(); }} onEnd={() => { orbitInteraction.current = false; }} />
      <CameraViewSync restoreView={restoreView} fallbackTarget={orbitTarget} stateRef={cameraStateRef} onRestored={onCameraViewRestored} />
    </>
  );
}

function ContextControls({ apiUrl, room, rooms, selection, onObstaclesChange, onFinishesChange, dock, layoutResetKey, onClose }: Pick<ViewerProps, "apiUrl" | "room" | "onObstaclesChange" | "onFinishesChange"> & { rooms: Room[]; selection: Selection; dock: ToolbarDock; layoutResetKey: number; onClose: () => void }) {
  const [wallPaintScope, setWallPaintScope] = useState<WallPaintScope>("SELECTED");
  const [floorTileScope, setFloorTileScope] = useState<FloorTileScope>("SELECTED");
  const [skirtingCollapsed, setSkirtingCollapsed] = useState(false);
  const [paintFamilyId, setPaintFamilyId] = useState("WHITE");
  const [paintSearch, setPaintSearch] = useState("");
  const [paintCollectionId, setPaintCollectionId] = useState("paints-dulux");
  const [materialCollections, setMaterialCollections] = useState<MaterialCollection[]>([]);
  useEffect(() => { void fetch(`${apiUrl}/catalog/materials?kind=PAINT`).then((response) => response.ok ? response.json() as Promise<MaterialCollection[]> : []).then(setMaterialCollections).catch(() => setMaterialCollections([])); }, [apiUrl]);
  if (!selection) return null;
  const finishes = room.finishes ?? {};
  const selectedElement = selection.type === "ELEMENT" ? room.obstacles.find((item) => item.id === selection.id) : undefined;
  const selectedCollection = materialCollections.find((item) => item.id === paintCollectionId);
  const paintFamilies = selectedCollection ? selectedCollection.families.map((family) => ({ id: family.id, name: family.name, colour: family.items[0]?.color_hex ?? "#ffffff", shades: family.items.map((item) => ({ id: item.id, name: item.name, colour: item.color_hex, ralCode: String(item.metadata.ral_code ?? item.code ?? ""), ralName: String(item.metadata.ral_name ?? "") })) })) : DULUX_PAINT_FAMILIES;
  const paintFamily = paintFamilies.find((family) => family.id === paintFamilyId) ?? paintFamilies[0];
  const normalisedPaintSearch = paintSearch.trim().toLocaleLowerCase();
  const visiblePaintShades = normalisedPaintSearch
    ? paintFamily.shades.filter((shade) => shade.name.toLocaleLowerCase().includes(normalisedPaintSearch))
    : paintFamily.shades;

  function setWallColour(shade?: DuluxPaintShade) {
    if (selection?.type !== "WALL") return;
    buildWallFinishUpdates(rooms, room.id, selection.ids, wallPaintScope, shade)
      .forEach((update) => onFinishesChange(update.finishes, update.roomId));
  }

  function setFloorTile(tile?: TileStyle) {
    buildFloorFinishUpdates(rooms, room.id, floorTileScope, (current) => ({
      ...current,
      floor_tile_id: tile?.id,
      floor_design: undefined,
      floor_color: tile?.base,
      floor_pattern: tile?.pattern ?? "NONE",
    })).forEach((update) => onFinishesChange(update.finishes, update.roomId));
  }

  function setWallLock(locked: boolean) {
    if (!selectedElement) return;
    const unlocked = { ...selectedElement, wall_lock: locked };
    const updated = constrainObstacleToRoom(unlocked,room) ?? selectedElement;
    onObstaclesChange(room.obstacles.map((item) => item.id === selectedElement.id ? updated : item), room.id);
  }



  return (
    <FloatingToolbar title="Selected object controls" defaultPosition={{ x: 790, y: 452 }} dock={dock} layoutResetKey={layoutResetKey} bringToFront maxHeight={650} onClose={onClose}>
    <aside className="context-controls" aria-label="Selected object controls" onPointerDown={(event) => {
      const skirtingSection = event.currentTarget.querySelector<HTMLElement>("[data-skirting-controls]");
      if (skirtingSection && !skirtingSection.contains(event.target as Node)) setSkirtingCollapsed(true);
    }}>
      {selection.type === "ELEMENT" && selectedElement && <>
        <span className="eyebrow">Selected element</span>
        <strong>{selectedElement.name}</strong>
        <p>Drag the selected element across the floor to reposition it.</p>
        <label className="viewer-lock-choice"><input type="checkbox" checked={selectedElement.wall_lock ?? false} onChange={(event) => setWallLock(event.target.checked)} /><span>Keep adjacent to nearest wall</span></label>
      </>}
      {selection.type === "PERSON" && <>
        <span className="eyebrow">Selected human mock-up</span>
        <strong>Person usability model</strong>
        <p>Drag the body across the floor to reposition it. Use the Human mock-up toolbar for rotation, posture and clearance settings.</p>
      </>}
      {selection.type === "WALL" && <>
        <div className="selected-wall-heading"><span className="eyebrow">Selected internal {selection.ids.length === 1 ? "wall" : "walls"}</span><strong>{selection.ids.length === 1 ? selection.id.replace("wall-", "Wall ") : `${selection.ids.length} walls selected`}</strong></div>
        <label className="field"><span>Paint options</span><select aria-label="Paint options" value={wallPaintScope} onChange={(event) => setWallPaintScope(event.target.value as WallPaintScope)}><option value="SELECTED">Selected walls</option><option value="ROOM">Current room walls</option><option value="ALL">All walls</option></select></label>
        <label className="field"><span>Paint collection</span><select value={paintCollectionId} onChange={(event) => { setPaintCollectionId(event.target.value); setPaintFamilyId(""); setPaintSearch(""); }}>{materialCollections.length ? materialCollections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>) : <option value="paints-dulux">Dulux paints</option>}</select></label>
        <SkirtingControls value={finishes.skirting_board} collapsed={skirtingCollapsed} onToggleCollapsed={setSkirtingCollapsed} onChange={skirting_board => { if (skirting_board.enabled) setSkirtingCollapsed(false); onFinishesChange({ ...finishes, skirting_board }, room.id); }} />
        <div className="paint-family-picker" role="tablist" aria-label="Paint colour families">{paintFamilies.map((family) => <button key={family.id} type="button" role="tab" aria-selected={paintFamily.id === family.id} title={family.name} className={paintFamily.id === family.id ? "selected" : ""} onClick={() => { setPaintFamilyId(family.id); setPaintSearch(""); }}><span style={{ background: family.colour }} /><small>{family.name}</small></button>)}</div>
        <div className="paint-shade-panel">
          <div className="paint-shade-heading"><strong>{paintFamily.name}</strong><small>{paintFamily.shades.length} shades</small></div>
          <label className="paint-search"><span>Find a shade</span><input type="search" value={paintSearch} onChange={(event) => setPaintSearch(event.target.value)} placeholder="Colour name" /></label>
          <div className="paint-shades">{visiblePaintShades.map((shade) => {
            const active = selection.ids.every((wallId) => finishes.wall_colors?.[wallId] === shade.colour);
            return <button key={shade.id} type="button" title={shade.name} aria-label={`Paint selected walls ${shade.name}`} className={active ? "selected" : ""} onClick={() => setWallColour(shade)}><span className="paint-shade-swatch" style={{ background: shade.colour }} /><strong>{shade.name}</strong></button>;
          })}</div>
          {!visiblePaintShades.length && <p className="paint-empty">No shades match this search.</p>}
          <p className="paint-code-note">Screen colours come from the selected catalogue collection. Confirm with a physical sample before ordering.</p>
        </div>
        <button className="review-style-button colour-reset-button" type="button" onClick={() => setWallColour()}>Reset to default</button>
      </>}
      {selection.type === "FLOOR" && <>
        <strong>Flooring</strong>
        <label className="field"><span>Tile options</span><select aria-label="Tile options" value={floorTileScope} onChange={(event) => setFloorTileScope(event.target.value as FloorTileScope)}><option value="SELECTED">Selected floor</option><option value="ROOM">Current room floor</option><option value="ALL">All floors</option></select></label>
        <FlooringControls design={finishes.floor_design} onChange={(floor_design) => {
          buildFloorFinishUpdates(rooms, room.id, floorTileScope, (current) => ({ ...current, floor_design, floor_color: floorDesignColour(floor_design), floor_tile_id: undefined, floor_pattern: "NONE" })).forEach((update) => onFinishesChange(update.finishes, update.roomId));
        }} />

        <button className="remove-finish" type="button" onClick={() => setFloorTile()}>Remove floor finish</button>
      </>}
    </aside>
    </FloatingToolbar>
  );
}

export function EngineeringViewer(props: ViewerProps) {
  const [lighting, setLighting] = useState<LightingSettings>(DEFAULT_LIGHTING);
  const [lightingExpanded, setLightingExpanded] = useState(false);
  const [roomSelectorExpanded, setRoomSelectorExpanded] = useState(false);
  const [preset, setPreset] = useState<CameraView>("perspective");
  const [projection, setProjection] = useState<ProjectionMode>("parallel");
  const [captureRequest, setCaptureRequest] = useState(0);
  const [captureFormat, setCaptureFormat] = useState<CaptureFormat>("png");
  const [captureMenuOpen, setCaptureMenuOpen] = useState(false);
  const [includeCaptureAttribution, setIncludeCaptureAttribution] = useState(true);
  const [captureFileHandle, setCaptureFileHandle] = useState<SaveFileHandle | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [cameraResetKey, setCameraResetKey] = useState(0);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [fitViewRequest, setFitViewRequest] = useState(0);
  const [activePreset, setActivePreset] = useState<CameraView | null>(null);
  const cameraStateRef = useRef<CameraViewSnapshot | null>(null);
  const projectionRestoreToken = useRef(0);
  const [projectionRestore, setProjectionRestore] = useState<ProjectionRestore | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [selection, setSelection] = useState<Selection>(null);
  const [panelSelection, setPanelSelection] = useState<Selection>(null);
  const [toolbarContextMenu, setToolbarContextMenu] = useState<{ x: number; y: number } | null>(null);
  const rightPointerRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const saveViewButton = useRef<HTMLButtonElement>(null);
  const [toggles, setToggles] = useState<Toggles>({
    elements: true,
    openingImprints: true,
    collisions: true,
    person: true,
    clearance: true,
  });
  const flip = (key: keyof Toggles) => setToggles((current) => ({ ...current, [key]: !current[key] }));
  const selectObject = (nextSelection: Selection) => {
    setSelection(nextSelection);
    props.onOpeningSelected?.(nextSelection?.type === "OPENING" ? nextSelection : null);
    if (nextSelection?.type === "OPENING") { setPanelSelection(null); props.onElementSelected?.(null); return; }
    if (nextSelection?.type === "ELEMENT") {
      setPanelSelection(null);
      props.onElementSelected?.(nextSelection);
      return;
    }
    setPanelSelection(nextSelection);
    props.onElementSelected?.(null);
  };
  const clearSelection = () => {
    setSelection(null);
    props.onOpeningSelected?.(null);
    setPanelSelection(null);
    props.onElementSelected?.(null);
  };
  const panelRoom = panelSelection
    ? props.sceneRooms?.find((sceneRoom) => sceneRoom.id === panelSelection.roomId) ?? (panelSelection.roomId === props.room.id ? props.room : null)
    : null;
  const selectedObjectPanelVisible = Boolean(panelSelection && panelRoom);
  const viewerLeftDock = (activeId: string): ToolbarDock => {
    if (activeId === "viewer-view") return positionedToolbarDock("LEFT", "clamp(166px, 14%, 174px)", undefined, 340);
    return filledToolbarDock("LEFT", ["viewer-view", "viewer-person"].filter((id) => props.toolbarVisibility[id as ToolbarId]), activeId);
  };
  const clearActivePreset = useCallback(() => setActivePreset(null), []);
  const switchProjection = useCallback((next: ProjectionMode) => {
    if (next === projection) return;
    const snapshot = cameraStateRef.current;
    const token = projectionRestoreToken.current + 1;
    projectionRestoreToken.current = token;
    setProjectionRestore(snapshot ? { ...snapshot, sourceProjection: projection, token } : null);
    setProjection(next);
  }, [projection]);
  const handleCameraViewRestored = useCallback((token: number) => {
    setProjectionRestore((current) => current?.token === token ? null : current);
  }, []);
  const handleFitComplete = useCallback((nextZoomPercent: number) => {
    setZoomPercent(Math.max(1, Math.round(nextZoomPercent)));
  }, []);
  const applyPreset = (next: CameraView) => { setProjectionRestore(null); setPreset(next); setActivePreset(next); setZoomPercent(100); setCameraResetKey((current) => current + 1); };
  const handleCaptureError = useCallback((message: string) => { setCaptureError(message); setCaptureMenuOpen(true); }, []);
  useEffect(() => {
    if (!props.saveViewRequest || props.placement) return;
    const openRequest = window.setTimeout(() => {
      setCaptureError(null);
      setCaptureMenuOpen(true);
    }, 0);
    return () => window.clearTimeout(openRequest);
  }, [props.placement, props.saveViewRequest]);
  async function saveViewAs() {
    setCaptureError(null);
    const picker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
    if (!picker) {
      setCaptureFileHandle(null);
      setCaptureMenuOpen(false);
      setCaptureRequest((current) => current + 1);
      return;
    }
    const formatDetails: Record<CaptureFormat, { label: string; mimeType: string }> = {
      png: { label: "PNG image", mimeType: "image/png" },
      jpg: { label: "JPG image", mimeType: "image/jpeg" },
      pdf: { label: "PDF document", mimeType: "application/pdf" },
    };
    const selected = formatDetails[captureFormat];
    try {
      const handle = await picker({
        suggestedName: `renovation-fit-view.${captureFormat}`,
        types: [{ description: selected.label, accept: { [selected.mimeType]: [`.${captureFormat}`] } }],
      });
      setCaptureFileHandle(handle);
      setCaptureMenuOpen(false);
      setCaptureRequest((current) => current + 1);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setCaptureError(reason instanceof Error ? reason.message : "Unable to choose a save location.");
    }
  }
  useEffect(() => {
    if (!captureMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { setCaptureMenuOpen(false); saveViewButton.current?.focus(); } };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [captureMenuOpen]);
  return (
    <div className="viewer-shell" onPointerDownCapture={(event) => { if (event.button === 2) rightPointerRef.current = { x: event.clientX, y: event.clientY, moved: false }; }} onPointerMoveCapture={(event) => { const pointer = rightPointerRef.current; if (pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5) pointer.moved = true; }} onPointerUpCapture={(event) => { if (event.button === 2 && rightPointerRef.current?.moved) window.setTimeout(() => { rightPointerRef.current = null; }, 0); }} onContextMenu={(event) => { if (!(event.target instanceof HTMLCanvasElement)) return; event.preventDefault(); const wasPan = rightPointerRef.current?.moved; rightPointerRef.current = null; if (wasPan) return; clearSelection(); setToolbarContextMenu({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 480)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 330)) }); }} onPointerDown={(event) => { if (toolbarContextMenu && event.target instanceof Element && !event.target.closest(".toolbar-context-menu")) setToolbarContextMenu(null); }}>
      {props.toolbarVisibility["viewer-view"] && <FloatingToolbar className="viewer-view-toolbar" title="View properties" defaultPosition={{ x: 790, y: 18 }} dock={props.fillToolbarLayout ? viewerLeftDock("viewer-view") : { side: "RIGHT", slot: 0, slots: 3 }} layoutResetKey={props.toolbarLayoutResetKey} maxHeight={340} onClose={() => props.onToggleToolbar("viewer-view")}><div className="viewer-toolbar floating-view-controls" aria-label="3D view properties">
        <div className="viewer-view-control-group viewer-zoom-controls" role="group" aria-label="Zoom controls">
          <button type="button" aria-label="Zoom out" onClick={() => setZoomPercent((value) => Math.max(25, value - 10))}>−</button>
          <button type="button" aria-label="Reset zoom" onClick={() => { setProjectionRestore(null); setZoomPercent(100); setCameraResetKey((value) => value + 1); }}>{zoomPercent}%</button>
          <button type="button" aria-label="Zoom in" onClick={() => setZoomPercent((value) => Math.min(300, value + 10))}>+</button>
          <button type="button" onClick={() => { setProjectionRestore(null); setActivePreset(null); setFitViewRequest((value) => value + 1); }}>Fit</button>
        </div>
        <div className="viewer-view-control-group viewer-projection-controls" role="group" aria-label="Projection">
          <button className={projection === "perspective" ? "active" : ""} aria-pressed={projection === "perspective"} onClick={() => switchProjection("perspective")}>Perspective</button>
          <button className={projection === "parallel" ? "active" : ""} aria-pressed={projection === "parallel"} onClick={() => switchProjection("parallel")}>Parallel</button>
        </div>
        <div className="viewer-view-control-group viewer-camera-controls" role="group" aria-label="Camera views">
          {props.room.person_mockup?.enabled && <button className={activePreset === "eye" ? "active" : ""} aria-pressed={activePreset === "eye"} onClick={() => applyPreset("eye")}>Eye level</button>}
          {(["top", "bottom", "left", "right"] as CameraView[]).map((view) => <button key={view} type="button" className={activePreset === view ? "active" : ""} aria-pressed={activePreset === view} onClick={() => applyPreset(view)}>{view[0].toUpperCase() + view.slice(1)}</button>)}
        </div>
        <div className="toggle-row" role="group" aria-label="3D visibility">
          <ViewToggle label="Grid" active={showGrid} onToggle={() => setShowGrid((current) => !current)} />
          {(["elements", "openingImprints", "clearance"] as const).map((key) => (
            <ViewToggle key={key} label={key === "openingImprints" ? "Opening imprint" : key === "clearance" ? "Clearance envelope" : "Elements"} active={toggles[key]} onToggle={() => flip(key)} />
          ))}
        </div>
        <div className="viewer-view-control-group viewer-lighting-controls" role="group" aria-label="Lighting">
          <button type="button" className="viewer-lighting-toggle" aria-expanded={lightingExpanded} onClick={() => setLightingExpanded((current) => !current)}>
            <strong>Lighting</strong><span aria-hidden>{lightingExpanded ? "−" : "+"}</span>
          </button>
          {lightingExpanded && <>{([
            { key: "intensity", label: "Light intensity", min: 0, max: 200, unit: "%" },
            { key: "shadows", label: "Shadow strength", min: 0, max: 100, unit: "%" },
            { key: "direction", label: "Light direction", min: 0, max: 360, unit: "°" },
            { key: "elevation", label: "Light elevation", min: 5, max: 90, unit: "°" },
          ] as const).map(({ key, label, min, max, unit }) => <label className="viewer-lighting-field" key={key}>
            <span>{label}<output>{lighting[key]}{unit}</output></span>
            <input aria-label={label} aria-valuetext={`${lighting[key]}${unit}`} type="range" min={min} max={max} step={1} value={lighting[key]} onChange={(event) => {
              const value = event.currentTarget.valueAsNumber;
              if (Number.isFinite(value)) setLighting((current) => ({ ...current, [key]: Math.min(max, Math.max(min, value)) }));
            }} />
          </label>)}
          <small>Direction is measured clockwise from the top of the floorplan (0°). Lower elevation creates longer shadows.</small>
          <button type="button" className="review-style-button" onClick={() => setLighting({ ...DEFAULT_LIGHTING })}>Reset lighting</button>
          </>}
        </div>
        <div className="viewer-view-control-group viewer-room-selector-controls" role="group" aria-label="Room selector">
          <button type="button" className="viewer-room-selector-toggle" aria-expanded={roomSelectorExpanded} onClick={() => setRoomSelectorExpanded((current) => !current)}>
            <strong>Room selector</strong><span aria-hidden>{roomSelectorExpanded ? "−" : "+"}</span>
          </button>
          {roomSelectorExpanded && <div className="viewer-room-selector-content">
            <label>Room
              <select value={props.roomSelection} onChange={(event) => props.onRoomSelectionChange(event.target.value)}>
                <option value={props.fullFloorplanSelection}>Full floorplan</option>
                {props.roomSelectionOptions.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
              </select>
            </label>
            <button className="review-style-button" type="button" onClick={props.onOpenRoomSelection}>Open selection in 3D</button>
          </div>}
        </div>
        <div className="viewer-save-row"><div className="viewer-save-menu"><button ref={saveViewButton} type="button" aria-label="Save 3D view" disabled={Boolean(props.placement)} onClick={() => { setCaptureError(null); setCaptureMenuOpen(true); }} aria-expanded={captureMenuOpen} aria-haspopup="dialog">Save view…</button></div></div>
      </div></FloatingToolbar>}
      {selectedObjectPanelVisible && panelSelection && panelRoom && <ContextControls key={`${props.toolbarLayoutResetKey}-${panelSelection.type}-${panelSelection.roomId}`} apiUrl={props.apiUrl} room={panelRoom} rooms={props.sceneRooms?.length ? props.sceneRooms : [props.room]} selection={panelSelection} onObstaclesChange={props.onObstaclesChange} onFinishesChange={props.onFinishesChange} dock={{ side: "RIGHT", slot: 2, slots: 3 }} layoutResetKey={props.toolbarLayoutResetKey} onClose={clearSelection} />}
      <Canvas key={projection} orthographic={projection === "parallel"} shadows={{ type: THREE.PCFShadowMap }} gl={{ preserveDrawingBuffer: true }} camera={{ position: [4.6, 4.1, 4.8], fov: 38, zoom: 180, near: 0.01, far: 100 }} onPointerMissed={clearSelection}>
        <Scene {...props} lighting={lighting} toggles={toggles} preset={preset} projection={projection} selection={selection} onSelectionChange={selectObject} showGrid={showGrid} cameraResetKey={cameraResetKey} fitViewRequest={fitViewRequest} zoomPercent={zoomPercent} onManualViewChange={clearActivePreset} restoreView={projectionRestore} cameraStateRef={cameraStateRef} onCameraViewRestored={handleCameraViewRestored} onFitComplete={handleFitComplete} />
        <WheelZoom onManualViewChange={clearActivePreset} />
        <CaptureController request={captureRequest} format={captureFormat} fileHandle={captureFileHandle} includeAttribution={includeCaptureAttribution} onError={handleCaptureError} />
      </Canvas>
      <div className="viewer-legend"><span>Click a surface to edit · drag elements to move</span><span>Drag orbit · wheel zoom · right-drag pan</span></div>
      {toolbarContextMenu && <ToolbarContextMenu x={toolbarContextMenu.x} y={toolbarContextMenu.y} toolbars={VIEWER_TOOLBARS.filter((toolbar) => props.toolbarAvailability[toolbar.id])} visibility={props.toolbarVisibility} onToggle={props.onToggleToolbar} onClose={() => setToolbarContextMenu(null)} />}
      <Popup open={captureMenuOpen} title="Save view" message="" confirmLabel="Save as…" onCancel={() => { setCaptureMenuOpen(false); setCaptureError(null); }} onConfirm={() => { void saveViewAs(); }}>
        <label className="field save-view-format"><span>File format</span><select value={captureFormat} onChange={(event) => setCaptureFormat(event.target.value as CaptureFormat)}><option value="png">PNG image (.png)</option><option value="jpg">JPG image (.jpg)</option><option value="pdf">PDF document (.pdf)</option></select></label><label className="save-view-attribution"><input type="checkbox" checked={includeCaptureAttribution} onChange={(event) => setIncludeCaptureAttribution(event.target.checked)} /><span>Include “Made with FreeFloorplan3D.com”</span></label>
        {captureError && <p className="inline-error">{captureError}</p>}
      </Popup>
    </div>
  );
}
