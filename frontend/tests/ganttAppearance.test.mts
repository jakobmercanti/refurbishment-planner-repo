import test from "node:test";
import assert from "node:assert/strict";
import { ganttBarAppearance } from "../lib/ganttAppearance";

const luminance = (hex:string) => [1,3,5].map(i=>{
  const n=Number.parseInt(hex.slice(i,i+2),16)/255;
  return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4;
}).reduce((sum,n,i)=>sum+n*[0.2126,0.7152,0.0722][i],0);

test("pale and dark activity colours use legible labels and compatible progress shading",()=>{
  assert.equal(ganttBarAppearance("#f5e9c8").foreground,"#000000");
  assert.equal(ganttBarAppearance("#246f62").foreground,"#ffffff");
  assert.match(ganttBarAppearance("#ffffff").progressOverlay,/255 255 255/);
  assert.match(ganttBarAppearance("#000000").progressOverlay,/0 0 0/);
  assert.deepEqual(ganttBarAppearance("invalid"),ganttBarAppearance("#287fb8"));
});
test("label contrast exceeds 4.5 throughout a 4,096-colour RGB grid, including progress shading",()=>{
  for(let r=0;r<=255;r+=17)for(let g=0;g<=255;g+=17)for(let b=0;b<=255;b+=17){
    const colour="#"+[r,g,b].map(v=>v.toString(16).padStart(2,"0")).join("");
    const style=ganttBarAppearance(colour),bg=luminance(colour),fg=luminance(style.foreground);
    assert.ok((Math.max(bg,fg)+0.05)/(Math.min(bg,fg)+0.05)>=4.5,colour);
    assert.match(style.progressOverlay,style.foreground==="#000000"?/255 255 255/:/0 0 0/);
    const overlay=style.foreground==="#000000"?255:0;
    const shaded="#"+[r,g,b].map(v=>Math.round(v*0.78+overlay*0.22).toString(16).padStart(2,"0")).join("");
    const shadedLuminance=luminance(shaded);
    assert.ok((Math.max(shadedLuminance,fg)+0.05)/(Math.min(shadedLuminance,fg)+0.05)>=4.5,shaded);
  }
});
