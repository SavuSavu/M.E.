import initManifold from "manifold-3d";
import wasmUrl from "manifold-3d/manifold.wasm?url";
import * as THREE from "three";
import {
  buildRevision,
  indexedMesh,
  transformedPositions,
  transformMatrix,
} from "./mesh";
import type { GeometryRevision, JobRequest, Vec3 } from "../types";
import { meshEdgeChains } from "./edgeChains";
import { blendCutters } from "./meshBlend";
let modulePromise: Promise<any> | undefined;
export const manifoldModule = () =>
  (modulePromise ??= (
    initManifold({ locateFile: () => wasmUrl }) as Promise<any>
  ).then((m) => {
    m.setup();
    return m;
  }));
export function revisionFromManifold(solid: any): GeometryRevision {
  const status = solid.status();
  if (status !== "NoError")
    throw new Error(
      `Mesh operation failed: ${status}. Repair the input first.`,
    );
  const mesh = solid.getMesh(),
    p = new Float32Array(mesh.triVerts.length * 3);
  for (let i = 0; i < mesh.triVerts.length; i++)
    for (let k = 0; k < 3; k++)
      p[i * 3 + k] = mesh.vertProperties[mesh.triVerts[i] * mesh.numProp + k];
  return buildRevision(p);
}
export async function meshOperation(job: JobRequest) {
  const m = await manifoldModule(),
    objects: any[] = [];
  const own = (o: any) => {
    objects.push(o);
    return o;
  };
  const load = (input: NonNullable<JobRequest["inputs"]>[number]) => {
    if (
      input.geometry.diagnostics.openEdges ||
      input.geometry.diagnostics.nonManifoldEdges
    )
      throw new Error(
        "Boolean operations require closed, manifold operands. Use Diagnostics and Repair first.",
      );
    const mesh = new m.Mesh(
      indexedMesh(transformedPositions(input.geometry, input.transform)),
    );
    mesh.merge();
    const solid = own(m.Manifold.ofMesh(mesh));
    if (solid.status() !== "NoError")
      throw new Error(`Input is not a valid solid: ${solid.status()}.`);
    return solid;
  };
  try {
    const inputs = job.inputs || [],
      a = load(inputs[0]);
    let result: any;
    if (job.operation === "split") {
      const parts =
        inputs.length > 1
          ? a.split(load(inputs[1]))
          : a.splitByPlane(
              job.params.normal || [0, 0, 1],
              job.params.offset || 0,
            );
      parts.forEach(own);
      if (parts.some((p: any) => p.isEmpty()))
        throw new Error("Split does not produce two non-empty bodies.");
      return parts.map(revisionFromManifold);
    }
    if (["fillet", "chamfer"].includes(job.operation)) {
      const source = inputs[0].geometry;
      const matrix = transformMatrix(inputs[0].transform);
      const g = matrix.equals(new THREE.Matrix4())
        ? source
        : buildRevision(transformedPositions(source, inputs[0].transform));
      const sourceIds = meshEdgeChains(source, job.params.edges || []).flatMap(
        (chain) => chain.ids,
      );
      const worldIds =
        g === source
          ? sourceIds
          : sourceIds.map((sourceId) => {
              const edge = source.edges[sourceId];
              const a = new THREE.Vector3(...edge.a).applyMatrix4(matrix);
              const b = new THREE.Vector3(...edge.b).applyMatrix4(matrix);
              const tolerance = Math.max(1e-8, a.distanceToSquared(b) * 1e-12);
              const same = (point: Vec3, target: THREE.Vector3) =>
                new THREE.Vector3(...point).distanceToSquared(target) <=
                tolerance;
              const id = g.edges.findIndex(
                (e) =>
                  (same(e.a, a) && same(e.b, b)) ||
                  (same(e.a, b) && same(e.b, a)),
              );
              if (id < 0)
                throw new Error(
                  "Selected edge is no longer available. Select it again.",
                );
              return id;
            });
      const cutters = blendCutters(
        g,
        meshEdgeChains(g, worldIds),
        m,
        Number(job.params.amount),
        job.operation as "fillet" | "chamfer",
        own,
      );
      result = a;
      for (const cutter of cutters) result = own(result.subtract(cutter));
    } else if (job.operation === "offset") {
      const ids: number[] = job.params.faces || [],
        g = inputs[0].geometry,
        amount = Number(job.params.amount);
      if (!ids.length || !amount)
        throw new Error("Select a planar surface and a non-zero offset.");
      const normal = new THREE.Vector3().fromArray(g.faceNormals, ids[0] * 3),
        origin = new THREE.Vector3().fromArray(g.positions, ids[0] * 9);
      const chosen = new Set(ids);
      for (const f of ids)
        if (
          normal.dot(new THREE.Vector3().fromArray(g.faceNormals, f * 3)) <
          0.99999
        )
          throw new Error("Mesh offset supports planar regions only.");
      const boundary = g.edges.filter(
        (e) =>
          e.faces.filter((f) => chosen.has(f)).length === 1 &&
          e.faces.some((f) => !chosen.has(f)),
      );
      if (boundary.length < 3)
        throw new Error(
          "Select a complete planar region with one closed boundary.",
        );
      const key = (p: Vec3) => p.map((v) => Math.round(v * 1e4)).join(","),
        loop: Vec3[] = [boundary[0].a],
        remaining = [...boundary];
      let current = boundary[0].a;
      while (remaining.length) {
        const idx = remaining.findIndex(
          (e) => key(e.a) === key(current) || key(e.b) === key(current),
        );
        if (idx < 0)
          throw new Error("Offset requires one simple boundary without holes.");
        const [e] = remaining.splice(idx, 1);
        current = key(e.a) === key(current) ? e.b : e.a;
        loop.push(current);
      }
      if (key(loop[0]) !== key(loop[loop.length - 1]))
        throw new Error("Offset boundary is open.");
      loop.pop();
      const u = new THREE.Vector3()
          .fromArray(g.positions, ids[0] * 9 + 3)
          .sub(origin)
          .normalize(),
        v = normal.clone().cross(u).normalize();
      const poly = loop.map((p) => {
        const q = new THREE.Vector3(...p).sub(origin);
        return [q.dot(u), q.dot(v)];
      });
      // Boundary traversal is undirected. Manifold's positive fill rule requires CCW contours.
      const twiceArea = poly.reduce((sum, point, i) => {
        const next = poly[(i + 1) % poly.length];
        return sum + point[0] * next[1] - next[0] * point[1];
      }, 0);
      if (twiceArea < 0) poly.reverse();
      let prism = own(m.Manifold.extrude([poly], Math.abs(amount) + 1e-4));
      const matrix = new THREE.Matrix4()
        .makeBasis(u, v, normal.clone().multiplyScalar(Math.sign(amount)))
        .setPosition(
          origin.clone().addScaledVector(normal, -Math.sign(amount) * 1e-4),
        )
        .premultiply(
          (await import("./mesh")).transformMatrix(inputs[0].transform),
        );
      prism = own(prism.transform(matrix.elements));
      result = own(amount > 0 ? a.add(prism) : a.subtract(prism));
    } else {
      const b = load(inputs[1]);
      result = own(
        job.operation === "union"
          ? a.add(b)
          : job.operation === "subtract"
            ? a.subtract(b)
            : a.intersect(b),
      );
    }
    if (result.isEmpty())
      throw new Error(
        "Operation produces an empty body. Change the operands or parameters.",
      );
    return [revisionFromManifold(result)];
  } finally {
    for (const o of objects.reverse()) o.delete();
  }
}
