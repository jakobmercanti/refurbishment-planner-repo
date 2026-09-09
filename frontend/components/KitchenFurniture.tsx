"use client";
import { RoundedBox } from "@react-three/drei";
import { CatmullRomCurve3, Vector3 } from "three";

/** Render proportions only; the caller supplies the authoritative physical envelope. */
export function KitchenFurniture({ representation: key, colour, width, depth, height }: {
  representation: string; colour: string; width: number; depth: number; height: number;
}) {
  const sink = key.includes("sink"), fridge = key.includes("fridge"), wardrobe = key.includes("wardrobe");
  const washing = key.includes("washing"), oven = key.includes("oven"), hob = key.includes("hob");
  const double = key.includes("double") || key.includes("big");
  const top = sink ? .78 : 1;
  const metal = "#B6BABB", dark = "#20282D";
  const box = (id: string, x: number, y: number, z: number, w: number, h: number, d: number, color = colour, metallic = false) =>
    <RoundedBox key={id} args={[w,h,d]} position={[x,y,z]} radius={Math.min(w,h,d)*.08} smoothness={3} castShadow receiveShadow><meshStandardMaterial color={color} roughness={metallic ? .23 : .48} metalness={metallic ? .85 : 0} /></RoundedBox>;
  const doors = double ? 2 : 1;
  const faceTop = top-.045;
  const parts = [
    box("plinth",0,.045,0,.94,.09,.87,"#5B554C"),
    box("left",-.483,top/2,0,.034,top-.1,.96),
    box("right",.483,top/2,0,.034,top-.1,.96),
    box("back",0,top/2,-.475,.94,top-.1,.03),
    box("base",0,.11,0,.94,.04,.94),
  ];
  if (!sink) parts.push(box("top",0,top-.018,0,1,.036,1,fridge ? metal : wardrobe ? colour : "#77736B",fridge));
  if (!oven && !washing) for(let i=0;i<doors;i++) {
    const x = -.5+(i+.5)/doors, dw=1/doors-.012;
    parts.push(box("door"+i,x,(faceTop+.12)/2,.472,dw,faceTop-.12,.035,fridge ? metal : colour,fridge));
    parts.push(box("handle"+i,x+(double ? (i===0 ? 1 : -1)*dw*.36 : dw*.32), wardrobe || fridge ? .53 : faceTop-.06,.498,.012,wardrobe || fridge ? .22 : .035,.018,metal,true));
  }
  if(fridge) {
    parts.push(box("freezer-seam",0,.28,.494,.97,.006,.007,dark));
    parts.push(box("display",double ? .15 : 0,.73,.495,.14,.065,.009,dark));
  }
  if(sink) {
    // Open countertop frame and recessed basins: no solid slab over the bowls.
    parts.push(box("rim-back",0,top,-.385,1,.025,.23,metal,true),box("rim-front",0,top,.385,1,.025,.23,metal,true));
    parts.push(box("rim-left",-.47,top,0,.06,.025,.55,metal,true),box("rim-right",.47,top,0,.06,.025,.55,metal,true));
    if(double) parts.push(box("divider",0,top,0,.06,.025,.55,metal,true));
    for(let i=0;i<doors;i++){
      const x=-.5+(i+.5)/doors, bw=.88/doors;
      parts.push(box("bowl-bottom"+i,x,top-.13,0,bw,.015,.51,metal,true),
        box("bowl-back"+i,x,top-.065,-.255,bw,.13,.015,metal,true),
        box("bowl-front"+i,x,top-.065,.255,bw,.13,.015,metal,true),
        box("bowl-l"+i,x-bw/2,top-.065,0,.012,.13,.51,metal,true),
        box("bowl-r"+i,x+bw/2,top-.065,0,.012,.13,.51,metal,true));
      parts.push(<mesh key={"drain"+i} position={[x,top-.12,0]} rotation={[-Math.PI/2,0,0]}><circleGeometry args={[.025,24]}/><meshStandardMaterial color={dark} metalness={.8} roughness={.2}/></mesh>);
    }
    const tap = new CatmullRomCurve3([new Vector3(0,top,-.37),new Vector3(0,.94,-.37),new Vector3(0,.985,-.25),new Vector3(0,.94,-.13)]);
    parts.push(<mesh key="tap" castShadow><tubeGeometry args={[tap,32,.009,12,false]}/><meshStandardMaterial color={metal} metalness={.95} roughness={.15}/></mesh>);
  }
  if(hob) {
    parts.push(box("hob-glass",0,.999,0,.88,.006,.82,"#141B20"));
    for(const x of [-.23,.23]) for(const z of [-.22,.2]) parts.push(<mesh key={`ring${x}${z}`} position={[x,1.004,z]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.12,.127,48]}/><meshStandardMaterial color={key.includes("electric") ? "#797C7D" : "#BBC0C3"} roughness={.35}/></mesh>);
  }
  if(oven || washing) {
    parts.push(box("appliance",0,.52,.425,.94,.78,.13,"#E4E3DE"),
      box("controls",0,.84,.5,.87,.1,.016,metal,true));
    if(oven) parts.push(box("oven-glass",0,.48,.5,.8,.48,.015,dark),box("oven-handle",0,.76,.518,.72,.022,.025,metal,true));
    else parts.push(<group key="drum" position={[0,.47,.51]}><mesh><torusGeometry args={[.255,.035,16,48]}/><meshStandardMaterial color={metal} metalness={.9} roughness={.2}/></mesh><mesh position={[0,0,-.012]}><circleGeometry args={[.235,48]}/><meshPhysicalMaterial color="#283B44" metalness={.25} roughness={.15}/></mesh></group>);
    parts.push(box("drawer",0,.16,.482,.91,.08,.03));
    for(const x of [-.3,.3]) parts.push(<mesh key={"dial"+x} position={[x,.84,.518]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.026,.026,.025,24]}/><meshStandardMaterial color={dark}/></mesh>);
  }
  return <group scale={[width,height,depth]}>{parts}</group>;
}
