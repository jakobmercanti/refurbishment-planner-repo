"use client";

import { useEffect, useMemo } from "react";
import { RoundedBox } from "@react-three/drei";
import { BufferGeometry, CatmullRomCurve3, Color, Float32BufferAttribute, Quaternion, Vector3 } from "three";
import { FabricMaterial } from "@/components/FabricMaterial";

type Point = [number, number, number];
type Finish = { colour: string; fabricId?: string; physicalSize: Point };

function Rod({ start, end, radius = .018, taper = .7, colour }: { start: Point; end: Point; radius?: number; taper?: number; colour: string }) {
  const a = new Vector3(...start), b = new Vector3(...end), delta = b.clone().sub(a);
  return <mesh position={a.add(b).multiplyScalar(.5)} quaternion={new Quaternion().setFromUnitVectors(new Vector3(0,1,0), delta.clone().normalize())} castShadow receiveShadow><cylinderGeometry args={[radius, radius*taper, delta.length(), 16]} /><meshStandardMaterial color={colour} roughness={.48} /></mesh>;
}

function Piping({ points, radius = .004, colour }: { points: Point[]; radius?: number; colour: string }) {
  const curve = useMemo(() => new CatmullRomCurve3(points.map(point => new Vector3(...point))), [points]);
  return <mesh castShadow><tubeGeometry args={[curve, 48, radius, 6, false]} /><meshStandardMaterial color={colour} roughness={.8} /></mesh>;
}

function Pad({ position, size, finish, tilt = 0, radius = .045 }: { position: Point; size: Point; finish: Finish; tilt?: number; radius?: number }) {
  return <RoundedBox position={position} rotation={[tilt,0,0]} args={size} radius={Math.min(radius, ...size.map(value => value*.45))} smoothness={5} castShadow receiveShadow><FabricMaterial {...finish} /></RoundedBox>;
}

/** Solid bent shell, including its rim. All proportions stay inside the fit envelope. */
function CurvedBack({ finish, tub = false, timber = false }: { finish: Finish; tub?: boolean; timber?: boolean }) {
  const geometry = useMemo(() => {
    const positions: number[] = [], indices: number[] = [];
    const segments = 40, spread = tub ? 2.1 : 1.13, radius = tub ? .45 : .47;
    for (let i=0;i<=segments;i++) {
      const angle = (i/segments*2-1)*spread;
      const top = tub ? .97 - Math.pow(Math.abs(angle)/spread,1.5)*.3 : .975-Math.pow(Math.abs(angle)/spread,2)*.035;
      const bottom = tub ? .31 : .66;
      for (const outer of [false,true]) for (const upper of [false,true]) {
        const r = radius + (outer ? (timber ? .027 : .045) : -(timber ? .005 : .035));
        positions.push(Math.sin(angle)*r, upper ? top : bottom, .055-Math.cos(angle)*r);
      }
      if (i<segments) {
        const b=i*4, n=b+4;
        indices.push(b,b+1,n+1,b,n+1,n, b+2,n+3,b+3,b+2,n+2,n+3, b+1,b+3,n+3,b+1,n+3,n+1, b,n+2,b+2,b,n,n+2);
      }
    }
    indices.push(0,2,3,0,3,1);
    const end=segments*4; indices.push(end,end+1,end+3,end,end+3,end+2);
    for (let i=0;i<indices.length;i+=3) [indices[i+1],indices[i+2]] = [indices[i+2],indices[i+1]];
    const result = new BufferGeometry(); result.setAttribute("position",new Float32BufferAttribute(positions,3)); result.setIndex(indices); result.computeVertexNormals();
    return result;
  },[tub,timber]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh castShadow receiveShadow><primitive object={geometry} attach="geometry" /><FabricMaterial {...finish} /></mesh>;
}

export function SeatingFurniture({ representation, colours, fabrics, colour, width, height, depth, physicalSize }: {
  representation: string; colours: Record<string,string>; fabrics: Record<string,string>; colour: string; width: number; height: number; depth: number; physicalSize: Point;
}) {
  const chair = representation.startsWith("furniture-chair-");
  const variant = representation.split("-").at(-1);
  const timber = colours.timber ?? "#B99B77", legs = colours.legs ?? "#715840", body = colours.frame ?? colour;
  const finish = (part: string): Finish => ({ colour: colours[part] ?? body, fabricId: chair ? undefined : fabrics[part], physicalSize });
  const seam = new Color(colours.cushions ?? body).multiplyScalar(.82).getStyle();
  const legTop = chair ? .48 : variant === "scandi" ? .38 : .28;
  const legWidth = chair ? .32 : .36;
  const legsGeometry = [-1,1].flatMap(x => [-1,1].map(z => <Rod key={`leg-${x}-${z}`} start={[x*(legWidth+.065),.023,z*.39]} end={[x*legWidth,legTop,z*.29]} radius={chair ? .024 : .03} taper={.63} colour={legs} />));

  if (chair) {
    const spindle = variant === "classic", wishbone = variant === "wishbone", ladder = variant === "ladder", crossback = variant === "crossback";
    const backRail: Point[] = Array.from({ length: 17 },(_,i) => { const a=(i/16*2-1)*1.15; return [Math.sin(a)*.47,.97,.06-Math.cos(a)*.46]; });
    return <group scale={[width,height,depth]}>
      {legsGeometry}
      <Pad position={[0,.49,.025]} size={[.91,.075,.85]} radius={.035} finish={finish("frame")} />
      {[-1,1].map(x => <Rod key={`apron-${x}`} start={[x*.31,.425,-.27]} end={[x*.31,.425,.30]} radius={.022} colour={body} />)}
      {[-1,1].map(z => <Rod key={`stretcher-${z}`} start={[-.35,.235,z*.32]} end={[.35,.235,z*.32]} radius={.013} colour={legs} />)}
      {spindle && <>
        <Piping points={backRail} radius={.025} colour={body} />
        {[-.34,-.225,-.11,0,.11,.225,.34].map(x => <Rod key={x} start={[x*.88,.53,-.31]} end={[x,.945,.06-Math.sqrt(.46*.46-x*x)]} radius={.013} taper={.9} colour={body} />)}
      </>}
      {wishbone && <>
        <Piping points={backRail} radius={.028} colour={body} />
        {[-1,1].map(x => <Rod key={x} start={[x*.34,.49,-.27]} end={[x*.43,.94,-.13]} radius={.022} colour={body} />)}
        <Piping points={[[0,.54,-.36],[0,.71,-.39],[-.18,.92,-.36]]} radius={.022} colour={body} />
        <Piping points={[[0,.69,-.39],[.07,.79,-.39],[.18,.92,-.36]]} radius={.022} colour={body} />
      </>}
      {(ladder || crossback) && <>
        {[-1,1].map(x => <Rod key={x} start={[x*.36,.49,-.29]} end={[x*.40,.98,-.38]} radius={.023} taper={1} colour={body} />)}
        {(crossback ? [.93] : [.65,.79,.93]).map(y => <Pad key={y} position={[0,y,-.32-(y-.5)*.15]} size={[.78,.09,.045]} finish={finish("frame")} radius={.017} />)}
        {crossback && [-1,1].map(x => <Rod key={`cross-${x}`} start={[x*.34,.56,-.32]} end={[-x*.35,.88,-.375]} radius={.023} taper={1} colour={body} />)}
      </>}
      {!spindle && !wishbone && !ladder && !crossback && <>
        <CurvedBack timber finish={finish("frame")} />
        {[-1,1].map(x => <Rod key={x} start={[x*.29,.50,-.28]} end={[x*.29,.75,-.31]} radius={.018} colour={body} />)}
      </>}
    </group>;
  }

  const scandi = variant === "scandi", tub = variant === "tub", wing = variant === "classic", club = variant === "club";
  return <group scale={[width,height,depth]}>
    {legsGeometry}
    <Pad position={[0,.33,.01]} size={[scandi ? .81 : .89,.15,.86]} finish={scandi ? { colour: timber, physicalSize } : finish("frame")} radius={.04} />
    {tub ? <CurvedBack tub finish={finish("frame")} /> : <>
      <Pad position={[0,club ? .74 : .70,-.325]} size={[wing ? .76 : .78,wing ? .57 : club ? .45 : .5,club ? .23 : .15]} tilt={-.10} finish={finish("back")} radius={club ? .09 : .06} />
      {[-1,1].map(x => scandi ? <group key={x}>
        <Rod start={[x*.43,.30,.26]} end={[x*.43,.61,.20]} radius={.025} colour={timber} />
        <Rod start={[x*.43,.31,-.29]} end={[x*.43,.65,-.32]} radius={.025} colour={timber} />
        <Pad position={[x*.43,.645,-.045]} size={[.105,.065,.77]} tilt={-.05} finish={{colour:timber,physicalSize}} radius={.026} />
      </group> : <group key={x}>
        <Pad position={[x*.413,.49,.025]} size={[.165,wing ? .37 : .28,.87]} finish={finish("frame")} radius={.065} />
        {club && <mesh position={[x*.39,.635,.015]} rotation={[Math.PI/2,0,0]} castShadow receiveShadow><capsuleGeometry args={[.105,.60,6,18]} /><FabricMaterial {...finish("frame")} /></mesh>}
        {wing && <Pad position={[x*.355,.8,-.24]} size={[.16,.34,.25]} tilt={-.10} finish={finish("back")} radius={.07} />}
      </group>)}
    </>}
    <Pad position={[0,.453,.04]} size={[tub ? .74 : scandi ? .74 : .68,.155,.70]} finish={finish("cushions")} radius={.065} />
    {tub && <Pad position={[0,.697,-.267]} size={[.62,.38,.15]} tilt={-.14} finish={finish("back")} radius={.055} />}
    <Piping points={[[-.28,.5,-.27],[-.335,.5,-.21],[-.335,.5,.31],[-.28,.5,.365],[.28,.5,.365],[.335,.5,.31],[.335,.5,-.21],[.28,.5,-.27],[-.28,.5,-.27]]} colour={seam} />
    {(wing || club) && [-.18,.18].flatMap(x => [.69,.83].map(y => <mesh key={`${x}-${y}`} position={[x,y,club ? -.20 : -.235]} castShadow><sphereGeometry args={[.015,12,8]} /><meshStandardMaterial color={colours.back ?? body} roughness={.9} /></mesh>))}
  </group>;
}
