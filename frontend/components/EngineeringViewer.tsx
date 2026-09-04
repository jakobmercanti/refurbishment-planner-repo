"use client";

import { Grid, Line, OrbitControls, RoundedBox } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { DULUX_PAINT_FAMILIES, type DuluxPaintShade } from "@/lib/duluxPalette";
import { fixtureKindForObstacle } from "@/lib/fixtureCatalog";
import { alignObstacleToNearestWall, constrainPersonToRoom } from "@/lib/layoutInteraction";
import type { MaterialCollection, Obstacle, Opening, PersonMockup, Point2D, Room, RoomFinishes, TilePattern, WallViewMode } from "@/lib/types";
import { FloatingToolbar } from "@/components/FloatingToolbar";
import { ToolbarContextMenu } from "@/components/ToolbarContextMenu";
import { VIEWER_TOOLBARS, type ToolbarId, type ToolbarVisibility } from "@/lib/toolbars";

const SCALE = 0.001;
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

interface ViewerProps {
  apiUrl: string;
  room: Room;
  collisionIds: string[];
  onObstaclesChange: (obstacles: Obstacle[]) => void;
  onFinishesChange: (finishes: RoomFinishes) => void;
  onPersonChange: (person: PersonMockup | null) => void;
  wallMode: WallViewMode;
  toolbarVisibility: ToolbarVisibility;
  onToggleToolbar: (id: ToolbarId) => void;
  toolbarLayoutResetKey: number;
}

type Selection = { type: "ELEMENT"; id: string } | { type: "PERSON" } | { type: "WALL"; id: string; ids: string[] } | { type: "FLOOR" } | null;

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

interface TilePalette {
  name: string;
  base: string;
  accent: string;
  grout: string;
}

const TILE_PALETTES: Partial<Record<TilePattern, TilePalette[]>> = {
  MARBLE: [
    { name: "Carrara", base: "#eeeae2", accent: "#aeb5b3", grout: "#d0cdc7" },
    { name: "Nero", base: "#202321", accent: "#d9d7ce", grout: "#777a75" },
    { name: "Rose", base: "#ead8d2", accent: "#a36f70", grout: "#cbb9b3" },
  ],
  CHECKERBOARD: [
    { name: "Black + white", base: "#f2f0e9", accent: "#202523", grout: "#b9b7b0" },
    { name: "Navy + cream", base: "#efe5cf", accent: "#263e58", grout: "#c9bda8" },
    { name: "Sage + chalk", base: "#e8e8df", accent: "#668071", grout: "#bfc4b9" },
  ],
  HERRINGBONE: [
    { name: "Terracotta", base: "#b96f4f", accent: "#8e4d39", grout: "#e2cbbd" },
    { name: "Forest", base: "#42685b", accent: "#28483f", grout: "#c4cdc6" },
    { name: "Sand", base: "#d8c19b", accent: "#aa8d65", grout: "#eee2ce" },
  ],
  DIAMOND: [
    { name: "Blue", base: "#e8e5dc", accent: "#315f78", grout: "#c8c5bd" },
    { name: "Burgundy", base: "#eee3d8", accent: "#7c3843", grout: "#cbbeb3" },
    { name: "Ochre", base: "#f0e5c9", accent: "#b67b27", grout: "#cabf9f" },
  ],
  KITKAT: [
    { name: "Sage", base: "#789786", accent: "#5d796b", grout: "#d8d4ca" },
    { name: "Ocean", base: "#4e7f8b", accent: "#315c68", grout: "#d4dcda" },
    { name: "Blush", base: "#c98f86", accent: "#a66d68", grout: "#ead8d3" },
  ],
  SQUARE_600: [
    { name: "Charcoal", base: "#343c3b", accent: "#252b2a", grout: "#79817e" },
    { name: "Limestone", base: "#c9c0ae", accent: "#a99d88", grout: "#e2ddd3" },
    { name: "Concrete", base: "#8d9290", accent: "#6f7472", grout: "#c4c7c4" },
  ],
  TERRAZZO: [
    { name: "Cream", base: "#e6ddcc", accent: "#9d7867", grout: "#d5cbb9" },
    { name: "Confetti", base: "#ece8dd", accent: "#315f78", grout: "#b96f4f" },
    { name: "Night", base: "#343938", accent: "#d2a45b", grout: "#7f8e89" },
  ],
  HEXAGON: [
    { name: "White", base: "#f3f1eb", accent: "#d3d0c9", grout: "#aaa9a5" },
    { name: "Graphite", base: "#4a504e", accent: "#2f3433", grout: "#858b88" },
    { name: "Sea glass", base: "#b7d0c8", accent: "#759c91", grout: "#e0e7e3" },
  ],
};

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

function wallVector(start: Point2D, end: Point2D) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  return { dx: dx / length, dy: dy / length, length, angle: Math.atan2(dy, dx) };
}

function cross(a: Point2D, b: Point2D) {
  return a.x * b.y - a.y * b.x;
}

function wallThickness(room: Room, index: number): number {
  return room.wall_thickness_overrides_mm?.[`wall-${String(index + 1).padStart(3, "0")}`] ?? room.wall_thickness.value;
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
      {wallMode !== "CUTAWAY_2D" && <mesh
        ref={solidMeshRef}
        position={[0, base * SCALE, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={(event) => { event.stopPropagation(); onSelect(event.ctrlKey || event.metaKey); }}
      >
        <extrudeGeometry args={[shape, { depth: height * SCALE, bevelEnabled: false }]} />
        <meshStandardMaterial color="#d9d4c8" roughness={0.86} side={THREE.DoubleSide} transparent={wallMode === "TRANSPARENT"} opacity={wallMode === "TRANSPARENT" ? 0.2 : 1} depthWrite={wallMode !== "TRANSPARENT"} />
      </mesh>}
      <mesh
        ref={paintMeshRef}
        position={[
          innerCentre.x * SCALE - vector.dy * paintOffset,
          (base + height / 2) * SCALE,
          -innerCentre.y * SCALE - vector.dx * paintOffset,
        ]}
        rotation={[0, vector.angle, 0]}
        receiveShadow
        onPointerDown={(event) => { event.stopPropagation(); onSelect(event.ctrlKey || event.metaKey); }}
      >
        <planeGeometry args={[length * SCALE, height * SCALE]} />
        <meshBasicMaterial color={selected ? "#b76d16" : colour} toneMapped={false} side={THREE.DoubleSide} transparent={wallMode === "TRANSPARENT"} opacity={wallMode === "TRANSPARENT" ? 0.28 : 1} depthWrite={wallMode !== "TRANSPARENT"} />
      </mesh>
    </group>
  );
}

function WallWithOpenings({
  index,
  room,
  start,
  end,
  wallMode,
  selected,
  onSelect,
}: {
  index: number;
  room: Room;
  start: Point2D;
  end: Point2D;
  wallMode: WallViewMode;
  selected: boolean;
  onSelect: (additive: boolean) => void;
}) {
  const vector = wallVector(start, end);
  const thickness = wallThickness(room, index);
  const outerStart = exteriorCorner(room.vertices, index, wallThickness(room, (index - 1 + room.vertices.length) % room.vertices.length), thickness);
  const outerEnd = exteriorCorner(room.vertices, (index + 1) % room.vertices.length, thickness, wallThickness(room, (index + 1) % room.vertices.length));
  const wallId = `wall-${String(index + 1).padStart(3, "0")}`;
  const colour = room.finishes?.wall_colors?.[wallId] ?? "#d9d4c8";
  const openings = room.openings
    .filter((opening) => opening.parent_wall_id === wallId)
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
        onSelect={onSelect}
      />,
    );
    cursor = opening.offset_mm + opening.width.value;
  });
  pieces.push(
    <WallPiece
      key={`${wallId}-after`}
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
  const floorGeometry = useMemo(() => {
    const geometry = new THREE.ShapeGeometry(shape);
    const position = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    const tileSizeMetres = (renderedTile?.tileSize ?? 500) * SCALE;
    for (let index = 0; index < position.count; index += 1) {
      uv.setXY(index, position.getX(index) / tileSizeMetres, position.getY(index) / tileSizeMetres);
    }
    uv.needsUpdate = true;
    return geometry;
  }, [renderedTile?.tileSize, shape]);
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
        {renderedTile ? (
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

function TapAssembly({ height, depth }: { height: number; depth: number }) {
  const baseY = height * 0.865;
  const baseZ = -depth * 0.27;
  const curve = useMemo(() => new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, baseY + 0.055, baseZ),
    new THREE.Vector3(0, baseY + 0.14, baseZ),
    new THREE.Vector3(0, baseY + 0.19, baseZ + 0.045),
    new THREE.Vector3(0, baseY + 0.185, baseZ + 0.12),
    new THREE.Vector3(0, baseY + 0.145, baseZ + 0.175),
  ]), [baseY, baseZ]);
  return <group>
    <mesh position={[0, baseY + 0.006, baseZ]} castShadow><cylinderGeometry args={[0.038, 0.046, 0.012, 32]} /><meshPhysicalMaterial color="#e4e9e8" metalness={0.96} roughness={0.11} clearcoat={0.8} /></mesh>
    <mesh position={[0, baseY + 0.047, baseZ]} castShadow><cylinderGeometry args={[0.025, 0.032, 0.082, 28]} /><meshPhysicalMaterial color="#dce3e1" metalness={0.96} roughness={0.1} clearcoat={0.9} /></mesh>
    <mesh castShadow><tubeGeometry args={[curve, 48, 0.012, 18, false]} /><meshPhysicalMaterial color="#e5eae9" metalness={0.98} roughness={0.09} clearcoat={1} /></mesh>
    <mesh position={[0, baseY + 0.126, baseZ + 0.176]} castShadow><cylinderGeometry args={[0.014, 0.012, 0.044, 20]} /><meshPhysicalMaterial color="#d7dedc" metalness={0.95} roughness={0.12} /></mesh>
    <mesh position={[0, baseY + 0.103, baseZ + 0.176]} castShadow><cylinderGeometry args={[0.013, 0.013, 0.004, 20]} /><meshStandardMaterial color="#596563" metalness={0.7} roughness={0.25} /></mesh>
    <group position={[0.041, baseY + 0.055, baseZ]} rotation={[0, 0, -0.28]}>
      <mesh castShadow><sphereGeometry args={[0.018, 18, 14]} /><meshPhysicalMaterial color="#dce3e1" metalness={0.96} roughness={0.1} /></mesh>
      <mesh position={[0, 0.04, 0]} castShadow><cylinderGeometry args={[0.008, 0.011, 0.075, 16]} /><meshPhysicalMaterial color="#e5eae9" metalness={0.98} roughness={0.09} /></mesh>
      <RoundedBox args={[0.022, 0.012, 0.052]} radius={0.005} smoothness={3} position={[0, 0.08, 0.008]} rotation={[Math.PI / 2, 0, 0]} castShadow><meshPhysicalMaterial color="#e3e8e7" metalness={0.97} roughness={0.1} /></RoundedBox>
    </group>
  </group>;
}

function StlFixture({ obstacle, width, depth, height, colour }: { obstacle: Obstacle; width: number; depth: number; height: number; colour: string }) {
  const geometry = useMemo(() => {
    if (!obstacle.stl_base64) return null;
    try {
      const encoded = obstacle.stl_base64.includes(",") ? obstacle.stl_base64.split(",", 2)[1] : obstacle.stl_base64;
      const binary = window.atob(encoded);
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
      const centre = box.getCenter(new THREE.Vector3());
      parsed.translate(-centre.x, -box.min.y, -centre.z);
      parsed.scale(width / Math.max(size.x, 1e-6), height / Math.max(size.y, 1e-6), depth / Math.max(size.z, 1e-6));
      parsed.computeBoundingSphere();
      return parsed;
    } catch {
      return null;
    }
  }, [depth, height, obstacle.stl_base64, width]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return <mesh geometry={geometry} castShadow receiveShadow><meshStandardMaterial color={colour} roughness={0.56} metalness={0.04} /></mesh>;
}

function FixtureMesh({ obstacle, selected, onPointerDown, onPointerMove, onPointerUp }: {
  obstacle: Obstacle;
  selected: boolean;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void;
  onPointerUp: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const fixtureKind = fixtureKindForObstacle(obstacle);
  const width = obstacle.dimensions.width.value * SCALE;
  const depth = obstacle.dimensions.depth.value * SCALE;
  const height = obstacle.dimensions.height.value * SCALE;
  const position: [number, number, number] = [
    obstacle.center.x * SCALE,
    obstacle.base_z_mm * SCALE,
    -obstacle.center.y * SCALE,
  ];
  const rotation: [number, number, number] = [0, THREE.MathUtils.degToRad(obstacle.rotation_deg), 0];
  const interactionProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
  const customColour = obstacle.color_hex;
  const selectionRing = selected ? (
    <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[Math.max(width, depth) * 0.62, Math.max(width, depth) * 0.68, 48]} />
      <meshBasicMaterial color="#d88416" transparent opacity={0.9} side={THREE.DoubleSide} />
    </mesh>
  ) : null;

  if (obstacle.stl_base64) {
    return <group position={position} rotation={rotation} {...interactionProps}>{selectionRing}<StlFixture obstacle={obstacle} width={width} depth={depth} height={height} colour={customColour ?? "#b99b77"} /></group>;
  }

  if (fixtureKind === "SHOWER") {
    return (
      <group position={position} rotation={rotation} {...interactionProps}>
        {selectionRing}
        <mesh position={[0, 0.035, 0]} castShadow receiveShadow>
          <boxGeometry args={[width, 0.07, depth]} />
          <meshStandardMaterial color={customColour ?? "#f7f8f6"} roughness={0.65} />
        </mesh>
        <mesh position={[0, height * 0.52, -depth / 2]} castShadow>
          <boxGeometry args={[width, height * 0.96, 0.012]} />
          <meshPhysicalMaterial color="#b9e1e8" transparent opacity={0.28} roughness={0.08} transmission={0.35} depthWrite={false} />
        </mesh>
        <mesh position={[-width / 2, height * 0.52, 0]} castShadow>
          <boxGeometry args={[0.012, height * 0.96, depth]} />
          <meshPhysicalMaterial color="#b9e1e8" transparent opacity={0.28} roughness={0.08} transmission={0.35} depthWrite={false} />
        </mesh>
        <mesh position={[width * 0.23, height * 0.52, depth / 2]} castShadow>
          <boxGeometry args={[width * 0.54, height * 0.96, 0.012]} />
          <meshPhysicalMaterial color="#c6e7ec" transparent opacity={0.22} roughness={0.06} transmission={0.42} depthWrite={false} />
        </mesh>
        <mesh position={[0, height - 0.018, -depth / 2]}>
          <boxGeometry args={[width + 0.025, 0.03, 0.025]} />
          <meshStandardMaterial color="#496a70" metalness={0.65} roughness={0.28} />
        </mesh>
        {[-width / 2, width / 2].map((xValue) => <mesh key={xValue} position={[xValue, height / 2, -depth / 2]}><cylinderGeometry args={[0.014, 0.014, height, 12]} /><meshStandardMaterial color="#52696c" metalness={0.75} roughness={0.22} /></mesh>)}
        <mesh position={[0, 0.074, 0]} rotation={[-Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.045, 0.045, 0.008, 24]} /><meshStandardMaterial color="#667878" metalness={0.7} roughness={0.25} /></mesh>
      </group>
    );
  }

  if (fixtureKind === "BASIN") {
    const isVanity = obstacle.name.toLowerCase().includes("vanity") || obstacle.model_id?.includes("vanity") || width >= 0.55;
    const cabinetColour = customColour ?? "#9d8067";
    return (
      <group position={position} rotation={rotation} {...interactionProps}>
        {selectionRing}
        {isVanity ? <>
          <RoundedBox args={[width * 0.92, height * 0.68, depth * 0.84]} radius={0.022} smoothness={4} position={[0, height * 0.42, -depth * 0.06]} castShadow>
            <meshStandardMaterial color={cabinetColour} roughness={0.58} />
          </RoundedBox>
          <mesh position={[0, height * 0.095, depth * 0.02]} castShadow><boxGeometry args={[width * 0.8, height * 0.13, depth * 0.68]} /><meshStandardMaterial color="#594b40" roughness={0.78} /></mesh>
          <mesh position={[0, height * 0.18, depth * 0.385]}><boxGeometry args={[width * 0.78, height * 0.12, 0.018]} /><meshStandardMaterial color="#3f3832" roughness={0.72} /></mesh>
          {[-0.235, 0.235].map((side) => <group key={side} position={[width * side, height * 0.45, depth * 0.372]}>
            <RoundedBox args={[width * 0.43, height * 0.49, 0.025]} radius={0.009} smoothness={3} castShadow><meshStandardMaterial color={cabinetColour} roughness={0.5} /></RoundedBox>
            <mesh position={[side < 0 ? width * 0.14 : -width * 0.14, height * 0.04, 0.022]}><boxGeometry args={[0.07, 0.011, 0.012]} /><meshStandardMaterial color="#c3cbc9" metalness={0.82} roughness={0.18} /></mesh>
          </group>)}
          <RoundedBox args={[width, height * 0.065, depth]} radius={0.018} smoothness={4} position={[0, height * 0.805, 0]} castShadow>
            <meshStandardMaterial color="#eeeae2" roughness={0.22} />
          </RoundedBox>
          <mesh position={[0, height * 0.84, -depth * 0.47]} castShadow><boxGeometry args={[width, height * 0.12, 0.025]} /><meshStandardMaterial color="#ece8df" roughness={0.26} /></mesh>
        </> : <>
          <mesh position={[0, height * 0.37, -depth * 0.08]} castShadow><cylinderGeometry args={[width * 0.18, width * 0.28, height * 0.72, 24]} /><meshStandardMaterial color={customColour ?? "#f1f0eb"} roughness={0.3} /></mesh>
          <RoundedBox args={[width, height * 0.07, depth]} radius={0.025} smoothness={4} position={[0, height * 0.78, 0]} castShadow><meshStandardMaterial color="#f0eee8" roughness={0.26} /></RoundedBox>
        </>}
        <mesh position={[0, height * 0.86, depth * 0.035]} rotation={[-Math.PI / 2, 0, 0]} scale={[width * 0.64, depth * 0.6, 1]} castShadow>
          <torusGeometry args={[0.5, 0.075, 18, 56]} />
          <meshStandardMaterial color="#fbfaf6" roughness={0.2} />
        </mesh>
        <mesh position={[0, height * 0.847, depth * 0.035]} rotation={[-Math.PI / 2, 0, 0]} scale={[width * 0.54, depth * 0.49, 1]}>
          <circleGeometry args={[0.5, 48]} />
          <meshStandardMaterial color="#dfe5e3" roughness={0.18} />
        </mesh>
        <mesh position={[0, height * 0.855, depth * 0.035]}><cylinderGeometry args={[0.024, 0.024, 0.012, 24]} /><meshStandardMaterial color="#87908e" metalness={0.8} roughness={0.18} /></mesh>
        <mesh position={[0, height * 0.89, -depth * 0.01]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.011, 0.011, 0.008, 16]} /><meshStandardMaterial color="#9ca5a2" metalness={0.72} roughness={0.2} /></mesh>
        <TapAssembly height={height} depth={depth} />
      </group>
    );
  }

  if (fixtureKind === "TOILET") {
    return (
      <group position={position} rotation={rotation} {...interactionProps}>
        {selectionRing}
        <mesh position={[0, height * 0.3, depth * 0.08]} scale={[width * 0.9, height * 0.48, depth * 0.72]} castShadow>
          <sphereGeometry args={[0.5, 32, 18]} />
          <meshStandardMaterial color={customColour ?? "#f7f7f3"} roughness={0.3} />
        </mesh>
        <mesh position={[0, height * 0.7, -depth * 0.35]} castShadow>
          <boxGeometry args={[width * 0.82, height * 0.56, depth * 0.3]} />
          <meshStandardMaterial color="#f7f7f3" roughness={0.32} />
        </mesh>
        <mesh position={[0, height * 0.49, depth * 0.12]} rotation={[-Math.PI / 2, 0, 0]} scale={[width * 0.42, depth * 0.36, 1]}><torusGeometry args={[0.5, 0.075, 14, 36]} /><meshStandardMaterial color="#fafaf6" roughness={0.25} /></mesh>
        <mesh position={[0, height * 0.985, -depth * 0.35]} rotation={[-Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.035, 0.035, 0.01, 20]} /><meshStandardMaterial color="#8b9391" metalness={0.55} roughness={0.3} /></mesh>
      </group>
    );
  }

  if (fixtureKind === "FURNITURE") {
    const isBench = obstacle.model_id?.includes("bench");
    return (
      <group position={position} rotation={rotation} {...interactionProps}>
        {selectionRing}
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
      </group>
    );
  }

  return (
    <mesh
      position={[position[0], position[1] + height / 2, position[2]]}
      rotation={rotation}
      castShadow
      {...interactionProps}
    >
      <boxGeometry args={[width, height, depth]} />
      <meshStandardMaterial color="#8a7765" roughness={0.72} />
    </mesh>
  );
}

function DoorSwingLeaf({
  hinge,
  initial,
  direction,
  radius,
}: {
  hinge: Point2D;
  initial: number;
  direction: number;
  radius: number;
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
      <meshStandardMaterial color="#e5a51b" transparent opacity={0.28} side={THREE.DoubleSide} depthWrite={false} />
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
  if (door.door_type === "DOUBLE") {
    return (
      <>
        <DoorSwingLeaf hinge={{ x: startX, y: startY }} initial={vector.angle} direction={inward ? 1 : -1} radius={door.width.value / 2} />
        <DoorSwingLeaf hinge={{ x: endX, y: endY }} initial={vector.angle + Math.PI} direction={inward ? -1 : 1} radius={door.width.value / 2} />
      </>
    );
  }
  const hingeStart = door.hinge_side === "START";
  const hinge = hingeStart ? { x: startX, y: startY } : { x: endX, y: endY };
  const initial = Math.atan2(hingeStart ? vector.dy : -vector.dy, hingeStart ? vector.dx : -vector.dx);
  const direction = hingeStart ? (inward ? 1 : -1) : (inward ? -1 : 1);
  return <DoorSwingLeaf hinge={hinge} initial={initial} direction={direction} radius={door.width.value} />;
}

type VectorTuple = [number, number, number];

function OpeningFixture({ room, opening }: { room: Room; opening: Opening }) {
  const wallIndex = Number(opening.parent_wall_id.split("-")[1]) - 1;
  const start = room.vertices[wallIndex];
  const end = room.vertices[(wallIndex + 1) % room.vertices.length];
  if (!start || !end || (opening.kind !== "DOOR" && opening.kind !== "WINDOW")) return null;
  const vector = wallVector(start, end);
  const width = opening.width.value * SCALE;
  const height = opening.height.value * SCALE;
  const sill = opening.sill_height_mm * SCALE;
  const depth = Math.max((opening.reveal_depth_mm ?? wallThickness(room, wallIndex)) * SCALE, 0.06);
  const frame = Math.min(Math.max(width * 0.055, 0.028), 0.065);
  const centre = {
    x: start.x + vector.dx * (opening.offset_mm + opening.width.value / 2),
    y: start.y + vector.dy * (opening.offset_mm + opening.width.value / 2),
  };
  const frameMaterial = <meshStandardMaterial color={opening.kind === "DOOR" ? "#5b4330" : "#455756"} roughness={0.46} metalness={opening.kind === "WINDOW" ? 0.38 : 0.06} />;
  const framePieces = <>
    <mesh position={[-width / 2 + frame / 2, sill + height / 2, 0]} castShadow><boxGeometry args={[frame, height, depth]} />{frameMaterial}</mesh>
    <mesh position={[width / 2 - frame / 2, sill + height / 2, 0]} castShadow><boxGeometry args={[frame, height, depth]} />{frameMaterial}</mesh>
    <mesh position={[0, sill + height - frame / 2, 0]} castShadow><boxGeometry args={[width, frame, depth]} />{frameMaterial}</mesh>
    {opening.kind === "WINDOW" && <mesh position={[0, sill + frame / 2, 0]} castShadow><boxGeometry args={[width, frame, depth]} />{frameMaterial}</mesh>}
  </>;
  const leafHeight = Math.max(height, 0.1);
  const leafWidth = Math.max(width, 0.1);
  const makeDoorLeaf = (centreX: number, leafWidthValue: number) => (
    <group position={[centreX, sill, 0.002]}>
      <mesh position={[0, leafHeight / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[leafWidthValue, leafHeight, Math.min(depth * 0.28, 0.052)]} />
        <meshStandardMaterial color="#f6f6f3" roughness={0.5} />
      </mesh>
      {[0.24, 0.67].flatMap((vertical, row) => [-0.24, 0.24].map((horizontal, column) => <mesh key={`${row}-${column}`} position={[horizontal * leafWidthValue, vertical * leafHeight, depth * 0.17 + 0.004]} castShadow><boxGeometry args={[leafWidthValue * 0.38, leafHeight * 0.28, 0.018]} /><meshStandardMaterial color="#ecece8" roughness={0.58} /></mesh>))}
      <mesh position={[leafWidthValue * 0.36, leafHeight * 0.5, depth * 0.2]} castShadow>
        <sphereGeometry args={[0.025, 14, 10]} />
        <meshStandardMaterial color="#c8cccd" metalness={0.82} roughness={0.2} />
      </mesh>
    </group>
  );
  return <group position={[centre.x * SCALE, 0, -centre.y * SCALE]} rotation={[0, vector.angle, 0]}>
    {opening.kind === "DOOR" ? (
      opening.door_type === "DOUBLE"
        ? <>{makeDoorLeaf(-leafWidth / 4, leafWidth / 2)}{makeDoorLeaf(leafWidth / 4, leafWidth / 2)}</>
        : makeDoorLeaf(0, leafWidth)
    ) : <>
        {framePieces}
        <mesh position={[0, sill + height / 2, 0]} receiveShadow>
          <boxGeometry args={[Math.max(width - frame * 2, 0.1), Math.max(height - frame * 2, 0.1), 0.012]} />
          <meshPhysicalMaterial color="#98c8d5" transparent opacity={0.52} roughness={0.08} metalness={0.1} transmission={0.12} />
        </mesh>
        <mesh position={[0, sill + height / 2, depth * 0.012]}><boxGeometry args={[frame * 0.48, Math.max(height - frame * 2, 0.1), depth * 0.12]} />{frameMaterial}</mesh>
      </>}
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
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void;
  onPointerUp: (event: ThreeEvent<PointerEvent>) => void;
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
  const headY = standing ? height * 0.91 : Math.min(eye + headRadius * 0.18, height - headRadius);
  const shoulderY = standing ? height * 0.84 : headY - headRadius * 1.15;
  const hipY = standing ? height * 0.48 : seated ? height * 0.35 : height * 0.31;
  const shoulderZ = person.posture === "CROUCHING" ? depth * 0.38 : 0;
  const hipZ = person.posture === "CROUCHING" ? -depth * 0.08 : 0;
  const torsoHeight = Math.max(shoulderY - hipY, height * 0.2);
  const torsoY = (shoulderY + hipY) / 2;
  const torsoZ = (shoulderZ + hipZ) / 2;
  const torsoTilt = person.posture === "CROUCHING" ? -0.34 : seated ? -0.06 : 0;
  const shoulderLeft: VectorTuple = [-width * 0.36, shoulderY, shoulderZ];
  const shoulderRight: VectorTuple = [width * 0.36, shoulderY, shoulderZ];
  const hipLeft: VectorTuple = [-width * 0.2, hipY, hipZ];
  const hipRight: VectorTuple = [width * 0.2, hipY, hipZ];
  const kneeLeft: VectorTuple = standing ? [-width * 0.18, height * 0.26, 0] : seated ? [-width * 0.2, height * 0.33, depth * 1.12] : [-width * 0.34, height * 0.14, depth * 0.92];
  const kneeRight: VectorTuple = standing ? [width * 0.18, height * 0.26, 0] : seated ? [width * 0.2, height * 0.33, depth * 1.12] : [width * 0.34, height * 0.14, depth * 0.92];
  const ankleLeft: VectorTuple = standing ? [-width * 0.18, height * 0.055, 0] : seated ? [-width * 0.2, height * 0.055, depth * 1.12] : [-width * 0.27, height * 0.045, depth * 0.12];
  const ankleRight: VectorTuple = standing ? [width * 0.18, height * 0.055, 0] : seated ? [width * 0.2, height * 0.055, depth * 1.12] : [width * 0.27, height * 0.045, depth * 0.12];
  const elbowY = standing ? height * 0.56 : seated ? height * 0.47 : height * 0.32;
  const handY = standing ? height * 0.39 : seated ? height * 0.34 : height * 0.12;
  const elbowZ = person.posture === "CROUCHING" ? depth * 0.78 : depth * 0.08;
  const handZ = person.posture === "CROUCHING" ? depth * 1.08 : depth * 0.12;
  const clearanceWidth = width + clearance * 2;
  const clearanceDepth = depth + clearance * 2;
  const clearancePoints: VectorTuple[] = [[-clearanceWidth / 2, 0.017, -clearanceDepth / 2], [clearanceWidth / 2, 0.017, -clearanceDepth / 2], [clearanceWidth / 2, 0.017, clearanceDepth / 2], [-clearanceWidth / 2, 0.017, clearanceDepth / 2], [-clearanceWidth / 2, 0.017, -clearanceDepth / 2]];
  const clearanceTopPoints: VectorTuple[] = clearancePoints.map(([x, , z]) => [x, height, z]);
  const neckBottom = shoulderY - headRadius * 0.04;
  const neckTop = headY - headRadius * 0.92;
  const neckHeight = Math.max(neckTop - neckBottom, headRadius * 0.34);

  return (
    <group position={[person.center.x * SCALE, 0, -person.center.y * SCALE]} rotation={[0, THREE.MathUtils.degToRad(person.rotation_deg), 0]} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
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
      {[ankleLeft, ankleRight].map((ankle, index) => <RoundedBox key={`foot-${index}`} args={[width * 0.23, height * 0.07, depth * 0.76]} radius={0.025} smoothness={3} position={[ankle[0], height * 0.034, ankle[2] + depth * 0.24]} castShadow><meshStandardMaterial color={shoe} roughness={0.82} /></RoundedBox>)}
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

function CameraPreset({ preset, projection, person, target, span, resetKey, zoomPercent }: { preset: CameraView; projection: ProjectionMode; person?: PersonMockup | null; target: VectorTuple; span: [number, number, number]; resetKey: number; zoomPercent: number }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const horizontalSpan = preset === "left" || preset === "right" ? span[2] : span[0];
    const verticalSpan = preset === "top" || preset === "bottom" ? span[2] : span[1];
    const aspect = Math.max(size.width / Math.max(size.height, 1), 0.1);
    const verticalFov = THREE.MathUtils.degToRad(camera instanceof THREE.PerspectiveCamera ? camera.fov : 50);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const boundingRadius = Math.sqrt(span[0] ** 2 + span[1] ** 2 + span[2] ** 2) / 2;
    const fitDistance = Math.max(0.1, boundingRadius / Math.sin(Math.min(verticalFov, horizontalFov) / 2)) * 1.15;
    if (preset === "eye" && person?.enabled) {
      camera.up.set(0, 1, 0);
      camera.position.set(person.center.x * SCALE, person.eye_height_mm * SCALE, -person.center.y * SCALE);
      camera.lookAt(eyeTarget(person));
    } else {
      if (preset === "top") {
        // Room data uses Cartesian plan coordinates (positive Y is floorplan-up),
        // while every 3D item maps plan Y to negative world Z. Keep negative Z
        // screen-up so floors, walls, openings and placed items retain the same
        // top-view orientation as the floorplan.
        camera.up.set(0, 0, -1);
        camera.position.set(target[0], target[1] + fitDistance, target[2]);
      } else if (preset === "bottom") {
        camera.up.set(0, 0, 1);
        camera.position.set(target[0], target[1] - fitDistance, target[2]);
      } else if (preset === "left") {
        camera.up.set(0, 1, 0);
        camera.position.set(target[0] - fitDistance, target[1], target[2]);
      } else if (preset === "right") {
        camera.up.set(0, 1, 0);
        camera.position.set(target[0] + fitDistance, target[1], target[2]);
      } else {
        camera.up.set(0, 1, 0);
        camera.position.set(target[0] + fitDistance, target[1] + fitDistance * 0.85, target[2] + fitDistance);
      }
      camera.lookAt(...target);
    }
    const orthographicFit = Math.min(size.width / Math.max(horizontalSpan * 1.15, 0.001), size.height / Math.max(verticalSpan * 1.15, 0.001));
    setCameraZoom(camera, projection === "parallel" ? orthographicFit * zoomPercent / 100 : zoomPercent / 100);
    camera.updateProjectionMatrix();
  }, [camera, person, preset, projection, resetKey, size.height, size.width, span, target, zoomPercent]);
  return null;
}

/** Keep wheel input tied to the rendered camera in every projection mode. */
function WheelZoom() {
  const { camera, gl } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const zoomWithWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.deltaY === 0) return;
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      camera.zoom = camera instanceof THREE.OrthographicCamera
        ? THREE.MathUtils.clamp(camera.zoom * factor, 0.0001, 1_000_000)
        : THREE.MathUtils.clamp(camera.zoom * factor, 0.35, 3);
      camera.updateProjectionMatrix();
    };
    canvas.addEventListener("wheel", zoomWithWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", zoomWithWheel);
  }, [camera, gl]);
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

function CaptureController({ request, format }: { request: number; format: CaptureFormat }) {
  const { camera, gl, scene } = useThree();
  useEffect(() => {
    if (request === 0) return;
    gl.render(scene, camera);
    const mimeType = format === "jpg" || format === "pdf" ? "image/jpeg" : "image/png";
    gl.domElement.toBlob(async (blob) => {
      if (!blob) return;
      const output = format === "pdf" ? pdfBlobFromJpeg(await blob.arrayBuffer(), gl.domElement.width, gl.domElement.height) : blob;
      const url = URL.createObjectURL(output);
      const link = document.createElement("a");
      link.href = url;
      link.download = `renovation-fit-view-${request}.${format}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, mimeType, format === "jpg" || format === "pdf" ? 0.94 : undefined);
  }, [camera, format, gl, request, scene]);
  return null;
}

function Scene({ room, collisionIds, onObstaclesChange, onPersonChange, wallMode, toggles, preset, projection, selection, onSelectionChange, showGrid, cameraResetKey, zoomPercent }: ViewerProps & {
  toggles: Toggles;
  preset: CameraView;
  projection: ProjectionMode;
  selection: Selection;
  onSelectionChange: (selection: Selection) => void;
  showGrid: boolean;
  cameraResetKey: number;
  zoomPercent: number;
}) {
  const [dragging, setDragging] = useState<{ id: string; offset: Point2D } | null>(null);
  const [personDragging, setPersonDragging] = useState<{ offset: Point2D } | null>(null);
  const [previewObstacles, setPreviewObstacles] = useState<Record<string, Obstacle>>({});
  const [previewPerson, setPreviewPerson] = useState<PersonMockup | null>(null);
  const dragPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const displayedObstacles = room.obstacles.map((obstacle) => previewObstacles[obstacle.id] ?? obstacle);
  const displayedPerson = previewPerson ?? room.person_mockup;
  const roomTarget = useMemo<VectorTuple>(() => {
    const minX = Math.min(...room.vertices.map((point) => point.x));
    const maxX = Math.max(...room.vertices.map((point) => point.x));
    const minY = Math.min(...room.vertices.map((point) => point.y));
    const maxY = Math.max(...room.vertices.map((point) => point.y));
    return [(minX + maxX) * SCALE / 2, room.wall_height.value * SCALE / 2, -(minY + maxY) * SCALE / 2];
  }, [room.vertices, room.wall_height.value]);
  const roomSpan = useMemo<[number, number, number]>(() => [
    (Math.max(...room.vertices.map((point) => point.x)) - Math.min(...room.vertices.map((point) => point.x))) * SCALE,
    room.wall_height.value * SCALE,
    (Math.max(...room.vertices.map((point) => point.y)) - Math.min(...room.vertices.map((point) => point.y))) * SCALE,
  ], [room.vertices, room.wall_height.value]);
  const orbitTarget: [number, number, number] = preset === "eye" && room.person_mockup?.enabled
    ? eyeTarget(room.person_mockup).toArray()
    : roomTarget;

  function floorPoint(event: ThreeEvent<PointerEvent>) {
    const point = event.ray.intersectPlane(dragPlane, new THREE.Vector3());
    return point ? { x: point.x / SCALE, y: -point.z / SCALE } : null;
  }

  function startDrag(event: ThreeEvent<PointerEvent>, obstacle: Obstacle) {
    event.stopPropagation();
    onSelectionChange({ type: "ELEMENT", id: obstacle.id });
    const point = floorPoint(event);
    if (!point) return;
    (event.target as EventTarget & { setPointerCapture(pointerId: number): void }).setPointerCapture(event.pointerId);
    setDragging({ id: obstacle.id, offset: { x: obstacle.center.x - point.x, y: obstacle.center.y - point.y } });
  }

  function moveDrag(event: ThreeEvent<PointerEvent>, obstacle: Obstacle) {
    if (dragging?.id !== obstacle.id) return;
    event.stopPropagation();
    const point = floorPoint(event);
    if (!point) return;
    const requested = { x: point.x + dragging.offset.x, y: point.y + dragging.offset.y };
    const preview = obstacle.wall_lock
      ? alignObstacleToNearestWall(obstacle, room.vertices, requested)
      : { ...obstacle, center: requested };
    setPreviewObstacles((current) => ({ ...current, [obstacle.id]: preview }));
  }

  function endDrag(event: ThreeEvent<PointerEvent>, obstacle: Obstacle) {
    if (dragging?.id !== obstacle.id) return;
    event.stopPropagation();
    const updated = previewObstacles[obstacle.id] ?? obstacle;
    onObstaclesChange(room.obstacles.map((item) => item.id === obstacle.id ? updated : item));
    setPreviewObstacles({});
    setDragging(null);
  }

  function startPersonDrag(event: ThreeEvent<PointerEvent>, person: PersonMockup) {
    event.stopPropagation();
    onSelectionChange({ type: "PERSON" });
    const point = floorPoint(event);
    if (!point) return;
    (event.target as EventTarget & { setPointerCapture(pointerId: number): void }).setPointerCapture(event.pointerId);
    setPersonDragging({ offset: { x: person.center.x - point.x, y: person.center.y - point.y } });
  }

  function movePersonDrag(event: ThreeEvent<PointerEvent>, person: PersonMockup) {
    if (!personDragging) return;
    event.stopPropagation();
    const point = floorPoint(event);
    if (!point) return;
    const requested = { x: point.x + personDragging.offset.x, y: point.y + personDragging.offset.y };
    const previous = previewPerson?.center ?? person.center;
    setPreviewPerson({ ...person, center: constrainPersonToRoom(person, room.vertices, requested, previous) });
  }

  function endPersonDrag(event: ThreeEvent<PointerEvent>, person: PersonMockup) {
    if (!personDragging) return;
    event.stopPropagation();
    onPersonChange(previewPerson ?? person);
    setPreviewPerson(null);
    setPersonDragging(null);
  }

  function selectWall(wallId: string, additive: boolean) {
    if (!additive || selection?.type !== "WALL") {
      onSelectionChange({ type: "WALL", id: wallId, ids: [wallId] });
      return;
    }
    const ids = selection.ids.includes(wallId)
      ? selection.ids.filter((id) => id !== wallId)
      : [...selection.ids, wallId];
    onSelectionChange(ids.length ? { type: "WALL", id: ids.at(-1) ?? wallId, ids } : null);
  }

  return (
    <>
      <CameraPreset preset={preset} projection={projection} person={room.person_mockup} target={roomTarget} span={roomSpan} resetKey={cameraResetKey} zoomPercent={zoomPercent} />
      <ambientLight intensity={1.3} />
      <directionalLight position={[4, 7, 3]} intensity={2.2} castShadow />
      <Floor room={room} selected={selection?.type === "FLOOR"} onSelect={() => onSelectionChange({ type: "FLOOR" })} />
      {room.vertices.map((start, index) => wallMode !== "INVISIBLE" && (
        <WallWithOpenings
          key={`wall-${index}`}
          index={index}
          room={room}
          start={start}
          end={room.vertices[(index + 1) % room.vertices.length]}
          wallMode={wallMode}
          selected={selection?.type === "WALL" && selection.ids.includes(`wall-${String(index + 1).padStart(3, "0")}`)}
          onSelect={(additive) => selectWall(`wall-${String(index + 1).padStart(3, "0")}`, additive)}
        />
      ))}
      {room.openings.map((opening) => <OpeningFixture key={`fixture-${opening.id}`} room={room} opening={opening} />)}
      {toggles.elements && displayedObstacles.map((obstacle) => (
        <FixtureMesh
          key={obstacle.id}
          obstacle={obstacle}
          selected={selection?.type === "ELEMENT" && selection.id === obstacle.id}
          onPointerDown={(event) => startDrag(event, obstacle)}
          onPointerMove={(event) => moveDrag(event, obstacle)}
          onPointerUp={(event) => endDrag(event, obstacle)}
        />
      ))}
      {toggles.openingImprints && <>
        {room.openings.map((opening) => <OpeningImprint key={`imprint-${opening.id}`} room={room} opening={opening} />)}
        {room.openings.filter((item) => item.kind === "DOOR").map((door) => <DoorSwing key={`swing-${door.id}`} room={room} door={door} />)}
      </>}
      {toggles.person && displayedPerson?.enabled && <PersonMesh person={displayedPerson} showClearance={toggles.clearance && displayedPerson.show_clearance !== false} collision={collisionIds.includes(displayedPerson.id)} selected={selection?.type === "PERSON"} onPointerDown={(event) => startPersonDrag(event, displayedPerson)} onPointerMove={(event) => movePersonDrag(event, displayedPerson)} onPointerUp={(event) => endPersonDrag(event, displayedPerson)} />}
      {toggles.collisions && room.obstacles.filter((item) => collisionIds.includes(item.id)).map((obstacle) => (
        <mesh key={`collision-${obstacle.id}`} position={[obstacle.center.x * SCALE, 0.9, -obstacle.center.y * SCALE]}>
          <sphereGeometry args={[0.11, 24, 24]} />
          <meshStandardMaterial color="#ff2d2d" emissive="#ff2d2d" emissiveIntensity={1.2} />
        </mesh>
      ))}
      {showGrid && <Grid position={[1.6, -0.002, -1.4]} args={[8, 8]} cellSize={0.1} cellThickness={0.4} cellColor="#a9b1ac" sectionSize={1} sectionColor="#65706a" fadeDistance={9} />}
      <OrbitControls makeDefault enableDamping enableZoom={false} enableRotate enabled={!dragging && !personDragging} target={orbitTarget} />
    </>
  );
}

function ContextControls({ apiUrl, room, selection, onObstaclesChange, onFinishesChange, onClose }: Pick<ViewerProps, "apiUrl" | "room" | "onObstaclesChange" | "onFinishesChange"> & { selection: Selection; onClose: () => void }) {
  const [applyToAllWalls, setApplyToAllWalls] = useState(false);
  const [paintFamilyId, setPaintFamilyId] = useState("WHITE");
  const [paintSearch, setPaintSearch] = useState("");
  const [paintCollectionId, setPaintCollectionId] = useState("paints-dulux");
  const [materialCollections, setMaterialCollections] = useState<MaterialCollection[]>([]);
  const [tileCollections, setTileCollections] = useState<MaterialCollection[]>([]);
  const [tileCollectionId, setTileCollectionId] = useState("tiles-default");
  useEffect(() => { void fetch(`${apiUrl}/catalog/materials?kind=PAINT`).then((response) => response.ok ? response.json() as Promise<MaterialCollection[]> : []).then(setMaterialCollections).catch(() => setMaterialCollections([])); }, [apiUrl]);
  useEffect(() => { void fetch(`${apiUrl}/catalog/materials?kind=TILE`).then((response) => response.ok ? response.json() as Promise<MaterialCollection[]> : []).then(setTileCollections).catch(() => setTileCollections([])); }, [apiUrl]);
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
    const wallColors = { ...(finishes.wall_colors ?? {}) };
    const wallColorCodes = { ...(finishes.wall_color_codes ?? {}) };
    const wallIds = applyToAllWalls
      ? room.vertices.map((_item, index) => `wall-${String(index + 1).padStart(3, "0")}`)
      : selection.ids;
    wallIds.forEach((wallId) => {
      if (shade) {
        wallColors[wallId] = shade.colour;
        wallColorCodes[wallId] = shade.name;
      } else {
        delete wallColors[wallId];
        delete wallColorCodes[wallId];
      }
    });
    onFinishesChange({ ...finishes, wall_colors: wallColors, wall_color_codes: wallColorCodes });
  }

  function setFloorTile(tile?: TileStyle) {
    onFinishesChange({
      ...finishes,
      floor_tile_id: tile?.id,
      floor_color: tile?.base,
      floor_pattern: tile?.pattern ?? "NONE",
    });
  }

  function setFloorColours(tileId: string, colours: { base: string; accent: string; grout: string }) {
    onFinishesChange({
      ...finishes,
      floor_tile_colours: { ...(finishes.floor_tile_colours ?? {}), [tileId]: colours },
    });
  }

  function setWallLock(locked: boolean) {
    if (!selectedElement) return;
    const unlocked = { ...selectedElement, wall_lock: locked };
    const updated = locked ? alignObstacleToNearestWall(unlocked, room.vertices, unlocked.center) : unlocked;
    onObstaclesChange(room.obstacles.map((item) => item.id === selectedElement.id ? updated : item));
  }

  const selectedTileCollection = tileCollections.find((collection) => collection.id === tileCollectionId);
  const tiles = selectedTileCollection?.families.flatMap((family) => family.items.map((item) => ({
    id: item.id,
    name: item.name,
    pattern: "SQUARE_600" as TilePattern,
    base: item.color_hex,
    accent: item.color_hex,
    grout: "#b7b5af",
    tileSize: 600,
    preview: item.color_hex,
  }))) ?? TILE_COLLECTION;

  return (
    <FloatingToolbar title="Selected object controls" defaultPosition={{ x: 790, y: 452 }} dock={{ side: "RIGHT", slot: 2, slots: 3 }} maxHeight={650} onClose={onClose}>
    <aside className="context-controls" aria-label="Selected object controls">
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
        <span className="eyebrow">Selected internal {selection.ids.length === 1 ? "wall" : "walls"}</span>
        <strong>{selection.ids.length === 1 ? selection.id.replace("wall-", "Wall ") : `${selection.ids.length} walls selected`}</strong>
        <output className="selected-colour-hex">HEX <code>{(finishes.wall_colors?.[selection.id] ?? "#FFFFFF").toUpperCase()}</code></output>
        <label className="paint-all-choice"><input type="checkbox" checked={applyToAllWalls} onChange={(event) => setApplyToAllWalls(event.target.checked)} /><span>Paint all walls together</span></label>
        <label className="field"><span>Paint collection</span><select value={paintCollectionId} onChange={(event) => { setPaintCollectionId(event.target.value); setPaintFamilyId(""); setPaintSearch(""); }}>{materialCollections.length ? materialCollections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>) : <option value="paints-dulux">Dulux paints</option>}</select></label>
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
        <button className="remove-finish" type="button" onClick={() => setWallColour()}>Remove colour</button>
      </>}
      {selection.type === "FLOOR" && <>
        <span className="eyebrow">Selected floor</span>
        <strong>Floor tile collection</strong>
        <output className="selected-colour-hex">HEX <code>{(finishes.floor_tile_colours?.[finishes.floor_tile_id ?? ""]?.base ?? finishes.floor_color ?? "#E8E1D6").toUpperCase()}</code></output>
        <label className="field"><span>Tile collection</span><select value={tileCollectionId} onChange={(event) => setTileCollectionId(event.target.value)}>{tileCollections.length ? tileCollections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>) : <option value="tiles-default">Default colours</option>}</select></label>
        <div className="tile-collection">{tiles.map((tile) => <button key={tile.id} type="button" className={finishes.floor_tile_id === tile.id ? "selected" : ""} onClick={() => setFloorTile(tile)}><span className="tile-swatch" style={{ background: tile.preview }} /><small>{tile.name}</small></button>)}</div>
        {(() => {
          const selectedTile = tiles.find((tile) => tile.id === finishes.floor_tile_id);
          if (!selectedTile) return null;
          const current = finishes.floor_tile_colours?.[selectedTile.id] ?? { base: selectedTile.base, accent: selectedTile.accent, grout: selectedTile.grout };
          return <div className="tile-colour-editor"><strong>{selectedTile.name} colours</strong><div className="tile-palette-presets">{(TILE_PALETTES[selectedTile.pattern] ?? []).map((palette) => <button key={palette.name} type="button" title={palette.name} aria-label={`Use ${palette.name} colours`} style={{ background: `linear-gradient(135deg, ${palette.base} 0 45%, ${palette.grout} 45% 55%, ${palette.accent} 55% 100%)` }} onClick={() => setFloorColours(selectedTile.id, palette)} />)}</div><div className="tile-custom-colours"><label><span>Primary</span><input type="color" value={current.base} onChange={(event) => setFloorColours(selectedTile.id, { ...current, base: event.target.value })} /></label><label><span>Accent</span><input type="color" value={current.accent} onChange={(event) => setFloorColours(selectedTile.id, { ...current, accent: event.target.value })} /></label><label><span>Grout</span><input type="color" value={current.grout} onChange={(event) => setFloorColours(selectedTile.id, { ...current, grout: event.target.value })} /></label></div></div>;
        })()}
        <button className="remove-finish" type="button" onClick={() => setFloorTile()}>Remove floor finish</button>
      </>}
    </aside>
    </FloatingToolbar>
  );
}

export function EngineeringViewer(props: ViewerProps) {
  const [preset, setPreset] = useState<CameraView>("perspective");
  const [projection, setProjection] = useState<ProjectionMode>("parallel");
  const [captureRequest, setCaptureRequest] = useState(0);
  const [captureFormat, setCaptureFormat] = useState<CaptureFormat>("png");
  const [captureMenuOpen, setCaptureMenuOpen] = useState(false);
  const [cameraResetKey, setCameraResetKey] = useState(0);
  const [zoomPercent, setZoomPercent] = useState(100);
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
    setPanelSelection(nextSelection);
  };
  const clearSelection = () => {
    setSelection(null);
    setPanelSelection(null);
  };
  const applyPreset = (next: CameraView) => { setPreset(next); setZoomPercent(100); setCameraResetKey((current) => current + 1); };
  useEffect(() => {
    if (!captureMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { setCaptureMenuOpen(false); saveViewButton.current?.focus(); } };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [captureMenuOpen]);
  return (
    <div className="viewer-shell" onPointerDownCapture={(event) => { if (event.button === 2) rightPointerRef.current = { x: event.clientX, y: event.clientY, moved: false }; }} onPointerMoveCapture={(event) => { const pointer = rightPointerRef.current; if (pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5) pointer.moved = true; }} onPointerUpCapture={(event) => { if (event.button === 2 && rightPointerRef.current?.moved) window.setTimeout(() => { rightPointerRef.current = null; }, 0); }} onContextMenu={(event) => { if (!(event.target instanceof HTMLCanvasElement)) return; event.preventDefault(); const wasPan = rightPointerRef.current?.moved; rightPointerRef.current = null; if (wasPan) return; clearSelection(); setToolbarContextMenu({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 480)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 330)) }); }} onPointerDown={(event) => { if (toolbarContextMenu && event.target instanceof Element && !event.target.closest(".toolbar-context-menu")) setToolbarContextMenu(null); }}>
      {props.toolbarVisibility["viewer-view"] && <FloatingToolbar className="viewer-view-toolbar" title="View properties" defaultPosition={{ x: 790, y: 18 }} dock={{ side: "RIGHT", slot: 0, slots: 3 }} layoutResetKey={props.toolbarLayoutResetKey} maxHeight={340} onClose={() => props.onToggleToolbar("viewer-view")}><div className="viewer-toolbar floating-view-controls" aria-label="3D view properties">
        <div className="segmented">
          <button className={projection === "perspective" ? "active" : ""} aria-pressed={projection === "perspective"} onClick={() => setProjection("perspective")}>Perspective</button>
          <button className={projection === "parallel" ? "active" : ""} aria-pressed={projection === "parallel"} onClick={() => setProjection("parallel")}>Parallel</button>
          <button type="button" aria-label="Zoom out" onClick={() => setZoomPercent((value) => Math.max(25, value - 10))}>−</button>
          <button type="button" aria-label="Reset zoom" onClick={() => { setZoomPercent(100); setCameraResetKey((value) => value + 1); }}>{zoomPercent}%</button>
          <button type="button" aria-label="Zoom in" onClick={() => setZoomPercent((value) => Math.min(300, value + 10))}>+</button>
          <button type="button" onClick={() => { setZoomPercent(100); setCameraResetKey((value) => value + 1); }}>Fit</button>
          <button className={showGrid ? "active" : ""} aria-pressed={showGrid} onClick={() => setShowGrid((current) => !current)}>Grid</button>
          {props.room.person_mockup?.enabled && <button className={preset === "eye" ? "active" : ""} aria-pressed={preset === "eye"} onClick={() => applyPreset("eye")}>Eye level</button>}
          {(["top", "bottom", "left", "right"] as CameraView[]).map((view) => <button key={view} type="button" className={preset === view ? "active" : ""} aria-pressed={preset === view} onClick={() => applyPreset(view)}>{view[0].toUpperCase() + view.slice(1)}</button>)}
        </div>
        <div className="toggle-row">
          {(["elements", "openingImprints", "collisions", "person"] as Array<keyof Toggles>).map((key) => (
            <button key={key} className={toggles[key] ? "active" : ""} onClick={() => flip(key)} aria-pressed={toggles[key]}>
              {key === "openingImprints" ? "opening imprint" : key}
            </button>
          ))}
          <label className="viewer-toggle-checkbox"><input type="checkbox" checked={toggles.clearance} onChange={() => flip("clearance")} />Clearance envelope</label>
        </div>
        <div className="viewer-save-row"><div className="viewer-save-menu"><button ref={saveViewButton} type="button" aria-label="Save 3D view" onClick={() => setCaptureMenuOpen((current) => !current)} aria-expanded={captureMenuOpen} aria-haspopup="menu">Save view…</button>{captureMenuOpen && <div role="menu" aria-label="Save view format"><button autoFocus role="menuitem" onClick={() => { setCaptureFormat("png"); setCaptureRequest(Date.now()); setCaptureMenuOpen(false); }}>PNG image</button><button role="menuitem" onClick={() => { setCaptureFormat("jpg"); setCaptureRequest(Date.now()); setCaptureMenuOpen(false); }}>JPG image</button><button role="menuitem" onClick={() => { setCaptureFormat("pdf"); setCaptureRequest(Date.now()); setCaptureMenuOpen(false); }}>PDF document</button></div>}</div></div>
      </div></FloatingToolbar>}
      {panelSelection && <ContextControls key={`${props.toolbarLayoutResetKey}-${panelSelection.type}`} apiUrl={props.apiUrl} room={props.room} selection={panelSelection} onObstaclesChange={props.onObstaclesChange} onFinishesChange={props.onFinishesChange} onClose={clearSelection} />}
      <Canvas key={projection} orthographic={projection === "parallel"} shadows gl={{ preserveDrawingBuffer: true }} camera={{ position: [4.6, 4.1, 4.8], fov: 38, zoom: 180, near: 0.01, far: 100 }} onPointerMissed={clearSelection}>
        <Scene {...props} toggles={toggles} preset={preset} projection={projection} selection={selection} onSelectionChange={selectObject} showGrid={showGrid} cameraResetKey={cameraResetKey} zoomPercent={zoomPercent} />
        <WheelZoom />
        <CaptureController request={captureRequest} format={captureFormat} />
      </Canvas>
      <div className="viewer-legend"><span>Click a surface to edit · drag elements to move</span><span>Drag orbit · wheel zoom · right-drag pan</span></div>
      {toolbarContextMenu && <ToolbarContextMenu x={toolbarContextMenu.x} y={toolbarContextMenu.y} toolbars={VIEWER_TOOLBARS} visibility={props.toolbarVisibility} onToggle={props.onToggleToolbar} onClose={() => setToolbarContextMenu(null)} />}
    </div>
  );
}
