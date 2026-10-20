import { doorModel } from "./doorModels";
import type { Opening, PassageProfile } from "./types";

export const PASSAGE_PROFILES = ["RECTANGULAR", "ROUND_ARCH", "SEGMENTAL_ARCH", "CHAMFERED"] as const;
export function passageProfileForKey(key?: string | null): PassageProfile | undefined {
  const model = doorModel(key ?? undefined);
  return model?.operation === "OPENING" ? model.profile as PassageProfile : undefined;
}
export function passageProfileForOpening(opening: Pick<Opening, "kind" | "passage_profile" | "metadata">) {
  return opening.kind === "DOOR" ? opening.passage_profile ?? passageProfileForKey(typeof opening.metadata?.representation_key === "string" ? opening.metadata.representation_key : undefined) : undefined;
}

/** Scale-invariant elevation; callers keep mm authoritative and convert only for rendering. */
export function passageHeightAt(profile: PassageProfile, width: number, height: number, x: number) {
  const along = Math.max(0, Math.min(width, x));
  if (profile === "RECTANGULAR") return height;
  const rise = Math.min(width * (profile === "ROUND_ARCH" ? .5 : profile === "CHAMFERED" ? .2 : .18), height * .45);
  if (profile === "CHAMFERED") return height - rise + rise * Math.min(1, along / (width * .18), (width - along) / (width * .18));
  const t = 2 * along / width - 1;
  return height - rise + rise * Math.sqrt(Math.max(0, 1 - t * t));
}

/** Angular samples keep arches smooth and retain full-aperture coordinates on split walls. */
export function passageTopPoints(profile: PassageProfile, width: number, height: number, from = 0, to = width) {
  const first = Math.max(0, from), last = Math.min(width, to);
  if (last <= first) return [];
  const knots = profile === "RECTANGULAR" ? [] : profile === "CHAMFERED" ? [width * .18, width * .82] : Array.from({ length: 63 }, (_, i) => width * (1-Math.cos((i+1)*Math.PI/64))/2);
  return [first, ...knots.filter(x => x > first && x < last), last].map(x => ({ x, y: passageHeightAt(profile, width, height, x) }));
}

/** Exact clear area, including partial wall spans; no visual mesh drives quantities. */
export function passageAreaMm2(profile: PassageProfile, width: number, height: number, from = 0, to = width) {
  const a = Math.max(0, from), b = Math.min(width, to);
  if (b <= a) return 0;
  if (profile === "RECTANGULAR") return (b-a)*height;
  if (profile === "CHAMFERED") {
    const points = passageTopPoints(profile,width,height,a,b);
    return points.slice(1).reduce((sum,p,i)=>sum+(p.x-points[i].x)*(p.y+points[i].y)/2,0);
  }
  const rise = Math.min(width * (profile === "ROUND_ARCH" ? .5 : .18),height*.45);
  const primitive = (x:number) => { const t=Math.max(-1,Math.min(1,2*x/width-1));return .5*(t*Math.sqrt(Math.max(0,1-t*t))+Math.asin(t)); };
  return (b-a)*(height-rise)+rise*width/2*(primitive(b)-primitive(a));
}

export function openingClearAreaMm2(opening: Opening, from=0, to=opening.width.value) {
  const profile=passageProfileForOpening(opening);
  return profile?passageAreaMm2(profile,opening.width.value,opening.height.value,from,to):Math.max(0,Math.min(to,opening.width.value)-Math.max(0,from))*opening.height.value;
}
