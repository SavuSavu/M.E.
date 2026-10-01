export type Vec3 = [number, number, number];
export type GeometryKind = "mesh" | "brep";
export type EntityKind =
  | "body"
  | "face"
  | "surface"
  | "planar"
  | "tangent"
  | "edge"
  | "loop"
  | "connected-edges"
  | "curve"
  | "brush";
export type Transform = { position: Vec3; rotation: Vec3; scale: Vec3 };
export type Edge = {
  a: Vec3;
  b: Vec3;
  faces: number[];
  angle: number;
  kernelId?: number;
};
export type Diagnostics = {
  openEdges: number;
  nonManifoldEdges: number;
  shells: number;
  triangles: number;
  volume: number;
  removed: number;
};
export type GeometryRevision = {
  id: string;
  kind: GeometryKind;
  positions: Float32Array;
  normals: Float32Array;
  faceIds?: Int32Array;
  edges: Edge[];
  adjacency: { neighbor: number; angle: number }[][];
  faceNormals: Float32Array;
  centroids: Float32Array;
  bounds: { min: Vec3; max: Vec3 };
  diagnostics: Diagnostics;
  brep?: string;
  nativeRadii?: Record<number, number>;
  nativeLoops?: number[][];
  planarFaceIds?: number[];
  bvh?: any;
};
export type Body = {
  id: string;
  name: string;
  visible: boolean;
  role: "solid" | "cutter";
  geometryId: string;
  transform: Transform;
  color: string;
};
export type TopologyRef = {
  bodyId: string;
  revision: string;
  kind: EntityKind;
  ids: number[];
};
export type SelectionState = {
  refs: TopologyRef[];
  bodyIds: string[];
  mode: "include" | "exclude";
  angle: number;
  brushRadius: number;
  through: boolean;
  paint?: { bodyId: string; revision: string; data: unknown };
};
export type Operation =
  | "import"
  | "primitive"
  | "union"
  | "subtract"
  | "intersect"
  | "split"
  | "fillet"
  | "chamfer"
  | "offset"
  | "repair"
  | "simplify"
  | "subdivide"
  | "transform"
  | "duplicate"
  | "mirror"
  | "delete"
  | "rename"
  | "visibility"
  | "role"
  | "selection";
export type Snapshot = { bodies: Body[]; selection: SelectionState };
export type OperationNode = {
  id: string;
  label: string;
  operation: Operation;
  params: Record<string, any>;
  before: Snapshot;
  after: Snapshot;
  createdBodies?: Body[];
  inputIds: string[];
  outputIds: string[];
  suppressed: boolean;
  status: "valid" | "blocked";
  error?: string;
};
export type JobRequest = {
  id: string;
  revision: number;
  operation: string;
  inputs?: { geometry: GeometryRevision; transform: Transform }[];
  params: Record<string, any>;
  buffer?: ArrayBuffer;
};
export type JobResponse = {
  id: string;
  revision: number;
  type: "progress" | "result" | "error";
  message?: string;
  progress?: number;
  results?: GeometryRevision[];
  data?: unknown;
};
export const identityTransform = (): Transform => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});
export const emptySelection = (): SelectionState => ({
  refs: [],
  bodyIds: [],
  mode: "include",
  angle: 20,
  brushRadius: 5,
  through: false,
});
export const uid = () => crypto.randomUUID();
