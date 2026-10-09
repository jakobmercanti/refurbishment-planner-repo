export const ADD_TO_PLAN_MODES = [
  { value: "DOOR", label: "Doors" },
  { value: "WINDOW", label: "Windows" },
  { value: "FURNITURE", label: "Fittings" },
  { value: "HEATING", label: "Heating elements" },
  { value: "ELECTRICAL", label: "Electrical" },
] as const;

export type AddToPlanMode = (typeof ADD_TO_PLAN_MODES)[number]["value"];
