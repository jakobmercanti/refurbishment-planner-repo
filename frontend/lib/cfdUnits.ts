import { fromDisplayNumber, toDisplayInputNumber, UNIT_LABEL, type DisplayUnits } from "./units";

export type TemperatureUnit = "K" | "C" | "F";
export type FlowUnit = "m³/s" | "L/s" | "m³/h";
export type EngineeringUnits = { units?: DisplayUnits; temperatureUnit?: TemperatureUnit; cfdFlowUnit?: FlowUnit };
export const toTemperature = (kelvin: number, unit: TemperatureUnit) => unit === "K" ? kelvin : unit === "C" ? kelvin - 273.15 : (kelvin - 273.15) * 9 / 5 + 32;
export const fromTemperature = (value: number, unit: TemperatureUnit) => unit === "K" ? value : unit === "C" ? value + 273.15 : (value - 32) * 5 / 9 + 273.15;

/** UI conversion only. Stored geometry stays mm, temperatures K, flow m³/s. */
export function engineeringDisplay(label: string, preferences: EngineeringUnits) {
  const temperature = preferences.temperatureUnit ?? "K", units = preferences.units ?? "MM", flow = preferences.cfdFlowUnit ?? "m³/s";
  if (label.includes("(K)")) return { label: label.replace("(K)", `(${temperature === "K" ? "K" : `°${temperature}`})`),
    to: (v: number) => Number(toTemperature(v, temperature).toFixed(8)), from: (v: number) => fromTemperature(v, temperature) };
  if (label.includes("(mm)")) return { label: label.replace("(mm)", `(${UNIT_LABEL[units]})`),
    to: (v: number) => toDisplayInputNumber(v, units), from: (v: number) => fromDisplayNumber(v, units) };
  if (label.includes("(m³/s)")) {
    const factor = flow === "L/s" ? 1000 : flow === "m³/h" ? 3600 : 1;
    return { label: label.replace("(m³/s)", `(${flow})`), to: (v: number) => v * factor, from: (v: number) => v / factor };
  }
  return { label, to: (v: number) => v, from: (v: number) => v };
}
