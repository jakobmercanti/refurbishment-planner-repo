"use client";
import { DoorFixture } from "@/components/DoorFixture";
import { StaircaseFixture, WindowFixture } from "@/components/ArchitecturalFixtures";
import { RoundedBox } from "@react-three/drei";
import { RoomFurniture } from "@/components/RoomFurniture";
import { KitchenFurniture } from "@/components/KitchenFurniture";
import { Vector2, Vector3, CatmullRomCurve3, DoubleSide, Shape, Path } from "three";
import { fixtureRepresentation } from "@/components/FixturePlanSymbol";
import type { Obstacle } from "@/lib/types";

function smoothProfile(points: number[][]) {
  return new CatmullRomCurve3(points.map(([x, y]) => new Vector3(x, y, 0))).getPoints(96).map(p => new Vector2(Math.max(0, p.x), p.y));
}
const bowlProfile = smoothProfile([[.03,0],[.23,.02],[.39,.15],[.49,.38],[.5,.43],[.48,.46],[.45,.43],[.41,.28],[.30,.14],[.12,.09],[.03,.09]]);
const wcProfile = smoothProfile([[.10,0],[.24,.02],[.38,.09],[.47,.22],[.5,.37],[.5,.44],[.48,.46],[.435,.45],[.42,.38],[.35,.23],[.23,.14],[.10,.12],[0,.12]]);
const seatProfile = smoothProfile([[.39,0],[.46,0],[.495,.014],[.49,.038],[.46,.046],[.385,.041],[.37,.024],[.39,0]]);
const footProfile = smoothProfile([[0,0],[.27,0],[.30,.025],[.27,.15],[.23,.35],[.31,.53],[.35,.58]]);
function deckShape(double: boolean, corner: boolean) {
  const shape = new Shape();
  if (corner) { shape.moveTo(-.5,.5); shape.lineTo(.5,.5); shape.quadraticCurveTo(.5,-.5,-.5,-.5); shape.closePath(); }
  else { shape.moveTo(-.5,-.5); shape.lineTo(.5,-.5); shape.lineTo(.5,.5); shape.lineTo(-.5,.5); shape.closePath(); }
  for (const x of double ? [-.25,.25] : [corner ? -.10 : 0]) {
    const hole = new Path(); hole.absellipse(x,corner ? .10 : -.07,double ? .195 : corner ? .30 : .43,corner ? .29 : .36,0,Math.PI*2,true); shape.holes.push(hole);
  }
  return shape;
}
const decks = {single:deckShape(false,false),double:deckShape(true,false),corner:deckShape(false,true)};
const quadrantTray = new Shape();
quadrantTray.moveTo(-.5,.5); quadrantTray.lineTo(.5,.5); quadrantTray.absarc(-.5,.5,1,0,-Math.PI/2,true); quadrantTray.closePath();
function Bowl({ x = 0, y, z = 0, width, depth, height }: { x?: number; y: number; z?: number; width: number; depth: number; height: number }) {
  return <group position={[x, y, z]}>
    <mesh scale={[width, height / .46, depth]} castShadow receiveShadow><latheGeometry args={[bowlProfile, 64]} /><meshStandardMaterial color="#fafaf7" roughness={.16} side={DoubleSide} /></mesh>
    <mesh position={[0, height * .21, 0]}><cylinderGeometry args={[width * .04, width * .04, .005, 20]} /><meshStandardMaterial color="#89928f" metalness={.8} roughness={.18} /></mesh>
  </group>;
}
function Block({ position, size, colour = "#f4f3ef" }: { position: [number, number, number]; size: [number, number, number]; colour?: string }) {
  return <RoundedBox args={size} radius={Math.min(...size) * .18} smoothness={4} position={position} castShadow receiveShadow><meshStandardMaterial color={colour} roughness={.25} /></RoundedBox>;
}

/** Normalised render-only geometry: world millimetres are converted by the caller. */
export function ParametricFixture({ obstacle, width, depth, height }: { obstacle: Obstacle; width: number; depth: number; height: number }) {
  const key = fixtureRepresentation(obstacle);
  if (key.startsWith("door-")) return <DoorFixture representation={key} width={width} depth={depth} height={height} colour={obstacle.color_hex} />;
  if (key.startsWith("furniture-stair-")) return <StaircaseFixture representation={key} width={width} depth={depth} height={height} colour={obstacle.color_hex} />;
  if (key.startsWith("window-")) return <WindowFixture representation={key} width={width} depth={depth} height={height} />;
  if (/^furniture-(kitchen-|wardrobe-)/.test(key)) return <KitchenFurniture representation={key} colour={obstacle.color_hex ?? "#C7B69C"} width={width} depth={depth} height={height} />;
  if (/^furniture-(sofa|armchair|chair|bed|table)-/.test(key)) return <RoomFurniture representation={key} colour={obstacle.color_hex ?? "#b99b77"} width={width} depth={depth} height={height} />;
  const kind = obstacle.fixture_kind ?? key.split("-")[0].toUpperCase();
  const chrome = <meshStandardMaterial color="#bac4c3" metalness={.92} roughness={.16} />;
  const glass = <meshPhysicalMaterial color="#d5e8e8" transparent opacity={.25} roughness={.06} metalness={.05} depthWrite={false} side={DoubleSide} />;
  return <group scale={[width, height, depth]}>
    {kind === "TOILET" && (() => {
      const cistern = key.includes("close-coupled");
      const hung = key.includes("wall-mounted");
      const top = cistern ? .51 : .94;
      const bowlDepth = cistern ? .71 : .90;
      const centre = cistern ? .13 : .035;
      return <>
        {!hung && <mesh scale={[.90,top,.75]} position={[0,0,centre]} castShadow receiveShadow><latheGeometry args={[footProfile,96]} /><meshPhysicalMaterial color="#f6f5f1" roughness={.19} clearcoat={.55} /></mesh>}
        {cistern && <Block position={[0,top*.70,-.24]} size={[.72,top*.51,.43]} />}
        {(hung || key.includes("back-to-wall")) && <Block position={[0,top*.49,-.28]} size={[.72,top*(hung ? .45 : .95),.43]} />}
        <mesh position={[0,top*.40,centre]} scale={[.96,top*1.22,bowlDepth]} castShadow receiveShadow><latheGeometry args={[wcProfile,96]} /><meshPhysicalMaterial color="#faf9f5" roughness={.14} clearcoat={.65} side={DoubleSide} /></mesh>
        <mesh position={[0,top,centre]} scale={[.99,cistern ? .6 : 1,bowlDepth*1.03]} castShadow receiveShadow><latheGeometry args={[seatProfile,96]} /><meshPhysicalMaterial color="#ffffff" roughness={.23} clearcoat={.4} /></mesh>
        <mesh position={[0,top*.555,centre]} rotation={[-Math.PI/2,0,0]} scale={[.17,.20,1]}><circleGeometry args={[1,48]} /><meshPhysicalMaterial color="#b6d4d4" roughness={.08} metalness={.15} /></mesh>
        {[-.19,.19].map(x => <Block key={x} position={[x,top+.005,centre-bowlDepth*.39]} size={[.105,.018,.06]} colour="#b4bcbd" />)}
        {cistern && <><Block position={[0,.705,-.345]} size={[.88,.51,.30]} /><Block position={[0,.969,-.345]} size={[.91,.032,.31]} /><mesh position={[.18,.99,-.345]}>{chrome}<cylinderGeometry args={[.043,.043,.006,32]} /></mesh></>}
      </>;
    })()}
    {kind === "BASIN" && (() => {
      const vanity = key.includes("vanity") || key.includes("undermount");
      const double = key.includes("double");
      return <>
        {vanity && <>
          {/* Hollow carcass: a solid cabinet would fill the basin's interior. */}
          {[-.455,.455].map(x => <Block key={x} position={[x,.45,0]} size={[.035,.86,.94]} colour="#a78d70" />)}
          <Block position={[0,.45,-.455]} size={[.88,.86,.035]} colour="#a78d70" />
          <Block position={[0,.03,0]} size={[.88,.04,.94]} colour="#a78d70" />
          {[-.24,.24].map(x => <group key={x}><Block position={[x,.45,.475]} size={[.455,.84,.03]} colour={obstacle.color_hex === "#F4F3EE" ? "#b7a187" : obstacle.color_hex ?? "#b7a187"} /><Block position={[x,.73,.496]} size={[.20,.012,.008]} colour="#76827c" /></group>)}
          <mesh position={[0,.88,0]} rotation={[-Math.PI/2,0,0]} castShadow receiveShadow><extrudeGeometry args={[double ? decks.double : decks.single,{depth:.025,bevelEnabled:false,curveSegments:64}]} /><meshStandardMaterial color="#f4f3ef" roughness={.22} /></mesh>
        </>}
        {key.includes("pedestal") && <mesh position={[0, .36, -.04]} castShadow><cylinderGeometry args={[.18, .26, .72, 48]} /><meshStandardMaterial color="#f4f3ef" roughness={.2} /></mesh>}
        {key.includes("countertop") && <Block position={[0, .69, 0]} size={[1, .06, 1]} colour="#a78d70" />}
        {!vanity && !key.includes("countertop") && !key.includes("corner") && <Block position={[0, .79, -.34]} size={[.94, .20, .27]} />}
        {key.includes("corner") && <mesh position={[0,.89,0]} rotation={[-Math.PI/2,0,0]} castShadow><extrudeGeometry args={[decks.corner,{depth:.035,bevelEnabled:false,curveSegments:64}]} /><meshStandardMaterial color="#fafaf7" roughness={.19} /></mesh>}
        {(double ? [-.25, .25] : [0]).map(x => <group key={x}>
          <Bowl x={key.includes("corner") ? -.10 : x} y={.71} z={key.includes("corner") ? -.10 : .07} width={double ? .44 : key.includes("corner") ? .68 : .98} depth={key.includes("corner") ? .66 : .83} height={.20} />
          <mesh position={[x, .86, -.38]}>{chrome}<cylinderGeometry args={[.024, .026, .24, 20]} /></mesh>
          <Block position={[x, .974, -.29]} size={[.05, .045, .23]} colour="#aebbb9" />
        </group>)}
      </>;
    })()}
    {kind === "SHOWER" && <>
      {key.includes("quadrant") ? <mesh rotation={[-Math.PI/2,0,0]} castShadow receiveShadow><extrudeGeometry args={[quadrantTray,{depth:.034,bevelEnabled:false,curveSegments:64}]} /><meshStandardMaterial color="#f4f3ef" roughness={.24} /></mesh> : <Block position={[0, .017, 0]} size={[1, .034, 1]} />}
      <Block position={[0, .036, .10]} size={[.15, .004, .09]} colour="#737f7c" />
      {key.includes("quadrant") ? <mesh position={[-.49, .515, -.49]}><cylinderGeometry args={[.98, .98, .96, 64, 1, true, 0, Math.PI / 2]} />{glass}</mesh> : <>
        {!key.includes("wet-room") && !key.includes("alcove") && <mesh position={[-.492, .515, 0]}><boxGeometry args={[.012, .96, 1]} />{glass}</mesh>}
        {!key.includes("walk-in") && !key.includes("wet-room") && !key.includes("alcove") && <mesh position={[.492, .515, 0]}><boxGeometry args={[.012, .96, 1]} />{glass}</mesh>}
        <mesh position={[key.includes("walk-in") ? -.15 : 0, .515, .492]}><boxGeometry args={[key.includes("walk-in") || key.includes("wet-room") ? .66 : 1, .96, .012]} />{glass}</mesh>
      </>}
      {key.includes("freestanding") && <mesh position={[0, .515, -.492]}><boxGeometry args={[1, .96, .012]} />{glass}</mesh>}
      <mesh position={[0, .58, -.46]}>{chrome}<cylinderGeometry args={[.014, .014, .66, 16]} /></mesh>
      <Block position={[0, .91, -.34]} size={[.025, .012, .24]} colour="#b0bbba" />
      <mesh position={[0, .905, -.23]}>{chrome}<cylinderGeometry args={[.12, .12, .015, 40]} /></mesh>
      <Block position={[0, .44, -.45]} size={[.20, .035, .06]} colour="#b0bbba" />
      {!key.includes("wet-room") && !key.includes("quadrant") && [-.48,.48].map(x => <Block key={x} position={[x,.51,.48]} size={[.016,.95,.02]} colour="#aeb8b8" />)}
      {!key.includes("walk-in") && !key.includes("wet-room") && <Block position={key.includes("quadrant") ? [.20,.51,.20] : [.12,.51,.493]} size={[.016,.12,.026]} colour="#919d9e" />}
    </>}
    {kind === "FURNITURE" && <><Block position={[0,.48,0]} size={[.97,.94,.94]} colour={obstacle.color_hex === "#F4F3EE" ? "#b59b7d" : obstacle.color_hex ?? "#b59b7d"} /><Block position={[0,.967,0]} size={[1,.036,1]} />{[-.235,.235].map(x => <group key={x}><Block position={[x,.48,.48]} size={[.455,.89,.035]} colour="#c5af94" /><Block position={[x>0 ? .08 : -.08,.67,.505]} size={[.025,.16,.025]} colour="#788488" /></group>)}</>}
    {(kind === "DOOR" || kind === "WINDOW") && (() => {
      const count = kind === "DOOR" ? (key.includes("double") ? 2 : 1) : key.includes("triple") ? 3 : key.includes("double") ? 2 : 1;
      return <>{[-.475,.475].map(x => <Block key={x} position={[x,.5,0]} size={[.05,1,1]} />)}{[.025,.975].map(y => <Block key={y} position={[0,y,0]} size={[.95,.05,1]} />)}{Array.from({length:count},(_,i) => {
        const w=.90/count; const x=-.45+w*(i+.5);
        return <group key={i}><Block position={[x,.5,0]} size={[w-.015,.90,.45]} colour={kind === "DOOR" ? "#c6ad8e" : "#91b4be"} />{kind === "DOOR" ? <><Block position={[x,.70,.245]} size={[w*.73,.32,.08]} colour="#d8c6b0" /><Block position={[x,.25,.245]} size={[w*.73,.40,.08]} colour="#d8c6b0" /><Block position={[x+w*.32,.49,.37]} size={[w*.16,.014,.12]} colour="#7f8d93" /></> : <><Block position={[x,.5,.30]} size={[.015,.9,.16]} /><Block position={[x,.5,.30]} size={[w,.018,.16]} /></>}</group>;
      })}</>;
    })()}
  </group>;
}
