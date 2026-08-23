"use client";

import { Grid, Line, OrbitControls, RoundedBox } from "@react-three/drei";
import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { fixtureKindForObstacle } from "@/lib/fixtureCatalog";
import { alignObstacleToNearestWall } from "@/lib/layoutInteraction";
import type { Obstacle, Opening, PersonMockup, Point2D, Room, RoomFinishes, TilePattern } from "@/lib/types";

const SCALE = 0.001;

interface Toggles {
  walls: boolean;
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
}

type Selection = { type: "ELEMENT"; id: string } | { type: "PERSON" } | { type: "WALL"; id: string } | { type: "FLOOR" } | null;

const WALL_COLOURS = [
  "#f6f3eb", "#e8e1d5", "#d4cabd", "#f0d7c8", "#d8b8a8", "#e1d2a6",
  "#c9d8c6", "#9db7a7", "#c3d5df", "#8eabc0", "#bbb2c9", "#5c6862",
];

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
  selected: boolean;
  onSelect: () => void;
}) {
  if (length <= 0 || height <= 0) return null;
  const vector = wallVector(start, end);
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
  return (
    <mesh
      position={[0, base * SCALE, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      castShadow
      receiveShadow
      onPointerDown={(event) => { event.stopPropagation(); onSelect(); }}
    >
      <extrudeGeometry args={[shape, { depth: height * SCALE, bevelEnabled: false }]} />
      <meshStandardMaterial color={colour} roughness={0.76} side={THREE.DoubleSide} emissive={selected ? "#b76d16" : "#000000"} emissiveIntensity={selected ? 0.18 : 0} />
    </mesh>
  );
}

function WallWithOpenings({
  index,
  room,
  start,
  end,
  selected,
  onSelect,
}: {
  index: number;
  room: Room;
  start: Point2D;
  end: Point2D;
  selected: boolean;
  onSelect: () => void;
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
      selected={selected}
      onSelect={onSelect}
    />,
  );
  return <>{pieces}</>;
}

function tileTexture(style: TileStyle) {
  const size = 128;
  const base = new THREE.Color(style.base);
  const accent = new THREE.Color(style.accent);
  const grout = new THREE.Color(style.grout);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let source = base;
      const gridLine = x < 2 || y < 2;
      if (style.pattern === "CHECKERBOARD") source = (Math.floor(x / 32) + Math.floor(y / 32)) % 2 ? accent : base;
      else if (style.pattern === "HERRINGBONE") {
        const line = ((x + y) % 32 < 3) || ((x - y + size) % 32 < 3);
        source = line ? grout : ((Math.floor((x + y) / 32) % 2) ? accent : base);
      } else if (style.pattern === "DIAMOND") {
        const diamond = (Math.abs((x % 64) - 32) + Math.abs((y % 64) - 32)) < 22;
        const edge = Math.abs((Math.abs((x % 64) - 32) + Math.abs((y % 64) - 32)) - 22) < 2;
        source = edge ? grout : diamond ? accent : base;
      } else if (style.pattern === "KITKAT") {
        const line = x % 16 < 2 || y % 64 < 2;
        source = line ? grout : Math.floor(x / 16) % 2 ? accent : base;
      } else if (style.pattern === "TERRAZZO") {
        const hash = (x * 37 + y * 61 + x * y * 3) % 211;
        source = hash < 5 ? accent : hash > 203 ? grout : base;
      } else if (style.pattern === "HEXAGON") {
        const row = Math.floor(y / 28);
        const shiftedX = (x + (row % 2) * 20) % 40;
        const localY = y % 28;
        const edge = localY < 2 || Math.abs(shiftedX - 20) + localY < 4 || Math.abs(shiftedX - 20) + (28 - localY) < 4;
        source = edge ? grout : ((Math.floor(x / 40) + row) % 2 ? accent : base);
      } else if (style.pattern === "MARBLE") {
        const vein = Math.abs(Math.sin((x + y * 0.37) / 11) + Math.sin(y / 23) * 0.35) > 1.18;
        source = vein ? accent : gridLine ? grout : base;
      } else source = gridLine ? grout : base;
      const offset = (y * size + x) * 4;
      data[offset] = Math.round(source.r * 255);
      data[offset + 1] = Math.round(source.g * 255);
      data[offset + 2] = Math.round(source.b * 255);
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  const repeatsPerMetre = 1000 / style.tileSize;
  texture.repeat.set(repeatsPerMetre, repeatsPerMetre);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
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
  const texture = useMemo(() => tile ? tileTexture(tile) : null, [tile]);
  useEffect(() => () => texture?.dispose(), [texture]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow onPointerDown={(event) => { event.stopPropagation(); onSelect(); }}>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial color={texture ? "#ffffff" : colour} map={texture} roughness={0.78} side={THREE.DoubleSide} emissive={selected ? "#b76d16" : "#000000"} emissiveIntensity={selected ? 0.12 : 0} />
    </mesh>
  );
}

function TapAssembly({ height, depth }: { height: number; depth: number }) {
  const baseY = height * 0.86;
  const baseZ = -depth * 0.24;
  const curve = useMemo(() => new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, baseY, baseZ),
    new THREE.Vector3(0, baseY + 0.1, baseZ),
    new THREE.Vector3(0, baseY + 0.16, baseZ + 0.04),
    new THREE.Vector3(0, baseY + 0.15, baseZ + 0.12),
    new THREE.Vector3(0, baseY + 0.11, baseZ + 0.16),
  ]), [baseY, baseZ]);
  const chrome = <meshStandardMaterial color="#c8d0ce" metalness={0.9} roughness={0.14} />;
  return <group>
    <mesh position={[0, baseY + 0.005, baseZ]} castShadow><cylinderGeometry args={[0.034, 0.042, 0.02, 24]} />{chrome}</mesh>
    <mesh castShadow><tubeGeometry args={[curve, 36, 0.015, 12, false]} />{chrome}</mesh>
    <mesh position={[0, baseY + 0.106, baseZ + 0.166]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.016, 0.016, 0.055, 16]} />{chrome}</mesh>
    <group position={[0.052, baseY + 0.035, baseZ]} rotation={[0, 0, -0.22]}>
      <mesh castShadow><cylinderGeometry args={[0.012, 0.014, 0.065, 14]} />{chrome}</mesh>
      <mesh position={[0, 0.045, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.009, 0.009, 0.055, 12]} />{chrome}</mesh>
    </group>
  </group>;
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
  const shoulderY = standing ? height * 0.73 : headY - headRadius * 1.75;
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
      <mesh position={[0, headY - headRadius * 1.18, shoulderZ * 0.9]} castShadow><cylinderGeometry args={[headRadius * 0.42, headRadius * 0.48, headRadius * 0.7, 18]} /><meshStandardMaterial color={skin} roughness={0.64} /></mesh>
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
      {[ankleLeft, ankleRight].map((ankle, index) => <RoundedBox key={`foot-${index}`} args={[width * 0.22, height * 0.045, depth * 0.72]} radius={0.025} smoothness={3} position={[ankle[0], height * 0.025, ankle[2] + depth * 0.25]} castShadow><meshStandardMaterial color={shoe} roughness={0.82} /></RoundedBox>)}
      <mesh position={[0, 0.023, depth * 0.7]} rotation={[-Math.PI / 2, 0, 0]}><coneGeometry args={[0.06, 0.16, 3]} /><meshStandardMaterial color="#e2a73a" emissive="#e2a73a" emissiveIntensity={0.25} /></mesh>
    </group>
  );
}

function eyeTarget(person: PersonMockup) {
  const angle = THREE.MathUtils.degToRad(person.rotation_deg);
  return new THREE.Vector3(person.center.x * SCALE + Math.sin(angle) * 2, person.eye_height_mm * SCALE, -person.center.y * SCALE + Math.cos(angle) * 2);
}

function CameraPreset({ preset, person }: { preset: CameraView; person?: PersonMockup | null }) {
  const { camera } = useThree();
  useEffect(() => {
    if (preset === "eye" && person?.enabled) {
      camera.position.set(person.center.x * SCALE, person.eye_height_mm * SCALE, -person.center.y * SCALE);
      camera.lookAt(eyeTarget(person));
    } else {
      if (preset === "top") camera.position.set(1.6, 6.4, -1.4);
      else camera.position.set(4.6, 4.1, 4.8);
      camera.lookAt(1.6, 0, -1.4);
    }
    camera.updateProjectionMatrix();
  }, [camera, person, preset]);
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

function Scene({ room, collisionIds, onObstaclesChange, onPersonChange, toggles, preset, selection, onSelectionChange }: ViewerProps & {
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
  const orbitTarget: [number, number, number] = preset === "eye" && room.person_mockup?.enabled
    ? eyeTarget(room.person_mockup).toArray()
    : [1.6, 0, -1.4];

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
    setPreviewPerson({ ...person, center: { x: point.x + personDragging.offset.x, y: point.y + personDragging.offset.y } });
  }

  function endPersonDrag(event: ThreeEvent<PointerEvent>, person: PersonMockup) {
    if (!personDragging) return;
    event.stopPropagation();
    onPersonChange(previewPerson ?? person);
    setPreviewPerson(null);
    setPersonDragging(null);
  }

  return (
    <>
      <CameraPreset preset={preset} person={room.person_mockup} />
      <ambientLight intensity={1.3} />
      <directionalLight position={[4, 7, 3]} intensity={2.2} castShadow />
      <Floor room={room} selected={selection?.type === "FLOOR"} onSelect={() => onSelectionChange({ type: "FLOOR" })} />
      {toggles.walls && room.vertices.map((start, index) => (
        <WallWithOpenings
          key={`wall-${index}`}
          index={index}
          room={room}
          start={start}
          end={room.vertices[(index + 1) % room.vertices.length]}
          selected={selection?.type === "WALL" && selection.id === `wall-${String(index + 1).padStart(3, "0")}`}
          onSelect={() => onSelectionChange({ type: "WALL", id: `wall-${String(index + 1).padStart(3, "0")}` })}
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
      <OrbitControls makeDefault enableDamping enabled={!dragging && !personDragging} target={orbitTarget} />
    </>
  );
}

function ContextControls({ room, selection, onObstaclesChange, onFinishesChange }: Pick<ViewerProps, "room" | "onObstaclesChange" | "onFinishesChange"> & { selection: Selection }) {
  const [applyToAllWalls, setApplyToAllWalls] = useState(false);
  if (!selection) return null;
  const finishes = room.finishes ?? {};
  const selectedElement = selection.type === "ELEMENT" ? room.obstacles.find((item) => item.id === selection.id) : undefined;

  function setWallColour(colour?: string) {
    if (selection?.type !== "WALL") return;
    const wallColors = { ...(finishes.wall_colors ?? {}) };
    const wallIds = applyToAllWalls
      ? room.vertices.map((_item, index) => `wall-${String(index + 1).padStart(3, "0")}`)
      : [selection.id];
    wallIds.forEach((wallId) => {
      if (colour) wallColors[wallId] = colour;
      else delete wallColors[wallId];
    });
    onFinishesChange({ ...finishes, wall_colors: wallColors });
  }

  function setFloorTile(tileId?: string) {
    onFinishesChange({ ...finishes, floor_tile_id: tileId, floor_color: undefined, floor_pattern: "NONE" });
  }

  function setWallLock(locked: boolean) {
    if (!selectedElement) return;
    const unlocked = { ...selectedElement, wall_lock: locked };
    const updated = locked ? alignObstacleToNearestWall(unlocked, room.vertices, unlocked.center) : unlocked;
    onObstaclesChange(room.obstacles.map((item) => item.id === selectedElement.id ? updated : item));
  }

  return (
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
        <p>Drag the body across the floor to reposition it. Use Tools → Human mock-up panel for rotation, posture and clearance settings.</p>
      </>}
      {selection.type === "WALL" && <>
        <span className="eyebrow">Selected internal wall</span>
        <strong>{selection.id.replace("wall-", "Wall ")}</strong>
        <label className="paint-all-choice"><input type="checkbox" checked={applyToAllWalls} onChange={(event) => setApplyToAllWalls(event.target.checked)} /><span>Paint all walls together</span></label>
        <div className="finish-palette wall-palette">{WALL_COLOURS.map((colour) => <button key={colour} type="button" aria-label={`Set wall colour ${colour}`} className={finishes.wall_colors?.[selection.id] === colour ? "selected" : ""} style={{ background: colour }} onClick={() => setWallColour(colour)} />)}</div>
        <button className="remove-finish" type="button" onClick={() => setWallColour()}>Remove colour</button>
      </>}
      {selection.type === "FLOOR" && <>
        <span className="eyebrow">Selected floor</span>
        <strong>Floor tile collection</strong>
        <div className="tile-collection">{TILE_COLLECTION.map((tile) => <button key={tile.id} type="button" className={finishes.floor_tile_id === tile.id ? "selected" : ""} onClick={() => setFloorTile(tile.id)}><span className="tile-swatch" style={{ background: tile.preview }} /><small>{tile.name}</small></button>)}</div>
        <button className="remove-finish" type="button" onClick={() => setFloorTile()}>Remove floor finish</button>
      </>}
    </aside>
  );
}

export function EngineeringViewer(props: ViewerProps) {
  const [preset, setPreset] = useState<CameraView>("perspective");
  const [captureRequest, setCaptureRequest] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [toggles, setToggles] = useState<Toggles>({
    walls: true,
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
