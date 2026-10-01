import { describe, it, expect } from 'vitest';
import { BoxGeometry } from 'three';
import { readSTL, writeSTL, topology, transformMesh, smoothMesh, sculptMesh, subdivideMesh, validatePositions } from '../src/mesh.js';
const cube = () => new BoxGeometry(20, 20, 20).toNonIndexed().attributes.position.array;
describe('print geometry', () => {
  it('round-trips STL with correct byte count, triangles and coordinates', () => {
    const positions = cube(), buffer = writeSTL(positions);
    expect(buffer.byteLength).toBe(84 + 12 * 50);
    expect(new DataView(buffer).getUint32(80, true)).toBe(12);
    expect(readSTL(buffer)).toEqual(positions);
    const view = new DataView(buffer); const n = [0, 4, 8].map(offset => view.getFloat32(84 + offset, true));
    expect(Math.hypot(...n)).toBeCloseTo(1);
  });
  it('reads ASCII STL', () => {
    const text = 'solid test\n facet normal 0 0 1\n outer loop\n vertex 0 0 0\n vertex 1 0 0\n vertex 0 1 0\n endloop\n endfacet\n endsolid test';
    expect(readSTL(new TextEncoder().encode(text).buffer)).toEqual(new Float32Array([0,0,0,1,0,0,0,1,0]));
  });
  it('identifies closed and open topology after welding duplicated STL vertices', () => {
    const closed = topology(cube()); expect(closed.vertices.length).toBe(8); expect(closed.open).toBe(0); expect(closed.nonManifold).toBe(0);
    expect(topology(cube().slice(9)).open).toBe(3);
  });
  it('exports transformed coordinates instead of just changing the viewport', () => {
    const result = transformMesh(cube(), { scale: 2, translation: [7, 0, 0], rotation: [0, 0, 90] });
    expect(Math.min(...Array.from(result).filter((_, i) => i % 3 === 0))).toBeCloseTo(-13);
    expect(Math.max(...Array.from(result).filter((_, i) => i % 3 === 0))).toBeCloseTo(27);
    expect(readSTL(writeSTL(result))).toEqual(result);
  });
  it('refines without opening seams or changing the surface', () => {
    const refined = subdivideMesh(cube()); expect(refined.length).toBe(cube().length * 4); expect(topology(refined).open).toBe(0);
    expect(Math.max(...refined)).toBe(10);
  });
  it('smooths connected vertices while keeping shared vertices welded', () => {
    const input = cube(), output = smoothMesh(input);
    expect(output).not.toEqual(input); expect(topology(output).vertices.length).toBe(8); expect(topology(output).open).toBe(0);
  });
  it('sculpts a local patch and keeps a closed mesh closed', () => {
    const input = subdivideMesh(cube()), output = sculptMesh(input, [[0, 0, 10]], 8, 1);
    expect(Math.max(...output)).toBeGreaterThan(10); expect(topology(output).open).toBe(0);
    expect(input[0]).toBe(output[0]);
  });
  it('rejects oversized and truncated binary STL headers before allocating geometry', () => {
    const oversized = new ArrayBuffer(84); new DataView(oversized).setUint32(80, 0xffffffff, true);
    expect(() => readSTL(oversized)).toThrow(/limit/);
    const truncated = new ArrayBuffer(84); new DataView(truncated).setUint32(80, 100, true);
    expect(() => readSTL(truncated)).toThrow(/incomplete/);
  });
  it('rejects empty, invalid and excessively dense meshes', () => {
    expect(() => validatePositions(new Float32Array())).toThrow();
    expect(() => validatePositions(new Float32Array([NaN,0,0,0,0,0,0,0,0]))).toThrow();
    expect(() => transformMesh(cube(), { scale: -1 })).toThrow();
    expect(() => subdivideMesh(new Float32Array(150001 * 9))).toThrow(/limit/);
  });
});
