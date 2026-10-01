import { PaintTree } from "../vendor/bumpmesh/paintTree.js";
import { buildAdjacency } from "../vendor/bumpmesh/exclusion.js";
import { bufferGeometry } from "./mesh";
import type { GeometryRevision } from "../types";
export function paintRegion(g: GeometryRevision, params: Record<string, any>) {
  const geometry = bufferGeometry(g.positions),
    topology = buildAdjacency(geometry),
    tree = new PaintTree({ positions: g.positions, ...topology });
  tree.addLayer("selection");
  if (params.previous) tree.deserialize(PaintTree.fromJSON(params.previous));
  else if (params.faces?.length) tree.paintFaces(0, params.faces, false);
  for (const sample of params.samples)
    tree.paintStroke({
      slot: 0,
      seedFace: sample.face,
      from: sample.from,
      to: sample.to,
      radius: params.radius,
      view: sample.view,
      hardness: 1,
      erase: params.erase,
      edgeLimit: Math.max(0.1, params.radius / 5),
    });
  const flat = tree.flatten(),
    flags = tree.flatPaint(0, flat).hard,
    overlay: number[] = [],
    ids = new Set<number>();
  for (let i = 0; i < flags.length; i++) {
    const painted = flags[i] > 0;
    if (painted) ids.add(flat.faceParentId[i]);
    if (params.mode === "exclude" ? !painted : painted)
      for (let k = 0; k < 9; k++) overlay.push(flat.positions[i * 9 + k]);
  }
  geometry.dispose();
  return {
    serialized: PaintTree.toJSON(tree.serialize()),
    overlay,
    ids: [...ids],
    count: flags.reduce((n, v) => n + Number(v > 0), 0),
  };
}
