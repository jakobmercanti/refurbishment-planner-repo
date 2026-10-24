"use client";

import { useEffect, useState } from "react";
import { terminalJob, type CFDWorkerJob } from "@/lib/climoptixJobs";
import { parseResidualLog } from "@/lib/climoptixWorkflow";
import { downloadCFD } from "@/lib/climoptix";
import type { RailwayCFDWorker, WorkerResult } from "@/lib/railwayCFDWorker";
import { ClimoptixConvergence } from "./ClimoptixConvergence";

export function ClimoptixWorkerMonitor({adapter, job, name, older, onVTK}: {
  adapter: RailwayCFDWorker; job: CFDWorkerJob; name: string; older: boolean; onVTK: (file: File) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<WorkerResult | null>(null);
  const [busy, setBusy] = useState(false);
  const {id, studyId, clientRevision} = job;
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
        setText(buffer); setError("");
        if (terminalJob(chunk) && chunk.cursor === chunk.nextCursor) return;
        timer = setTimeout(() => void poll(), chunk.text.length >= 128*1024 ? 10 : 1500);
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(error instanceof Error ? error.message : "Worker telemetry unavailable.");
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
    void adapter.result({id, studyId, clientRevision, phase, progress: null, message: ""}, controller.signal)
      .then(data => {if (!controller.signal.aborted) setResult(data);})
      .catch(() => { /* A failed mesh or cancelled job may have logs but no native result. */ });
    return () => controller.abort();
  }, [adapter, id, studyId, clientRevision, phase]);
  const log = parseResidualLog(text);
  return <section className="cfx-worker-monitor" aria-label="Authenticated OpenFOAM job">
    <div className="cfx-inline-toolbar"><strong>{job.phase} · {job.message}</strong>
      {!terminalJob(job) && <button disabled={busy} onClick={async () => {
        setBusy(true); try {await adapter.cancel(job, AbortSignal.timeout(25000));}
        catch (error) {setError(error instanceof Error ? error.message : "Cancellation failed.");} finally {setBusy(false);}
      }}>Cancel job</button>}
      <button disabled={!text} onClick={() => downloadCFD(new Blob([text], {type:"text/plain"}), `${job.id}.log`)}>Download worker log</button>
    </div>
    {error && <p className="cfx-error" role="alert">{error}</p>}
    <ClimoptixConvergence name={name} workerSource={`Authenticated worker · job ${job.id}${older ? " · older setup: not the current configuration" : " · pinned setup revision"}`}
      state={{file:null, samples:log.samples, truncated:log.truncated, reading:false, error:""}} onImport={() => {}} onClear={() => {}} />
    {result && <section aria-label="Worker artifacts"><p>{result.accepted ? "Job acceptance checks passed." : "Diagnostic output only: job acceptance checks did not pass."} Native p is kinematic pressure (m²/s²), not Pa.</p>
      <div className="cfx-grid">{result.artifacts.map(artifact => <button key={artifact.id} disabled={busy} onClick={async () => {
        setBusy(true);
        try {const file = await adapter.download(job, artifact, AbortSignal.timeout(25000));
          if (artifact.kind === "vtk") onVTK(file); else downloadCFD(file, file.name);
        } catch (error) {setError(error instanceof Error ? error.message : "Artifact download failed.");}
        finally {setBusy(false);}
      }}>{artifact.kind === "vtk" ? "View" : "Download"} {artifact.id}</button>)}</div>
    </section>}
    <details><summary>Bounded native solver log</summary><pre className="cfx-native-log">{text.slice(-64000)}</pre></details>
  </section>;
}
