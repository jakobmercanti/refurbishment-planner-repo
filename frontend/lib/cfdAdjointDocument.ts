import { z } from "zod";

const finite = z.number().finite(), length = finite.min(0).max(1e7);
const hash = z.string().regex(/^[a-f0-9]{64}$/), id = z.string().regex(/^[\w:-]{1,150}$/);
const vector=z.tuple([finite,finite,finite]);
const fixedPortSchema=z.object({ventId:id,name:z.string().min(1).max(120),role:z.enum(["supply","extract"]),supportId:z.string().regex(/^[\w:.-]{1,500}$/),shape:z.enum(["rectangle","circle"]),
  widthMm:finite.gt(0).max(10000),heightMm:finite.gt(0).max(10000),rotationDeg:finite.min(-360).max(360),centreUMm:length,centreVMm:length,originMm:vector,uAxis:vector,vAxis:vector,normal:vector}).strict();
export const movementBoundsSchema = z.object({uMinMm:length,uMaxMm:length,vMinMm:length,vMaxMm:length}).strict()
  .refine(b=>b.uMinMm<=b.uMaxMm&&b.vMinMm<=b.vMaxMm,"Movement minima must not exceed maxima.");
export const adjointStudySchema = z.object({
  version:z.literal(1).default(1),id,name:z.string().trim().min(1).max(120),
  baseline:z.object({sourceHash:hash,configurationHash:hash,clientRevision:hash,
    runId:z.string().regex(/^[a-f0-9-]{36}$/).nullable().default(null),ports:z.array(fixedPortSchema).max(100).default([])}).strict()
    .refine(b=>new Set(b.ports.map(p=>p.ventId)).size===b.ports.length,"Baseline port snapshots require unique IDs."),
  ports:z.array(z.object({ventId:id,movable:z.boolean().default(false),lockU:z.boolean().default(false),lockV:z.boolean().default(false),
    clearanceMm:length.default(10),maxDisplacementMm:finite.gt(0).max(10000).default(100),bounds:movementBoundsSchema}).strict()).max(100),
  objective:z.object({kind:z.enum(["velocityUniformity","draught"]).default("velocityUniformity"),
    referenceVelocityMS:finite.gt(0).max(100).default(1),targetVelocityMS:finite.min(0).max(100).default(0.2),region:z.literal("wholeFluid").default("wholeFluid")}).strict().prefault({}),
  strategy:z.object({maxAcceptedSteps:z.int().min(1).max(50).default(3),initialStepMm:finite.gt(0).max(1000).default(50),
    minimumStepMm:finite.gt(0).max(1000).default(1),maximumStepMm:finite.gt(0).max(1000).default(100),
    maskTransitionMm:finite.gt(0).max(1000).default(10),maxRejectedTrials:z.int().min(0).max(15).default(5),
    maxPrimalSolves:z.int().min(1).max(200).default(20),budgetSeconds:z.int().min(60).max(3600).default(900)}).strict().superRefine((s,c)=>{
      if(!(s.minimumStepMm<=s.initialStepMm&&s.initialStepMm<=s.maximumStepMm))c.addIssue({code:"custom",message:"Require minimum ≤ initial ≤ maximum translation step."});
      if(s.maxPrimalSolves<s.maxAcceptedSteps+1)c.addIssue({code:"custom",message:"Primal budget must cover a baseline and every accepted movement."});
    }).prefault({}),
}).strict().refine(s=>new Set(s.ports.map(p=>p.ventId)).size===s.ports.length,"Use unique port IDs.");
export const adjointStudiesSchema=z.array(adjointStudySchema).max(20).refine(s=>new Set(s.map(v=>v.id)).size===s.length,"Adjoint preparation IDs must be unique.");
export type AdjointStudy=z.infer<typeof adjointStudySchema>;
