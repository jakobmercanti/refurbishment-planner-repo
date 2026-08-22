"use client";

import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { fixtureKindForObstacle } from "@/lib/fixtureCatalog";
import type { Obstacle, Opening, Point2D, Room } from "@/lib/types";

const SCALE = 0.001;

interface Toggles {
  walls: boolean;
  elements: boolean;
  doorSwings: boolean;
  collisions: boolean;
}

interface ViewerProps {
  room: Room;
  collisionIds: string[];
}

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
    >
      <extrudeGeometry args={[shape, { depth: height * SCALE, bevelEnabled: false }]} />
      <meshStandardMaterial color="#d9d4c8" roughness={0.82} side={THREE.DoubleSide} />
    </mesh>
  );
}

function WallWithOpenings({
  index,
  room,
  start,
  end,
}: {
  index: number;
  room: Room;
  start: Point2D;
  end: Point2D;
}) {
  const vector = wallVector(start, end);
  const outerStart = exteriorCorner(room.vertices, index, room.wall_thickness.value);
  const outerEnd = exteriorCorner(room.vertices, (index + 1) % room.vertices.length, room.wall_thickness.value);
  const wallId = `wall-${String(index + 1).padStart(3, "0")}`;
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
    />,
  );
  return <>{pieces}</>;
}

function Floor({ vertices }: { vertices: Point2D[] }) {
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
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial color="#ece9e1" roughness={0.94} side={THREE.DoubleSide} />
    </mesh>
  );
}

function FixtureMesh({ obstacle }: { obstacle: Obstacle }) {
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

  if (fixtureKind === "SHOWER") {
    return (
      <group position={position} rotation={rotation}>
        <mesh position={[0, 0.025, 0]} castShadow receiveShadow>
          <boxGeometry args={[width, 0.05, depth]} />
          <meshStandardMaterial color="#f7f8f6" roughness={0.65} />
        </mesh>
        <mesh position={[0, height / 2, 0]} castShadow>
          <boxGeometry args={[width, height, depth]} />
          <meshStandardMaterial color="#73bdd0" transparent opacity={0.2} roughness={0.12} metalness={0.08} depthWrite={false} />
        </mesh>
        <mesh position={[0, height - 0.018, 0]}>
          <boxGeometry args={[width + 0.025, 0.036, depth + 0.025]} />
          <meshStandardMaterial color="#496a70" metalness={0.65} roughness={0.28} />
        </mesh>
      </group>
    );
  }

  if (fixtureKind === "BASIN") {
    return (
      <group position={position} rotation={rotation}>
        <mesh position={[0, height * 0.42, 0]} castShadow>
          <boxGeometry args={[width * 0.72, height * 0.82, depth * 0.62]} />
          <meshStandardMaterial color="#d8d4ca" roughness={0.68} />
        </mesh>
        <mesh position={[0, height * 0.92, 0.02]} scale={[width, height * 0.16, depth]} castShadow>
          <sphereGeometry args={[0.5, 32, 16]} />
          <meshStandardMaterial color="#fbfbf8" roughness={0.25} />
        </mesh>
      </group>
    );
  }

  if (fixtureKind === "TOILET") {
    return (
      <group position={position} rotation={rotation}>
        <mesh position={[0, height * 0.34, depth * 0.1]} scale={[width, height * 0.5, depth * 0.72]} castShadow>
          <sphereGeometry args={[0.5, 32, 18]} />
          <meshStandardMaterial color="#f7f7f3" roughness={0.3} />
        </mesh>
        <mesh position={[0, height * 0.7, -depth * 0.34]} castShadow>
          <boxGeometry args={[width * 0.82, height * 0.56, depth * 0.3]} />
          <meshStandardMaterial color="#f7f7f3" roughness={0.32} />
        </mesh>
      </group>
    );
  }

  if (fixtureKind === "FURNITURE") {
    const isBench = obstacle.model_id?.includes("bench");
    return (
      <group position={position} rotation={rotation}>
        <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[width, height, depth]} />
          <meshStandardMaterial color={isBench ? "#a88762" : "#b99b77"} roughness={0.72} />
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

function CameraPreset({ preset }: { preset: "perspective" | "top" }) {
  const { camera } = useThree();
  useEffect(() => {
    if (preset === "top") camera.position.set(1.6, 6.4, -1.4);
    else camera.position.set(4.6, 4.1, 4.8);
    camera.lookAt(1.6, 0, -1.4);
    camera.updateProjectionMatrix();
  }, [camera, preset]);
  return null;
}

function Scene({ room, collisionIds, toggles, preset }: ViewerProps & { toggles: Toggles; preset: "perspective" | "top" }) {
  return (
    <>
      <CameraPreset preset={preset} />
      <ambientLight intensity={1.3} />
      <directionalLight position={[4, 7, 3]} intensity={2.2} castShadow />
      <Floor vertices={room.vertices} />
      {toggles.walls && room.vertices.map((start, index) => (
        <WallWithOpenings
          key={`wall-${index}`}
          index={index}
          room={room}
          start={start}
          end={room.vertices[(index + 1) % room.vertices.length]}
        />
      ))}
      {toggles.elements && room.obstacles.map((obstacle) => <FixtureMesh key={obstacle.id} obstacle={obstacle} />)}
      {toggles.doorSwings && room.openings.filter((item) => item.kind === "DOOR").map((door) => (
        <DoorSwing key={door.id} room={room} door={door} />
      ))}
      {toggles.collisions && room.obstacles.filter((item) => collisionIds.includes(item.id)).map((obstacle) => (
        <mesh key={`collision-${obstacle.id}`} position={[obstacle.center.x * SCALE, 0.9, -obstacle.center.y * SCALE]}>
          <sphereGeometry args={[0.11, 24, 24]} />
          <meshStandardMaterial color="#ff2d2d" emissive="#ff2d2d" emissiveIntensity={1.2} />
        </mesh>
      ))}
      <Grid position={[1.6, -0.002, -1.4]} args={[8, 8]} cellSize={0.1} cellThickness={0.4} cellColor="#a9b1ac" sectionSize={1} sectionColor="#65706a" fadeDistance={9} />
      <OrbitControls makeDefault enableDamping />
    </>
  );
}

export function EngineeringViewer(props: ViewerProps) {
  const [preset, setPreset] = useState<"perspective" | "top">("perspective");
  const [toggles, setToggles] = useState<Toggles>({
    walls: true,
    elements: true,
    doorSwings: true,
    collisions: true,
  });
  const flip = (key: keyof Toggles) => setToggles((current) => ({ ...current, [key]: !current[key] }));
  return (
    <div className="viewer-shell">
      <div className="viewer-toolbar" aria-label="3D viewer controls">
        <div className="segmented">
          <button className={preset === "perspective" ? "active" : ""} onClick={() => setPreset("perspective")}>Perspective</button>
          <button className={preset === "top" ? "active" : ""} onClick={() => setPreset("top")}>Top</button>
        </div>
        <div className="toggle-row">
          {(Object.keys(toggles) as Array<keyof Toggles>).map((key) => (
            <button key={key} className={toggles[key] ? "active" : ""} onClick={() => flip(key)} aria-pressed={toggles[key]}>
              {key === "doorSwings" ? "door swings" : key}
            </button>
          ))}
        </div>
      </div>
      <Canvas shadows camera={{ position: [4.6, 4.1, 4.8], fov: 38, near: 0.01, far: 100 }}>
        <Scene {...props} toggles={toggles} preset={preset} />
      </Canvas>
      <div className="viewer-legend"><span>1 scene unit = 1000 mm</span><span>Drag orbit · wheel zoom · right-drag pan</span></div>
    </div>
  );
}
