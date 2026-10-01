import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { buildAdjacency } from "../vendor/bumpmesh/exclusion.js";
import { QuantizedPointMap, IntPairMap } from "../vendor/bumpmesh/meshIndex.js";
import type { GeometryRevision, Transform, Vec3, Edge } from "../types";
import { uid } from "../types";
export function bufferGeometry(positions: Float32Array) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geometry;
}
export function parseSTL(buffer: ArrayBuffer) {
  if (buffer.byteLength > 200 * 1024 * 1024)
    throw new Error("STL exceeds the 200 MB import budget.");
  const binary =
    buffer.byteLength >= 84 &&
    84 + new DataView(buffer).getUint32(80, true) * 50 === buffer.byteLength;
  if (
    !binary &&
    !/^\s*solid\b/i.test(new TextDecoder().decode(buffer.slice(0, 256)))
  )
    throw new Error("Not a valid binary or ASCII STL.");
  if (
    binary &&
    new DataView(buffer).getUint32(80, true) * 432 > 512 * 1024 * 1024
  )
    throw new Error("STL triangle count exceeds the topology memory budget.");
  const g = new STLLoader().parse(buffer);
  return buildRevision(g.attributes.position.array as Float32Array);
}
export function buildRevision(
  source: Float32Array,
  extra: Partial<GeometryRevision> = {},
): GeometryRevision {
  if (source.byteLength * 12 > 512 * 1024 * 1024)
    throw new Error(
      "Geometry exceeds the topology memory budget. Simplify it before import.",
    );
  const positions = new Float32Array(source.length);
  const cleanFaceIds = extra.faceIds
    ? new Int32Array(source.length / 9)
    : undefined;
  let cursor = 0,
    removed = 0;
  for (let i = 0; i < source.length; i += 9) {
    const a = source.subarray(i, i + 9);
    const ux = a[3] - a[0],
      uy = a[4] - a[1],
      uz = a[5] - a[2],
      vx = a[6] - a[0],
      vy = a[7] - a[1],
      vz = a[8] - a[2];
    if (
      a.length !== 9 ||
      !a.every(Number.isFinite) ||
      (uy * vz - uz * vy) ** 2 +
        (uz * vx - ux * vz) ** 2 +
        (ux * vy - uy * vx) ** 2 <
        1e-24
    ) {
      removed++;
      continue;
    }
    if (cleanFaceIds) cleanFaceIds[cursor / 9] = extra.faceIds![i / 9];
    positions.set(a, cursor);
    cursor += 9;
  }
  if (!cursor) throw new Error("Geometry contains no valid triangles.");
  const clean = positions.slice(0, cursor),
    g = bufferGeometry(clean);
  g.computeVertexNormals();
  g.computeBoundingBox();
  const topology = (buildAdjacency as any)(g, {
    vertexEstimate: Math.max(16, clean.length / 18),
  });
  const edgeTable = new IntPairMap(Math.max(16, clean.length / 6));
  const edges: Edge[] = [];
  const vertexPoints: Vec3[] = [];
  const vertexAt = (i: number, id: number): Vec3 =>
    (vertexPoints[id] ??= [clean[i * 3], clean[i * 3 + 1], clean[i * 3 + 2]]);
  for (let f = 0; f < clean.length / 9; f++)
    for (const [p, q] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ]) {
      const va = topology.vertId[f * 3 + p],
        vb = topology.vertId[f * 3 + q];
      if (va === vb) continue;
      const a = Math.min(va, vb),
        b = Math.max(va, vb);
      const idx = edgeTable.get(a, b);
      if (idx !== undefined && idx !== -1) edges[idx].faces.push(f);
      else {
        edgeTable.getOrSet(a, b, edges.length);
        edges.push({
          a: vertexAt(f * 3 + p, va),
          b: vertexAt(f * 3 + q, vb),
          faces: [f],
          angle: 0,
        });
      }
    }
  // Full edge incidence is authoritative; non-manifold edges are traversal barriers.
  const adjacency: { neighbor: number; angle: number }[][] = topology.adjacency;
  for (const edge of edges) {
    if (edge.faces.length === 2) {
      const [a, b] = edge.faces;
      edge.angle = adjacency[a].find((n) => n.neighbor === b)?.angle || 0;
    } else if (edge.faces.length > 2) {
      const incidents = new Set(edge.faces);
      for (const face of edge.faces)
        adjacency[face] = adjacency[face].filter(
          (n) => !incidents.has(n.neighbor),
        );
    }
  }
  let volume = 0;
  for (let i = 0; i < clean.length; i += 9)
    volume +=
      (clean[i] * (clean[i + 4] * clean[i + 8] - clean[i + 5] * clean[i + 7]) +
        clean[i + 1] *
          (clean[i + 5] * clean[i + 6] - clean[i + 3] * clean[i + 8]) +
        clean[i + 2] *
          (clean[i + 3] * clean[i + 7] - clean[i + 4] * clean[i + 6])) /
      6;
  const revision: GeometryRevision = {
    id: uid(),
    kind: "mesh",
    positions: clean,
    normals: g.attributes.normal.array as Float32Array,
    edges,
    adjacency,
    faceNormals: topology.faceNormals,
    centroids: topology.centroids,
    bounds: {
      min: g.boundingBox!.min.toArray() as Vec3,
      max: g.boundingBox!.max.toArray() as Vec3,
    },
    diagnostics: {
      openEdges: edges.filter((e) => e.faces.length === 1).length,
      nonManifoldEdges: edges.filter((e) => e.faces.length > 2).length,
      shells: topology.shellCount,
      triangles: clean.length / 9,
      volume: Math.abs(volume),
      removed,
    },
    ...extra,
    ...(cleanFaceIds ? { faceIds: cleanFaceIds.slice(0, cursor / 9) } : {}),
  };
  if (clean.length / 9 >= 10000)
    revision.bvh = MeshBVH.serialize(new MeshBVH(g, { indirect: true }));
  g.dispose();
  return revision;
}
export function transformMatrix(transform: Transform) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...transform.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...transform.rotation)),
    new THREE.Vector3(...transform.scale),
  );
}
export function transformedPositions(g: GeometryRevision, t: Transform) {
  const matrix = transformMatrix(t),
    p = g.positions.slice(),
    v = new THREE.Vector3();
  for (let i = 0; i < p.length; i += 3) {
    v.fromArray(p, i).applyMatrix4(matrix);
    v.toArray(p, i);
  }
  if (matrix.determinant() < 0)
    for (let i = 0; i < p.length; i += 9)
      for (let k = 0; k < 3; k++) {
        const a = p[i + 3 + k];
        p[i + 3 + k] = p[i + 6 + k];
        p[i + 6 + k] = a;
      }
  return p;
}
export function indexedMesh(positions: Float32Array) {
  const map = new QuantizedPointMap(1e4, Math.max(16, positions.length / 3));
  const verts: number[] = [],
    indices = new Uint32Array(positions.length / 3);
  let next = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const id = map.getOrSet(
      positions[i],
      positions[i + 1],
      positions[i + 2],
      next,
    );
    if (map.inserted) {
      verts.push(positions[i], positions[i + 1], positions[i + 2]);
      next++;
    }
    indices[i / 3] = id;
  }
  return {
    numProp: 3,
    vertProperties: new Float32Array(verts),
    triVerts: indices,
  };
}
export function binarySTL(positions: Float32Array) {
  const n = positions.length / 9,
    buffer = new ArrayBuffer(84 + n * 50),
    view = new DataView(buffer);
  new Uint8Array(buffer).set(
    new TextEncoder().encode("M.E. Model-Editor | millimetres"),
  );
  view.setUint32(80, n, true);
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    normal = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const at = 84 + i * 50;
    a.fromArray(positions, i * 9);
    b.fromArray(positions, i * 9 + 3);
    c.fromArray(positions, i * 9 + 6);
    normal.subVectors(b, a).cross(c.sub(a)).normalize();
    for (let k = 0; k < 3; k++)
      view.setFloat32(at + k * 4, normal.getComponent(k), true);
    for (let k = 0; k < 9; k++)
      view.setFloat32(at + 12 + k * 4, positions[i * 9 + k], true);
  }
  return buffer;
}
