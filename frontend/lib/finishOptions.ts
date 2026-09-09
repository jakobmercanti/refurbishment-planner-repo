import { WOOD_COLOURS } from "./flooring";

export const CUSTOM_FINISH_ID = "__custom-colour__";

export type FinishOption = {
  id: string;
  label: string;
  colorHex: string;
};

/** Keep finish selectors aligned with the Wood types family in Object catalogue. */
export function woodFinishOptions(): FinishOption[] {
  return WOOD_COLOURS.map((wood) => ({ id: `wood:${wood.id}`, label: wood.name, colorHex: wood.base }));
}

export function finishChoiceForColour(colorHex: string | undefined): string {
  if (!colorHex) return CUSTOM_FINISH_ID;
  return woodFinishOptions().find((option) => option.colorHex.toLowerCase() === colorHex.toLowerCase())?.id ?? CUSTOM_FINISH_ID;
}
