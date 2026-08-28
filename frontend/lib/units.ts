export type DisplayUnits = "MM" | "CM" | "INCHES" | "FEET_INCHES";

const MM_PER_UNIT: Record<Exclude<DisplayUnits, "FEET_INCHES">, number> = { MM: 1, CM: 10, INCHES: 25.4 };

export const UNIT_LABEL: Record<DisplayUnits, string> = { MM: "mm", CM: "cm", INCHES: "in", FEET_INCHES: "ft + in" };

export function toDisplayNumber(mm: number, units: DisplayUnits): number {
  return units === "FEET_INCHES" ? mm / 304.8 : mm / MM_PER_UNIT[units];
}

export function toDisplayInputNumber(mm: number, units: DisplayUnits): number {
  const value = toDisplayNumber(mm, units);
  const precision = units === "MM" ? 2 : units === "CM" ? 3 : 4;
  return Number(value.toFixed(precision));
}

export function fromDisplayNumber(value: number, units: DisplayUnits): number {
  return units === "FEET_INCHES" ? value * 304.8 : value * MM_PER_UNIT[units];
}

export function formatLength(mm: number, units: DisplayUnits, decimals?: number): string {
  if (!Number.isFinite(mm)) return "—";
  if (units === "FEET_INCHES") {
    const totalInches = Math.abs(mm) / 25.4;
    let feet = Math.floor(totalInches / 12);
    let inches = Number((totalInches - feet * 12).toFixed(1));
    if (inches >= 12) { feet += 1; inches = 0; }
    return `${mm < 0 ? "-" : ""}${feet}' ${inches.toFixed(1)}\"`;
  }
  const precision = decimals ?? (units === "MM" ? 0 : units === "CM" ? 1 : 2);
  return `${toDisplayNumber(mm, units).toFixed(precision)} ${UNIT_LABEL[units]}`;
}

export function formatArea(areaMm2: number, units: DisplayUnits): string {
  const divisor = units === "MM" ? 1 : units === "CM" ? 100 : units === "INCHES" ? 645.16 : 92903.04;
  const precision = units === "MM" ? 0 : units === "CM" ? 1 : 2;
  const label = units === "MM" ? "mm²" : units === "CM" ? "cm²" : units === "INCHES" ? "in²" : "ft²";
  return `${(areaMm2 / divisor).toFixed(precision)} ${label}`;
}

export function formatMeasurementText(text: string, units: DisplayUnits): string {
  return text.replace(/(-?\d+(?:\.\d+)?)\s*mm\b/gi, (_match, value: string) => formatLength(Number(value), units));
}
