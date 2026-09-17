"use client";

import { useCallback } from "react";
import type { MeshPhysicalMaterial } from "three";
import { Vector3 } from "three";
import { fabricById } from "@/lib/fabrics";

// Analytic, seamless yarns with gentle irregularity; no image downloads or UV seams.
const weaveShader = /* glsl */`
varying vec3 vFabricPosition;
varying vec3 vFabricNormal;
float fabricHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float fabricNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(fabricHash(i),fabricHash(i+vec2(1,0)),f.x),mix(fabricHash(i+vec2(0,1)),fabricHash(i+vec2(1,1)),f.x),f.y);
}
float fabricWeave(vec2 p) {
  float grain = fabricNoise(p*3.7);
  float slub = fabricNoise(p*.27);
  p += vec2(fabricNoise(vec2(p.y*.4,3.0)),fabricNoise(vec2(p.x*.4,7.0)))*.17;
  float warp = .5+.5*cos(p.x*6.28318), weft = .5+.5*cos(p.y*6.28318);
  float h = mix(warp,weft,step(1.0,mod(floor(p.x)+floor(p.y),2.0)));
  FABRIC_PATTERN
  // Fade fine detail below pixel resolution to prevent shimmering at room scale.
  float visible = 1.0-smoothstep(.25,1.4,max(length(dFdx(p)),length(dFdy(p))));
  return mix(.5,h*.75+grain*.12+slub*.13,visible);
}
float fabricHeight() {
  vec3 weight = pow(abs(normalize(vFabricNormal)),vec3(5.0));
  weight /= max(dot(weight,vec3(1.0)),.0001);
  return dot(vec3(fabricWeave(vFabricPosition.yz),fabricWeave(vFabricPosition.xz),fabricWeave(vFabricPosition.xy)),weight);
}
`;
const patterns: Record<string, string> = {
  plain: "h = h*.82 + slub*.18;",
  loops: "vec2 cell = fract(p)-.5; float ring=length(cell+vec2(slub-.5,grain-.5)*.2); h=1.0-smoothstep(.09,.22,abs(ring-.28));",
  pile: "h = .4+grain*.25+slub*.35;",
  rib: "h = warp*.65+weft*.1+grain*.25;",
  felt: "h = slub*.55+grain*.45;",
  twill: "h = (.5+.5*cos((p.x+p.y)*3.14159))*.72+grain*.28;",
  herringbone: "float direction=mod(floor(p.x/4.0),2.0)*2.0-1.0; h=.5+.5*cos((p.x+direction*p.y)*3.14159);",
  cord: "h = pow(warp,.45)*.9+grain*.1;",
  basket: "h=mix(warp,weft,step(1.0,mod(floor(p.x/2.0)+floor(p.y/2.0),2.0)));",
  satin: "h=.45+(.5+.5*cos((p.x+p.y*.2)*6.28318))*.12+grain*.1;",
  knit: "float stitch=abs(fract(p.x)-.5)*2.0; h=pow(.5+.5*cos((p.y+stitch*.6)*6.28318),.6);",
};

export function FabricMaterial({ fabricId, colour, physicalSize }: { fabricId?: string; colour: string; physicalSize: [number, number, number] }) {
  const fabric = fabricById(fabricId);
  const [x,y,z] = physicalSize;
  const compile = useCallback<MeshPhysicalMaterial["onBeforeCompile"]>((shader) => {
    if (!fabric) return;
    shader.uniforms.fabricScale = { value: new Vector3(x/fabric.scale_mm,y/fabric.scale_mm,z/fabric.scale_mm) };
    shader.vertexShader = `uniform vec3 fabricScale; varying vec3 vFabricPosition; varying vec3 vFabricNormal;\n${shader.vertexShader}`.replace("#include <begin_vertex>", "#include <begin_vertex>\nvFabricPosition = position * fabricScale; vFabricNormal = normal;");
    shader.fragmentShader = weaveShader.replace("FABRIC_PATTERN", patterns[fabric.pattern] ?? patterns.plain) + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\nfloat yarnHeight = fabricHeight(); diffuseColor.rgb *= .88 + .24 * yarnHeight;");
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
      vec3 fabricDx = normalize(dFdx(-vViewPosition)), fabricDy = normalize(dFdy(-vViewPosition));
      vec3 fabricR1 = cross(fabricDy, normal), fabricR2 = cross(normal, fabricDx);
      float fabricDet = dot(fabricDx, fabricR1) * faceDirection;
      vec3 fabricGradient = sign(fabricDet) * (dFdx(yarnHeight)*fabricR1 + dFdy(yarnHeight)*fabricR2);
      normal = normalize(max(abs(fabricDet),.0001)*normal - ${fabric.relief.toFixed(3)}*fabricGradient);`);
  }, [fabric,x,y,z]);
  return <meshPhysicalMaterial key={`${fabricId}-${x}-${y}-${z}`} color={colour} roughness={fabric?.roughness ?? .7} sheen={fabric?.sheen ?? 0} sheenColor={colour} sheenRoughness={.75} onBeforeCompile={compile} customProgramCacheKey={() => `fabric-v1-${fabricId}`} />;
}
