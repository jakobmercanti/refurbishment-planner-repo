/** Readable device faces for the 2D plan. These never change physical dimensions. */
type DevicePlanSymbol = { dataUrl: string; aspectRatio: number };
type PlanPresentation = { electricalLayout: DevicePlanSymbol; standardPlan: DevicePlanSymbol };

function svgSymbol(content: string, width: number, height: number, plate = true): DevicePlanSymbol {
  const background = plate ? '<rect x="5" y="5" width="' + (width - 10) + '" height="' + (height - 10) + '" rx="10" fill="#fff" stroke="#071b38" stroke-width="4"/>' : "";
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + " " + height + '">' + background + '<g fill="#e9f2fb" stroke="#071b38" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">' + content + "</g></svg>";
  return { dataUrl: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg), aspectRatio: width / height };
}

function deviceFace(content: string, width = 100): DevicePlanSymbol {
  return svgSymbol(content, width, 100);
}

function rocker(x: number, width: number) {
  return '<rect x="' + x + '" y="21" width="' + width + '" height="58" rx="5"/><path d="M' + (x + 6) + " 50h" + (width - 12) + '"/>';
}

function socketPins(x: number) {
  return '<g fill="#071b38" stroke="none"><rect x="' + (x - 4) + '" y="25" width="8" height="18" rx="1"/><rect x="' + (x - 21) + '" y="52" width="16" height="8" rx="1"/><rect x="' + (x + 5) + '" y="52" width="16" height="8" rx="1"/></g>';
}

const rockerInset = (x: number, width: number, y = 15, height = 22) =>
  '<rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" rx="3" fill="#fff"/><path d="M' + (x + 4) + " " + (y + height / 2) + "h" + (width - 8) + '"/>';
const standardSocketPins = (x: number) =>
  '<g fill="#071b38" stroke="none"><rect x="' + (x - 2) + '" y="16" width="4" height="10" rx="1"/><rect x="' + (x - 12) + '" y="32" width="9" height="4" rx="1"/><rect x="' + (x + 3) + '" y="32" width="9" height="4" rx="1"/></g>';

// Use structured catalogue keys, including for saved projects with older symbols.
const DEVICE_SYMBOLS = new Map<string, PlanPresentation>([
  ["electrical-switch-single", { electricalLayout: deviceFace(rocker(26, 36), 88), standardPlan: svgSymbol(rockerInset(40, 20), 100, 52) }],
  ["electrical-switch-double", { electricalLayout: deviceFace(rocker(29, 27) + rocker(72, 27), 128), standardPlan: svgSymbol(rockerInset(27, 16) + rockerInset(57, 16), 100, 52) }],
  ["electrical-switch-triple", { electricalLayout: deviceFace([25, 66, 107].map(x => rocker(x, 24)).join(""), 156), standardPlan: svgSymbol([20, 44, 68].map(x => rockerInset(x, 12)).join(""), 100, 52) }],
  ["electrical-switch-quadruple", { electricalLayout: deviceFace([23, 61, 99, 137].map(x => rocker(x, 24)).join(""), 184), standardPlan: svgSymbol([23, 51, 79, 107].map(x => rockerInset(x, 12)).join(""), 140, 52) }],
  ["electrical-switch-dimmer", { electricalLayout: deviceFace('<circle cx="50" cy="50" r="25"/><path d="M50 30v12"/>'), standardPlan: svgSymbol('<circle cx="50" cy="26" r="9" fill="#fff"/><path d="M50 20v6"/>', 100, 52) }],
  ["electrical-switch-dimmer-double", { electricalLayout: deviceFace([46, 114].map(x => '<circle cx="' + x + '" cy="50" r="22"/><path d="M' + x + ' 32v10"/>').join(""), 160), standardPlan: svgSymbol([40, 100].map(x => '<circle cx="' + x + '" cy="26" r="9" fill="#fff"/><path d="M' + x + ' 20v6"/>').join(""), 140, 52) }],
  ["electrical-switch-pull", { electricalLayout: deviceFace('<circle cx="50" cy="37" r="20"/><path d="M50 57v20"/><circle cx="50" cy="82" r="5" fill="#071b38"/>'), standardPlan: svgSymbol('<circle cx="50" cy="17" r="6" fill="#fff"/><path d="M50 23v15"/><circle cx="50" cy="40" r="2" fill="#071b38"/>', 100, 52) }],
  ["electrical-socket-single", { electricalLayout: deviceFace(socketPins(50)), standardPlan: svgSymbol(standardSocketPins(36), 72, 52) }],
  ["electrical-socket-double", { electricalLayout: deviceFace(socketPins(43) + socketPins(117), 160), standardPlan: svgSymbol(standardSocketPins(36) + standardSocketPins(84), 120, 68) }],
  ["electrical-socket-usb", { electricalLayout: deviceFace(socketPins(43) + socketPins(117) + '<rect x="57" y="76" width="20" height="9" rx="1"/><rect x="87" y="76" width="16" height="9" rx="4"/>', 160), standardPlan: svgSymbol(standardSocketPins(31) + standardSocketPins(65) + '<rect x="49" y="43" width="7" height="4" rx="1"/><rect x="58" y="43" width="6" height="4" rx="2"/>', 96, 58) }],
  ["electrical-socket-weatherproof", { electricalLayout: deviceFace(socketPins(43) + socketPins(117) + '<path d="M17 16h126M17 77h126"/>', 160), standardPlan: svgSymbol(standardSocketPins(36) + standardSocketPins(84) + '<path d="M9 11h102M9 51h102"/>', 120, 68) }],
]);

// Mirror-symmetric fan face, also used for older placed items with stale SVGs.
const fanFace = '<path d="M44 44 C38 32 38 14 50 14 C62 14 62 32 56 44 Z"/><path d="M56 44 C68 38 86 38 86 50 C86 62 68 62 56 56 Z"/><path d="M56 56 C62 68 62 86 50 86 C38 86 38 68 44 56 Z"/><path d="M44 56 C32 62 14 62 14 50 C14 38 32 38 44 44 Z"/><circle cx="50" cy="50" r="8" fill="#fff"/>';
for (const variant of ["axial", "silent", "hood", "canopy"]) {
  const symbol = deviceFace(fanFace);
  DEVICE_SYMBOLS.set(`electrical-fan-${variant}`, { electricalLayout: symbol, standardPlan: symbol });
}

export function electricalDevicePlanSymbol(key: string | null | undefined, electricalLayout = false) {
  const presentation = key ? DEVICE_SYMBOLS.get(key) : undefined;
  return presentation ? electricalLayout ? presentation.electricalLayout : presentation.standardPlan : undefined;
}

/** Display units only: preserve the device-face aspect ratio instead of its shallow wall depth. */
export function electricalDevicePlanSize(key: string | null | undefined, width: number, depth: number, electricalLayout = false) {
  const symbol = electricalDevicePlanSymbol(key, electricalLayout);
  if (!symbol) return { width, depth };
  const minimumHeight = electricalLayout ? 32 : 13;
  // Multi-gang plates grow horizontally only; catalogue footprint dimensions remain authoritative.
  const rockerPlate = electricalLayout && /^electrical-switch-(single|double|triple|quadruple)$/.test(key ?? "");
  const nominalWidth = key === "electrical-switch-quadruple" ? 146 : 86;
  const height = rockerPlate ? Math.max(minimumHeight, Math.abs(width) * 86 / nominalWidth, Math.abs(depth)) : Math.max(minimumHeight, Math.abs(width) / symbol.aspectRatio, Math.abs(depth));
  return { width: height * symbol.aspectRatio, depth: height };
}

/** Normalised rocker rectangles shared by the symbol and its interactive state overlay. */
export function electricalRockerBounds(key: string | null | undefined) {
  const face = key === "electrical-switch-single" ? { width: 88, xs: [26], rocker: 36 }
    : key === "electrical-switch-double" ? { width: 128, xs: [29, 72], rocker: 27 }
    : key === "electrical-switch-triple" ? { width: 156, xs: [25, 66, 107], rocker: 24 }
    : key === "electrical-switch-quadruple" ? { width: 184, xs: [23, 61, 99, 137], rocker: 24 } : null;
  return face?.xs.map(x => ({ x: x / face.width - .5, y: -.29, width: face.rocker / face.width, height: .58 }));
}
