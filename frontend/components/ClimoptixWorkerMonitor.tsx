"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { terminalJob, type CFDWorkerJob } from "@/lib/climoptixJobs";
import { parseResidualLog } from "@/lib/climoptixWorkflow";
import { downloadCFD } from "@/lib/climoptix";
import type { RailwayCFDWorker } from "@/lib/railwayCFDWorker";
import type { WorkerTelemetry } from "@/lib/cfdWorkerTelemetry";
import { CFDWorkerTelemetry } from "./CFDWorkerTelemetry";
import { ClimoptixConvergence } from "./ClimoptixConvergence";
import { useCFDResult } from "./useCFDResult";
import { CFDResultFiles } from "./CFDResultFiles";
import { CFDJobProgress } from "./CFDJobProgress";
import { CFDCollapseAll } from "./CFDCollapseAll";

export function ClimoptixWorkerMonitor({adapter, job, name, older, onVTK}: {
  adapter: RailwayCFDWorker; job: CFDWorkerJob; name: string; older: boolean; onVTK: (file: File) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [logError,setLogError]=useState("");
  const resultState = useCFDResult(adapter,job);
  const {result,error:resultError,missing:noResult,retry:retryResult} = resultState;
  const [telemetry, setTelemetry] = useState<WorkerTelemetry | null>(null);
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
  const log = useMemo(() => parseResidualLog(text), [text]);
  return <section className="cfx-worker-monitor" data-cfx-collapse-root aria-label="Authenticated OpenFOAM job">
    <div className="cfx-panel-actions"><CFDCollapseAll /></div>
    <details open><summary>Job status &amp; controls</summary><CFDJobProgress job={job} name={name}/>
    <div className="cfx-inline-toolbar">
      {!terminalJob(job) && <button disabled={busy} onClick={async () => {
        const signal = actions.current?.signal; if (!signal || signal.aborted) return;
        setBusy(true);setError(""); try {await adapter.cancel(job, AbortSignal.any([signal, AbortSignal.timeout(25000)]));}
        catch (error) {if (!signal.aborted) setError(error instanceof Error ? error.message : "Cancellation failed.");} finally {setBusy(false);}
      }}>Cancel job</button>}
      <button disabled={!text} onClick={() => downloadCFD(new Blob([text], {type:"text/plain"}), `${job.id}.log`)}>Download worker log</button>
    </div>
    </details>
    {(error||logError||resultError||noResult)&&<details open><summary>Job diagnostics</summary>
    {error && <p className="cfx-error" role="alert">{error}</p>}
    {logError&&<p className="cfx-error" role="alert">{logError}</p>}
    {resultError&&<div role="alert" className="cfx-error"><p>Native result retrieval failed: {resultError} Automatic retries are bounded; the job will not be rerun.</p>
      <button onClick={retryResult}>Retry loading results</button></div>}
    {noResult&&<p>No native result manifest was produced for this {phase.toLowerCase()} job. Available solver logs are shown below.</p>}
    </details>}
    <details open><summary>Convergence &amp; residuals</summary>
    <ClimoptixConvergence name={name} workerSource={`Authenticated worker · job ${job.id}${older ? " · older setup: not the current configuration" : " · pinned setup revision"}`}
      state={{file:null, samples:log.samples, truncated:log.truncated, reading:false, error:""}} onImport={() => {}} onClear={() => {}} />
    </details><details open><summary>Worker telemetry</summary><CFDWorkerTelemetry data={telemetry} result={result} jobId={job.id}/></details>
    {result && <CFDResultFiles adapter={adapter} job={job} result={result} onVTK={onVTK}/>}
    <details><summary>Bounded native solver log</summary><pre className="cfx-native-log">{text.slice(-64000)}</pre></details>
  </section>;
}
