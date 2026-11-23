import type { MeshGeometry, MeshSection } from "./cfdMeshInspection";

/** Native mesh topology stays in an isolated worker, never on the render thread. */
export function createLocalMeshSection(bytes: ArrayBuffer, meshId: string, signal: AbortSignal) {
  const worker = new Worker(new URL("./cfdMeshSection.worker.ts", import.meta.url), {type: "module"});
  let sequence = 0, closed = false;
  const pending = new Map<number, {resolve: (value: MeshGeometry) => void; reject: (cause: Error) => void}>();
  let readyResolve: () => void, readyReject: (cause: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const dispose = () => {
    if (closed) return;
    closed = true; worker.terminate(); signal.removeEventListener("abort", dispose);
    const cause = new Error("Local section calculation unavailable.");
    readyReject(cause); pending.forEach(request => request.reject(cause)); pending.clear();
  };
  worker.onmessage = ({data}: MessageEvent<{type: string; id: number; geometry: MeshGeometry}>) => {
    if (data.type === "ready") { readyResolve(); return; }
    if (data.type === "unavailable") { dispose(); return; }
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.type === "section") request.resolve(data.geometry);
    else request.reject(new Error("This cut needs exact server sectioning."));
  };
  worker.onerror = dispose;
  signal.addEventListener("abort", dispose, {once: true});
  worker.postMessage({type: "source", meshId, bytes}, [bytes]);
  if (signal.aborted) dispose();
  return {
    dispose, ready,
    cut: async (section: MeshSection, abort: AbortSignal): Promise<MeshGeometry> => {
      await ready;
      abort.throwIfAborted();
      if (closed) throw new Error("Local section calculation unavailable.");
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const finish = () => { clearTimeout(timer); pending.delete(id); abort.removeEventListener("abort", cancel); };
        const cancel = () => { finish(); reject(abort.reason); };
        const timer = setTimeout(() => { finish(); dispose(); reject(new Error("Using server sectioning for this mesh.")); }, 750);
        pending.set(id, {resolve: value => { finish(); resolve(value); }, reject: cause => { finish(); reject(cause); }});
        abort.addEventListener("abort", cancel, {once: true});
        worker.postMessage({type: "cut", id, section});
      });
    },
  };
}
