"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { terminalJob, type CFDWorkerJob } from "@/lib/climoptixJobs";
import { parseResidualLog } from "@/lib/climoptixWorkflow";
import { downloadCFD } from "@/lib/climoptix";
import { CFDWorkerError, type RailwayCFDWorker, type WorkerResult } from "@/lib/railwayCFDWorker";
import type { WorkerTelemetry } from "@/lib/cfdWorkerTelemetry";
import { CFDWorkerTelemetry } from "./CFDWorkerTelemetry";
import { ClimoptixConvergence } from "./ClimoptixConvergence";

export function ClimoptixWorkerMonitor({adapter, job, name, older, onVTK}: {
  adapter: RailwayCFDWorker; job: CFDWorkerJob; name: string; older: boolean; onVTK: (file: File) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [logError,setLogError]=useState("");
  const [result, setResult] = useState<WorkerResult | null>(null);
  const [telemetry, setTelemetry] = useState<WorkerTelemetry | null>(null);
  const [resultError,setResultError]=useState("");
  const [resultRetry,setResultRetry]=useState(0);
  const [noResult,setNoResult]=useState(false);
  const [busy, setBusy] = useState(false);
  const {id, studyId, clientRevision} = job;
  const actions = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController(); actions.current = controller;
    return () => controller.abort();
  }, [adapter, id, studyId, clientRevision]);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    let cursor = 0, buffer = "";
    const pinned = {id, studyId, clientRevision};
    const poll = async () => {
      try {
        const chunk = await adapter.logs({...pinned, phase: "Queued", progress: null, message: ""}, cursor, controller.signal);
        if (controller.signal.aborted) return;
        buffer += chunk.text; cursor = chunk.nextCursor;
        if (buffer.length > 8*1024**2) throw new Error("Live log buffer exceeded 8 MB.");
        setText(buffer); setLogError("");
        if (chunk.telemetry) setTelemetry(chunk.telemetry);
        if (terminalJob(chunk) && chunk.cursor === chunk.nextCursor) return;
        timer = setTimeout(() => void poll(), chunk.text.length >= 128*1024 ? 10 : 1500);
      } catch (error) {
        if (!controller.signal.aborted) {
          setLogError(error instanceof Error ? error.message : "Worker telemetry unavailable.");
          timer = setTimeout(() => void poll(), 4000);
        }
      }
    };
    void poll();
    return () => {controller.abort(); clearTimeout(timer);};
  }, [adapter, id, studyId, clientRevision]);
  const phase = job.phase;
  useEffect(() => {
    if (!["Completed", "Failed", "Cancelled"].includes(phase)) return;
    const controller = new AbortController();
    let timer:ReturnType<typeof setTimeout>, attempts=0;
    const read = async () => {
      try {
        const data=await adapter.result({id,studyId,clientRevision,phase,progress:null,message:""},controller.signal);
        if (!controller.signal.aborted) {setResult(data);setResultError("");setNoResult(false);}
      } catch(error) {
        if(controller.signal.aborted)return;
        if(phase!=="Completed"&&error instanceof CFDWorkerError&&[404,409].includes(error.status)) {
          setNoResult(true);setResultError("");return;
        }
        setResultError(error instanceof Error?error.message:"Native results could not be loaded.");
        if(++attempts<5)timer=setTimeout(()=>void read(),Math.min(1000*2**(attempts-1),10000));
      }
    };
    void read();
    return () => {controller.abort();clearTimeout(timer);};
  }, [adapter, id, studyId, clientRevision, phase, resultRetry]);
  const log = useMemo(() => parseResidualLog(text), [text]);
  return <section className="cfx-worker-monitor" aria-label="Authenticated OpenFOAM job">
    <div className="cfx-inline-toolbar"><strong>{job.phase} · {job.message}</strong>
      {!terminalJob(job) && <button disabled={busy} onClick={async () => {
        const signal = actions.current?.signal; if (!signal || signal.aborted) return;
        setBusy(true);setError(""); try {await adapter.cancel(job, AbortSignal.any([signal, AbortSignal.timeout(25000)]));}
        catch (error) {if (!signal.aborted) setError(error instanceof Error ? error.message : "Cancellation failed.");} finally {setBusy(false);}
      }}>Cancel job</button>}
      <button disabled={!text} onClick={() => downloadCFD(new Blob([text], {type:"text/plain"}), `${job.id}.log`)}>Download worker log</button>
    </div>
    {error && <p className="cfx-error" role="alert">{error}</p>}
    {logError&&<p className="cfx-error" role="alert">{logError}</p>}
    {resultError&&<div role="alert" className="cfx-error"><p>Native result retrieval failed: {resultError} Automatic retries are bounded; the job will not be rerun.</p>
      <button onClick={()=>setResultRetry(v=>v+1)}>Retry loading results</button></div>}
    {noResult&&<p>No native result manifest was produced for this {phase.toLowerCase()} job. Available solver logs are shown below.</p>}
    <ClimoptixConvergence name={name} workerSource={`Authenticated worker · job ${job.id}${older ? " · older setup: not the current configuration" : " · pinned setup revision"}`}
      state={{file:null, samples:log.samples, truncated:log.truncated, reading:false, error:""}} onImport={() => {}} onClear={() => {}} />
    <CFDWorkerTelemetry data={telemetry} result={result} jobId={job.id}/>
    {result && <section aria-label="Worker artifacts"><p>{result.accepted ? "Job acceptance checks passed." : "Diagnostic output only: job acceptance checks did not pass."} Native p is kinematic pressure (m²/s²), not Pa.</p>
      <div className="cfx-grid">{result.artifacts.map(artifact => <button key={artifact.id} disabled={busy} onClick={async () => {
        const signal = actions.current?.signal; if (!signal || signal.aborted) return;
        setBusy(true);setError("");
        try {const file = await adapter.download(job, artifact, AbortSignal.any([signal, AbortSignal.timeout(25000)]));
          if (signal.aborted) return;
          if (artifact.kind === "vtk") onVTK(file); else downloadCFD(file, file.name);
        } catch (error) {if (!signal.aborted) setError(error instanceof Error ? error.message : "Artifact download failed.");}
        finally {setBusy(false);}
      }}>{artifact.kind === "vtk" ? "View" : "Download"} {artifact.id}</button>)}</div>
    </section>}
    <details><summary>Bounded native solver log</summary><pre className="cfx-native-log">{text.slice(-64000)}</pre></details>
  </section>;
}
