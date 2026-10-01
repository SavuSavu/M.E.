import * as THREE from "three";
import type { GeometryRevision, Vec3 } from "../types";

const vertexKey = (p: Vec3) => p.map((v) => Math.round(v * 1e4)).join(",");
const graphs = new WeakMap<GeometryRevision, Map<string, number[]>>();
function featureGraph(g: GeometryRevision) {
  let graph = graphs.get(g);
  if (!graph) {
    graph = new Map();
    g.edges.forEach((e, id) => {
      if (e.faces.length !== 2 || e.angle < 3) return;
      for (const p of [e.a, e.b]) {
        const key = vertexKey(p),
          ids = graph!.get(key) || [];
        ids.push(id);
        graph!.set(key, ids);
      }
    });
    graphs.set(g, graph);
  }
  return graph;
}

export type EdgeChain = {
  ids: number[];
  a: Vec3;
  b: Vec3;
  faces: number[];
  branches: Vec3[];
};

/** Follow collinear feature segments on the same two planes, stopping at corners. */
export function straightEdgeChain(
  g: GeometryRevision,
  seed: number,
  preferred?: Set<number>,
): EdgeChain {
  const edge = g.edges[seed];
  if (!edge)
    throw new Error(
      "The selected edge is no longer available. Select it again.",
    );
  if (edge.faces.length !== 2 || edge.angle < 3)
    return {
      ids: [seed],
      a: edge.a,
      b: edge.b,
      faces: edge.faces,
      branches: [],
    };
  const graph = featureGraph(g),
    origin = new THREE.Vector3(...edge.a),
    axis = new THREE.Vector3(...edge.b).sub(origin).normalize(),
    normals = edge.faces.map((f) =>
      new THREE.Vector3().fromArray(g.faceNormals, f * 3),
    );
  const compatible = (id: number) => {
    const e = g.edges[id],
      direction = new THREE.Vector3(...e.b)
        .sub(new THREE.Vector3(...e.a))
        .normalize();
    if (Math.abs(direction.dot(axis)) < Math.cos(Math.PI / 180)) return false;
    const n = e.faces.map((f) =>
      new THREE.Vector3().fromArray(g.faceNormals, f * 3),
    );
    return (
      (normals[0].dot(n[0]) > 0.9999 && normals[1].dot(n[1]) > 0.9999) ||
      (normals[0].dot(n[1]) > 0.9999 && normals[1].dot(n[0]) > 0.9999)
    );
  };
  const visited = new Set([seed]),
    queue = [seed],
    branches: Vec3[] = [];
  while (queue.length) {
    const id = queue.pop()!;
    for (const point of [g.edges[id].a, g.edges[id].b]) {
      let next = (graph.get(vertexKey(point)) || []).filter(
        (i) => i !== id && compatible(i),
      );
      if (next.length > 1) {
        const chosen = next.filter((id) => preferred?.has(id));
        if (chosen.length === 1) next = chosen;
        else {
          branches.push(point);
          continue;
        }
      }
      for (const i of next)
        if (!visited.has(i)) {
          visited.add(i);
          queue.push(i);
        }
    }
  }
  let a = edge.a,
    b = edge.b,
    low = 0,
    high = new THREE.Vector3(...edge.b).sub(origin).dot(axis);
  for (const id of visited)
    for (const point of [g.edges[id].a, g.edges[id].b]) {
      const t = new THREE.Vector3(...point).sub(origin).dot(axis);
      if (t < low) {
        low = t;
        a = point;
      }
      if (t > high) {
        high = t;
        b = point;
      }
    }
  return {
    ids: [...visited].sort((a, b) => a - b),
    a,
    b,
    faces: edge.faces,
    branches,
  };
}

export function meshEdgeChains(g: GeometryRevision, seeds: number[]) {
  const seen = new Set<number>(),
    chains: EdgeChain[] = [],
    preferred = new Set(seeds);
  for (const seed of seeds) {
    if (seen.has(seed)) continue;
    const chain = straightEdgeChain(g, seed, preferred);
    chain.ids.forEach((id) => seen.add(id));
    chains.push(chain);
  }
  return chains;
}
