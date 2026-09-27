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
  ["electrical-switch-single", { electricalLayout: deviceFace(rocker(32, 36)), standardPlan: svgSymbol(rockerInset(40, 20), 100, 52) }],
  ["electrical-switch-double", { electricalLayout: deviceFace(rocker(19, 27) + rocker(54, 27)), standardPlan: svgSymbol(rockerInset(27, 16) + rockerInset(57, 16), 100, 52) }],
  ["electrical-switch-dimmer", { electricalLayout: deviceFace('<circle cx="50" cy="50" r="25"/><path d="M50 30v12"/>'), standardPlan: svgSymbol('<circle cx="50" cy="26" r="9" fill="#fff"/><path d="M50 20v6"/>', 100, 52) }],
  ["electrical-switch-pull", { electricalLayout: deviceFace('<circle cx="50" cy="37" r="20"/><path d="M50 57v20"/><circle cx="50" cy="82" r="5" fill="#071b38"/>'), standardPlan: svgSymbol('<circle cx="50" cy="17" r="6" fill="#fff"/><path d="M50 23v15"/><circle cx="50" cy="40" r="2" fill="#071b38"/>', 100, 52) }],
  ["electrical-socket-single", { electricalLayout: deviceFace(socketPins(50)), standardPlan: svgSymbol(standardSocketPins(36), 72, 52) }],
  ["electrical-socket-double", { electricalLayout: deviceFace(socketPins(43) + socketPins(117), 160), standardPlan: svgSymbol(standardSocketPins(36) + standardSocketPins(84), 120, 68) }],
  ["electrical-socket-usb", { electricalLayout: deviceFace(socketPins(43) + socketPins(117) + '<rect x="57" y="76" width="20" height="9" rx="1"/><rect x="87" y="76" width="16" height="9" rx="4"/>', 160), standardPlan: svgSymbol(standardSocketPins(31) + standardSocketPins(65) + '<rect x="49" y="43" width="7" height="4" rx="1"/><rect x="58" y="43" width="6" height="4" rx="2"/>', 96, 58) }],
  ["electrical-socket-weatherproof", { electricalLayout: deviceFace(socketPins(43) + socketPins(117) + '<path d="M17 16h126M17 77h126"/>', 160), standardPlan: svgSymbol(standardSocketPins(36) + standardSocketPins(84) + '<path d="M9 11h102M9 51h102"/>', 120, 68) }],
]);

export function electricalDevicePlanSymbol(key: string | null | undefined, electricalLayout = false) {
  const presentation = key ? DEVICE_SYMBOLS.get(key) : undefined;
  return presentation ? electricalLayout ? presentation.electricalLayout : presentation.standardPlan : undefined;
}

/** Display units only: preserve the device-face aspect ratio instead of its shallow wall depth. */
export function electricalDevicePlanSize(key: string | null | undefined, width: number, depth: number, electricalLayout = false) {
  const symbol = electricalDevicePlanSymbol(key, electricalLayout);
  if (!symbol) return { width, depth };
  const minimumHeight = electricalLayout ? 32 : 13;
  const height = Math.max(minimumHeight, Math.abs(width) / symbol.aspectRatio, Math.abs(depth));
  return { width: height * symbol.aspectRatio, depth: height };
}
