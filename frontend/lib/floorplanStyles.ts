export type FloorplanStyle = "DEFAULT" | "TRADITIONAL" | "MODERN" | "CREATIVE";

export const FLOORPLAN_STYLE_OPTIONS: ReadonlyArray<{ value: FloorplanStyle; label: string }> = [
  { value: "DEFAULT", label: "Default view" },
  { value: "TRADITIONAL", label: "Traditional style" },
  { value: "MODERN", label: "Modern style" },
  { value: "CREATIVE", label: "Creative style" },
];

export function floorplanStyleClass(style: FloorplanStyle): string {
  return style === "DEFAULT" ? "" : `${style.toLowerCase()}-floorplan`;
}

export function floorplanStyleLabel(style: FloorplanStyle): string {
  return FLOORPLAN_STYLE_OPTIONS.find((option) => option.value === style)?.label ?? "Default view";
}

/**
 * Shared style overrides for the live SVG and standalone export SVG.
 * The root of both SVGs receives the matching style class so a selected
 * style renders with the same colours, line weights, and symbols in either
 * mode.
 */
export function floorplanStyleCss(style: FloorplanStyle): string {
  const root = floorplanStyleClass(style);
  if (!root) return "";

  if (style === "TRADITIONAL") return `
.${root} .plan-grid{display:none}
.${root} .canvas-background{fill:#fff}
.${root} .wall-body,.${root} .wall-line,.${root} .opening-gap,.${root} .opening-jamb,.${root} .door-leaf,.${root} .door-swing,.${root} .window-frame,.${root} .window-core,.${root} .window-jamb{stroke:#151515}
.${root} .wall-line{stroke:#151515;stroke-width:var(--wall-inner-stroke-width,4px)}
.${root} .wall-thickness-label{fill:#151515}
.${root} .wall-line:hover,.${root} .wall-line.selected{stroke:#f1b14b;stroke-width:var(--wall-inner-stroke-width,4px)}
.${root} .vertex-layer{opacity:0}
.${root} .vertex-label{display:none}
.${root} .wall-dimension{display:inline}
.${root} .opening-dimension{display:none}
.${root} .full-room-highlight polygon{display:none}
.${root} .full-room-highlight{cursor:default}
.${root} .room-name-editor input{color:#151515;font-family:Arial,sans-serif;font-size:9px;font-weight:700;letter-spacing:.02em;text-transform:uppercase}
.${root} .export-room-name{fill:#151515;font-family:Arial,sans-serif;font-size:9px;font-weight:700;letter-spacing:.02em}
.${root} .opening-gap{stroke:#fff;stroke-width:var(--opening-gap-width,14px)}
.${root} .opening-jamb{stroke-width:1.4}
.${root} .door-closed-line{display:none}
.${root} .door-leaf{stroke:var(--door-colour,#606060);stroke-width:1.15}
.${root} .door-swing{stroke:var(--door-colour,#777);stroke-width:1;stroke-dasharray:none}
.${root} .window-frame{stroke:#151515;stroke-width:1.25}
.${root} .window-core{stroke:#777;stroke-width:.8}
.${root} .window-jamb{stroke-width:1.2}
.${root} .floorplan-fixture rect{fill:#fff;stroke:#151515}
.${root} .floorplan-fixture text{fill:#151515}
.${root} .floorplan-fixture .fixture-dimension{color:#b45309}
.${root} .floorplan-fixture .fixture-dimension-label{fill:currentColor}
`;

  if (style === "MODERN") return `
.${root} .canvas-background{fill:#fff}
.${root} .plan-grid{display:none}
.${root} .styled-room-floors{display:inline!important}
.${root} .coloured-fixture-symbol .symbol-default{display:none}
.${root} .symbol-modern{display:inline!important}
.${root} .furniture-material{fill:#dcc4a0;stroke:#89775e}
.${root} .full-room-highlight{display:inline}
.${root} .full-room-highlight polygon{fill:transparent;fill-opacity:0}
.${root} .vertex-layer{opacity:0}
.${root} .vertex-label{display:none}
.${root} .room-polygon{fill:#fbfefd}
.${root} .wall-body{stroke:#323530}
.${root} .wall-line{stroke:#323530}
.${root} .wall-line:hover,.${root} .wall-line.selected{stroke:#f1b14b;stroke-width:var(--wall-inner-stroke-width,4px)}
.${root} .wall-label,.${root} .wall-thickness-label{fill:#164e48;font-family:Arial,sans-serif}
.${root} .room-name-editor input{color:#164e48;font-family:Arial,sans-serif}
.${root} .export-room-name{fill:#164e48;font-family:Arial,sans-serif}
.${root} .vertex-handle{stroke:#155d55;fill:#f8fffe}
.${root} .door-leaf{stroke:var(--door-colour,#ae8760);stroke-width:2.5}
.${root} .door-swing{stroke:var(--door-colour,#9eaa9f);stroke-dasharray:none;opacity:.7}
.${root} .opening-dimension{color:#168a79}
.${root} .opening-dimension-label{fill:#126e61}
.${root} .window-frame,.${root} .window-jamb{stroke:#2c7dbc}
.${root} .window-core{stroke:#b7d9df;stroke-width:3}
.${root} .window-dimension{color:#2c7dbc}
.${root} .window-dimension .opening-dimension-label{fill:#246a9e}
.${root} .floorplan-fixture .fixture-dimension{color:#b45309}
.${root} .floorplan-fixture .fixture-dimension-label{fill:currentColor}
`;

  return `
.${root} .canvas-background{fill:#fffcf6}
.${root} .plan-grid{display:none}
.${root} .styled-room-floors,.${root} .creative-garden,.${root} .creative-floor-wash{display:inline!important}
.${root} .coloured-fixture-symbol .symbol-default{display:none}
.${root} .symbol-creative{display:inline!important}
.${root} .furniture-material{fill:#ddd0b9;stroke:#9c947f}
.${root} .vertex-layer{opacity:0}
.${root} .vertex-label{display:none}
.${root} .room-polygon{fill:#fffdf8}
.${root} .wall-body{stroke:#57544b}
.${root} .wall-line{stroke:#756f60}
.${root} .wall-line:hover,.${root} .wall-line.selected{stroke:#f1b14b;stroke-width:var(--wall-inner-stroke-width,4px)}
.${root} .wall-label,.${root} .wall-thickness-label{fill:#6c4d23;font-family:Georgia,serif}
.${root} .room-name-editor input{color:#6c4d23;font-family:Georgia,serif}
.${root} .export-room-name{fill:#6c4d23;font-family:Georgia,serif}
.${root} .vertex-handle{stroke:#b36b32;fill:#fff2d3}
.${root} .door-leaf{stroke:var(--door-colour,#bba083);stroke-width:2.5}
.${root} .door-swing{stroke:var(--door-colour,#a9b09d);stroke-dasharray:none;opacity:.65}
.${root} .opening-dimension{color:#b35c35}
.${root} .opening-dimension-label{fill:#9d4b29}
.${root} .window-frame,.${root} .window-jamb{stroke:#5d83a5}
.${root} .window-core{stroke:#bed5d0;stroke-width:3}
.${root} .window-dimension{color:#5d83a5}
.${root} .window-dimension .opening-dimension-label{fill:#426b8c}
.${root} .floorplan-fixture .fixture-dimension{color:#b45309}
.${root} .floorplan-fixture .fixture-dimension-label{fill:currentColor}
.${root} .full-room-highlight{display:inline}
.${root} .full-room-highlight polygon{fill:transparent;fill-opacity:0}
`;
}
