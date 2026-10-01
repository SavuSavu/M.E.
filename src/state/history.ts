import { useEditor } from "./editor";
import { runJob } from "../geometry/jobs";
import { emptySelection, identityTransform } from "../types";
import type {
  Body,
  OperationNode,
  GeometryRevision,
  Operation,
} from "../types";
import { report } from "./operations";
const geometryOperations = new Set<Operation>([
  "primitive",
  "union",
  "subtract",
  "intersect",
  "split",
  "fillet",
  "chamfer",
  "offset",
  "repair",
  "simplify",
  "subdivide",
]);
export async function rebuildHistory(
  index: number,
  params?: Record<string, any>,
  suppressed?: boolean,
) {
  const s = useEditor.getState();
  if (s.busy || index >= s.cursor) return;
  s.patch({
    busy: { message: "Rebuilding history", progress: 0 },
    error: null,
  });
  const nodes = s.history.slice(0, s.cursor).map((n) => ({ ...n })),
    geometries = { ...s.geometries };
  if (params) nodes[index].params = { ...nodes[index].params, ...params };
  if (suppressed !== undefined) nodes[index].suppressed = suppressed;
  let bodies = nodes[index].before.bodies;
  let selection = nodes[index].before.selection;
  try {
    for (let i = index; i < s.cursor; i++) {
      const node = nodes[i],
        before = { bodies, selection };
      if (node.suppressed) {
        node.before = before;
        node.after = before;
        node.status = "valid";
        continue;
      }
      if (geometryOperations.has(node.operation)) {
        const inputIds: string[] = node.params.bodyIds || [],
          inputs = inputIds.map((id) => bodies.find((b) => b.id === id));
        if (inputs.some((x) => !x))
          throw new Error(
            `${node.label}: an input body is suppressed or missing.`,
          );
        if (
          ["fillet", "chamfer", "offset"].includes(node.operation) &&
          inputs[0]?.geometryId !==
            node.before.bodies.find((b) => b.id === inputs[0]?.id)?.geometryId
        )
          throw new Error(
            `${node.label}: selected topology changed. Reselect the affected edges or faces.`,
          );
        const result = await runJob(
          {
            revision: s.revision,
            operation: node.operation,
            params: node.params,
            inputs: (inputs as Body[]).map((b) => ({
              geometry: geometries[b.geometryId],
              transform: b.transform,
            })),
          },
          (message) =>
            s.patch({
              busy: {
                message,
                progress: (i - index) / Math.max(1, s.cursor - index),
              },
            }),
        );
        const results = result.results!;
        for (const g of results) geometries[g.id] = g;
        if (node.operation === "primitive") {
          const old =
            node.createdBodies?.[0] ||
            node.after.bodies.find(
              (b) => !node.before.bodies.some((x) => x.id === b.id),
            );
          if (!old) throw new Error("Feature body metadata is missing.");
          bodies = [...bodies, { ...old, geometryId: results[0].id }];
        } else if (node.operation === "split") {
          const added =
            node.createdBodies ||
            node.after.bodies.filter(
              (b) => !node.before.bodies.some((x) => x.id === b.id),
            );
          bodies = [
            ...bodies.map((b) =>
              inputIds.includes(b.id) ? { ...b, visible: false } : b,
            ),
            ...added.map((b, j) => ({ ...b, geometryId: results[j].id })),
          ];
        } else
          bodies = bodies.map((b) =>
            b.id === inputIds[0]
              ? {
                  ...b,
                  geometryId: results[0].id,
                  transform: identityTransform(),
                }
              : inputIds.slice(1).includes(b.id)
                ? { ...b, visible: false }
                : b,
          );
        selection = emptySelection();
      } else if (node.operation === "import") {
        const additions = node.after.bodies.filter(
          (b) => !node.before.bodies.some((x) => x.id === b.id),
        );
        bodies = [...bodies, ...additions];
      } else if (node.operation === "selection") {
        const next = node.after.selection;
        selection = next.refs.every((r) =>
          bodies.some((b) => b.id === r.bodyId && b.geometryId === r.revision),
        )
          ? next
          : emptySelection();
      } else if (node.operation === "delete")
        bodies = bodies.filter((b) => b.id !== node.params.bodyId);
      else if (node.operation === "duplicate") {
        const source = bodies.find((b) => b.id === node.params.bodyId);
        const old =
          node.createdBodies?.find((b) => b.id === node.params.createdId) ||
          node.after.bodies.find((b) => b.id === node.params.createdId);
        if (!source || !old)
          throw new Error(`${node.label}: source is missing.`);
        const copy = {
          ...old,
          geometryId: source.geometryId,
          transform: structuredClone(source.transform),
        };
        copy.transform.position[0] += 10;
        bodies = [...bodies, copy];
      } else {
        const patches = node.params.patches || [
          { bodyId: node.params.bodyId, patch: node.params.patch },
        ];
        bodies = bodies.map((b) => {
          const p = patches.find((p: any) => p.bodyId === b.id);
          return p?.patch ? { ...b, ...p.patch } : b;
        });
      }
      node.before = before;
      node.after = { bodies, selection };
      node.status = "valid";
      node.error = undefined;
      node.inputIds = before.bodies.map((b) => b.geometryId);
      node.outputIds = bodies.map((b) => b.geometryId);
    }
    s.patch({
      bodies,
      selection,
      history: nodes,
      geometries,
      revision: s.revision + 1,
      notice: "History rebuilt",
      panel: null,
      preview: [],
      previewGeometries: {},
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const history = s.history.map((n, i) =>
      i >= index ? { ...n, status: "blocked" as const, error: message } : n,
    );
    s.patch({ history });
    report(e);
  } finally {
    s.patch({ busy: null });
  }
}
