import { z } from "zod";

const finite=z.number().finite(), hash=z.string().regex(/^[a-f0-9]{64}$/);
export const sliceFieldSchema=z.object({name:z.string().max(200),components:z.number().int().min(1).max(9),cell:z.boolean(),unit:z.string().max(100)});
export const slicePlaneSchema=z.object({id:hash,sha256:hash,name:z.string().max(200),axis:z.enum(["X","Y","Z"]),coordinate:finite,time:z.string().max(100),status:z.literal("ready"),bounds:z.tuple([finite,finite,finite,finite]),fields:z.array(sliceFieldSchema).max(64),method:z.string().max(500)});
export const sliceManifestSchema=z.object({schemaVersion:z.literal(1),runId:z.uuid(),projectId:z.uuid(),studyId:z.string().max(200),name:z.string().max(200),createdAt:finite,updatedAt:finite,status:z.string().max(100),message:z.string().max(2000),sourceHash:hash,configurationHash:hash,revision:hash,frame:z.string().max(100),solver:z.string().max(100),timeKind:z.string().max(100),pressureReference:hash,planes:z.array(slicePlaneSchema).max(200),warnings:z.array(z.string().max(1000)).max(20),pending:z.number().int().nonnegative()});
const nullable=finite.nullable(), values=z.array(nullable).max(512**2);
const sample=z.object({value:nullable,velocity:z.tuple([finite,finite,finite]).nullable(),method:z.string().max(1000),reason:z.string().max(2000)});
export const sliceDataSchema=z.object({
  schemaVersion:z.literal(1),axis:z.enum(["X","Y","Z"]),coordinate:finite,
  field:z.string().max(200),component:z.number().int().min(-1).max(8),
  unit:z.string().max(100),deltaUnit:z.string().max(100),
  deltaMode:z.enum(["absolute","percent","vector"]),epsilon:finite.positive(),
  definition:z.string().max(500),compatibility:z.array(z.string().max(2000)).max(20),
  method:z.string().max(1000),notes:z.array(z.string().max(2000)).max(20),
  baseline:z.object({run:z.uuid(),asset:hash,time:z.string().max(100)}),
  option:z.object({run:z.uuid(),asset:hash,time:z.string().max(100),axis:z.enum(["X","Y","Z"]).optional(),coordinate:finite.optional()}).nullable(),
  key:hash.optional(),bounds:z.tuple([finite,finite,finite,finite]).optional(),
  size:z.number().int().min(16).max(512).optional(),
  a:values.optional(),b:values.nullable().optional(),delta:values.optional(),
  range:z.tuple([finite,finite]).nullable().optional(),
  statistics:z.object({valid:z.number().int().nonnegative(),missing:z.number().int().nonnegative(),coverage:finite.min(0).max(1),min:nullable,max:nullable,mean:nullable,rms:nullable,commonAreaM2:finite.nonnegative(),method:z.string().max(1000)}).optional(),
  point:z.tuple([finite,finite,finite]).optional(),
  probe:z.object({baseline:sample,option:sample.nullable(),delta:nullable}).optional(),
}).superRefine((data,ctx)=>{
  if(data.point){if(!data.probe)ctx.addIssue({code:"custom",message:"Picked-point data is missing its numerical readout."});return;}
  if(!data.size||!data.bounds||!data.a||!data.delta||!data.statistics){ctx.addIssue({code:"custom",message:"Slice response is missing its raster/mask/physical extent."});return;}
  if([data.a,data.b,data.delta].some(array=>array&&array.length!==data.size!**2)||data.statistics.valid+data.statistics.missing!==data.size**2)ctx.addIssue({code:"custom",message:"Slice raster size does not match its arrays/mask counts."});
  if(data.bounds[2]<=data.bounds[0]||data.bounds[3]<=data.bounds[1])ctx.addIssue({code:"custom",message:"Slice extent has no finite physical area."});
});
export type SliceManifest=z.infer<typeof sliceManifestSchema>;
export type SlicePlane=z.infer<typeof slicePlaneSchema>;
export type SliceData=z.infer<typeof sliceDataSchema>;
export interface SliceRequest {projectId:string;baseline:{runId:string;assetId:string};option?:{runId:string;assetId:string};field:string;component:number;size:number;deltaMode:"absolute"|"percent"|"vector";epsilon:number;temperature:"K"|"C";point?:[number,number,number]}
export const axisLabels={X:"X plane — constant X, Y-Z slice (normal parallel X axis)",Y:"Y plane — constant Y, X-Z slice (normal parallel Y axis)",Z:"Z plane — constant Z, X-Y horizontal slice"};
export const inPlaneAxes=(axis:"X"|"Y"|"Z")=>[0,1,2].filter(i=>i!=="XYZ".indexOf(axis));
export function availablePlanes(manifest:SliceManifest|undefined,axis:string,time:string) {
  const planes=manifest?.planes.filter(p=>p.axis===axis)??[];
  const latest=planes.reduce((best,p)=>Number(p.time)>Number(best)?p.time:best,planes[0]?.time??"");
  return planes.filter(p=>p.time===(time||latest)).sort((a,b)=>a.coordinate-b.coordinate);
}
export function nearestPlane(planes:SlicePlane[],coordinate?:number) {return planes.reduce<SlicePlane|undefined>((best,p)=>!best||Math.abs(p.coordinate-(coordinate??(planes[0].coordinate+planes.at(-1)!.coordinate)/2))<Math.abs(best.coordinate-(coordinate??(planes[0].coordinate+planes.at(-1)!.coordinate)/2))?p:best,undefined);}
export function rangeFor(values:(number|null)[]) {const finite=values.filter((v):v is number=>v!==null&&Number.isFinite(v));return finite.reduce<[number,number]>(([a,b],v)=>[Math.min(a,v),Math.max(b,v)],[Infinity,-Infinity]);}
export function autoDeltaRange(values:(number|null)[]):[number,number] {const [low,high]=rangeFor(values),magnitude=Number.isFinite(low)?Math.max(Math.abs(low),Math.abs(high)):0;return magnitude?[-magnitude,magnitude]:[-1,1];}
export const defaultLegend={auto:true,min:-1,max:1,palette:"coolwarm",bands:0,ticks:5,precision:3};
export interface SliceState {version:1;mode:"single"|"compare";baseline:string;option:string;axis:"X"|"Y"|"Z";coordinates:Partial<Record<"X"|"Y"|"Z",number>>;field:string;component:number;time:string;optionTime:string;size:number;deltaMode:SliceRequest["deltaMode"];epsilon:number;temperature:"K"|"C";legends:Record<string,{shared:typeof defaultLegend;delta:typeof defaultLegend}>;point:[number,number,number]|null;focus:string}
export const defaultSliceState:SliceState={version:1,mode:"single",baseline:"",option:"",axis:"Z",coordinates:{},field:"U",component:-1,time:"",optionTime:"",size:96,deltaMode:"absolute",epsilon:1e-6,temperature:"K",legends:{},point:null,focus:"all"};
const legendSchema=z.object({auto:z.boolean(),min:finite,max:finite,palette:z.enum(["coolwarm","viridis","grey"]),bands:z.number().int().min(0).max(20),ticks:z.number().int().min(2).max(9),precision:z.number().int().min(0).max(7)});
const stateSchema=z.object({version:z.literal(1),mode:z.enum(["single","compare"]),baseline:z.string().max(200),option:z.string().max(200),axis:z.enum(["X","Y","Z"]),coordinates:z.object({X:finite.optional(),Y:finite.optional(),Z:finite.optional()}),field:z.string().max(200),component:z.number().int().min(-1).max(8),time:z.string().max(100),optionTime:z.string().max(100),size:z.number().int().min(16).max(512),deltaMode:z.enum(["absolute","percent","vector"]),epsilon:finite.positive().max(1e10),temperature:z.enum(["K","C"]),legends:z.record(z.string().max(200),z.object({shared:legendSchema,delta:legendSchema})),point:z.tuple([finite,finite,finite]).nullable(),focus:z.enum(["all","baseline","option","delta","inspector"])});
export function restoreSliceState(text:string|null):SliceState {try {
  if(!text||text.length>64000)return structuredClone(defaultSliceState);
  const result=stateSchema.safeParse(JSON.parse(text));
  if(!result.success)return structuredClone(defaultSliceState);
  return {...result.data,focus:result.data.mode==="single"&&["option","delta"].includes(result.data.focus)?"all":result.data.focus};
}catch{return structuredClone(defaultSliceState);}}
export function slicePlotQuantity(data:SliceData|null,kind:string) {
  if(kind==="delta"&&data?.deltaMode==="vector")return `|ΔU| [${data.deltaUnit}]`;
  return `${data?.field??"Field"}${data&&data.component>=0?"XYZ"[data.component]??data.component:data?.field==="U"?" magnitude":""} [${kind==="delta"?data?.deltaUnit??"—":data?.unit??"—"}]`;
}
export function sliceCSV(data:SliceData,optionPlane?:Pick<SlicePlane,"axis"|"coordinate">) {
  const optionAxis=data.option?.axis??optionPlane?.axis??(data.option&&!data.compatibility.length?data.axis:undefined);
  const optionCoordinate=data.option?.coordinate??optionPlane?.coordinate??(data.option&&!data.compatibility.length?data.coordinate:undefined);
  const option=data.option?{...data.option,axis:optionAxis,coordinate:optionCoordinate}:null;
  const metadata=JSON.stringify({baseline:data.baseline,option,axis:data.axis,coordinate:data.coordinate,field:data.field,component:data.component,unit:data.unit,deltaUnit:data.deltaUnit,definition:data.definition,deltaMode:data.deltaMode,epsilon:data.epsilon,method:data.method,bounds:data.bounds,size:data.size,key:data.key,notes:data.notes,sampleCoordinates:"Baseline uses X_m/Y_m/Z_m; Option uses Option_X_m/Option_Y_m/Option_Z_m. Blank coordinates mean unavailable, not colocated."});
  if(!data.size||!data.bounds||!data.a)return `# ${metadata}\nNo raster available\n`;
  const axes=inPlaneAxes(data.axis),rows=[`# ${metadata}`,"X_m,Y_m,Z_m,Baseline,Option,Delta,Common_valid,Option_X_m,Option_Y_m,Option_Z_m"];
  data.a.forEach((a,i)=>{
    const p=[data.coordinate,data.coordinate,data.coordinate];
    p[axes[0]]=data.bounds![0]+((i%data.size!)+.5)/data.size!*(data.bounds![2]-data.bounds![0]);
    p[axes[1]]=data.bounds![1]+(Math.floor(i/data.size!)+.5)/data.size!*(data.bounds![3]-data.bounds![1]);
    const q:(number|string)[]=["","",""];
    if(optionAxis&&optionCoordinate!==undefined&&data.b){q.splice(0,3,...p);q["XYZ".indexOf(optionAxis)]=optionCoordinate;}
    rows.push([...p,a??"",data.b?.[i]??"",data.delta?.[i]??"",data.delta?.[i]!=null?1:0,...q].join(","));
  });
  return rows.join("\n");
}
