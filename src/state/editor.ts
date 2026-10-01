import { create } from "zustand";
import type {
  Body,
  GeometryRevision,
  SelectionState,
  Snapshot,
  OperationNode,
  Operation,
  EntityKind,
} from "../types";
import { emptySelection, uid } from "../types";
export type Tool =
  | "select"
  | "move"
  | "rotate"
  | "scale"
  | "measure"
  | "align"
  | "place";
type State = {
  title: string;
  bodies: Body[];
  geometries: Record<string, GeometryRevision>;
  selection: SelectionState;
  history: OperationNode[];
  cursor: number;
  revision: number;
  tool: Tool;
  entity: EntityKind;
  brush: boolean;
  wireframe: boolean;
  section: boolean;
  sectionAxis: "x" | "y" | "z";
  sectionOffset: number;
  perspective: boolean;
  busy: { message: string; progress: number } | null;
  error: string | null;
  notice: string;
  hover: string;
  measurements: { point: number[]; bodyId: string }[];
  panel: string | null;
  preview: Body[];
  previewGeometries: Record<string, GeometryRevision>;
  patch: (patch: Partial<State>) => void;
  commit: (
    label: string,
    operation: Operation,
    params: Record<string, any>,
    bodies: Body[],
    geometries?: GeometryRevision[],
    selection?: SelectionState,
  ) => void;
  undo: () => void;
  redo: () => void;
  selectBodies: (ids: string[]) => void;
  selectEntities: (
    bodyId: string,
    ids: number[],
    kind: EntityKind,
    erase?: boolean,
    append?: boolean,
  ) => void;
  updateBody: (
    id: string,
    patch: Partial<Body>,
    label: string,
    operation: Operation,
  ) => void;
  reset: () => void;
};
const snapshot = (state: State): Snapshot => ({
  bodies: state.bodies,
  selection: state.selection,
});
const initial = {
  title: "Untitled workspace",
  bodies: [] as Body[],
  geometries: {} as Record<string, GeometryRevision>,
  selection: emptySelection(),
  history: [] as OperationNode[],
  cursor: 0,
  revision: 0,
  tool: "select" as Tool,
  entity: "body" as EntityKind,
  brush: false,
  wireframe: false,
  section: false,
  sectionAxis: "z" as const,
  sectionOffset: 0,
  perspective: false,
  busy: null,
  error: null,
  notice: "Import an STL or add a solid to begin.",
  hover: "",
  measurements: [],
  panel: null,
  preview: [],
  previewGeometries: {},
};
export const useEditor = create<State>((set, get) => ({
  ...initial,
  patch: (patch) => set(patch),
  commit: (
    label,
    operation,
    params,
    bodies,
    geometries = [],
    selection = emptySelection(),
  ) =>
    set((state) => {
      const registry = { ...state.geometries };
      for (const g of geometries) registry[g.id] = g;
      const before = snapshot(state),
        after = { bodies, selection },
        node: OperationNode = {
          id: uid(),
          label,
          operation,
          params,
          before,
          after,
          createdBodies: after.bodies.filter(
            (b) => !before.bodies.some((old) => old.id === b.id),
          ),
          inputIds: before.bodies.map((b) => b.geometryId),
          outputIds: after.bodies.map((b) => b.geometryId),
          suppressed: false,
          status: "valid",
        };
      const history = [...state.history.slice(0, state.cursor), node];
      const retained = new Set(bodies.map((b) => b.geometryId));
      for (const entry of history)
        for (const b of [
          ...entry.before.bodies,
          ...entry.after.bodies,
          ...(entry.createdBodies || []),
        ])
          retained.add(b.geometryId);
      for (const id of Object.keys(registry))
        if (!retained.has(id)) delete registry[id];
      return {
        bodies,
        geometries: registry,
        selection,
        history,
        cursor: history.length,
        revision: state.revision + 1,
        error: null,
        preview: [],
        previewGeometries: {},
        notice: label,
      };
    }),
  undo: () =>
    set((state) => {
      if (!state.cursor || state.busy) return {};
      const node = state.history[state.cursor - 1];
      return {
        ...node.before,
        cursor: state.cursor - 1,
        revision: state.revision + 1,
        preview: [],
        previewGeometries: {},
        notice: `Undo · ${node.label}`,
      };
    }),
  redo: () =>
    set((state) => {
      if (state.cursor >= state.history.length || state.busy) return {};
      const node = state.history[state.cursor];
      return {
        ...node.after,
        cursor: state.cursor + 1,
        revision: state.revision + 1,
        preview: [],
        previewGeometries: {},
        notice: `Redo · ${node.label}`,
      };
    }),
  selectBodies: (ids) => {
    const s = get();
    if (s.busy) return;
    set({
      selection: { ...s.selection, bodyIds: ids, refs: [], paint: undefined },
    });
  },
  selectEntities: (bodyId, ids, kind, erase = false, append = false) => {
    const s = get(),
      body = s.bodies.find((b) => b.id === bodyId);
    if (!body || s.busy) return;
    const previous = s.selection.refs.find(
        (r) =>
          r.bodyId === bodyId &&
          r.kind === kind &&
          r.revision === body.geometryId,
      ),
      setIds = new Set(append || erase ? previous?.ids : []);
    for (const id of ids)
      if (erase) setIds.delete(id);
      else setIds.add(id);
    const refs = [
      ...(append || erase
        ? s.selection.refs.filter(
            (r) => !(r.bodyId === bodyId && r.kind === kind),
          )
        : []),
      { bodyId, revision: body.geometryId, kind, ids: [...setIds] },
    ].filter((r) => r.ids.length);
    set({
      selection: { ...s.selection, bodyIds: [bodyId], refs, paint: undefined },
    });
  },
  updateBody: (id, patch, label, operation) => {
    const s = get();
    if (s.busy) return;
    s.commit(
      label,
      operation,
      { bodyId: id, patch },
      s.bodies.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      [],
      s.selection,
    );
  },
  reset: () => set({ ...initial, revision: get().revision + 1 }),
}));
