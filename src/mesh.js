import { BufferGeometry, Float32BufferAttribute, Vector3, Matrix4, Euler } from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

export const MAX_TRIANGLES = 600_000;
export function validatePositions(positions) {
  if (!positions?.length || positions.length % 9) throw new Error('The file contains no valid triangle mesh.');
  if (positions.length / 9 > MAX_TRIANGLES) throw new Error('This version supports up to 600,000 triangles. Simplify the model before importing.');
  if (!positions.every(Number.isFinite)) throw new Error('The model contains invalid coordinates.');
}
export function readSTL(buffer) {
  if (buffer.byteLength < 15) throw new Error('This STL file is empty or incomplete.');
  // Reject oversized binary files before the parser allocates vertex arrays.
  const header = new TextDecoder().decode(buffer.slice(0, 256));
  const asciiHeader = /^\s*solid\b/i.test(header);
  if (buffer.byteLength >= 84) {
    const view = new DataView(buffer), count = view.getUint32(80, true);
    const expected = 84 + count * 50;
    if (expected === buffer.byteLength || !asciiHeader) {
      if (count > MAX_TRIANGLES) throw new Error('STL exceeds the 600,000 triangle limit.');
      if (expected > buffer.byteLength) throw new Error('This binary STL file is incomplete.');
    } else {
      const text = new TextDecoder().decode(buffer);
      if ((text.match(/\bvertex\s/gi) || []).length > MAX_TRIANGLES * 3) throw new Error('STL exceeds the 600,000 triangle limit.');
    }
  } else if (!asciiHeader) throw new Error('This file does not contain valid STL geometry.');
  const geometry = new STLLoader().parse(buffer);
  const positions = geometry.attributes.position.array.slice();
  geometry.dispose(); validatePositions(positions); return positions;
}
export function geometryOf(positions) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.computeVertexNormals(); g.computeBoundingBox(); return g;
}
export function writeSTL(positions) {
  validatePositions(positions);
  const count = positions.length / 9;
  const buffer = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buffer);
  new Uint8Array(buffer).set(new TextEncoder().encode('M.E. | Model Editor | millimetres'));
  view.setUint32(80, count, true);
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), normal = new Vector3();
  for (let i = 0; i < count; i++) {
    a.fromArray(positions, i * 9); b.fromArray(positions, i * 9 + 3); c.fromArray(positions, i * 9 + 6);
    normal.crossVectors(b.sub(a), c.sub(a)).normalize();
    const offset = 84 + i * 50;
    normal.toArray().forEach((v, j) => view.setFloat32(offset + j * 4, v, true));
    for (let j = 0; j < 9; j++) view.setFloat32(offset + 12 + j * 4, positions[i * 9 + j], true);
  }
  return buffer;
}
export function transformMesh(positions, { scale = 1, rotation = [0, 0, 0], translation = [0, 0, 0] }) {
  if (![scale, ...rotation, ...translation].every(Number.isFinite) || scale <= 0) throw new Error('Enter finite values and a positive scale.');
  const g = geometryOf(positions);
  const center = g.boundingBox.getCenter(new Vector3());
  const matrix = new Matrix4().makeTranslation(-center.x, -center.y, -center.z);
  matrix.premultiply(new Matrix4().makeScale(scale, scale, scale));
  matrix.premultiply(new Matrix4().makeRotationFromEuler(new Euler(...rotation.map(v => v * Math.PI / 180))));
  matrix.premultiply(new Matrix4().makeTranslation(center.x + translation[0], center.y + translation[1], center.z + translation[2]));
  g.applyMatrix4(matrix);
  const result = g.attributes.position.array.slice(); g.dispose(); return result;
}
export function topology(positions) {
  const vertices = [], ids = new Uint32Array(positions.length / 3), map = new Map();
  const bounds = geometryOf(positions); const diagonal = bounds.boundingBox.getSize(new Vector3()).length(); bounds.dispose();
  const tolerance = Math.max(diagonal * 1e-7, 1e-6);
  for (let i = 0; i < positions.length; i += 3) {
    const point = Array.from(positions.subarray(i, i + 3));
    const key = point.map(v => Math.round(v / tolerance)).join(',');
    if (!map.has(key)) { map.set(key, vertices.length); vertices.push(point); }
    ids[i / 3] = map.get(key);
  }
  const neighbors = vertices.map(() => new Set()), edges = new Map(), normals = vertices.map(() => new Vector3());
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3();
  let degenerate = 0;
  for (let i = 0; i < ids.length; i += 3) {
    const tri = [ids[i], ids[i + 1], ids[i + 2]];
    a.fromArray(vertices[tri[0]]); b.fromArray(vertices[tri[1]]); c.fromArray(vertices[tri[2]]);
    n.crossVectors(b.sub(a), c.sub(a));
    if (n.lengthSq() < 1e-16) degenerate++;
    for (const id of tri) normals[id].add(n);
    for (let j = 0; j < 3; j++) {
      const u = tri[j], v = tri[(j + 1) % 3];
      neighbors[u].add(v); neighbors[v].add(u);
      const key = u < v ? `${u},${v}` : `${v},${u}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  normals.forEach(n => n.normalize());
  const boundary = new Set(); let open = 0, nonManifold = 0;
  for (const [key, count] of edges) {
    if (count !== 2) key.split(',').forEach(v => boundary.add(Number(v)));
    if (count === 1) open++; if (count > 2) nonManifold++;
  }
  return { vertices, ids, neighbors, normals, boundary, open, nonManifold, degenerate };
}
export function smoothMesh(positions, iterations = 1, strength = 0.3) {
  const t = topology(positions);
  let vertices = t.vertices;
  for (let iteration = 0; iteration < iterations; iteration++) {
    vertices = vertices.map((p, i) => {
      if (t.boundary.has(i) || !t.neighbors[i].size) return p;
      const average = [0, 0, 0];
      for (const j of t.neighbors[i]) for (let k = 0; k < 3; k++) average[k] += vertices[j][k] / t.neighbors[i].size;
      return p.map((v, k) => v + (average[k] - v) * strength);
    });
  }
  const output = positions.slice();
  for (let i = 0; i < t.ids.length; i++) output.set(vertices[t.ids[i]], i * 3);
  return output;
}
export function sculptMesh(positions, points, radius, amount) {
  const t = topology(positions);
  const displaced = t.vertices.map((p, i) => {
    if (t.boundary.has(i)) return p;
    let weight = 0;
    for (const hit of points) {
      const distance = Math.hypot(...p.map((v, k) => v - hit[k]));
      if (distance < radius) weight = Math.max(weight, Math.pow(1 - distance / radius, 2));
    }
    return p.map((v, k) => v + t.normals[i].getComponent(k) * amount * weight);
  });
  const output = positions.slice();
  for (let i = 0; i < t.ids.length; i++) output.set(displaced[t.ids[i]], i * 3);
  return output;
}
export function subdivideMesh(positions) {
  if (positions.length / 9 * 4 > MAX_TRIANGLES) throw new Error('Refining would exceed the 600,000 triangle limit.');
  const output = new Float32Array(positions.length * 4);
  for (let i = 0; i < positions.length; i += 9) {
    const a = Array.from(positions.subarray(i, i + 3)), b = Array.from(positions.subarray(i + 3, i + 6)), c = Array.from(positions.subarray(i + 6, i + 9));
    const ab = a.map((v, k) => (v + b[k]) / 2), bc = b.map((v, k) => (v + c[k]) / 2), ca = c.map((v, k) => (v + a[k]) / 2);
    output.set([...a, ...ab, ...ca, ...ab, ...b, ...bc, ...ca, ...bc, ...c, ...ab, ...bc, ...ca], i * 4);
  }
  return output;
}
