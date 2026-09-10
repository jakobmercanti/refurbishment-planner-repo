"use client";
import { useEffect, useMemo } from "react";
import { DataTexture, RGBAFormat, SRGBColorSpace } from "three";
import { CUSTOM_FINISH_ID, finishChoiceForColour } from "@/lib/finishOptions";

/** Wood catalogue colours receive a neutral grain; custom paint remains smooth. */
export function OpeningFinishMaterial({ colour = "#F4F3EE" }: { colour?: string }) {
  const wood = finishChoiceForColour(colour) !== CUSTOM_FINISH_ID;
  const grain = useMemo(() => {
    if (!wood) return null;
    const pixels = new Uint8Array(128 * 256 * 4);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 128; x++) {
      const line = x + Math.sin(y * .026) * 2 + Math.sin(y * .008 + x * .08) * 4;
      const tone = Math.round(226 + Math.sin(line * 2.8) * 12 + Math.sin(line * .45) * 10);
      pixels.set([tone, tone, tone, 255], (y * 128 + x) * 4);
    }
    const texture = new DataTexture(pixels, 128, 256, RGBAFormat);
    texture.colorSpace = SRGBColorSpace; texture.needsUpdate = true;
    return texture;
  }, [wood]);
  useEffect(() => () => grain?.dispose(), [grain]);
  return <meshStandardMaterial color={colour} map={grain} roughness={wood ? .48 : .34} />;
}
