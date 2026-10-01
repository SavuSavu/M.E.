import { it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { buildRevision, bufferGeometry } from "../src/geometry/mesh";
import { surfaceSelection } from "../src/geometry/selection";
it.skipIf(process.env.ME_BENCH !== "1")(
  "benchmarks one million triangles with stable BVH picking",
  () => {
    const positions = new THREE.PlaneGeometry(100, 100, 708, 708).toNonIndexed()
      .attributes.position.array as Float32Array;
    const start = performance.now(),
      g = buildRevision(positions),
      buildMs = performance.now() - start;
    const display = bufferGeometry(g.positions),
      bvh = MeshBVH.deserialize(g.bvh, display, { setIndex: false }),
      ray = new THREE.Ray(
        new THREE.Vector3(0.124, 0.357, 20),
        new THREE.Vector3(0, 0, -1),
      );
    const pickStart = performance.now();
    for (let i = 0; i < 100; i++)
      expect(bvh.raycastFirst(ray, THREE.DoubleSide)).not.toBeNull();
    const hoverMs = (performance.now() - pickStart) / 100;
    const selectStart = performance.now(),
      ids = surfaceSelection(g, 0, "planar", 20),
      selectionMs = performance.now() - selectStart;
    expect(ids.length).toBe(g.diagnostics.triangles);
    const metrics = {
      triangles: g.diagnostics.triangles,
      buildMs,
      hoverMs,
      selectionMs,
      heapMB: Math.round(process.memoryUsage().heapUsed / 1048576),
      arrayBuffersMB: Math.round(process.memoryUsage().arrayBuffers / 1048576),
    };
    mkdirSync("test-results", { recursive: true });
    writeFileSync(
      "test-results/benchmark.json",
      JSON.stringify(metrics, null, 2),
    );
    expect(hoverMs).toBeLessThan(50);
  },
  60000,
);
