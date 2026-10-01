import { zip, unzip, strToU8, strFromU8 } from "fflate";
import { get, set, del } from "idb-keyval";
import { useEditor } from "./editor";
import { runJob } from "../geometry/jobs";
import { buildRevision } from "../geometry/mesh";
import { report } from "./operations";
import type {
  GeometryRevision,
  Body,
  OperationNode,
  SelectionState,
} from "../types";
export function download(
  data: BlobPart,
  name: string,
  type = "application/octet-stream",
) {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function projectBytes() {
  const s = useEditor.getState(),
    files: Record<string, Uint8Array> = {},
    ids = new Set(s.bodies.map((b) => b.geometryId));
  for (const node of s.history)
    for (const b of [
      ...node.before.bodies,
      ...node.after.bodies,
      ...(node.createdBodies || []),
    ])
      ids.add(b.geometryId);
  const metas = [];
  for (const id of ids) {
    const g = s.geometries[id];
    if (!g) throw new Error("History refers to missing geometry.");
    files[`geometry/${id}.bin`] = new Uint8Array(
      g.positions.buffer,
      g.positions.byteOffset,
      g.positions.byteLength,
    );
    if (g.faceIds)
      files[`geometry/${id}.faces`] = new Uint8Array(
        g.faceIds.buffer,
        g.faceIds.byteOffset,
        g.faceIds.byteLength,
      );
    if (g.brep) files[`geometry/${id}.brep`] = strToU8(g.brep);
    metas.push({
      id: g.id,
      kind: g.kind,
      edges: g.kind === "brep" ? g.edges : undefined,
      nativeRadii: g.nativeRadii,
      nativeLoops: g.nativeLoops,
      planarFaceIds: g.planarFaceIds,
    });
  }
  const manifest = {
    format: "me-model-editor",
    version: 1,
    title: s.title,
    units: "mm",
    bodies: s.bodies,
    selection: s.selection,
    history: s.history,
    cursor: s.cursor,
    geometries: metas,
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest));
  const estimate = Object.values(files).reduce((n, b) => n + b.byteLength, 0);
  if (estimate > 256 * 1024 * 1024)
    throw new Error("Project exceeds the 256 MB archive budget.");
  return new Promise<Uint8Array>((resolve, reject) =>
    zip(files, { level: 1 }, (err, data) =>
      err ? reject(err) : resolve(data),
    ),
  );
}
export async function saveProject() {
  try {
    const bytes = await projectBytes();
    download(
      bytes as Uint8Array<ArrayBuffer>,
      `${useEditor.getState().title.replace(/[^\w .-]/g, "") || "Workspace"}.meproj`,
    );
  } catch (e) {
    report(e);
  }
}
function validateTransform(t: any) {
  return (
    t &&
    ["position", "rotation", "scale"].every(
      (k) =>
        Array.isArray(t[k]) &&
        t[k].length === 3 &&
        t[k].every((x: any) => typeof x === "number" && Number.isFinite(x)),
    ) &&
    t.scale.every((x: number) => Math.abs(x) > 1e-8)
  );
}
export async function decodeProject(bytes: Uint8Array) {
  if (bytes.byteLength > 256 * 1024 * 1024)
    throw new Error("Project exceeds the archive budget.");
  let total = 0;
  const files = await new Promise<Record<string, Uint8Array>>(
    (resolve, reject) =>
      unzip(
        bytes,
        {
          filter: (entry) => {
            total += entry.originalSize;
            if (total > 256 * 1024 * 1024)
              throw new Error("Expanded project exceeds the memory budget.");
            return true;
          },
        },
        (err, data) => (err ? reject(err) : resolve(data)),
      ),
  );
  if (!files["manifest.json"]) throw new Error("Project manifest is missing.");
  const m = JSON.parse(strFromU8(files["manifest.json"]));
  if (
    m.format !== "me-model-editor" ||
    m.version !== 1 ||
    m.units !== "mm" ||
    !Array.isArray(m.bodies) ||
    !Array.isArray(m.history) ||
    !Array.isArray(m.geometries)
  )
    throw new Error("Unsupported or invalid M.E. project.");
  const geometries: Record<string, GeometryRevision> = {};
  for (const meta of m.geometries) {
    if (
      typeof meta.id !== "string" ||
      !/^[a-zA-Z0-9-]+$/.test(meta.id) ||
      !["mesh", "brep"].includes(meta.kind) ||
      geometries[meta.id]
    )
      throw new Error("Invalid geometry entry.");
    const data = files[`geometry/${meta.id}.bin`];
    if (!data || data.byteLength % 36 !== 0)
      throw new Error("Invalid geometry data.");
    const positions = new Float32Array(data.slice().buffer);
    if (!positions.every(Number.isFinite))
      throw new Error("Non-finite project geometry.");
    const extra: Partial<GeometryRevision> = { id: meta.id, kind: meta.kind };
    if (meta.kind === "brep") {
      const faces = files[`geometry/${meta.id}.faces`],
        brep = files[`geometry/${meta.id}.brep`];
      if (
        !faces ||
        faces.byteLength !== (positions.length / 9) * 4 ||
        !brep ||
        !Array.isArray(meta.edges)
      )
        throw new Error("Native geometry snapshot is incomplete.");
      extra.faceIds = new Int32Array(faces.slice().buffer);
      extra.brep = strFromU8(brep);
      extra.edges = meta.edges;
      extra.nativeRadii = meta.nativeRadii;
      extra.nativeLoops = meta.nativeLoops;
      extra.planarFaceIds = meta.planarFaceIds;
    }
    const result = await runJob({
      revision: useEditor.getState().revision,
      operation: "restore",
      params: { extra },
      buffer: positions.buffer,
    });
    geometries[meta.id] = result.results![0];
  }
  const checkBodies = (bodies: any) => {
    if (
      !Array.isArray(bodies) ||
      new Set(bodies.map((b: any) => b.id)).size !== bodies.length
    )
      throw new Error("Invalid body list.");
    for (const b of bodies)
      if (
        typeof b.id !== "string" ||
        typeof b.name !== "string" ||
        typeof b.visible !== "boolean" ||
        !["solid", "cutter"].includes(b.role) ||
        !validateTransform(b.transform) ||
        !geometries[b.geometryId]
      )
        throw new Error("Invalid body or transform.");
  };
  checkBodies(m.bodies);
  if (
    !Number.isInteger(m.cursor) ||
    m.cursor < 0 ||
    m.cursor > m.history.length
  )
    throw new Error("Invalid history cursor.");
  for (const node of m.history) {
    if (!node.before || !node.after || typeof node.operation !== "string")
      throw new Error("Invalid history.");
    checkBodies(node.before.bodies);
    checkBodies(node.after.bodies);
  }
  const entityKinds = [
    "body",
    "face",
    "surface",
    "planar",
    "tangent",
    "edge",
    "loop",
    "connected-edges",
    "curve",
    "brush",
  ];
  const checkSelection = (selection: any, bodies: Body[]) => {
    if (
      !selection ||
      !Array.isArray(selection.refs) ||
      !Array.isArray(selection.bodyIds) ||
      !["include", "exclude"].includes(selection.mode) ||
      !Number.isFinite(selection.angle) ||
      selection.angle < 0 ||
      selection.angle > 180 ||
      !Number.isFinite(selection.brushRadius) ||
      selection.brushRadius <= 0 ||
      typeof selection.through !== "boolean"
    )
      throw new Error("Invalid selection.");
    if (
      selection.bodyIds.some((id: unknown) => !bodies.some((b) => b.id === id))
    )
      throw new Error("Selection refers to missing bodies.");
    for (const ref of selection.refs) {
      const body = bodies.find((b) => b.id === ref.bodyId);
      if (
        !body ||
        body.geometryId !== ref.revision ||
        !entityKinds.includes(ref.kind) ||
        !Array.isArray(ref.ids)
      )
        throw new Error("Selection refers to invalid topology.");
      const g = geometries[body.geometryId],
        limit = ["edge", "loop", "connected-edges", "curve"].includes(ref.kind)
          ? g.edges.length
          : g.diagnostics.triangles;
      if (
        ref.ids.some(
          (id: unknown) =>
            !Number.isInteger(id) ||
            (id as number) < 0 ||
            (id as number) >= limit,
        )
      )
        throw new Error("Selection contains invalid entity IDs.");
    }
    if (selection.paint) {
      const paint = selection.paint,
        body = bodies.find((b) => b.id === paint.bodyId);
      if (
        !body ||
        body.geometryId !== paint.revision ||
        !paint.data ||
        !Array.isArray(paint.data.overlay) ||
        paint.data.overlay.length % 9 ||
        !paint.data.overlay.every(Number.isFinite) ||
        paint.data.serialized?.version !== 1
      )
        throw new Error("Invalid brush selection data.");
    }
  };
  const selection = m.selection as SelectionState;
  checkSelection(selection, m.bodies);
  for (const node of m.history) {
    checkSelection(node.before.selection, node.before.bodies);
    checkSelection(node.after.selection, node.after.bodies);
    if (
      !node.params ||
      typeof node.params !== "object" ||
      Array.isArray(node.params)
    )
      throw new Error("Invalid feature parameters.");
  }
  return {
    title: String(m.title || "Workspace"),
    bodies: m.bodies as Body[],
    geometries,
    selection,
    history: m.history as OperationNode[],
    cursor: m.cursor,
  };
}
export async function loadProject(file: File) {
  const s = useEditor.getState();
  if (s.busy) return;
  s.patch({ busy: { message: "Opening project", progress: 0 }, error: null });
  try {
    const result = await decodeProject(
      new Uint8Array(await file.arrayBuffer()),
    );
    s.patch({
      ...result,
      revision: s.revision + 1,
      panel: null,
      preview: [],
      previewGeometries: {},
      notice: "Project restored",
    });
    window.dispatchEvent(new Event("me-fit"));
  } catch (e) {
    report(e);
  } finally {
    s.patch({ busy: null });
  }
}
export async function exportSTL(separate = false) {
  const s = useEditor.getState();
  if (s.busy) return;
  const chosen = s.selection.bodyIds.length
    ? s.bodies.filter((b) => s.selection.bodyIds.includes(b.id))
    : s.bodies.filter((b) => b.visible && b.role === "solid");
  if (!chosen.length) {
    report(new Error("Select a body or show solid bodies to export."));
    return;
  }
  s.patch({ busy: { message: "Writing STL", progress: 0 }, error: null });
  try {
    for (const group of separate ? chosen.map((b) => [b]) : [chosen]) {
      const result = await runJob({
        revision: s.revision,
        operation: "export",
        params: {},
        inputs: group.map((b) => ({
          geometry: s.geometries[b.geometryId],
          transform: b.transform,
        })),
      });
      download(
        result.data as ArrayBuffer,
        `${group.length === 1 ? group[0].name : "M.E.-assembly"}.stl`,
      );
    }
    s.patch({ notice: "STL exported with committed transforms" });
  } catch (e) {
    report(e);
  } finally {
    s.patch({ busy: null });
  }
}
let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
export function startRecovery() {
  return useEditor.subscribe((s, previous) => {
    if (s.revision === previous.revision || s.busy || !s.bodies.length) return;
    clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(async () => {
      try {
        const data = await projectBytes();
        await set("me-recovery", data);
      } catch {
        /* quota should not interrupt editing */
      }
    }, 2000);
  });
}
export const recoveryAvailable = async () => Boolean(await get("me-recovery"));
export async function recover() {
  const bytes = await get<Uint8Array>("me-recovery");
  if (bytes)
    await loadProject(
      new File([bytes as Uint8Array<ArrayBuffer>], "Recovery.meproj"),
    );
}
export const discardRecovery = () => del("me-recovery");
