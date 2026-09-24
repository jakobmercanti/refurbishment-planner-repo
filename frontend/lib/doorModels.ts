import definitions from "./doorModels.json";
export const DOOR_MODELS = definitions;
export function doorModel(key?: string) {
  return DOOR_MODELS.find(model => model.key === key);
}
export function doorRepresentation(key?: string, type?: "SINGLE" | "DOUBLE") {
  if (!doorModel(key) || ((key === "door-single" || key === "door-double") && type)) return type === "DOUBLE" ? "door-double" : "door-single";
  return key!;
}
