import catalogue from "@/lib/duluxColours.generated.json";

export interface DuluxPaintShade {
  id: string;
  name: string;
  colour: string;
  ralCode: string;
  ralName: string;
}

export interface DuluxPaintFamily {
  id: string;
  name: string;
  colour: string;
  sourceUrl: string;
  shades: DuluxPaintShade[];
}

export const DULUX_PAINT_FAMILIES = catalogue.families as DuluxPaintFamily[];
export const DULUX_PALETTE_SOURCE = catalogue.source;
export const DULUX_RAL_NOTE = catalogue.ralReference;
