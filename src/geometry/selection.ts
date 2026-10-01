import * as THREE from "three";
import { bucketFill } from "../vendor/bumpmesh/exclusion.js";
import type { GeometryRevision, EntityKind } from "../types";
export function effectiveSelection(
  g: GeometryRevision,
  ids: number[],
  mode: "include" | "exclude",
  edges = false,
  angle = 20,
) {
  if (mode === "include") return ids;
  const omitted = new Set(ids);
  const candidates = edges
    ? featureEdges(g, angle)
    : Array.from({ length: g.diagnostics.triangles }, (_, i) => i);
  return candidates.filter((i) => !omitted.has(i));
}
export function surfaceSelection(
  g: GeometryRevision,
  seed: number,
  mode: EntityKind,
  angle: number,
): number[] {
  if (seed < 0 || seed >= g.diagnostics.triangles) return [];
  if (mode === "face") {
    if (g.kind === "brep" && g.faceIds)
      return Array.from(g.faceIds.entries())
        .filter(([, id]) => id === g.faceIds![seed])
        .map(([i]) => i);
    return [seed];
  }
  if (g.kind === "brep" && g.faceIds && mode === "planar")
    return g.planarFaceIds?.includes(g.faceIds[seed])
      ? surfaceSelection(g, seed, "face", angle)
      : [];
  const threshold = mode === "planar" ? Math.min(angle, 1) : angle;
  const result = Array.from(
    bucketFill(seed, g.adjacency, threshold),
  ) as number[];
  if (mode !== "planar") {
    if (g.kind === "brep" && g.faceIds) {
      const faces = new Set(result.map((i) => g.faceIds![i]));
      return Array.from(g.faceIds.entries())
        .filter(([, id]) => faces.has(id))
        .map(([i]) => i);
    }
    return result;
  }
  const normal = new THREE.Vector3().fromArray(g.faceNormals, seed * 3),
    origin = new THREE.Vector3().fromArray(g.centroids, seed * 3);
  const diag = new THREE.Vector3(...g.bounds.max)
    .sub(new THREE.Vector3(...g.bounds.min))
    .length();
  const tolerance = Math.max(1e-4, diag * 1e-5),
    p = new THREE.Vector3();
  const accepted = new Set(
    result.filter((f) =>
      [0, 3, 6].every(
        (k) =>
          Math.abs(
            p
              .fromArray(g.positions, f * 9 + k)
              .sub(origin)
              .dot(normal),
          ) <= tolerance,
      ),
    ),
  );
  // Re-traverse only accepted faces; do not bridge rejected triangles.
  const out: number[] = [],
    visited = new Set([seed]),
    queue = [seed];
  while (queue.length) {
    const f = queue.pop()!;
    if (!accepted.has(f)) continue;
    out.push(f);
    for (const e of g.adjacency[f])
      if (!visited.has(e.neighbor)) {
        visited.add(e.neighbor);
        queue.push(e.neighbor);
      }
  }
  return out;
}
export function featureEdges(g: GeometryRevision, angle = 20) {
  return g.edges
    .map((e, i) => ({ e, i }))
    .filter(
      ({ e }) =>
        e.kernelId !== undefined || e.faces.length !== 2 || e.angle > angle,
    )
    .map(({ i }) => i);
}
const key = (p: number[]) => p.map((x) => Math.round(x * 1e4)).join(",");
export function edgeSelection(
  g: GeometryRevision,
  seed: number,
  mode: EntityKind,
  threshold = 20,
) {
  if (g.kind === "brep" && g.edges[seed]?.kernelId !== undefined) {
    const id = g.edges[seed].kernelId;
    if (mode === "edge" || mode === "curve")
      return g.edges
        .map((e, i) => (e.kernelId === id ? i : -1))
        .filter((i) => i >= 0);
    if (mode === "loop") {
      const loop = g.nativeLoops?.find((loop) => loop.includes(id!));
      return loop
        ? g.edges
            .map((e, i) => (loop.includes(e.kernelId!) ? i : -1))
            .filter((i) => i >= 0)
        : [];
    }
  }
  if (mode === "edge") return [seed];
  const features = featureEdges(g, threshold),
    byVertex = new Map<string, number[]>();
  for (const i of features)
    for (const p of [g.edges[i].a, g.edges[i].b]) {
      const k = key(p);
      byVertex.set(k, [...(byVertex.get(k) || []), i]);
    }
  const result: number[] = [],
    visited = new Set<number>(),
    queue = [seed];
  while (queue.length) {
    const i = queue.pop()!;
    if (visited.has(i)) continue;
    visited.add(i);
    result.push(i);
    const e = g.edges[i];
    for (const p of [e.a, e.b]) {
      const next = byVertex.get(key(p)) || [];
      if (mode !== "connected-edges" && next.length !== 2) continue;
      for (const j of next) {
        if (mode === "curve") {
          const f = g.edges[j],
            u = new THREE.Vector3(...e.b)
              .sub(new THREE.Vector3(...e.a))
              .normalize(),
            v = new THREE.Vector3(...f.b)
              .sub(new THREE.Vector3(...f.a))
              .normalize();
          if (
            (Math.acos(Math.min(1, Math.abs(u.dot(v)))) * 180) / Math.PI >
            threshold
          )
            continue;
        }
        queue.push(j);
      }
    }
  }
  if (
    mode === "loop" &&
    result.some((i) =>
      [g.edges[i].a, g.edges[i].b].some(
        (p) =>
          (byVertex.get(key(p)) || []).filter((j) => visited.has(j)).length !==
          2,
      ),
    )
  )
    return [];
  return result;
}
export function fittedRadius(points: THREE.Vector3[]) {
  if (points.length < 3) return null;
  if (
    points.length > 3 &&
    points[0].distanceToSquared(points[points.length - 1]) < 1e-12
  )
    points = points.slice(0, -1);
  const a = points[0],
    b = points[Math.floor(points.length / 3)],
    c = points[Math.floor((points.length * 2) / 3)],
    ab = b.clone().sub(a),
    ac = c.clone().sub(a),
    cross = ab.clone().cross(ac),
    den = 2 * cross.lengthSq();
  if (den < 1e-12) return null;
  const center = a
      .clone()
      .add(
        ac
          .clone()
          .cross(cross)
          .multiplyScalar(ab.lengthSq())
          .add(cross.clone().cross(ab).multiplyScalar(ac.lengthSq()))
          .divideScalar(den),
      ),
    radius = center.distanceTo(a);
  const error = Math.max(
    ...points.map((p) => Math.abs(p.distanceTo(center) - radius)),
  );
  return { center, radius, error };
}
