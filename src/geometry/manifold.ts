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
      const g = buildRevision(
          transformedPositions(inputs[0].geometry, inputs[0].transform),
        ),
        ids: number[] = job.params.edges || [];
      if (ids.length !== 1)
        throw new Error(
          "Select one isolated straight convex edge for mesh fillet/chamfer.",
        );
      // Reflections reverse triangle winding, so match the selected edge in world space.
      const sourceEdge = inputs[0].geometry.edges[ids[0]];
      if (!sourceEdge) throw new Error("Selected edge is no longer available.");
      const matrix = transformMatrix(inputs[0].transform);
      const endpointA = new THREE.Vector3(...sourceEdge.a).applyMatrix4(matrix);
      const endpointB = new THREE.Vector3(...sourceEdge.b).applyMatrix4(matrix);
      const tolerance = Math.max(
        1e-8,
        endpointA.distanceTo(endpointB) ** 2 * 1e-12,
      );
      const same = (point: Vec3, target: THREE.Vector3) =>
        new THREE.Vector3(...point).distanceToSquared(target) <= tolerance;
      const e = g.edges.find(
          (edge) =>
            (same(edge.a, endpointA) && same(edge.b, endpointB)) ||
            (same(edge.a, endpointB) && same(edge.b, endpointA)),
        ),
        r = Number(job.params.amount);
      if (!e || e.faces.length !== 2 || r <= 0)
        throw new Error("Select a manifold convex edge and a positive size.");
      const n1 = new THREE.Vector3().fromArray(g.faceNormals, e.faces[0] * 3),
        n2 = new THREE.Vector3().fromArray(g.faceNormals, e.faces[1] * 3);
      if (Math.abs(n1.dot(n2)) > 0.01)
        throw new Error(
          "Initial mesh blends support perpendicular planar surfaces.",
        );
      const pa = new THREE.Vector3(...e.a),
        pb = new THREE.Vector3(...e.b),
        axis = pb.clone().sub(pa),
        length = axis.length();
      axis.normalize();
      if (length < r * 4)
        throw new Error("Blend size exceeds the available edge clearance.");
      for (const f of e.faces)
        for (const item of g.adjacency[f])
          if (
            item.angle < 1 &&
            Math.abs(
              new THREE.Vector3()
                .fromArray(g.faceNormals, f * 3)
                .dot(
                  new THREE.Vector3().fromArray(
                    g.faceNormals,
                    item.neighbor * 3,
                  ),
                ) - 1,
            ) > 1e-4
          )
            throw new Error("Blend requires planar adjacent patches.");
      const inside = pa
        .clone()
        .addScaledVector(axis, length / 2)
        .addScaledVector(n1, -r / 10)
        .addScaledVector(n2, -r / 10);
      // Point containment prevents cutting a concave crease as if it were convex.
      const ray = new THREE.Ray(
          inside,
          new THREE.Vector3(0.312, 0.537, 0.784).normalize(),
        ),
        v1 = new THREE.Vector3(),
        v2 = new THREE.Vector3(),
        v3 = new THREE.Vector3(),
        hit = new THREE.Vector3();
      let crossings = 0;
      for (let i = 0; i < g.positions.length; i += 9)
        if (
          ray.intersectTriangle(
            v1.fromArray(g.positions, i),
            v2.fromArray(g.positions, i + 3),
            v3.fromArray(g.positions, i + 6),
            false,
            hit,
          )
        )
          crossings++;
      if (crossings % 2 !== 1)
        throw new Error("Only convex outside edges are supported.");
      const polygon: number[][] = [
        [0, 0],
        [r, 0],
      ];
      if (job.operation === "fillet")
        for (let i = 1; i <= 24; i++) {
          const t = -Math.PI / 2 - (i * Math.PI) / 48;
          polygon.push([r + r * Math.cos(t), r + r * Math.sin(t)]);
        }
      else polygon.push([0, r]);
      let cutter = own(m.Manifold.extrude([polygon], length));
      const basis = new THREE.Matrix4().makeBasis(
        n1.clone().negate(),
        n2.clone().negate(),
        axis,
      );
      const values = basis.elements;
      const mat = [
        values[0],
        values[1],
        values[2],
        0,
        values[4],
        values[5],
        values[6],
        0,
        values[8],
        values[9],
        values[10],
        0,
        pa.x,
        pa.y,
        pa.z,
        1,
      ];
      cutter = own(cutter.transform(mat));
      result = own(a.subtract(cutter));
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
