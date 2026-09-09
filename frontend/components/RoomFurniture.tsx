"use client";
import { RoundedBox } from "@react-three/drei";

/** Render-only proportions, scaled to the authoritative obstacle dimensions by the caller. */
export function RoomFurniture({ representation, colour, width, depth, height }: {
  representation: string; colour: string; width: number; depth: number; height: number;
}) {
  const part = (key: string, x: number, y: number, z: number, w: number, h: number, d: number, tint = colour) =>
    <RoundedBox key={key} position={[x, y, z]} args={[w, h, d]} radius={Math.min(w, h, d) * .15} smoothness={3} castShadow receiveShadow><meshStandardMaterial color={tint} roughness={0.75} /></RoundedBox>;
  const legs = [-1, 1].flatMap((x) => [-1, 1].map((z) => part(`leg-${x}-${z}`, x * .42, .42, z * .4, .06, .84, .06, "#715840")));
  let parts;
  if (representation.includes("table-")) {
    parts = [...legs, part("top", 0, .94, 0, 1, .12, 1)];
  } else if (representation.includes("bed-")) {
    const pillows = representation.includes("single") ? [0] : [-.24, .24];
    parts = [part("frame", 0, .24, 0, 1, .32, 1), part("mattress", 0, .49, .025, .96, .18, .95, "#f2eee5"),
      part("headboard", 0, .5, -.47, 1, 1, .06),
      part("blanket", 0, .60, .15, .94, .04, .63),
      ...pillows.map((x, i) => part(`pillow-${i}`, x, .62, -.31, pillows.length === 1 ? .7 : .4, .09, .22, "#fffaf0"))];
  } else {
    const chair = representation.includes("chair-") && !representation.includes("armchair");
    const corner = representation.includes("corner");
    const classic = representation.includes("classic");
    const seats = representation.includes("-4") ? 4 : representation.includes("-3") ? 3 : representation.includes("sofa-") ? 2 : 1;
    parts = [part("seat-base", 0, .36, corner ? -.2 : 0, 1, .22, corner ? .6 : 1),
      part("back", 0, .75, -.44, 1, .5, .12),
      ...Array.from({ length: seats }, (_, i) => part(`cushion-${i}`, -.4 + .8 / seats * (i + .5), .51, corner ? -.15 : .02, .78 / seats, .1, corner ? .43 : .76))];
    if (!chair) parts.push(...[-1, 1].map((x) => part(`arm-${x}`, x * .45, classic ? .55 : .5, corner ? -.2 : 0, .1, classic ? .5 : .36, corner ? .6 : 1)));
    if (corner) {
      const side = representation.includes("left") ? -1 : 1;
      parts.push(part("chaise", side * .33, .36, .15, .34, .22, .7), part("chaise-cushion", side * .33, .51, .18, .30, .1, .6));
    }
    if (chair && classic) {
      parts = parts.filter((p) => p.key !== "back");
      parts.push(part("back-rail", 0, .95, -.44, 1, .1, .12),
        ...[-.4, -.2, 0, .2, .4].map((x) => part(`slat-${x}`, x, .72, -.44, .06, .46, .08)));
    }
    parts.push(...[-1, 1].flatMap((x) => [-1, 1].map((z) => {
      const chaiseSide = representation.includes("left") ? -1 : 1;
      const footZ = corner && z === 1 && x !== chaiseSide ? .04 : z * .4;
      return part(`foot-${x}-${z}`, x * .42, .13, footZ, .06, .26, .06, "#715840");
    })));
  }
  return <group scale={[width, height, depth]}>{parts}</group>;
}
