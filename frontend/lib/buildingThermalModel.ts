/** Derived shared fabric inputs. Never persisted as a second copy of project data. */
export type ThermalElementOverride = { uValue?: number; boundary?: "Auto" | "External" | "Heated" | "Unheated" | "Adiabatic" | "Ground"; adjacentTemperatureC?: number; warning?: string };
export type BuildingThermalOverrides = Record<string, ThermalElementOverride>;
export const thermalElementId = (roomId: string, element: string) => `${roomId}|${element}`;
