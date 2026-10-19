import type { RoofConfiguration, RoofFinish } from "./buildingDocument";

export const ROOF_MATERIALS = [
  {id:"CLAY_TILES",name:"Clay / terracotta tiles",colour:"#a65338",roughness:.82,metalness:0,bumpMm:9},
  {id:"CONCRETE_TILES",name:"Concrete tiles",colour:"#736961",roughness:.9,metalness:0,bumpMm:6},
  {id:"SLATE",name:"Natural slate",colour:"#46515c",roughness:.8,metalness:.04,bumpMm:3},
  {id:"CEMENT",name:"Cement / mineral finish",colour:"#b2aea2",roughness:.95,metalness:0,bumpMm:.6},
  {id:"METAL",name:"Standing-seam metal",colour:"#596c72",roughness:.4,metalness:.55,bumpMm:4},
] as const;
export function resolvedRoofFinish(roof:RoofConfiguration):RoofFinish {
  return roof.finish??{material:"SLATE",colour:"#46515c",tileWidthMm:300,tileHeightMm:400};
}
/** Deterministic four-by-four tile repeat. Appearance only, never fit geometry. */
export function roofTexturePixels(material:RoofFinish["material"],size=256):Uint8Array {
  const data=new Uint8Array(size*size*4),hash=(x:number,y:number)=>{let n=Math.imul(x+73,374761393)^Math.imul(y+29,668265263);n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967295;};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const row=Math.floor(y/size*4),px=(x/size*4+(row%2)*.5)%4,col=Math.floor(px),u=px-col,v=(y/size*4)%1;
    const grain=(hash(x,y)-.5)*.055,variation=(hash(col,row)-.5)*.13;
    let shade=.92+grain+variation;
    if(material==="CLAY_TILES"||material==="CONCRETE_TILES")shade+=Math.sin(u*Math.PI*2)*(material==="CLAY_TILES"?.09:.035);
    if(material==="SLATE")shade+=Math.sin(x*.9+y*.27)*.025;
    if(material==="CEMENT")shade=.94+grain*.8;
    else if(material==="METAL"){const seam=(x/size*4)%1;shade=.91+grain*.35+(seam<.025?.11:seam<.05?-.24:0);}
    else if(u<.025||v<.035)shade*=.55;
    else if(v>.94)shade*=.82;
    const i=(y*size+x)*4,value=Math.round(Math.max(0,Math.min(1,shade))*255);
    data[i]=value;data[i+1]=value;data[i+2]=value;data[i+3]=255;
  }
  return data;
}
