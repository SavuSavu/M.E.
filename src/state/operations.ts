import { useEditor } from "./editor";
import { runJob, cancelJob } from "../geometry/jobs";
import { effectiveSelection } from "../geometry/selection";
import { uid, identityTransform, emptySelection } from "../types";
import type {
  Body,
  GeometryRevision,
  JobRequest,
  Operation,
  SelectionState,
} from "../types";
const colors = ["#d5dde4", "#63b8aa", "#9eafdd", "#d4af7b", "#af97c9"];
export const makeBody = (
  g: GeometryRevision,
  name: string,
  index = 0,
): Body => ({
  id: uid(),
  geometryId: g.id,
  name,
  visible: true,
  role: "solid",
  transform: identityTransform(),
  color: colors[index % colors.length],
});
export async function importFiles(files: File[]) {
  for (const file of files) {
    if (!/\.stl$/i.test(file.name)) {
      useEditor
        .getState()
        .patch({ error: "Only STL files are supported for model import." });
      continue;
    }
    if (file.size > 200 * 1024 * 1024) {
      useEditor
        .getState()
        .patch({ error: "STL exceeds the 200 MB import budget." });
      continue;
    }
    const state = useEditor.getState();
    if (state.busy) return;
    state.patch({
      busy: { message: `Importing ${file.name}`, progress: 0 },
      error: null,
    });
    try {
      const buffer = await file.arrayBuffer(),
        result = await runJob(
          { revision: state.revision, operation: "import", params: {}, buffer },
          progress,
        );
      if (useEditor.getState().revision !== state.revision) continue;
      const g = result.results![0],
        body = makeBody(
          g,
          file.name.replace(/\.stl$/i, ""),
          state.bodies.length,
        );
      useEditor
        .getState()
        .commit(
          `Import ${file.name}`,
          "import",
          { name: file.name },
          [...state.bodies, body],
          [g],
          { ...emptySelection(), bodyIds: [body.id] },
        );
    } catch (e) {
      report(e);
    } finally {
      useEditor.getState().patch({ busy: null });
    }
  }
  window.dispatchEvent(new Event("me-fit"));
}
function progress(message: string, value: number) {
  useEditor.getState().patch({ busy: { message, progress: value } });
}
export function report(e: unknown) {
  if (e instanceof Error && e.message === "Operation cancelled.") {
    useEditor.getState().patch({ notice: e.message, error: null });
    return;
  }
  useEditor
    .getState()
    .patch({ error: e instanceof Error ? e.message : String(e) });
}
export const cancel = () => {
  cancelJob();
  useEditor.getState().patch({ preview: [], previewGeometries: {} });
};
export async function setMaskMode(mode: SelectionState["mode"]) {
  const s = useEditor.getState();
  if (s.busy || s.selection.mode === mode) return;
  const paint = s.selection.paint;
  const body = paint && s.bodies.find((b) => b.id === paint.bodyId);
  if (!paint || !body || body.geometryId !== paint.revision) {
    s.commit("Selection mask", "selection", {}, s.bodies, [], {
      ...s.selection,
      mode,
    });
    return;
  }
  s.patch({
    busy: { message: "Updating selection mask", progress: 0 },
    error: null,
  });
  try {
    const result = await runJob(
      {
        revision: s.revision,
        operation: "paint",
        inputs: [
          {
            geometry: s.geometries[body.geometryId],
            transform: body.transform,
          },
        ],
        params: {
          samples: [],
          previous: (paint.data as any).serialized,
          radius: s.selection.brushRadius,
          mode,
        },
      },
      progress,
    );
    if (useEditor.getState().revision !== s.revision) return;
    s.commit("Selection mask", "selection", {}, s.bodies, [], {
      ...s.selection,
      mode,
      paint: { ...paint, data: result.data },
    });
  } catch (e) {
    report(e);
  } finally {
    useEditor.getState().patch({ busy: null });
  }
}
export type PreparedOperation = {
  operation: Operation;
  params: Record<string, any>;
  label: string;
  inputs: Body[];
  results: GeometryRevision[];
  revision: number;
  selection: SelectionState;
};
export async function prepareOperation(
  operation: Operation,
  params: Record<string, any>,
  inputIds?: string[],
): Promise<PreparedOperation | undefined> {
  const s = useEditor.getState();
  if (s.busy) return;
  const selectedIds = inputIds || s.selection.bodyIds;
  const ids =
      operation === "primitive"
        ? []
        : ["union", "subtract", "intersect", "split"].includes(operation)
          ? selectedIds
          : selectedIds.slice(0, 1),
    inputs = ids
      .map((id) => s.bodies.find((b) => b.id === id))
      .filter(Boolean) as Body[];
  if (operation !== "primitive" && !inputs.length) {
    report(new Error("Select a target body first."));
    return;
  }
  if (
    ["union", "subtract", "intersect"].includes(operation) &&
    inputs.length !== 2
  ) {
    report(new Error("Choose a target body and one tool body."));
    return;
  }
  if (inputs.length > 1 && inputs[0].id === inputs[1].id) {
    report(new Error("Target and tool must be different bodies."));
    return;
  }
  const captured = { ...params };
  const ref = s.selection.refs.find((r) => r.bodyId === inputs[0]?.id);
  if (
    operation === "offset" &&
    (ref?.kind === "brush" || s.selection.paint?.bodyId === inputs[0]?.id)
  ) {
    report(
      new Error(
        "Offset requires a complete planar surface. Use Planar or Fill selection.",
      ),
    );
    return;
  }
  if (["fillet", "chamfer"].includes(operation))
    captured.edges =
      params.edges ||
      effectiveSelection(
        s.geometries[inputs[0].geometryId],
        ref?.ids || [],
        s.selection.mode,
        true,
        s.selection.angle,
      );
  if (operation === "offset")
    captured.faces =
      params.faces ||
      effectiveSelection(
        s.geometries[inputs[0].geometryId],
        ref?.ids || [],
        s.selection.mode,
      );
  if (
    ["fillet", "chamfer"].includes(operation) &&
    ref &&
    !["edge", "loop", "curve", "connected-edges"].includes(ref.kind)
  ) {
    report(new Error("Use By Line or By Curve to select edges for this tool."));
    return;
  }
  s.patch({
    error: null,
    busy: { message: "Preparing operation", progress: 0 },
    preview: [],
    previewGeometries: {},
  });
  try {
    const request: Omit<JobRequest, "id"> = {
      revision: s.revision,
      operation,
      params: captured,
      inputs: inputs.map((b) => ({
        geometry: s.geometries[b.geometryId],
        transform: b.transform,
      })),
    };
    const result = await runJob(request, progress);
    if (useEditor.getState().revision !== s.revision)
      throw new Error("Workspace changed while the operation was running.");
    const results = result.results!,
      label =
        operation === "primitive"
          ? `Add ${params.shape}`
          : `${operation[0].toUpperCase() + operation.slice(1)} ${inputs[0]?.name || ""}`;
    return {
      operation,
      params: captured,
      label,
      inputs,
      results,
      revision: s.revision,
      selection: s.selection,
    };
  } catch (e) {
    report(e);
  } finally {
    useEditor.getState().patch({ busy: null });
  }
}
export function previewOperation(prepared: PreparedOperation) {
  useEditor.getState().patch({
    preview: prepared.results.map((g, i) => ({
      ...makeBody(g, "Preview", i),
      id: `preview-${i}`,
      color: "#55ddbc",
    })),
    previewGeometries: Object.fromEntries(
      prepared.results.map((g) => [g.id, g]),
    ),
  });
}
export function commitPrepared(p: PreparedOperation) {
  const s = useEditor.getState();
  if (s.revision !== p.revision) {
    report(new Error("Preview is out of date. Preview again."));
    return;
  }
  let bodies: Body[], outputs: Body[];
  if (p.operation === "primitive") {
    outputs = [
      makeBody(
        p.results[0],
        p.params.shape[0].toUpperCase() + p.params.shape.slice(1),
        s.bodies.length,
      ),
    ];
    bodies = [...s.bodies, ...outputs];
  } else if (p.operation === "split") {
    outputs = p.results.map((g, i) =>
      makeBody(g, `${p.inputs[0].name} · ${i + 1}`, i),
    );
    bodies = [
      ...s.bodies.map((b) =>
        p.inputs.some((x) => x.id === b.id) ? { ...b, visible: false } : b,
      ),
      ...outputs,
    ];
  } else {
    outputs = [
      {
        ...p.inputs[0],
        geometryId: p.results[0].id,
        transform: identityTransform(),
      },
    ];
    bodies = s.bodies.map((b) =>
      b.id === outputs[0].id
        ? outputs[0]
        : p.inputs.slice(1).some((x) => x.id === b.id)
          ? { ...b, visible: false }
          : b,
    );
  }
  s.commit(
    p.label,
    p.operation,
    { ...p.params, bodyIds: p.inputs.map((b) => b.id) },
    bodies,
    p.results,
    { ...emptySelection(), bodyIds: outputs.map((b) => b.id) },
  );
  s.patch({ panel: null });
  if (p.operation === "primitive") window.dispatchEvent(new Event("me-fit"));
}
export async function execute(
  operation: Operation,
  params: Record<string, any>,
  inputIds?: string[],
) {
  const result = await prepareOperation(operation, params, inputIds);
  if (result) commitPrepared(result);
}
export function duplicateBody(id: string) {
  const s = useEditor.getState(),
    body = s.bodies.find((b) => b.id === id);
  if (!body || s.busy) return;
  const copy = {
    ...body,
    id: uid(),
    name: `${body.name} copy`,
    transform: structuredClone(body.transform),
  };
  copy.transform.position[0] += 10;
  s.commit(
    `Duplicate ${body.name}`,
    "duplicate",
    { bodyId: id, createdId: copy.id },
    [...s.bodies, copy],
    [],
    { ...emptySelection(), bodyIds: [copy.id] },
  );
}
export function deleteBody(id: string) {
  const s = useEditor.getState();
  if (s.busy) return;
  s.commit(
    "Delete body",
    "delete",
    { bodyId: id },
    s.bodies.filter((b) => b.id !== id),
  );
}
