"use client";

import { Grid, Line, OrbitControls, RoundedBox } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { DULUX_PAINT_FAMILIES, DULUX_PALETTE_SOURCE, type DuluxPaintShade } from "@/lib/duluxPalette";
import { fixtureKindForObstacle } from "@/lib/fixtureCatalog";
import { alignObstacleToNearestWall, constrainPersonToRoom } from "@/lib/layoutInteraction";
import type { Obstacle, Opening, PersonMockup, Point2D, Room, RoomFinishes, TilePattern, WallViewMode } from "@/lib/types";

const SCALE = 0.001;
const DISABLED_MESH_RAYCAST: THREE.Mesh["raycast"] = () => undefined;

interface Toggles {
  elements: boolean;
  doorSwings: boolean;
  collisions: boolean;
  person: boolean;
  clearance: boolean;
}

type CameraView = "perspective" | "top" | "eye";

interface ViewerProps {
  room: Room;
  collisionIds: string[];
  onObstaclesChange: (obstacles: Obstacle[]) => void;
  onFinishesChange: (finishes: RoomFinishes) => void;
  onPersonChange: (person: PersonMockup | null) => void;
  wallMode: WallViewMode;
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

function exteriorCorner(vertices: Point2D[], index: number, thickness: number): Point2D {
  const vertex = vertices[index];
  const previous = vertices[(index - 1 + vertices.length) % vertices.length];
  const next = vertices[(index + 1) % vertices.length];
  const incoming = wallVector(previous, vertex);
  const outgoing = wallVector(vertex, next);
  const previousOffset = { x: vertex.x + incoming.dy * thickness, y: vertex.y - incoming.dx * thickness };
  const nextOffset = { x: vertex.x + outgoing.dy * thickness, y: vertex.y - outgoing.dx * thickness };
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
  if (Math.hypot(corner.x - vertex.x, corner.y - vertex.y) > thickness * 4) {
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
        castShadow
        receiveShadow
        onPointerDown={(event) => { event.stopPropagation(); onSelect(event.ctrlKey || event.metaKey); }}
      >
        <extrudeGeometry args={[shape, { depth: height * SCALE, bevelEnabled: false }]} />
        <meshStandardMaterial color="#d9d4c8" roughness={0.76} side={THREE.DoubleSide} transparent={wallMode === "TRANSPARENT"} opacity={wallMode === "TRANSPARENT" ? 0.2 : 1} depthWrite={wallMode !== "TRANSPARENT"} />
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
        <meshStandardMaterial color={colour} roughness={0.72} side={THREE.DoubleSide} transparent={wallMode === "TRANSPARENT"} opacity={wallMode === "TRANSPARENT" ? 0.28 : 1} depthWrite={wallMode !== "TRANSPARENT"} emissive={selected ? "#b76d16" : "#000000"} emissiveIntensity={selected ? 0.18 : 0} />
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
  const outerStart = exteriorCorner(room.vertices, index, room.wall_thickness.value);
  const outerEnd = exteriorCorner(room.vertices, (index + 1) % room.vertices.length, room.wall_thickness.value);
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
        thickness={room.wall_thickness.value}
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
          thickness={room.wall_thickness.value}
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
        thickness={room.wall_thickness.value}
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
      thickness={room.wall_thickness.value}
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
  const savedColours = tile ? room.finishes?.floor_tile_colours?.[tile.id] : undefined;
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
  const neckBottom = shoulderY - headRadius * 0.04;
  const neckTop = headY - headRadius * 0.92;
  const neckHeight = Math.max(neckTop - neckBottom, headRadius * 0.34);

  return (
    <group position={[person.center.x * SCALE, 0, -person.center.y * SCALE]} rotation={[0, THREE.MathUtils.degToRad(person.rotation_deg), 0]} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      {showClearance && <>
        <RoundedBox args={[clearanceWidth, 0.012, clearanceDepth]} radius={Math.min(clearance, 0.18)} smoothness={4} position={[0, 0.009, 0]}>
          <meshBasicMaterial color={collision ? "#e04545" : "#e2a73a"} transparent opacity={0.18} depthWrite={false} />
        </RoundedBox>
        <Line points={clearancePoints} color={collision ? "#d63737" : "#bd7611"} lineWidth={1.6} dashed dashSize={0.07} gapSize={0.04} />
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

function CameraPreset({ preset, person, target }: { preset: CameraView; person?: PersonMockup | null; target: VectorTuple }) {
  const { camera } = useThree();
  const previousView = useRef<string | null>(null);
  useEffect(() => {
    const viewKey = `${preset}:${target.join(":")}`;
    if (previousView.current === viewKey) return;
    previousView.current = viewKey;
    if (preset === "eye" && person?.enabled) {
      camera.up.set(0, 1, 0);
      camera.position.set(person.center.x * SCALE, person.eye_height_mm * SCALE, -person.center.y * SCALE);
      camera.lookAt(eyeTarget(person));
    } else {
      if (preset === "top") {
        camera.up.set(0, 0, -1);
        camera.position.set(target[0], 6.4, target[2]);
      } else {
        camera.up.set(0, 1, 0);
        camera.position.set(target[0] + 3, 4.1, target[2] + 3.4);
      }
      camera.lookAt(...target);
    }
    camera.updateProjectionMatrix();
  }, [camera, person, preset, target]);
  return null;
}

function CaptureController({ request }: { request: number }) {
  const { camera, gl, scene } = useThree();
  useEffect(() => {
    if (request === 0) return;
    gl.render(scene, camera);
    gl.domElement.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `bathroom-eye-view-${request}.png`;
      link.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }, [camera, gl, request, scene]);
  return null;
}

function Scene({ room, collisionIds, onObstaclesChange, onPersonChange, wallMode, toggles, preset, selection, onSelectionChange }: ViewerProps & {
  toggles: Toggles;
  preset: CameraView;
  selection: Selection;
  onSelectionChange: (selection: Selection) => void;
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
    return [(minX + maxX) * SCALE / 2, 0, -(minY + maxY) * SCALE / 2];
  }, [room.vertices]);
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
      <CameraPreset preset={preset} person={room.person_mockup} target={roomTarget} />
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
      {toggles.doorSwings && room.openings.filter((item) => item.kind === "DOOR").map((door) => (
        <DoorSwing key={door.id} room={room} door={door} />
      ))}
      {toggles.person && displayedPerson?.enabled && <PersonMesh person={displayedPerson} showClearance={toggles.clearance} collision={collisionIds.includes(displayedPerson.id)} selected={selection?.type === "PERSON"} onPointerDown={(event) => startPersonDrag(event, displayedPerson)} onPointerMove={(event) => movePersonDrag(event, displayedPerson)} onPointerUp={(event) => endPersonDrag(event, displayedPerson)} />}
      {toggles.collisions && room.obstacles.filter((item) => collisionIds.includes(item.id)).map((obstacle) => (
        <mesh key={`collision-${obstacle.id}`} position={[obstacle.center.x * SCALE, 0.9, -obstacle.center.y * SCALE]}>
          <sphereGeometry args={[0.11, 24, 24]} />
          <meshStandardMaterial color="#ff2d2d" emissive="#ff2d2d" emissiveIntensity={1.2} />
        </mesh>
      ))}
      <Grid position={[1.6, -0.002, -1.4]} args={[8, 8]} cellSize={0.1} cellThickness={0.4} cellColor="#a9b1ac" sectionSize={1} sectionColor="#65706a" fadeDistance={9} />
      <OrbitControls makeDefault enableDamping enableRotate={preset !== "top"} enabled={!dragging && !personDragging} target={orbitTarget} />
    </>
  );
}

function ContextControls({ room, selection, onObstaclesChange, onFinishesChange }: Pick<ViewerProps, "room" | "onObstaclesChange" | "onFinishesChange"> & { selection: Selection }) {
  const [applyToAllWalls, setApplyToAllWalls] = useState(false);
  const [paintFamilyId, setPaintFamilyId] = useState("WHITE");
  const [paintSearch, setPaintSearch] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  const panelActionRef = useRef<{ mode: "MOVE" | "HEIGHT"; pointerX: number; pointerY: number; left: number; top: number; width: number; height: number; parentWidth: number; parentHeight: number } | null>(null);
  const [panelBox, setPanelBox] = useState<{ left: number | null; top: number | null; width: number; height: number | null }>({ left: null, top: null, width: 460, height: null });
  if (!selection) return null;
  const finishes = room.finishes ?? {};
  const selectedElement = selection.type === "ELEMENT" ? room.obstacles.find((item) => item.id === selection.id) : undefined;
  const paintFamily = DULUX_PAINT_FAMILIES.find((family) => family.id === paintFamilyId) ?? DULUX_PAINT_FAMILIES[0];
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

  function setFloorTile(tileId?: string) {
    onFinishesChange({ ...finishes, floor_tile_id: tileId, floor_color: undefined, floor_pattern: "NONE" });
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

  function startPanelAction(mode: "MOVE" | "HEIGHT", event: ReactPointerEvent<HTMLButtonElement>) {
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!panel || !parent) return;
    const rect = panel.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    panelActionRef.current = { mode, pointerX: event.clientX, pointerY: event.clientY, left: rect.left - parentRect.left, top: rect.top - parentRect.top, width: rect.width, height: rect.height, parentWidth: parentRect.width, parentHeight: parentRect.height };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function movePanelAction(mode: "MOVE" | "HEIGHT", event: ReactPointerEvent<HTMLButtonElement>) {
    const action = panelActionRef.current;
    if (!action || action.mode !== mode) return;
    const deltaX = event.clientX - action.pointerX;
    const deltaY = event.clientY - action.pointerY;
    if (mode === "MOVE") {
      const width = panelBox.width;
      const height = panelBox.height ?? action.height;
      setPanelBox({ left: Math.max(12, Math.min(action.parentWidth - width - 12, action.left + deltaX)), top: Math.max(12, Math.min(action.parentHeight - height - 12, action.top + deltaY)), width, height });
    } else {
      setPanelBox((current) => ({ ...current, height: Math.max(220, Math.min(action.parentHeight - action.top - 12, action.height + deltaY)) }));
    }
  }

  function endPanelAction(event: ReactPointerEvent<HTMLButtonElement>) {
    panelActionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const panelStyle: CSSProperties = {
    left: panelBox.left ?? undefined,
    top: panelBox.top ?? undefined,
    right: panelBox.left === null ? 12 : undefined,
    width: panelBox.width,
    height: panelBox.height ?? undefined,
  };

  return (
    <aside ref={panelRef} className="context-controls" aria-label="Selected object controls" style={panelStyle}>
      <button className="context-drag-handle" type="button" aria-label="Drag to move panel" title="Drag to move panel" onPointerDown={(event) => startPanelAction("MOVE", event)} onPointerMove={(event) => movePanelAction("MOVE", event)} onPointerUp={endPanelAction}>⠿</button>
      {selection.type === "ELEMENT" && selectedElement && <>
        <span className="eyebrow">Selected element</span>
        <strong>{selectedElement.name}</strong>
        <p>Drag the selected element across the floor to reposition it.</p>
        <label className="viewer-lock-choice"><input type="checkbox" checked={selectedElement.wall_lock ?? false} onChange={(event) => setWallLock(event.target.checked)} /><span>Keep adjacent to nearest wall</span></label>
      </>}
      {selection.type === "PERSON" && <>
        <span className="eyebrow">Selected human mock-up</span>
        <strong>Person usability model</strong>
        <p>Drag the body across the floor to reposition it. Use Tools → Human mock-up panel for rotation, posture and clearance settings.</p>
      </>}
      {selection.type === "WALL" && <>
        <span className="eyebrow">Selected internal {selection.ids.length === 1 ? "wall" : "walls"}</span>
        <strong>{selection.ids.length === 1 ? selection.id.replace("wall-", "Wall ") : `${selection.ids.length} walls selected`}</strong>
        <label className="paint-all-choice"><input type="checkbox" checked={applyToAllWalls} onChange={(event) => setApplyToAllWalls(event.target.checked)} /><span>Paint all walls together</span></label>
        <div className="paint-family-picker" role="tablist" aria-label="Dulux paint colour families">{DULUX_PAINT_FAMILIES.map((family) => <button key={family.id} type="button" role="tab" aria-selected={paintFamily.id === family.id} title={family.name} className={paintFamily.id === family.id ? "selected" : ""} onClick={() => { setPaintFamilyId(family.id); setPaintSearch(""); }}><span style={{ background: family.colour }} /><small>{family.name}</small></button>)}</div>
        <div className="paint-shade-panel">
          <div className="paint-shade-heading"><strong>{paintFamily.name}</strong><small>{paintFamily.shades.length} Dulux shades</small></div>
          <label className="paint-search"><span>Find a shade</span><input type="search" value={paintSearch} onChange={(event) => setPaintSearch(event.target.value)} placeholder="Colour name" /></label>
          <div className="paint-shades">{visiblePaintShades.map((shade) => {
            const active = selection.ids.every((wallId) => finishes.wall_colors?.[wallId] === shade.colour);
            return <button key={shade.id} type="button" title={shade.name} aria-label={`Paint selected walls Dulux ${shade.name}`} className={active ? "selected" : ""} onClick={() => setWallColour(shade)}><span className="paint-shade-swatch" style={{ background: shade.colour }} /><strong>{shade.name}</strong></button>;
          })}</div>
          {!visiblePaintShades.length && <p className="paint-empty">No shades match this search.</p>}
          <p className="paint-code-note">Dulux names and screen colours come from the <a href={DULUX_PALETTE_SOURCE} target="_blank" rel="noreferrer">Dulux UK catalogue</a>. Confirm with a physical sample before ordering.</p>
        </div>
        <button className="remove-finish" type="button" onClick={() => setWallColour()}>Remove colour</button>
      </>}
      {selection.type === "FLOOR" && <>
        <span className="eyebrow">Selected floor</span>
        <strong>Floor tile collection</strong>
        <div className="tile-collection">{TILE_COLLECTION.map((tile) => <button key={tile.id} type="button" className={finishes.floor_tile_id === tile.id ? "selected" : ""} onClick={() => setFloorTile(tile.id)}><span className="tile-swatch" style={{ background: tile.preview }} /><small>{tile.name}</small></button>)}</div>
        {(() => {
          const selectedTile = TILE_COLLECTION.find((tile) => tile.id === finishes.floor_tile_id);
          if (!selectedTile) return null;
          const current = finishes.floor_tile_colours?.[selectedTile.id] ?? { base: selectedTile.base, accent: selectedTile.accent, grout: selectedTile.grout };
          return <div className="tile-colour-editor"><strong>{selectedTile.name} colours</strong><div className="tile-palette-presets">{(TILE_PALETTES[selectedTile.pattern] ?? []).map((palette) => <button key={palette.name} type="button" title={palette.name} aria-label={`Use ${palette.name} colours`} style={{ background: `linear-gradient(135deg, ${palette.base} 0 45%, ${palette.grout} 45% 55%, ${palette.accent} 55% 100%)` }} onClick={() => setFloorColours(selectedTile.id, palette)} />)}</div><div className="tile-custom-colours"><label><span>Primary</span><input type="color" value={current.base} onChange={(event) => setFloorColours(selectedTile.id, { ...current, base: event.target.value })} /></label><label><span>Accent</span><input type="color" value={current.accent} onChange={(event) => setFloorColours(selectedTile.id, { ...current, accent: event.target.value })} /></label><label><span>Grout</span><input type="color" value={current.grout} onChange={(event) => setFloorColours(selectedTile.id, { ...current, grout: event.target.value })} /></label></div></div>;
        })()}
        <button className="remove-finish" type="button" onClick={() => setFloorTile()}>Remove floor finish</button>
      </>}
      <button className="context-resize-handle context-resize-height" type="button" aria-label="Drag to adjust panel height" title="Drag to adjust height" onPointerDown={(event) => startPanelAction("HEIGHT", event)} onPointerMove={(event) => movePanelAction("HEIGHT", event)} onPointerUp={endPanelAction} />
    </aside>
  );
}

export function EngineeringViewer(props: ViewerProps) {
  const [preset, setPreset] = useState<CameraView>("perspective");
  const [captureRequest, setCaptureRequest] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [toggles, setToggles] = useState<Toggles>({
    elements: true,
    doorSwings: true,
    collisions: true,
    person: true,
    clearance: true,
  });
  const flip = (key: keyof Toggles) => setToggles((current) => ({ ...current, [key]: !current[key] }));
  return (
    <div className="viewer-shell">
      <div className="viewer-toolbar" aria-label="3D viewer controls">
        <div className="segmented">
          <button className={preset === "perspective" ? "active" : ""} onClick={() => setPreset("perspective")}>Perspective</button>
          <button className={preset === "top" ? "active" : ""} onClick={() => setPreset("top")}>Top</button>
          {props.room.person_mockup?.enabled && <button className={preset === "eye" ? "active" : ""} onClick={() => setPreset("eye")}>Eye level</button>}
          {props.room.person_mockup?.enabled && preset === "eye" && <button onClick={() => setCaptureRequest(Date.now())}>Save PNG</button>}
        </div>
        <div className="toggle-row">
          {(Object.keys(toggles) as Array<keyof Toggles>).map((key) => (
            <button key={key} className={toggles[key] ? "active" : ""} onClick={() => flip(key)} aria-pressed={toggles[key]}>
              {key === "doorSwings" ? "door swings" : key}
            </button>
          ))}
        </div>
      </div>
      <ContextControls room={props.room} selection={selection} onObstaclesChange={props.onObstaclesChange} onFinishesChange={props.onFinishesChange} />
      <Canvas shadows gl={{ preserveDrawingBuffer: true }} camera={{ position: [4.6, 4.1, 4.8], fov: 38, near: 0.01, far: 100 }} onPointerMissed={() => setSelection(null)}>
        <Scene {...props} toggles={toggles} preset={preset} selection={selection} onSelectionChange={setSelection} />
        <CaptureController request={captureRequest} />
      </Canvas>
      <div className="viewer-legend"><span>Click a surface to edit · drag elements to move</span><span>Drag orbit · wheel zoom · right-drag pan</span></div>
    </div>
  );
}
