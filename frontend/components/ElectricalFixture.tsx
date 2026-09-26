"use client";
import { RoundedBox } from "@react-three/drei";
import { CatmullRomCurve3, DoubleSide, Vector2, Vector3 } from "three";
import { metalFinishProps } from "@/lib/metalSurface";

type Point = [number, number, number];
const metal = "#AEB7BD";
const dark = "#262D33";
const opal = "#F7F5E9";
const domeProfile = [[.48,0],[.5,.025],[.49,.12],[.43,.42],[.30,.75],[.12,.95],[.07,1]].map(([x,y]) => new Vector2(x,y));

function Block({ at, size, colour, metallic = false, glow = false }: { at: Point; size: Point; colour: string; metallic?: boolean; glow?: boolean }) {
  return <RoundedBox position={at} args={size} radius={Math.min(...size) * .14} smoothness={3} castShadow receiveShadow>
    <meshStandardMaterial color={colour} metalness={metallic ? .72 : .03} roughness={metallic ? .3 : .36} {...(glow ? {} : metalFinishProps(colour))} emissive={glow ? colour : "#000000"} emissiveIntensity={glow ? .25 : 0} />
  </RoundedBox>;
}
function Disc({ at, size, colour, front = false, metallic = false }: { at: Point; size: Point; colour: string; front?: boolean; metallic?: boolean }) {
  return <mesh position={at} rotation={front ? [Math.PI / 2,0,0] : [0,0,0]} scale={front ? [size[0],size[2],size[1]] : size} castShadow receiveShadow>
    <cylinderGeometry args={[.5,.5,1,48]} /><meshStandardMaterial color={colour} metalness={metallic ? .75 : .04} roughness={.32} {...metalFinishProps(colour)} />
  </mesh>;
}
function Ball({ at, size, colour }: { at: Point; size: Point; colour: string }) {
  return <mesh position={at} scale={size} castShadow><sphereGeometry args={[.5,40,24]} /><meshPhysicalMaterial color={colour} roughness={.24} clearcoat={.28} {...metalFinishProps(colour)} /></mesh>;
}
function Screw({ x, y, z, colour = metal }: { x: number; y: number; z: number; colour?: string }) {
  return <><Disc at={[x,y,z]} size={[.046,.046,.012]} colour={colour} front metallic /><Block at={[x,y,z+.008]} size={[.03,.007,.005]} colour={dark} /></>;
}
function CageTube({ points, colour, radius, closed = false }: { points: Point[]; colour: string; radius: number; closed?: boolean }) {
  const curve = new CatmullRomCurve3(points.map(([x,y,z]) => new Vector3(x,y,z)), closed, "centripetal");
  return <mesh castShadow receiveShadow><tubeGeometry args={[curve, points.length * 8, radius, 8, closed]} /><meshStandardMaterial color={colour} metalness={.48} roughness={.34} {...metalFinishProps(colour)} /></mesh>;
}
function Plate({ colour, hardware, metallic = false }: { colour: string; hardware: string; metallic?: boolean }) {
  return <><Block at={[0,.5,-.1]} size={[1,1,.8]} colour={colour} metallic={metallic} /><Block at={[0,.5,.31]} size={[.94,.94,.08]} colour={colour} metallic={metallic} />
    {[-.405,.405].map(x => <Screw key={x} x={x} y={.5} z={.366} colour={hardware} />)}</>;
}
function SocketFace({ x, controls, hardware, width = .36, usb = false }: { x: number; controls: string; hardware: string; width?: number; usb?: boolean }) {
  return <group position={[x,0,0]}>
    <Block at={[0,.73,.385]} size={[width*.65,.20,.13]} colour={controls} />
    <Block at={[width*.22,.79,.458]} size={[.023,.035,.008]} colour="#BE4741" />
    {/* Recessed UK earth, neutral and live pin openings. */}
    <Block at={[0,.49,.363]} size={[width*.14,.11,.025]} colour={dark} />
    {[-.22,.22].map(offset => <Block key={offset} at={[offset*width,.31,.363]} size={[width*.23,.065,.025]} colour={dark} />)}
    {usb && <><Block at={[-.045,.13,.37]} size={[.095,.045,.028]} colour={dark} /><Block at={[.07,.13,.37]} size={[.058,.038,.028]} colour={dark} /><Block at={[-.045,.13,.388]} size={[.063,.012,.006]} colour={hardware} /></>}
  </group>;
}

/** Detailed render-only meshes, scaled only at the existing Three.js boundary. */
export function ElectricalFixture({ representation, width, depth, height, colour: defaultColour, colours = {} }: { representation: string; width: number; depth: number; height: number; colour: string; colours?: Record<string, string> }) {
  const key = representation.replace("electrical-", "");
  const colour = colours.body ?? defaultColour;
  const controls = colours.controls ?? colour;
  const mounting = colours.mounting ?? colour;
  const hardware = colours.hardware ?? metal;
  const cable = colours.cable ?? dark;
  const grille = colours.grille ?? colour;
  const blades = colours.blades ?? "#BEC5C7";
  const filters = colours.filters ?? metal;
  let model;
  if (key === "switch-pull") {
    model = <><Disc at={[0,.97,0]} size={[1,.06,1]} colour={colour} /><Disc at={[0,.925,0]} size={[.72,.04,.72]} colour={colour} />
      <Disc at={[0,.49,0]} size={[.028,.84,.028]} colour={colours.cable ?? "#DEDCD5"} /><Ball at={[0,.045,0]} size={[.18,.09,.18]} colour={controls} />
      {[-.3,.3].map(x => <Disc key={x} at={[x,.936,0]} size={[.07,.003,.07]} colour={hardware} metallic />)}</>;
  } else if (key.startsWith("switch-")) {
    model = <><group scale={[1,1,key === "switch-dimmer" ? .4 : 1]} position={[0,0,key === "switch-dimmer" ? -.3 : 0]}><Plate colour={colour} hardware={hardware} metallic={key === "switch-dimmer"} /></group>
      {key === "switch-dimmer" ? <><Disc at={[0,.5,.16]} size={[.38,.38,.65]} colour={controls} metallic front /><Block at={[0,.64,.493]} size={[.027,.06,.008]} colour={dark} /></>
        : (key === "switch-double" ? [-.18,.18] : [0]).map(x => <group key={x} rotation={[.04,0,0]}><Block at={[x,.5,.365]} size={[key === "switch-double" ? .28 : .40,.58,.24]} colour={controls} /><Block at={[x,.735,.491]} size={[.08,.012,.008]} colour="#B7BDC0" /></group>)}</>;
  } else if (key.startsWith("socket-")) {
    const single = key === "socket-single", weather = key === "socket-weatherproof";
    model = <><Plate colour={colour} hardware={hardware} />{(single ? [0] : [-.235,.235]).map(x => <SocketFace key={x} x={x} controls={colours.controls ?? "#FAF9F4"} hardware={hardware} width={single ? .6 : .36} usb={key === "socket-usb"} />)}
      {weather && <><mesh position={[0,.53,.475]}><boxGeometry args={[.94,.84,.025]} /><meshPhysicalMaterial color="#99A7AD" transparent opacity={.23} roughness={.18} depthWrite={false} /></mesh><Block at={[0,.05,.46]} size={[.23,.07,.08]} colour={dark} /><Block at={[0,.97,.38]} size={[.8,.05,.16]} colour={hardware} /></>}</>;
  } else if (key.startsWith("ceiling-")) {
    const square = key === "ceiling-square";
    model = square ? <><Block at={[0,.975,0]} size={[.94,.05,.94]} colour={mounting} /><Block at={[0,.545,0]} size={[1,.81,1]} colour={colour} /><Block at={[0,.07,0]} size={[.9,.14,.9]} colour={opal} glow /></>
      : <><Disc at={[0,.975,0]} size={[.94,.05,.94]} colour={mounting} /><Disc at={[0,.565,0]} size={[1,.77,1]} colour={colour} metallic={key === "ceiling-downlight"} />
        <Disc at={[0,.14,0]} size={[key === "ceiling-downlight" ? .72 : .93,.22,key === "ceiling-downlight" ? .72 : .93]} colour={opal} />
        {key === "ceiling-drum" && <Disc at={[0,.96,0]} size={[.97,.07,.97]} colour={hardware} metallic />}</>;
  } else if (key.startsWith("pendant-")) {
    const linear = key === "pendant-linear";
    model = <>{!linear && <><Disc at={[0,.974,0]} size={[.28,.05,.28]} colour={mounting} metallic /><Disc at={[0,.946,0]} size={[.08,.018,.08]} colour={hardware} metallic /><Disc at={[0,.62,0]} size={[.007,.69,.007]} colour={cable} /></>}
      {key === "pendant-dome" ? <><mesh position={[0,.015,0]} scale={[1,.31,1]} castShadow><latheGeometry args={[domeProfile,64]} /><meshStandardMaterial color={colour} metalness={.45} roughness={.3} side={DoubleSide} {...metalFinishProps(colour)} /></mesh><Disc at={[0,.012,0]} size={[.90,.02,.90]} colour={opal} /></>
        : key === "pendant-globe" ? <><Ball at={[0,.18,0]} size={[1,.35,1]} colour={opal} /><Disc at={[0,.365,0]} size={[.16,.04,.16]} colour={colour} metallic /></>
        : <>
          {[-.36,.36].map(x => <group key={x}>
            <Disc at={[x,.985,0]} size={[.075,.03,.90]} colour={mounting} metallic />
            <Disc at={[x,.966,0]} size={[.026,.022,.36]} colour={hardware} metallic />
            <Disc at={[x,.545,0]} size={[.0025,.85,.03]} colour={cable} metallic />
            <Disc at={[x,.12,0]} size={[.025,.016,.34]} colour={hardware} metallic />
          </group>)}
          <Block at={[0,.075,0]} size={[1,.075,.64]} colour={colour} metallic />
          <Block at={[0,.039,0]} size={[.98,.014,.58]} colour="#F5F1E5" glow />
        </>}</>;
  } else if (key.startsWith("wall-")) {
    if (key === "wall-bulkhead") {
      // The glass is a shallow ellipsoidal dome. Keep every guard segment on
      // its front surface so the cage reads as one fitted assembly, not loose
      // loops passing through or behind the luminaire.
      const domeDepth = (x: number, y: number) => .075 + .14 * Math.sqrt(Math.max(0,
        1 - (x / .385) ** 2 - ((y - .5) / .42) ** 2,
      ));
      const perimeter: Point[] = Array.from({ length: 48 }, (_, index) => {
        const angle = index * Math.PI * 2 / 48;
        const x = .385 * Math.cos(angle);
        const y = .5 + .42 * Math.sin(angle);
        return [x, y, domeDepth(x, y) + .014];
      });
      const horizontalGuards: Point[][] = [.34,.66].map(y => {
        const halfWidth = .385 * Math.sqrt(1 - ((y - .5) / .42) ** 2) * .98;
        return Array.from({ length: 17 }, (_, index) => {
          const x = -halfWidth + 2 * halfWidth * index / 16;
          return [x, y, domeDepth(x, y) + .022] as Point;
        });
      });
      const verticalGuards: Point[][] = [-.31,.31].map(x => {
        const halfHeight = .42 * Math.sqrt(1 - (x / .385) ** 2) * .96;
        return Array.from({ length: 17 }, (_, index) => {
          const y = .5 - halfHeight + 2 * halfHeight * index / 16;
          return [x, y, domeDepth(x, y) + .022] as Point;
        });
      });
      model = <>
        {/* Oval wall plate, deep sealed housing and a distinct raised bezel. */}
        <Disc at={[0,.5,-.18]} size={[.96,.28,.98]} colour={mounting} front metallic />
        <Disc at={[0,.5,-.015]} size={[.88,.16,.91]} colour={colour} front />
        <Disc at={[0,.5,.065]} size={[.82,.07,.85]} colour={mounting} front metallic />
        {/* Single opal diffuser: a smooth, softly translucent front dome. */}
        <mesh position={[0,.5,.075]} scale={[.77,.84,.28]} castShadow receiveShadow>
          <sphereGeometry args={[.5,64,40]} />
          <meshPhysicalMaterial color="#F5F3E9" roughness={.34} clearcoat={.22} transparent opacity={.92} />
        </mesh>
        {/* One oval perimeter plus two horizontal and two upright guard wires. */}
        <CageTube points={perimeter} colour={grille} radius={.012} closed />
        {horizontalGuards.map((points,index) => <CageTube key={"crossbar-" + index} points={points} colour={grille} radius={.011} />)}
        {verticalGuards.map((points,index) => <CageTube key={"upright-" + index} points={points} colour={grille} radius={.011} />)}
        {[.12,.88].flatMap(y => [-.30,.30].map(x => <group key={`${x}-${y}`}>
          <Disc at={[x,y,.075]} size={[.038,.038,.018]} colour={hardware} front metallic />
          <Block at={[x,y,.087]} size={[.022,.004,.003]} colour={dark} />
        </group>))}
      </>;
    } else if (key === "wall-cylinder") {
      model = <><Block at={[0,.5,-.41]} size={[.7,.65,.18]} colour={mounting} />
        <mesh position={[0,.5,.08]} scale={[1,1,.72]} castShadow receiveShadow>
          <cylinderGeometry args={[.5,.5,1,64,1,true]} />
          <meshStandardMaterial color={colour} metalness={.45} roughness={.3} side={DoubleSide} {...metalFinishProps(colour)} />
        </mesh>
        {[.035,.965].map(y => <Disc key={y} at={[0,y,.08]} size={[.83,.025,.60]} colour={opal} />)}</>;
    } else if (key === "wall-globe") {
      model = <><Disc at={[0,.6,-.44]} size={[.6,.52,.12]} colour={mounting} front metallic /><Block at={[0,.38,-.08]} size={[.055,.055,.72]} colour={colour} metallic />
        <Disc at={[0,.46,.13]} size={[.30,.14,.24]} colour={colour} metallic /><Ball at={[0,.64,.13]} size={[1,.72,.74]} colour={opal} /></>;
    } else {
      model = <>
        <Disc at={[0,.5,-.38]} size={[.84,.16,.84]} colour={mounting} front metallic />
        <Disc at={[0,.5,-.17]} size={[1,.42,1]} colour={colour} front metallic />
        <Disc at={[0,.5,.06]} size={[.92,.06,.92]} colour="#171D20" front />
        <Ball at={[0,.5,.055]} size={[.84,.88,.42]} colour={opal} />
        {[-.31,.31].flatMap(x => [.18,.82].map(y => <group key={`${x}-${y}`}>
          <Disc at={[x,y,.105]} size={[.05,.07,.03]} colour={hardware} front metallic />
          <Block at={[x,y,.141]} size={[.03,.004,.003]} colour={dark} />
        </group>))}
      </>;
    }
  } else if (key.startsWith("sensor-")) {
    if (key === "sensor-co") {
      model = <><Block at={[0,.5,0]} size={[1,1,.88]} colour={colour} /><Block at={[.12,.57,.45]} size={[.43,.36,.02]} colour="#50635C" />
        {Array.from({length:6},(_,i) => <Block key={i} at={[-.32,.3+i*.085,.451]} size={[.19,.025,.015]} colour={dark} />)}
        <Block at={[.12,.25,.46]} size={[.21,.13,.045]} colour={controls} /><Ball at={[.38,.22,.46]} size={[.045,.07,.035]} colour="#41A172" />
        {[0,1].map(i => <group key={i} position={[.055+i*.13,0,0]}>{[.48,.57,.66].map(y => <Block key={y} at={[0,y,.465]} size={[.09,.017,.008]} colour="#BBCEAF" />)}{[-.04,.04].map(x => <Block key={x} at={[x,.57,.465]} size={[.015,.18,.008]} colour="#BBCEAF" />)}</group>)}</>;
    } else {
      model = <><Disc at={[0,.86,0]} size={[1,.28,1]} colour={colour} /><Disc at={[0,.48,0]} size={[.94,.50,.94]} colour={colour} />
        {Array.from({length:24},(_,i) => <group key={i} rotation={[0,i*Math.PI/12,0]}><Block at={[0,.48,.469]} size={[.06,.22,.018]} colour="#535C61" /></group>)}
        <Disc at={[0,.16,0]} size={[.78,.24,.78]} colour={colour} /><Disc at={[0,.031,.03]} size={[.26,.055,.26]} colour={controls} />
        {key === "sensor-heat" && <Disc at={[0,.035,0]} size={[.07,.065,.07]} colour={hardware} metallic />}
        <Ball at={[.22,.045,.19]} size={[.055,.04,.055]} colour="#419C6C" /></>;
    }
  } else if (key === "fan-axial" || key === "fan-silent") {
    model = <><Block at={[0,.5,-.08]} size={[1,1,.84]} colour={colour} /><Disc at={[0,.5,.35]} size={[.76,.76,.05]} colour={dark} front />
      {Array.from({length:5},(_,i) => <group key={i} position={[0,.5,.39]} rotation={[0,0,i*Math.PI*2/5]}><mesh position={[.13,0,0]} rotation={[.3,0,.35]}><boxGeometry args={[.31,.13,.02]} /><meshStandardMaterial color={blades} metalness={.35} roughness={.4} {...metalFinishProps(blades)} /></mesh></group>)}
      <Disc at={[0,.5,.42]} size={[.17,.17,.06]} colour={blades} front />
      {key === "fan-silent" ? <Block at={[0,.5,.46]} size={[.82,.82,.08]} colour={grille} />
        : Array.from({length:9},(_,i) => <Block key={i} at={[0,.20+i*.075,.47]} size={[.76,.022,.045]} colour={grille} />)}
      <Ball at={[.36,.1,.43]} size={[.024,.024,.025]} colour="#64AA87" /></>;
  } else if (key === "fan-hood" || key === "fan-canopy") {
    const hood = key === "fan-hood";
    model = <><Block at={[0,hood ? .06 : .48,0]} size={[1,hood ? .12 : .96,1]} colour={colour} metallic />
      {hood && <><mesh position={[0,.20,0]} scale={[1,.23,1]} castShadow><cylinderGeometry args={[.24,.70,1,4,1,false,Math.PI/4]} /><meshStandardMaterial color={colour} metalness={.7} roughness={.31} {...metalFinishProps(colour)} /></mesh><Block at={[0,.635,-.24]} size={[.34,.73,.46]} colour={colours.chimney ?? colour} metallic /></>}
      {[-.25,.25].map(x => <group key={x}><Block at={[x,.008,0]} size={[.41,.012,.73]} colour={filters} metallic />{Array.from({length:10},(_,i) => <Block key={i} at={[x,.001,-.32+i*.07]} size={[.39,.006,.015]} colour={filters} metallic />)}</group>)}
      {[-.39,.39].map(x => <Disc key={x} at={[x,.005,.38]} size={[.085,.01,.09]} colour={opal} />)}
      {Array.from({length:4},(_,i) => <Block key={i} at={[.22+i*.055,hood ? .065 : .5,.493]} size={[.032,hood ? .018 : .1,.012]} colour={controls} />)}</>;
  } else if (key.startsWith("board-")) {
    const ways = key === "board-large" ? 12 : 6;
    model = <><Block at={[0,.5,-.04]} size={[1,1,.92]} colour={colour} /><Block at={[0,.53,.435]} size={[.88,.74,.015]} colour={colours.panel ?? "#B1B8BC"} />
      <Block at={[0,.77,.46]} size={[.83,.09,.035]} colour="#EAE9E0" />
      {Array.from({length:ways},(_,i) => <group key={i} position={[-.38+(i+.5)*.65/ways,0,0]}><Block at={[0,.50,.455]} size={[.6/ways,.38,.055]} colour={colours.breakers ?? "#F8F7F1"} /><Block at={[0,.5,.489]} size={[.39/ways,.12,.022]} colour={controls} /><Block at={[0,.64,.49]} size={[.36/ways,.035,.012]} colour="#53616A" /></group>)}
      <Block at={[.35,.50,.455]} size={[.13,.38,.055]} colour={colours.breakers ?? "#F8F7F1"} /><Block at={[.35,.50,.489]} size={[.08,.12,.022]} colour="#AD3431" />
      <mesh position={[0,.53,.496]}><boxGeometry args={[.9,.68,.008]} /><meshPhysicalMaterial color="#83969D" transparent opacity={.2} roughness={.13} depthWrite={false} /></mesh>
      <Block at={[0,.185,.483]} size={[.20,.035,.025]} colour={colour} />{[-.42,.42].map(x => <Screw key={x} x={x} y={.92} z={.429} colour={hardware} />)}</>;
  }
  return <group scale={[width,height,depth]}>{model}</group>;
}
