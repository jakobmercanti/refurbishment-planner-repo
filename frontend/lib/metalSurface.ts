import { DataTexture, RepeatWrapping, RGBAFormat } from "three";
import { metalFinishForColour } from "./metalFinishes";

// A shared, small roughness texture gives brushed finishes directional grain.
let brushedTexture: DataTexture | undefined;
function brushedRoughness() {
  if (!brushedTexture) {
    const pixels = new Uint8Array(64 * 64 * 4);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const shade = Math.round(215 + 25 * Math.sin(y * 2.3) + 10 * Math.sin(y * .7 + x * .03));
      pixels.set([shade, shade, shade, 255], (y * 64 + x) * 4);
    }
    brushedTexture = new DataTexture(pixels, 64, 64, RGBAFormat);
    brushedTexture.wrapS = brushedTexture.wrapT = RepeatWrapping;
    brushedTexture.repeat.set(2, 4);
    brushedTexture.needsUpdate = true;
  }
  return brushedTexture;
}

/** Apply only to editable surfaces; lenses, glass and indicator colours stay fixed. */
export function metalFinishProps(colour?: string) {
  const finish = metalFinishForColour(colour);
  return finish ? {
    metalness: finish.metalness,
    roughness: finish.roughness,
    roughnessMap: finish.brushed ? brushedRoughness() : null,
  } : {};
}
