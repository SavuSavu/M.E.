import type { JobRequest, JobResponse } from "../types";
import { uid } from "../types";
let worker: Worker | undefined,
  ready = false,
  pending:
    | {
        id: string;
        resolve: (v: JobResponse) => void;
        reject: (e: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
export function cancelJob() {
  if (!pending) return;
  worker?.terminate();
  worker = undefined;
  ready = false;
  clearTimeout(pending.timer);
  pending.reject(new Error("Operation cancelled."));
  pending = undefined;
}
export function runJob(
  request: Omit<JobRequest, "id">,
  onProgress?: (message: string, progress: number) => void,
): Promise<JobResponse> {
  if (pending)
    return Promise.reject(new Error("Another geometry operation is running."));
  worker ??= new Worker(
    new URL("../workers/geometry.worker.ts", import.meta.url),
    { type: "module" },
  );
  const id = uid();
  return new Promise((resolve, reject) => {
    pending = {
      id,
      resolve,
      reject,
      timer: setTimeout(() => {
        cancelJob();
      }, 180000),
    };
    const post = () =>
      worker!.postMessage(
        { ...request, id },
        request.buffer ? [request.buffer] : [],
      );
    worker!.onerror = (e) => {
      const p = pending;
      worker?.terminate();
      worker = undefined;
      ready = false;
      pending = undefined;
      if (p) {
        clearTimeout(p.timer);
        p.reject(new Error(e.message || "Geometry worker crashed."));
      }
    };
    worker!.onmessage = ({
      data,
    }: MessageEvent<JobResponse | { type: "ready" }>) => {
      if (data.type === "ready") {
        ready = true;
        post();
        return;
      }
      if (data.id !== pending?.id) return;
      if (data.type === "progress") {
        onProgress?.(data.message || "Processing", data.progress || 0);
        return;
      }
      const p = pending;
      pending = undefined;
      clearTimeout(p.timer);
      if (data.type === "error") p.reject(new Error(data.message));
      else p.resolve(data);
    };
    // Module workers with async dependencies can dispatch an early message before
    // their handler is installed. Wait for a handshake rather than a timing delay.
    if (ready) post();
  });
}
