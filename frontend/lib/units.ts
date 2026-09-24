export type DisplayUnits = "MM" | "CM" | "INCHES" | "FEET" | "METERS";

const MM_PER_UNIT: Record<DisplayUnits, number> = {
  MM: 1,
  CM: 10,
  INCHES: 25.4,
  FEET: 304.8,
  METERS: 1000,
};

export const UNIT_LABEL: Record<DisplayUnits, string> = {
  MM: "mm",
  CM: "cm",
  INCHES: "in",
  FEET: "ft",
  METERS: "m",
};

export function toDisplayNumber(mm: number, units: DisplayUnits): number {
  return mm / MM_PER_UNIT[units];
}

/** Number suitable for an editable field, avoiding long repeating conversion decimals. */
export function toDisplayInputNumber(mm: number, units: DisplayUnits): number {
  const value = toDisplayNumber(mm, units);
  const precision = units === "MM" ? 2 : units === "CM" ? 3 : units === "INCHES" ? 4 : 3;
  return Number(value.toFixed(precision));
}

export function fromDisplayNumber(value: number, units: DisplayUnits): number {
  return value * MM_PER_UNIT[units];
}

export function formatLength(mm: number, units: DisplayUnits, decimals?: number): string {
  if (!Number.isFinite(mm)) return "—";
  const precision = decimals ?? (units === "MM" ? 0 : units === "CM" ? 1 : units === "INCHES" ? 2 : 2);
  return `${toDisplayNumber(mm, units).toFixed(precision)} ${UNIT_LABEL[units]}`;
}

export function formatArea(areaMm2: number, units: DisplayUnits): string {
  const divisor = units === "MM" ? 1 : units === "CM" ? 100 : units === "INCHES" ? 645.16 : units === "FEET" ? 92903.04 : 1_000_000;
  const precision = units === "MM" ? 0 : units === "CM" ? 1 : 2;
  const label = units === "MM" ? "mm²" : units === "CM" ? "cm²" : units === "INCHES" ? "in²" : units === "FEET" ? "ft²" : "m²";
  return `${(areaMm2 / divisor).toFixed(precision)} ${label}`;
}

export function formatMeasurementText(text: string, units: DisplayUnits): string {
  return text.replace(/(-?\d+(?:\.\d+)?)\s*mm\b/gi, (_match, value: string) => formatLength(Number(value), units));
}
