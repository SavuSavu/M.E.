import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import {
  buildRevision,
  binarySTL,
  parseSTL,
  transformedPositions,
  bufferGeometry,
} from "../src/geometry/mesh";
import {
  surfaceSelection,
  edgeSelection,
  featureEdges,
  fittedRadius,
  effectiveSelection,
} from "../src/geometry/selection";
import { identityTransform } from "../src/types";
import { paintRegion } from "../src/geometry/paint";
const cube = () =>
  buildRevision(
    new THREE.BoxGeometry(20, 20, 20).toNonIndexed().attributes.position
      .array as Float32Array,
  );
describe("mesh geometry and editor semantics", () => {
  it("preserves source placement and committed transform through STL round-trip", () => {
    const g = cube(),
      t = identityTransform();
    t.position = [83, -27, 10];
    t.scale = [-2, 1, 3];
    const output = parseSTL(binarySTL(transformedPositions(g, t)));
    expect(output.bounds.min).toEqual([63, -37, -20]);
    expect(output.bounds.max).toEqual([103, -17, 40]);
    expect(output.diagnostics.openEdges).toBe(0);
    expect(output.diagnostics.nonManifoldEdges).toBe(0);
    expect(output.diagnostics.volume).toBeCloseTo(48000);
  });
  it("finds six connected planar patches on a cube and respects dihedral thresholds", () => {
    const g = cube();
    expect(g.diagnostics.volume).toBeCloseTo(8000);
    expect(g.diagnostics.openEdges).toBe(0);
    expect(surfaceSelection(g, 0, "planar", 20)).toHaveLength(2);
    expect(surfaceSelection(g, 0, "surface", 20)).toHaveLength(2);
    expect(surfaceSelection(g, 0, "surface", 91)).toHaveLength(12);
    expect(featureEdges(g)).toHaveLength(12);
  });
  it("does not traverse non-manifold edges", () => {
    const g = buildRevision(
      new Float32Array([
        0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0,
        0, 0, 1,
      ]),
    );
    expect(g.diagnostics.nonManifoldEdges).toBe(1);
    expect(surfaceSelection(g, 0, "surface", 180)).toEqual([0]);
  });
  it("removes invalid triangles and rejects malformed STL", () => {
    const g = cube();
    const positions = new Float32Array(g.positions.length + 18);
    positions.set(g.positions);
    positions[g.positions.length] = NaN;
    const clean = buildRevision(positions);
    expect(clean.diagnostics.removed).toBe(2);
    expect(() =>
      parseSTL(new TextEncoder().encode("not an STL").buffer),
    ).toThrow("valid");
  });
  it("stops feature loops at branch vertices", () => {
    const g = cube(),
      e = featureEdges(g)[0];
    expect(edgeSelection(g, e, "loop")).toEqual([]);
    expect(edgeSelection(g, e, "connected-edges")).toHaveLength(12);
  });
  it("uses the same Include/Exclude complement for geometry tools and overlays", () => {
    const g = cube();
    expect(effectiveSelection(g, [0, 1], "include")).toEqual([0, 1]);
    expect(effectiveSelection(g, [0, 1], "exclude")).toHaveLength(10);
    const edges = featureEdges(g);
    expect(effectiveSelection(g, [edges[0]], "exclude", true)).toEqual(
      edges.slice(1),
    );
  });
  it("paints a small patch on a coarse cube without changing base mesh topology", () => {
    const g = cube(),
      p = g.centroids.slice(0, 3),
      point = { x: p[0], y: p[1], z: p[2] },
      view = {
        x: -g.faceNormals[0],
        y: -g.faceNormals[1],
        z: -g.faceNormals[2],
      };
    const paint = paintRegion(g, {
      samples: [{ face: 0, from: point, to: point, view }],
      radius: 2,
      erase: false,
      mode: "include",
    });
    expect(paint.count).toBeGreaterThan(0);
    expect(paint.overlay.length).toBeGreaterThan(0);
    expect(g.positions.length).toBe(108);
    const excluded = paintRegion(g, {
      samples: [],
      previous: paint.serialized,
      mode: "exclude",
    });
    expect(excluded.serialized).toEqual(paint.serialized);
    expect(excluded.ids).toEqual(paint.ids);
    expect(excluded.count).toBe(paint.count);
    expect(excluded.overlay.length).toBeGreaterThan(paint.overlay.length);
    const clear = paintRegion(g, {
      samples: [{ face: 0, from: point, to: point, view }],
      radius: 3,
      erase: true,
      previous: paint.serialized,
      mode: "include",
    });
    expect(clear.count).toBe(0);
  });
  it("measures a fitted circle radius and fit error", () => {
    const points = Array.from(
      { length: 11 },
      (_, i) =>
        new THREE.Vector3(
          10 * Math.cos((i * Math.PI) / 10),
          10 * Math.sin((i * Math.PI) / 10),
          4,
        ),
    );
    const fit = fittedRadius(points)!;
    expect(fit.radius).toBeCloseTo(10);
    expect(fit.error).toBeLessThan(1e-8);
    const closed = Array.from(
      { length: 25 },
      (_, i) =>
        new THREE.Vector3(
          10 * Math.cos((i * Math.PI) / 12),
          10 * Math.sin((i * Math.PI) / 12),
          4,
        ),
    );
    expect(fittedRadius(closed)?.radius).toBeCloseTo(10);
  });
  it("preserves triangle IDs when transferring an indirect BVH", () => {
    const plane = new THREE.PlaneGeometry(100, 100, 72, 72).toNonIndexed();
    const g = buildRevision(plane.attributes.position.array as Float32Array);
    const display = bufferGeometry(g.positions);
    const bvh = MeshBVH.deserialize(g.bvh, display, { setIndex: false });
    const ray = new THREE.Ray(
      new THREE.Vector3(13.17, 6.21, 10),
      new THREE.Vector3(0, 0, -1),
    );
    const hit = bvh.raycastFirst(ray, THREE.DoubleSide)!;
    expect(hit).not.toBeNull();
    const offset = hit.faceIndex! * 9;
    const triangle = new THREE.Triangle(
      new THREE.Vector3().fromArray(g.positions, offset),
      new THREE.Vector3().fromArray(g.positions, offset + 3),
      new THREE.Vector3().fromArray(g.positions, offset + 6),
    );
    expect(triangle.containsPoint(hit.point)).toBe(true);
    expect(display.index).toBeNull();
    display.dispose();
    plane.dispose();
  });
});
