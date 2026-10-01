import type { JobRequest, JobResponse } from "../types";
import {
  buildRevision,
  parseSTL,
  bufferGeometry,
  transformedPositions,
  binarySTL,
} from "../geometry/mesh";
import { meshOperation } from "../geometry/manifold";
import { resolveTJunctions } from "../vendor/bumpmesh/meshRepair.js";
import { decimate } from "../vendor/bumpmesh/decimation.js";
import { subdivide } from "../vendor/bumpmesh/subdivision.js";
import { runExpensiveDiagnostics } from "../vendor/bumpmesh/meshValidation.js";
self.onmessage = async ({ data: job }: MessageEvent<JobRequest>) => {
  const send = (payload: Partial<JobResponse>) => {
    const transfers = new Set<ArrayBuffer>();
    for (const g of payload.results || []) {
      for (const data of [
        g.positions,
        g.normals,
        g.centroids,
        g.faceNormals,
        g.faceIds,
        g.bvh?.index,
        g.bvh?.indirectBuffer,
      ])
        if (data?.buffer instanceof ArrayBuffer) transfers.add(data.buffer);
      for (const buffer of g.bvh?.roots || []) transfers.add(buffer);
    }
    if (payload.data instanceof ArrayBuffer) transfers.add(payload.data);
    self.postMessage({ id: job.id, revision: job.revision, ...payload }, [
      ...transfers,
    ]);
  };
  try {
    send({ type: "progress", message: "Preparing geometry", progress: 0.08 });
    const bytes =
      (job.buffer?.byteLength || 0) +
      (job.inputs || []).reduce(
        (sum, i) => sum + i.geometry.positions.byteLength * 12,
        0,
      );
    if (bytes > 512 * 1024 * 1024)
      throw new Error(
        "Operation exceeds the 512 MB geometry budget. Simplify the model first.",
      );
    const positive = (key: string) => {
      if (
        typeof job.params[key] !== "number" ||
        !Number.isFinite(job.params[key]) ||
        job.params[key] <= 0
      )
        throw new Error(`${key} must be a positive finite number.`);
    };
    if (job.operation === "primitive") {
      if (!["cube", "cylinder", "sphere"].includes(job.params.shape))
        throw new Error("Unknown primitive shape.");
      for (const key of job.params.shape === "cube"
        ? ["width", "depth", "height"]
        : job.params.shape === "cylinder"
          ? ["radius", "height"]
          : ["radius"])
        positive(key);
    }
    if (["fillet", "chamfer"].includes(job.operation)) positive("amount");
    if (
      job.operation === "offset" &&
      (!Number.isFinite(job.params.amount) || !job.params.amount)
    )
      throw new Error("Offset must be finite and non-zero.");
    if (job.operation === "simplify") {
      positive("triangles");
      if (job.params.triangles < 4)
        throw new Error("Target must have at least four triangles.");
    }
    if (job.operation === "subdivide") {
      positive("edgeLength");
      const g = job.inputs![0].geometry,
        areaEstimate =
          ((g.positions.length / 9) *
            Math.max(...g.bounds.max.map((v, i) => v - g.bounds.min[i])) ** 2) /
          job.params.edgeLength ** 2;
      if (areaEstimate > 5000000)
        throw new Error(
          "Requested refinement exceeds the triangle budget. Increase the maximum edge length.",
        );
    }
    let results;
    if (job.operation === "import") results = [parseSTL(job.buffer!)];
    else if (job.operation === "restore")
      results = [
        buildRevision(new Float32Array(job.buffer!), job.params.extra),
      ];
    else if (job.operation === "select") {
      const { surfaceSelection } = await import("../geometry/selection");
      send({
        type: "result",
        data: surfaceSelection(
          job.inputs![0].geometry,
          job.params.seed,
          job.params.mode,
          job.params.angle,
        ),
      });
      return;
    } else if (job.operation === "paint") {
      const data = (await import("../geometry/paint")).paintRegion(
        job.inputs![0].geometry,
        job.params,
      );
      send({ type: "result", data });
      return;
    } else if (job.operation === "export") {
      const all = (job.inputs || []).map((i) =>
          transformedPositions(i.geometry, i.transform),
        ),
        p = new Float32Array(all.reduce((n, a) => n + a.length, 0));
      let offset = 0;
      for (const a of all) {
        p.set(a, offset);
        offset += a.length;
      }
      send({ type: "result", data: binarySTL(p) });
      return;
    } else if (job.operation === "diagnostics") {
      const g = bufferGeometry(job.inputs![0].geometry.positions);
      const data = await runExpensiveDiagnostics(g, { get: () => 0 }, null);
      send({ type: "result", data });
      return;
    } else if (["repair", "simplify", "subdivide"].includes(job.operation)) {
      const input = job.inputs![0],
        g = bufferGeometry(
          transformedPositions(input.geometry, input.transform),
        );
      let out: any;
      if (job.operation === "repair")
        out = resolveTJunctions(g, { onSegTol: 0.0001 });
      else if (job.operation === "simplify")
        out = await decimate(g, job.params.triangles, (p: number) =>
          send({ type: "progress", progress: p, message: "Simplifying" }),
        );
      else
        out = await subdivide(g, job.params.edgeLength, (p: number) =>
          send({ type: "progress", progress: p, message: "Subdividing" }),
        );
      const geo = out.geometry || out;
      results = [buildRevision(geo.attributes.position.array)];
      g.dispose();
    } else if (
      job.operation === "primitive" ||
      job.inputs?.every((i) => i.geometry.kind === "brep")
    ) {
      send({
        type: "progress",
        message: "Loading CAD kernel / evaluating solid",
        progress: 0.25,
      });
      results = await (await import("../geometry/cad")).cadOperation(job);
    } else {
      send({
        type: "progress",
        message: "Evaluating mesh solid",
        progress: 0.25,
      });
      results = await meshOperation(job);
    }
    send({ type: "result", results });
  } catch (error) {
    send({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
self.postMessage({ type: "ready" });
