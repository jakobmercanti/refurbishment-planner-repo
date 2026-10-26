import { z } from "zod";
import { readBoundedResponse } from "./boundedResponse";
import { adjointStudySchema, type AdjointStudy } from "./cfdAdjointDocument";
import type { CFDScenario } from "./climoptixDocument";
import { preparationRequestBody, type CFDReport } from "./climoptix";
import type { ProjectDocument } from "./projectDocument";

export const ADJOINT_UNAVAILABLE="Adjoint unavailable: this adapter has no validated fixed-mesh moving-vent boundary law or its adjoint. Ordinary simpleFoam jobs remesh; they cannot execute this study.";
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const readinessSchema=z.object({version:z.literal(1),kind:z.literal("AdjointPreparation"),studyId:z.string(),units:z.literal("mm"),
  state:z.enum(["configurationInvalid","adjointUnavailable"]),configurationReady:z.boolean(),canRun:z.literal(false),
  binding:z.object({sourceHash:hash,configurationHash:hash,clientRevision:hash}).strict(),
  capability:z.object({version:z.literal(1),preparation:z.literal(true),canRun:z.literal(false),fixedMeshMovement:z.literal(false),adjoint:z.literal(false),reason:z.string()}).strict(),
  issues:z.array(z.object({code:z.string(),message:z.string(),repair:z.string(),ventId:z.string().nullable()}).strict()).max(1000),
  // Numerical frame metadata is not executed or used to modify the model here.
  ports:z.array(z.object({ventId:z.string(),name:z.string(),supportId:z.string(),role:z.enum(["supply","extract"]),
    centreMm:z.tuple([z.number().finite(),z.number().finite()])}).passthrough()).max(100),
  iterations:z.tuple([]),meshHash:z.null(),limitations:z.array(z.string()).max(20),
}).strict();
export type AdjointReadiness=z.infer<typeof readinessSchema>;

export function newAdjointStudy(scenario:CFDScenario,report:CFDReport,runId:string|null=null):AdjointStudy{
  return adjointStudySchema.parse({id:crypto.randomUUID(),name:`Vent position study ${(scenario.adjointStudies?.length??0)+1}`,
    baseline:{sourceHash:report.validation.sourceHash,configurationHash:report.validation.configurationHash,clientRevision:report.validation.clientRevision,runId,
      ports:scenario.vents.flatMap(vent=>{const host=report.patches.find(p=>p.id===vent.host.patchId)?.host;if(!host)return[];return[{
        ventId:vent.id,name:vent.name,role:vent.role,supportId:vent.host.patchId,shape:vent.shape,
        widthMm:vent.shape==="rectangle"?vent.widthMm:vent.diameterMm,heightMm:vent.shape==="rectangle"?vent.heightMm:vent.diameterMm,
        rotationDeg:vent.rotationDeg,centreUMm:vent.host.u*host.widthMm,centreVMm:vent.host.v*host.heightMm,
        originMm:host.originMm,uAxis:host.uAxis,vAxis:host.vAxis,normal:host.normal}];})},
    ports:scenario.vents.map(vent=>{
      const host=report.patches.find(p=>p.id===vent.host.patchId)?.host;
      const u=vent.host.u*(host?.widthMm??0),v=vent.host.v*(host?.heightMm??0);
      return{ventId:vent.id,bounds:{uMinMm:Math.max(0,u-50),uMaxMm:u+50,vMinMm:Math.max(0,v-50),vMaxMm:v+50}};
    })});
}

export async function validateAdjoint(apiUrl:string,project:ProjectDocument,scenario:CFDScenario,revision:string,study:AdjointStudy,signal:AbortSignal,expected?:{sourceHash:string;configurationHash:string}):Promise<AdjointReadiness>{
  signal.throwIfAborted();
  const source=JSON.parse(preparationRequestBody(project,scenario,revision));
  const body=JSON.stringify({...source,study:adjointStudySchema.parse(study)});
  if(new TextEncoder().encode(body).length>4*1024*1024)throw new Error("Optimisation preparation exceeds 4 MB.");
  const response=await fetch(`${apiUrl}/climoptix/optimisation/prepare`,{method:"POST",headers:{"Content-Type":"application/json"},body,
    signal:AbortSignal.any([signal,AbortSignal.timeout(25000)]),cache:"no-store",redirect:"error"});
  const text=new TextDecoder().decode(await readBoundedResponse(response,response.ok?2*1024*1024:16384,"Oversized optimisation readiness response."));
  if(!response.ok){let error;try{error=JSON.parse(text);}catch{/* fixed fallback */}throw new Error(typeof error?.detail==="string"?error.detail.slice(0,2000):
    "Optimisation preparation service unavailable. The configuration is saved; release the matching API before retrying.");}
  const result=readinessSchema.parse(JSON.parse(text));
  if(result.studyId!==study.id||result.binding.clientRevision!==revision)throw new Error("Readiness belongs to a different study or setup revision.");
  if(expected&&(result.binding.sourceHash!==expected.sourceHash||result.binding.configurationHash!==expected.configurationHash))throw new Error("Readiness source/configuration hashes do not match the current checked setup.");
  if(result.configurationReady!==(result.issues.length===0)||result.state!==(result.configurationReady?"adjointUnavailable":"configurationInvalid"))throw new Error("Inconsistent optimisation readiness response.");
  return result;
}

export function adjointConfigurationCSV(study:AdjointStudy):string{
  const quote=(v:unknown)=>`"${String(v).replaceAll('"','""')}"`;
  const rows:unknown[][]=[["kind","Adjoint preparation only — no CFD iterations"],["studyId",study.id],["sourceHash",study.baseline.sourceHash],
    ["configurationHash",study.baseline.configurationHash],["units","mm"],["objective",study.objective.kind],["maxAcceptedSteps",study.strategy.maxAcceptedSteps],
    ["ventId","movable","lockU","lockV","uMinMm","uMaxMm","vMinMm","vMaxMm","clearanceMm","maxDisplacementMm"]];
  for(const p of study.ports)rows.push([p.ventId,p.movable,p.lockU,p.lockV,p.bounds.uMinMm,p.bounds.uMaxMm,p.bounds.vMinMm,p.bounds.vMaxMm,p.clearanceMm,p.maxDisplacementMm]);
  return rows.map(r=>r.map(quote).join(",")).join("\r\n");
}
