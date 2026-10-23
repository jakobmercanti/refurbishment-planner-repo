// Browser-only integration fixture. Never imported by the production application.
import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ProjectDocument } from "../../../lib/projectDocument";
import type {
  CFDSubmission,
  CFDWorkerAdapter,
  CFDWorkerJob,
  CFDOperation,
} from "../../../lib/climoptixJobs";
import { ClimoptixStudies } from "../../../components/ClimoptixStudies";
import { useCFDJobs } from "../../../components/useCFDJobs";

const scope = window as typeof window & {
  initialProject: ProjectDocument;
  cfdFixture: unknown;
};
const transport = {
  submissions: [] as CFDSubmission[],
  jobs: {} as Record<string, CFDWorkerJob>,
  statusCalls: 0,
  aborts: 0,
  failSubmit: false,
  failStatus: false,
  wrongIdentity: false,
  holdSubmit: false,
  release: () => {},
};
const worker: CFDWorkerAdapter = {
  capabilities: { connected: true, mesh: true, run: true, reason: "" },
  async submit(request, signal) {
    transport.submissions.push(structuredClone(request));
    if (transport.holdSubmit)
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          transport.aborts++;
          reject(signal.reason);
        };
        transport.release = () => {
          signal.removeEventListener("abort", abort);
          resolve();
        };
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
    signal.throwIfAborted();
    if (transport.failSubmit)
      throw new Error("Response lost after worker acceptance");
    const job: CFDWorkerJob = {
      id: request.submissionId,
      studyId: request.studyId,
      clientRevision: request.clientRevision,
      phase: "Queued",
      progress: null,
      message: "Accepted",
    };
    transport.jobs[job.id] ??= job;
    return transport.jobs[job.id];
  },
  async status(id, signal) {
    signal.throwIfAborted();
    transport.statusCalls++;
    if (transport.failStatus) throw new Error("Temporary status failure");
    const job = transport.jobs[id];
    return transport.wrongIdentity ? { ...job, studyId: "another-study" } : job;
  },
};
const root = createRoot(document.getElementById("root")!);
function Fixture() {
  const [project, setProject] = useState(scope.initialProject);
  const [adapter, setAdapter] = useState(worker);
  const { entries, submit } = useCFDJobs(
    project,
    "/planner/engineering-api",
    adapter,
  );
  const scenarios = project.cfdScenarios!;
  const [selectedId, setSelectedId] = useState(scenarios[0].id);
  useLayoutEffect(() => {
    scope.cfdFixture = {
      transport,
      read: () => entries,
      submit: (ids: string[], operation: CFDOperation = "run") => {
        void submit(
          operation,
          scenarios.filter((s) => ids.includes(s.id)),
        );
      },
      editCpu: (id: string, cpu: number) =>
        setProject((p) => ({
          ...p,
          cfdScenarios: p.cfdScenarios!.map((s) =>
            s.id === id ? { ...s, resources: { ...s.resources, cpu } } : s,
          ),
        })),
      connect: (connected: boolean) =>
        setAdapter({
          ...worker,
          capabilities: { ...worker.capabilities, connected },
        }),
      unmount: () => root.unmount(),
    };
  });
  return (
    <ClimoptixStudies
      project={project}
      scenarios={scenarios}
      scenario={scenarios.find((s) => s.id === selectedId)}
      showArchived={false}
      onShowArchived={() => {}}
      onSelect={setSelectedId}
      onChange={(next) =>
        setProject((p) => ({
          ...p,
          cfdScenarios: p.cfdScenarios!.map((s) =>
            s.id === next.id ? next : s,
          ),
        }))
      }
      onOrder={(next) => setProject((p) => ({ ...p, cfdScenarios: next }))}
      onAdd={() => {}}
      onDuplicate={() => {}}
      onDelete={() => {}}
      onImport={() => {}}
      onConvergence={() => {}}
      entries={entries}
      worker={adapter}
      onSubmit={(op, studies) => void submit(op, studies)}
      onUndo={() => {}}
      onRedo={() => {}}
      canUndo={false}
      canRedo={false}
    />
  );
}
root.render(<Fixture />);
