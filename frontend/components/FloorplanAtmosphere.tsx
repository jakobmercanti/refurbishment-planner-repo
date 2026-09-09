import { useId } from "react";
import type { Point2D, Room } from "@/lib/types";
import { appearanceSeed, gardenClear, roomAppearances } from "@/lib/floorplanAppearance";
import { FlooringPatternDefinition } from "@/components/FlooringControls";

/** SVG-only materials and planting, also embedded in offline image/PDF exports. */
export function FloorplanAtmosphere({ rooms, toScreen }: { rooms: Room[]; toScreen: (point: Point2D) => Point2D }) {
  const prefix = useId().replace(/[^a-zA-Z0-9]/g, "");
  const polygons = rooms.map((room) => room.vertices.map(toScreen));
  const points = polygons.flat();
  const grassBounds = { x: Math.min(0, ...points.map((p) => p.x)) - 100, y: Math.min(0, ...points.map((p) => p.y)) - 100,
    width: Math.max(820, ...points.map((p) => p.x)) - Math.min(0, ...points.map((p) => p.x)) + 200,
    height: Math.max(560, ...points.map((p) => p.y)) - Math.min(0, ...points.map((p) => p.y)) + 200 };
  const scale = Math.abs(toScreen({ x: 1, y: 0 }).x - toScreen({ x: 0, y: 0 }).x);
  const plants: { x: number; y: number; radius: number; seed: number }[] = [];
  polygons.forEach((polygon, ri) => polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!length) return;
    const count = Math.min(48, Math.max(1, Math.floor(length / 18)));
    for (let j = 0; j < count; j++) {
      if (plants.length >= 260) break;
      const seed = appearanceSeed(`${rooms[ri].id}:${i}:${j}`);
      const radius = 8 + seed % 17;
      const along = (j + .25 + (seed % 100) / 200) / count;
      const setback = radius + 9 + seed % 13;
      for (const side of [-1, 1]) {
        const x = a.x + (b.x - a.x) * along - side * (b.y - a.y) / length * setback;
        const y = a.y + (b.y - a.y) * along + side * (b.x - a.x) / length * setback;
        if (gardenClear({ x, y }, radius + 5, polygons) && plants.every((p) => Math.hypot(p.x - x, p.y - y) > (p.radius + radius) * .35)) plants.push({ x, y, radius, seed });
      }
    }
  }));
  return <g pointerEvents="none" aria-hidden="true">
    <defs>
      <filter id={`${prefix}-grass-blur`} filterUnits="userSpaceOnUse" {...grassBounds}><feGaussianBlur stdDeviation="16" /></filter>
      <mask id={`${prefix}-exterior`} maskUnits="userSpaceOnUse" {...grassBounds}>
        <rect {...grassBounds} fill="white" />
        {polygons.map((polygon, i) => <polygon key={i} points={polygon.map((p) => `${p.x},${p.y}`).join(" ")} fill="black" stroke="black" strokeWidth="6" />)}
      </mask>
      <filter id={`${prefix}-paint`} x="-25%" y="-25%" width="150%" height="150%"><feTurbulence type="fractalNoise" baseFrequency=".08" numOctaves="3" seed="17" result="noise" /><feDisplacementMap in="SourceGraphic" in2="noise" scale="3" /></filter>
      <radialGradient id={`${prefix}-wash`}><stop stopColor="#fff" stopOpacity=".16" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
    </defs>
    <g className="creative-garden" style={{ display: "none" }}>
      <g className="creative-grass" mask={`url(#${prefix}-exterior)`} opacity=".48">
        <g filter={`url(#${prefix}-grass-blur)`} fill="#a3bb85" stroke="#a3bb85" strokeWidth="24" strokeLinejoin="round">
          {polygons.map((polygon, i) => <polygon key={i} points={polygon.map((p) => `${p.x},${p.y}`).join(" ")} />)}
        </g>
      </g>
      {plants.map((p, i) => <g key={i} filter={`url(#${prefix}-paint)`}>
        <circle cx={p.x + 2} cy={p.y + 3} r={p.radius} fill="#718267" opacity=".1" />
        {Array.from({ length: 26 }, (_, j) => {
          const angle = j * 2.399 + p.seed;
          const spread = p.radius * .7 * Math.sqrt(j / 25);
          return <circle key={j} cx={p.x + Math.cos(angle) * spread} cy={p.y + Math.sin(angle) * spread} r={p.radius * (.12 + j % 4 * .065)} fill={["#729773", "#a3b785", "#557e67", "#c8cf97"][j % 4]} opacity=".48" />;
        })}
      </g>)}
    </g>
    <g className="styled-room-floors" style={{ display: "none" }}>
      {roomAppearances(rooms).map((appearance, index) => {
        const { base, accent, grout, pattern } = appearance;
        const id = `${prefix}-floor-${index}`;
        const size = Math.max(3, (pattern === "SQUARE_300" ? 300 : pattern === "WOOD" ? 1000 : 600) * scale);
        const points = polygons[index].map((p) => `${p.x},${p.y}`).join(" ");
        if (appearance.room.finishes?.floor_design) return <g key={appearance.room.id}>
          <defs><FlooringPatternDefinition id={id} design={appearance.room.finishes.floor_design} scale={scale} origin={toScreen({ x: 0, y: 0 })} flipY={toScreen({ x: 0, y: 1 }).y < toScreen({ x: 0, y: 0 }).y} /></defs>
          <polygon points={points} fill={`url(#${id})`} />
          <polygon className="creative-floor-wash" style={{ display: "none" }} points={points} fill="#fffaf0" opacity=".19" />
        </g>;
        return <g key={appearance.room.id}>
          <defs><pattern id={id} patternUnits="userSpaceOnUse" width={size} height={pattern === "WOOD" ? size / 4 : size}>
            <rect width={size} height={size} fill={base} />
            {pattern === "WOOD" ? <><path d={`M0 0H${size} M${size * .6} 0v${size / 4}`} stroke="#917d5d" strokeWidth=".45" opacity=".3" /><path d={`M0 ${size * .1} Q${size / 2} ${size * .06} ${size} ${size * .12}`} fill="none" stroke="#fff" opacity=".28" /></> : pattern === "CHECKERBOARD" ? <path d={`M0 0h${size / 2}v${size / 2}H0z M${size / 2} ${size / 2}h${size / 2}v${size / 2}H${size / 2}z`} fill={accent} /> : pattern === "MARBLE" ? <path d={`M0 ${size * .8}Q${size / 2} ${size / 2} ${size} 0 M0 ${size}Q${size / 2} ${size * .2} ${size} ${size * .3}`} fill="none" stroke={accent === base ? "#aaa9a3" : accent} strokeWidth=".65" opacity=".45" /> : pattern === "TERRAZZO" ? Array.from({ length: 12 }, (_, j) => <circle key={j} cx={(j * 17 % 31) / 31 * size} cy={(j * 11 % 29) / 29 * size} r={size * .028} fill={j % 2 ? accent : grout} opacity=".65" />) : pattern !== "NONE" ? <path d={pattern === "DIAMOND" || pattern === "HEXAGON" ? `M${size / 2} 0L${size} ${size / 2} ${size / 2} ${size} 0 ${size / 2}Z` : pattern === "HERRINGBONE" ? `M0 0L${size / 2} ${size / 2} 0 ${size} M${size / 2} 0L${size} ${size / 2} ${size / 2} ${size}` : `M0 ${size}V0H${size}${pattern === "KITKAT" ? ` M${size / 3} 0V${size} M${size * 2 / 3} 0V${size}` : ""}`} fill="none" stroke={grout} strokeWidth=".65" /> : null}
          </pattern><clipPath id={`${id}-clip`}><polygon points={points} /></clipPath></defs>
          <polygon points={points} fill={`url(#${id})`} />
          <g className="creative-floor-wash" style={{ display: "none" }} clipPath={`url(#${id}-clip)`}>
            <polygon points={points} fill="#fffaf0" opacity=".19" />
            {polygons[index].map((p, j) => <circle key={j} cx={p.x} cy={p.y} r={size * 4} fill={`url(#${prefix}-wash)`} />)}
          </g>
        </g>;
      })}
    </g>
  </g>;
}
