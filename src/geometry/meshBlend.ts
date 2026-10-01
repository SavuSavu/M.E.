import * as THREE from "three";
import type { GeometryRevision } from "../types";
import type { EdgeChain } from "./edgeChains";

function contains(g: GeometryRevision, point: THREE.Vector3) {
  const ray = new THREE.Ray(
    point,
    new THREE.Vector3(0.312, 0.537, 0.784).normalize(),
  );
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    hit = new THREE.Vector3();
  const distances: number[] = [];
  for (let i = 0; i < g.positions.length; i += 9) {
    if (
      ray.intersectTriangle(
        a.fromArray(g.positions, i),
        b.fromArray(g.positions, i + 3),
        c.fromArray(g.positions, i + 6),
        false,
        hit,
      )
    )
      distances.push(point.distanceTo(hit));
  }
  distances.sort((a, b) => a - b);
  return (
    distances.filter((d, i) => i === 0 || Math.abs(d - distances[i - 1]) > 1e-5)
      .length %
      2 ===
    1
  );
}

/** Approximate mesh blends are sweeps along complete straight feature chains. */
export function blendCutters(
  g: GeometryRevision,
  chains: EdgeChain[],
  m: any,
  amount: number,
  operation: "fillet" | "chamfer",
  own: (value: any) => any,
) {
  if (!chains.length)
    throw new Error(
      "Click an edge to select it. Click additional edges to include them, or Shift-click to remove them.",
    );
  const epsilon = Math.max(
    1e-5,
    new THREE.Vector3(...g.bounds.max)
      .sub(new THREE.Vector3(...g.bounds.min))
      .length() * 1e-6,
  );
  return chains.map((chain, index) => {
    const label = `Edge ${index + 1}`;
    if (chain.branches.length)
      throw new Error(
        `${label} has an ambiguous continuation. Select the additional segments you want to follow with Ctrl-click.`,
      );
    if (chain.faces.length !== 2)
      throw new Error(
        `${label} is open or non-manifold. Select a closed solid's feature edge.`,
      );
    const n1 = new THREE.Vector3().fromArray(g.faceNormals, chain.faces[0] * 3),
      n2 = new THREE.Vector3().fromArray(g.faceNormals, chain.faces[1] * 3);
    if (Math.abs(n1.dot(n2)) > 0.01)
      throw new Error(
        `${label} needs two flat faces meeting at 90° for a mesh blend. Select a different edge.`,
      );
    // Every segment must remain on the same two planes over the whole sweep.
    const origin = new THREE.Vector3(...chain.a);
    for (const id of chain.ids)
      for (const face of g.edges[id].faces) {
        const normal = new THREE.Vector3().fromArray(g.faceNormals, face * 3);
        const reference =
          normal.dot(n1) > 0.9999
            ? n1
            : normal.dot(n2) > 0.9999
              ? n2
              : undefined;
        if (
          !reference ||
          [0, 3, 6].some(
            (k) =>
              Math.abs(
                new THREE.Vector3()
                  .fromArray(g.positions, face * 9 + k)
                  .sub(origin)
                  .dot(reference),
              ) >
              epsilon * 3,
          )
        )
          throw new Error(
            `${label} follows a curved surface. Mesh blends currently need flat adjacent faces.`,
          );
      }
    const end = new THREE.Vector3(...chain.b),
      axis = end.clone().sub(origin),
      length = axis.length();
    axis.normalize();
    if (length < amount * 2)
      throw new Error(
        `${label}: reduce the size below ${(length / 2).toFixed(3)} mm to fit this edge.`,
      );
    const midpoint = origin.clone().addScaledVector(axis, length / 2);
    if (
      !contains(
        g,
        midpoint
          .clone()
          .addScaledVector(n1, -amount / 10)
          .addScaledVector(n2, -amount / 10),
      )
    )
      throw new Error(
        `${label} is concave. Mesh blends currently support convex outside edges.`,
      );
    for (const [a, b] of [
      [amount, epsilon * 4],
      [epsilon * 4, amount],
    ])
      if (
        !contains(
          g,
          midpoint.clone().addScaledVector(n1, -a).addScaledVector(n2, -b),
        )
      )
        throw new Error(
          `${label}: reduce the size; it extends beyond an adjacent face.`,
        );
    const polygon = [
      [0, 0],
      [amount, 0],
    ];
    if (operation === "fillet")
      for (let i = 1; i <= 24; i++) {
        const angle = -Math.PI / 2 - (i * Math.PI) / 48;
        polygon.push([
          amount + amount * Math.cos(angle),
          amount + amount * Math.sin(angle),
        ]);
      }
    else polygon.push([0, amount]);
    const cutter = own(m.Manifold.extrude([polygon], length + epsilon * 2));
    const basis = new THREE.Matrix4()
      .makeBasis(n1.clone().negate(), n2.clone().negate(), axis)
      .setPosition(origin.clone().addScaledVector(axis, -epsilon));
    return own(cutter.transform(basis.elements));
  });
}
