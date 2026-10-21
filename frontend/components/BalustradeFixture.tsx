"use client";
import { DoubleSide } from "three";
import { BALUSTRADE_STYLES, balustradeRuns, balustradeStyle } from "@/lib/balustrades";
import type { FloorOpening } from "@/lib/buildingDocument";

/** Display-only section. All supplied dimensions have been converted at the render boundary. */
export function BalustradeFixture({representation,width,depth,height,colour,omitLastPost=false}:{representation:string;width:number;depth:number;height:number;colour:string;omitLastPost?:boolean}) {
  const style=BALUSTRADE_STYLES.find(item=>item.key===representation)?.id??"VERTICAL";
  const timber=style==="TIMBER",solid=style==="SOLID",glass=style==="GLASS",horizontal=style==="HORIZONTAL";
  const post=Math.min(depth*.7,width*.1),rail=height*.045,spans=Math.max(1,Math.min(200,Math.ceil(width/height))),spacing=width/spans,spindles=Math.max(1,Math.min(1000,Math.ceil(width/(height*.1))));
  const block=(key:string,x:number,y:number,w:number,h:number,d:number,c=colour)=><mesh key={key} position={[x,y,0]} castShadow receiveShadow><boxGeometry args={[w,h,d]}/><meshStandardMaterial color={c} roughness={timber||solid ? .8 : .35} metalness={timber||solid?0:.55}/></mesh>;
  return <group name={`Balustrade · ${style}`}>
    {solid?block("parapet",0,height/2,width,height,depth):<>
      {Array.from({length:spans+(omitLastPost?0:1)},(_,i)=>block(`post-${i}`,-width/2+post/2+i*(width-post)/spans,height/2,post,height,depth*.8))}
      {block("handrail",0,height-rail/2,width,rail,depth)}
      {glass?Array.from({length:spans},(_,i)=><mesh key={i} position={[-width/2+spacing*(i+.5),height*.5,0]} castShadow><boxGeometry args={[Math.max(.001,spacing-post*1.4),height*.78,depth*.12]}/><meshPhysicalMaterial color="#bbdadd" transparent opacity={.3} roughness={.08} metalness={0} side={DoubleSide} depthWrite={false}/></mesh>):horizontal?[.25,.5,.75].map((y,i)=>block(`rail-${i}`,0,height*y,width-post,rail*.65,depth*.45)):Array.from({length:spindles},(_,i)=>block(`spindle-${i}`,-width/2+width*(i+1)/(spindles+1),height*.49,post*(timber ? .5 : .25),height*.88,depth*(timber ? .45 : .2)))}
      {!horizontal&&!glass&&block("bottomrail",0,height*.08,width,rail,depth*.7)}
    </>}
  </group>;
}

export function OpeningBalustrades({openings}:{openings:FloorOpening[]}) {
  return <group name="Floor opening balustrades">{openings.flatMap(opening=>{
    const config=opening.balustrade;if(!config?.enabled)return [];
    const style=balustradeStyle(config.style);
    return balustradeRuns(opening.vertices,config).map((run,i)=><group key={`${opening.id}-${i}`} position={[(run.a.x+run.b.x)*.0005,0,-(run.a.y+run.b.y)*.0005]} rotation={[0,run.rotationDeg*Math.PI/180,0]} userData={{openingBalustrade:opening.id,balustradeStyle:config.style}}><BalustradeFixture representation={style.key} width={(run.length+run.depth*(config.style==="SOLID"?1:.7))*.001} depth={run.depth*.001} height={config.heightMm*.001} colour={config.colour} omitLastPost/></group>);
  })}</group>;
}
