"use client";
import { useEffect, useMemo } from "react";
import { CatmullRomCurve3, DataTexture, RGBAFormat, SRGBColorSpace, Path, Shape, Vector3 } from "three";
import { doorModel } from "@/lib/doorModels";

type Panel = { x: number; y: number; w: number; h: number; glass?: boolean };
function rectangle(x: number, y: number, w: number, h: number) {
  const shape = new Shape(); shape.moveTo(x, y); shape.lineTo(x + w, y); shape.lineTo(x + w, y + h); shape.lineTo(x, y + h); shape.closePath(); return shape;
}
function Box({ at, size, colour, metal = false }: { at: [number, number, number]; size: [number, number, number]; colour: string; metal?: boolean }) {
  return <mesh position={at} castShadow receiveShadow><boxGeometry args={size} /><meshStandardMaterial color={colour} roughness={metal ? .28 : .42} metalness={metal ? .78 : 0} /></mesh>;
}

/** A leaf built from pierced stiles/rails, recessed infills and bevelled mouldings. */
function DoorLeaf({ width: w, height: h, thickness: t, style, colour, handleSide = 1, sliding = false, showHandle = true }: { width: number; height: number; thickness: number; style: string; colour: string; handleSide?: number; sliding?: boolean; showHandle?: boolean }) {
  const grain = useMemo(() => {
    if (style !== "barn") return null;
    const data = new Uint8Array(128 * 128 * 4);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const tone = 224 + Math.sin(x * 2.1 + Math.sin(y * .05) * 2) * 15;
      data.set([tone, tone, tone, 255], (y * 128 + x) * 4);
    }
    const texture = new DataTexture(data, 128, 128, RGBAFormat); texture.colorSpace = SRGBColorSpace; texture.needsUpdate = true; return texture;
  }, [style]);
  useEffect(() => () => grain?.dispose(), [grain]);
  const panels = useMemo((): Panel[] => {
    if (style === "flush" || style === "barn") return [];
    if (style === "glazed" || style === "french-classic") return [{ x: -.36, y: .12, w: .72, h: .80, glass: true }];
    if (style === "entrance-glazed") return [{ x: -.34, y: .38, w: .68, h: .52, glass: true }, { x: -.34, y: .08, w: .68, h: .23 }];
    if (style === "shaker") return [.08, .37, .66].map(y => ({ x: -.35, y, w: .70, h: .24 }));
    return [-.40, .055].flatMap(x => [{ x, y: .79, w: .345, h: .135 }, { x, y: .365, w: .345, h: .365 }, { x, y: .075, w: .345, h: .235 }]);
  }, [style]);
  const slab = useMemo(() => {
    const shape = rectangle(-w / 2, 0, w, h);
    for (const p of panels) {
      const hole = new Path(); hole.moveTo(p.x * w, p.y * h); hole.lineTo(p.x * w, (p.y + p.h) * h); hole.lineTo((p.x + p.w) * w, (p.y + p.h) * h); hole.lineTo((p.x + p.w) * w, p.y * h); hole.closePath(); shape.holes.push(hole);
    }
    return shape;
  }, [panels, w, h]);
  const hardware = style === "six-panel" || style === "entrance" ? "#ad8644" : "#7c8588";
  const lever = useMemo(() => new CatmullRomCurve3([new Vector3(0, 0, 0), new Vector3(-handleSide * h * .016, h * .004, h * .006), new Vector3(-handleSide * h * .042, h * .001, h * .008), new Vector3(-handleSide * h * .050, h * .005, h * .008)]), [h, handleSide]);
  return <group>
    <mesh position={[0, 0, -t / 2]} castShadow receiveShadow><extrudeGeometry args={[slab, { depth: t, bevelEnabled: false }]} /><meshStandardMaterial color={colour} map={grain} roughness={.43} /></mesh>
    {panels.map((p, index) => {
      const pw = p.w * w, ph = p.h * h, trim = Math.min(w * .035, h * .014), x = (p.x + p.w / 2) * w, y = (p.y + p.h / 2) * h;
      const inset = rectangle(-pw / 2 + trim, -ph / 2 + trim, pw - trim * 2, ph - trim * 2);
      const ring = rectangle(-pw / 2, -ph / 2, pw, ph);
      const cut = new Path(); cut.moveTo(-pw / 2 + trim, -ph / 2 + trim); cut.lineTo(-pw / 2 + trim, ph / 2 - trim); cut.lineTo(pw / 2 - trim, ph / 2 - trim); cut.lineTo(pw / 2 - trim, -ph / 2 + trim); cut.closePath(); ring.holes.push(cut);
      return <group key={index} position={[x, y, 0]}>
        {p.glass ? <>
          <mesh><boxGeometry args={[pw - trim, ph - trim, t * .10]} /><meshPhysicalMaterial color="#bad1d7" transparent opacity={.28} roughness={style === "entrance-glazed" ? .38 : .04} metalness={.08} depthWrite={false} /></mesh>
          <mesh position={[0, 0, -t * .15]}><boxGeometry args={[pw - trim, ph - trim, t * .025]} /><meshPhysicalMaterial color="#d6e6e9" transparent opacity={.12} roughness={.06} depthWrite={false} /></mesh>
          {style === "french-classic" && <>
            <Box at={[0, 0, t * .12]} size={[trim * .8, ph, t * .3]} colour={colour} />
            {[1, 2, 3, 4].map(row => <Box key={row} at={[0, -ph / 2 + ph * row / 5, t * .12]} size={[pw, trim * .8, t * .3]} colour={colour} />)}
          </>}
        </> : <mesh position={[0, 0, -t * .09]} castShadow receiveShadow><extrudeGeometry args={[inset, { depth: t * .18, bevelEnabled: style !== "shaker", bevelSize: trim * .25, bevelThickness: t * .10, bevelSegments: 3 }]} /><meshStandardMaterial color={colour} roughness={.48} /></mesh>}
        {[-1, 1].map(side => <mesh key={side} position={[0, 0, side * t * .32]} rotation={[side < 0 ? Math.PI : 0, 0, 0]} castShadow receiveShadow><extrudeGeometry args={[ring, { depth: t * .14, bevelEnabled: style !== "shaker", bevelSize: trim * .4, bevelThickness: t * .10, bevelSegments: 3 }]} /><meshStandardMaterial color={colour} roughness={.35} /></mesh>)}
      </group>;
    })}
    {style === "barn" && <>
      {Array.from({ length: 7 }, (_, i) => <Box key={i} at={[-w / 2 + (i + 1) * w / 8, h / 2, t * .502]} size={[w * .003, h, t * .01]} colour="#5c5145" />)}
      {[.12, .86].map(y => <Box key={y} at={[0, y * h, t * .75]} size={[w * .9, h * .065, t * .5]} colour={colour} />)}
      <group position={[0, h * .49, t * .75]} rotation={[0, 0, -Math.atan2(w * .78, h * .65)]}><Box at={[0, 0, 0]} size={[h * .06, Math.hypot(w * .78, h * .65), t * .5]} colour={colour} /></group>
      {[-1, 1].map(side => <group key={side} position={[side * w * .30, h * .96, t * .85]}>
        <Box at={[0, -h * .025, 0]} size={[w * .035, h * .09, t * .20]} colour="#303639" metal />
        <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[h * .017, h * .017, t * .4, 24]} /><meshStandardMaterial color="#252c2e" roughness={.28} metalness={.8} /></mesh>
      </group>)}
    </>}
    {showHandle && [-1, 1].map(side => <group key={side} position={[handleSide * w * .415, h * .46, side * t * .56]} rotation={[0, side < 0 ? Math.PI : 0, 0]}>
      {sliding ? <>
        <Box at={[0, 0, t * .08]} size={[w * .035, h * .075, t * .12]} colour={hardware} metal />
        <Box at={[0, 0, t * .18]} size={[w * .018, h * .053, t * .08]} colour="#323a3b" metal />
      </> : <>
        <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[h * .012, h * .012, t * .18, 32]} /><meshStandardMaterial color={hardware} metalness={.85} roughness={.24} /></mesh>
        <mesh position={[0, 0, t * .32]}><tubeGeometry args={[lever, 20, h * .0038, 10, false]} /><meshStandardMaterial color={hardware} metalness={.85} roughness={.24} /></mesh>
        <Box at={[0, -h * .04, 0]} size={[w * .009, h * .013, t * .14]} colour={hardware} metal />
      </>}
    </group>)}
    {!sliding && [.16, .5, .84].map(y => <group key={y} position={[-handleSide * (w / 2 - t * .04), h * y, t * .35]}>
      <mesh castShadow><cylinderGeometry args={[t * .13, t * .13, h * .045, 16]} /><meshStandardMaterial color={hardware} metalness={.85} roughness={.3} /></mesh>
      <Box at={[handleSide * t * .22, 0, 0]} size={[t * .4, h * .045, t * .06]} colour={hardware} metal />
    </group>)}
    {style.startsWith("entrance") && <Box at={[0, h * .37, t * .58]} size={[w * .27, h * .028, t * .15]} colour={hardware} metal />}
  </group>;
}

/** Frame is opt-in at the placed-opening boundary; previews deliberately omit it. */
export function DoorFixture({ representation, width, depth, height, colour = "#f4f3ee", frame = false }: { representation: string; width: number; depth: number; height: number; colour?: string; frame?: boolean }) {
  const model = doorModel(representation) ?? doorModel("door-single")!;
  const unit = height / 2040, jamb = frame ? Math.min(38 * unit, width * .08) : 0, gap = Math.min(3 * unit, width / (model.leaves + 1) * .03);
  const innerWidth = width - 2 * jamb, leafHeight = height - jamb - gap * 2;
  const thickness = Math.min(depth * .5, height * (model.style === "entrance" ? 54 : 40) / 2040);
  const leafWidth = (innerWidth - (model.leaves + 1) * gap) / model.leaves;
  return <group>
    {Array.from({ length: model.leaves }, (_, i) => <group key={i} position={[-innerWidth / 2 + gap + leafWidth / 2 + i * (leafWidth + gap), gap, model.operation === "SLIDING" && model.leaves > 1 ? (i % 2 ? 1 : -1) * thickness * .6 : 0]}>
      <DoorLeaf width={leafWidth} height={leafHeight} thickness={thickness} style={model.style} colour={colour} handleSide={model.leaves > 1 && i % 2 ? -1 : 1} sliding={model.operation === "SLIDING"} showHandle={model.operation !== "FOLDING" || i % 2 === 0} />
    </group>)}
    {model.operation !== "HINGED" && <Box at={[0, height - unit * 8, 0]} size={[width, unit * 14, thickness * 1.4]} colour="#5a6061" metal />}
    {frame && <>
      {[-1, 1].map(side => <group key={side}>
        <Box at={[side * (width - jamb) / 2, height / 2, 0]} size={[jamb, height, depth]} colour={colour} />
        <Box at={[side * (width / 2 - jamb - unit * 5), height / 2, -thickness * .65]} size={[unit * 10, height - jamb, unit * 14]} colour={colour} />
      </group>)}
      <Box at={[0, height - jamb / 2, 0]} size={[width, jamb, depth]} colour={colour} />
      {[-1, 1].map(face => <group key={face}>
        {[0, 1, 2].map(layer => {
          const casing = (65 - layer * 16) * unit, projection = face * (depth / 2 + (4 + layer * 4) * unit);
          const inner = width / 2 - jamb * .3, top = height - jamb * .3;
          const profile = new Shape();
          profile.moveTo(-inner - casing, 0); profile.lineTo(-inner - casing, top + casing); profile.lineTo(inner + casing, top + casing); profile.lineTo(inner + casing, 0);
          profile.lineTo(inner, 0); profile.lineTo(inner, top); profile.lineTo(-inner, top); profile.lineTo(-inner, 0); profile.closePath();
          return <mesh key={layer} position={[0, 0, projection]} rotation={[0, face < 0 ? Math.PI : 0, 0]} castShadow receiveShadow><extrudeGeometry args={[profile, { depth: unit * 8, bevelEnabled: true, bevelSize: unit * .8, bevelThickness: unit * .8, bevelSegments: 2 }]} /><meshStandardMaterial color={colour} roughness={.38} /></mesh>;
        })}
      </group>)}
    </>}
  </group>;
}
