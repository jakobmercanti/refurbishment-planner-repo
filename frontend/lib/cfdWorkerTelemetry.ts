import { z } from "zod";

const value = z.number().finite().min(-1e12).max(1e12);
const iteration = z.number().finite().min(0).max(1e12);
const flowTotal = z.number().finite().min(-1e15).max(1e15);
const vector = z.tuple([value,value,value]);
export const workerTelemetrySchema = z.object({
  version:z.literal(1), truncated:z.boolean(), warnings:z.array(z.string().max(500)).max(8),
  balance:z.object({
    tolerance:z.number().positive().max(1).nullable(),
    fluxM3S:z.record(z.string().max(200),value),
    samples:z.array(z.object({iteration,relativeImbalance:z.number().finite().nonnegative(),
      incomingM3S:flowTotal,outgoingM3S:flowTotal,netM3S:flowTotal})).max(120),
  }).nullable(),
  probes:z.array(z.object({index:z.int().min(0).max(99),positionMm:vector.nullable(),
    samples:z.array(z.object({iteration,velocityMS:vector.nullable(),pressureM2S2:value.nullable()})).max(32),
  })).max(100),
});
export type WorkerTelemetry = z.infer<typeof workerTelemetrySchema>;

export function workerTelemetryCSV(data: WorkerTelemetry): string {
  const lines = ["kind,index,iteration,x_mm,y_mm,z_mm,ux_m_s,uy_m_s,uz_m_s,p_m2_s2,in_m3_s,out_m3_s,net_m3_s,relative_imbalance"];
  for (const probe of data.probes) for (const sample of probe.samples)
    lines.push(["probe",probe.index+1,sample.iteration,...(probe.positionMm??["","",""]),
      ...(sample.velocityMS??["","",""]),sample.pressureM2S2??"","","","",""].join(","));
  for (const sample of data.balance?.samples ?? [])
    lines.push(["balance","",sample.iteration,"","","","","","","",sample.incomingM3S,
      sample.outgoingM3S,sample.netM3S,sample.relativeImbalance].join(","));
  return lines.join("\r\n")+"\r\n";
}
