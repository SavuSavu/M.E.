import { useEffect, useState } from "react";
import {
  X,
  Check,
  Eye,
  Move3D,
  Box,
  Scissors,
  Info,
  Ruler,
  RotateCcw,
} from "lucide-react";
import { useEditor } from "../state/editor";
import {
  prepareOperation,
  previewOperation,
  commitPrepared,
  report,
} from "../state/operations";
import type { PreparedOperation } from "../state/operations";
import { runJob } from "../geometry/jobs";
import { rebuildHistory } from "../state/history";
import { fittedRadius, effectiveSelection } from "../geometry/selection";
import { meshEdgeChains } from "../geometry/edgeChains";
import { transformMatrix } from "../geometry/mesh";
import * as THREE from "three";
import type { Operation, Vec3 } from "../types";
function NumberField({
  label,
  value,
  onChange,
  min,
  step = 1,
  unit = "mm",
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  step?: number;
  unit?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="number-wrap">
        <input
          aria-label={label}
          type="number"
          value={value}
          min={min}
          step={step}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
        />
        <span>{unit}</span>
      </div>
    </label>
  );
}
export function ContextPanel() {
  const s = useEditor(),
    body = s.bodies.find((b) => b.id === s.selection.bodyIds[0]),
    g = body && s.geometries[body.geometryId];
  const [params, setParams] = useState<Record<string, any>>({
      shape: "cube",
      width: 30,
      depth: 30,
      height: 30,
      radius: 12,
      amount: 2,
      axis: "z",
      offset: 0,
      triangles: 5000,
      edgeLength: 5,
    }),
    [target, setTarget] = useState(""),
    [tool, setTool] = useState(""),
    [prepared, setPrepared] = useState<PreparedOperation>(),
    [uniform, setUniform] = useState(true),
    [coordinates, setCoordinates] = useState<"world" | "local">("world"),
    [trans, setTrans] = useState(body?.transform),
    [diag, setDiag] = useState<any>(null);
  useEffect(() => {
    setPrepared(undefined);
    s.patch({ preview: [], previewGeometries: {} });
    setTarget(s.selection.bodyIds[0] || "");
    setTool(
      s.selection.bodyIds[1] ||
        s.bodies.find(
          (b) => b.id !== s.selection.bodyIds[0] && b.role === "cutter",
        )?.id ||
        "",
    );
    setDiag(null);
  }, [s.panel, s.selection]);
  useEffect(
    () => setTrans(body ? structuredClone(body.transform) : undefined),
    [body],
  );
  const change = (key: string, value: any) => {
    setPrepared(undefined);
    s.patch({ preview: [], previewGeometries: {} });
    setParams((p) => ({ ...p, [key]: value }));
  };
  const close = () => {
    s.patch({
      panel: null,
      preview: [],
      previewGeometries: {},
      tool: "select",
    });
    setPrepared(undefined);
  };
  const boolean = ["union", "subtract", "intersect"].includes(s.panel || "");
  const blend = ["fillet", "chamfer"].includes(s.panel || "");
  const rawBlendIds = [
    ...new Set(
      s.selection.refs
        .filter(
          (r) =>
            r.bodyId === body?.id &&
            ["edge", "loop", "curve", "connected-edges"].includes(r.kind),
        )
        .flatMap((r) => r.ids),
    ),
  ];
  const blendIds =
    blend && g
      ? effectiveSelection(
          g,
          rawBlendIds,
          s.selection.mode,
          true,
          s.selection.angle,
        )
      : rawBlendIds;
  const meshChains = g?.kind === "mesh" ? meshEdgeChains(g, blendIds) : [];
  const needsContinuation = meshChains.some((c) => c.branches.length);
  const blendCount = !g
    ? 0
    : g.kind === "brep"
      ? new Set(blendIds.map((i) => g.edges[i]?.kernelId)).size
      : meshChains.length;
  const preview = async () => {
    const operation = s.panel as Operation;
    if (
      operation === "primitive" &&
      Object.entries(params).some(
        ([k, v]) =>
          ["width", "depth", "height", "radius"].includes(k) && v <= 0,
      )
    ) {
      report(new Error("Primitive dimensions must be positive."));
      return;
    }
    const normal =
      params.axis === "x"
        ? [1, 0, 0]
        : params.axis === "y"
          ? [0, 1, 0]
          : [0, 0, 1];
    const ids = boolean
      ? [target, tool]
      : operation === "split"
        ? tool
          ? [target, tool]
          : [target]
        : undefined;
    const p = await prepareOperation(operation, { ...params, normal }, ids);
    if (p) {
      setPrepared(p);
      previewOperation(p);
    }
  };
  const apply = async () => {
    if (prepared) {
      commitPrepared(prepared);
      setPrepared(undefined);
      return;
    }
    const operation = s.panel as Operation,
      normal =
        params.axis === "x"
          ? [1, 0, 0]
          : params.axis === "y"
            ? [0, 1, 0]
            : [0, 0, 1],
      ids = boolean
        ? [target, tool]
        : operation === "split"
          ? tool
            ? [target, tool]
            : [target]
          : undefined;
    const p = await prepareOperation(operation, { ...params, normal }, ids);
    if (p) commitPrepared(p);
  };
  const transform = () => {
    if (!body || !trans) return;
    if (trans.scale.some((v) => !Number.isFinite(v) || Math.abs(v) < 1e-5)) {
      report(new Error("Scale must be non-zero."));
      return;
    }
    s.updateBody(
      body.id,
      { transform: trans },
      `Transform ${body.name}`,
      "transform",
    );
  };
  const title = s.panel
    ? s.panel === "primitive"
      ? "Create a solid"
      : s.panel.startsWith("history:")
        ? "Edit feature"
        : s.panel[0].toUpperCase() + s.panel.slice(1)
    : s.tool === "measure"
      ? "Measure"
      : "Selection";
  const radiusInfo = () => {
    const ref = s.selection.refs[0];
    if (
      !g ||
      !ref ||
      !["edge", "loop", "curve", "connected-edges"].includes(ref.kind)
    )
      return null;
    const edges = ref.ids.map((i) => g.edges[i]).filter(Boolean),
      points: THREE.Vector3[] = [];
    const matrix = transformMatrix(body!.transform);
    for (const e of edges)
      points.push(new THREE.Vector3(...e.a).applyMatrix4(matrix));
    if (edges.length)
      points.push(
        new THREE.Vector3(...edges[edges.length - 1].b).applyMatrix4(matrix),
      );
    return fittedRadius(points);
  };
  const fitted = radiusInfo();
  const ref = s.selection.refs[0];
  const nativeRadius =
    g?.kind === "brep" &&
    ref?.ids.length &&
    ["edge", "loop", "curve", "connected-edges"].includes(ref.kind)
      ? g.nativeRadii?.[g.edges[ref.ids[0]]?.kernelId ?? -1]
      : undefined;
  const scales = body?.transform.scale.map(Math.abs);
  const exactRadius =
    nativeRadius !== undefined &&
    scales &&
    scales.every((v) => Math.abs(v - scales[0]) < 1e-9)
      ? nativeRadius * scales[0]
      : undefined;
  return (
    <aside className="context-panel">
      <div className="panel-heading">
        <span className="eyebrow">PROPERTIES</span>
        <span className="panel-badge">
          {g?.kind === "brep" ? "CAD" : "MESH"}
        </span>
      </div>
      <div className="context-title">
        <h2>{title}</h2>
        {s.panel && (
          <button
            className="icon-button"
            onClick={close}
            aria-label="Close panel"
          >
            <X size={17} />
          </button>
        )}
      </div>
      {s.panel?.startsWith("history:") ? (
        <HistoryEditor key={s.panel} index={Number(s.panel.split(":")[1])} />
      ) : s.panel && s.panel !== "diagnostics" ? (
        <>
          {s.panel === "primitive" ? (
            <>
              <p className="panel-description">
                Create an exact native solid. Dimensions remain editable in
                history.
              </p>
              <div className="segmented">
                {["cube", "cylinder", "sphere"].map((shape) => (
                  <button
                    key={shape}
                    className={params.shape === shape ? "active" : ""}
                    onClick={() => change("shape", shape)}
                  >
                    {shape}
                  </button>
                ))}
              </div>
              {params.shape === "cube" ? (
                <>
                  <NumberField
                    label="Width"
                    value={params.width}
                    min={0.01}
                    onChange={(v) => change("width", v)}
                  />
                  <NumberField
                    label="Depth"
                    value={params.depth}
                    min={0.01}
                    onChange={(v) => change("depth", v)}
                  />
                </>
              ) : (
                <NumberField
                  label="Radius"
                  value={params.radius}
                  min={0.01}
                  onChange={(v) => change("radius", v)}
                />
              )}{" "}
              {params.shape !== "sphere" && (
                <NumberField
                  label="Height"
                  value={params.height}
                  min={0.01}
                  onChange={(v) => change("height", v)}
                />
              )}
            </>
          ) : boolean || s.panel === "split" ? (
            <>
              <p className="panel-description">
                {s.panel === "subtract"
                  ? "Remove the tool’s volume from the target. Sources remain available in history."
                  : s.panel === "split"
                    ? "Keep both portions of a plane or object cut."
                    : "Combine solid volumes. STL operands produce a mesh result."}
              </p>
              <label className="field">
                <span>Target body</span>
                <select
                  aria-label="Target body"
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    setPrepared(undefined);
                  }}
                >
                  <option value="">Choose target…</option>
                  {s.bodies.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>
                  {s.panel === "split" ? "Tool (optional)" : "Tool body"}
                </span>
                <select
                  aria-label="Tool body"
                  value={tool}
                  onChange={(e) => {
                    setTool(e.target.value);
                    setPrepared(undefined);
                  }}
                >
                  <option value="">
                    {s.panel === "split" ? "Cut with a plane" : "Choose tool…"}
                  </option>
                  {s.bodies
                    .filter((b) => b.id !== target)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                        {b.role === "cutter" ? " · negative" : ""}
                      </option>
                    ))}
                </select>
              </label>
              {s.panel === "split" && !tool && (
                <>
                  <label className="field">
                    <span>Plane normal</span>
                    <select
                      value={params.axis}
                      onChange={(e) => change("axis", e.target.value)}
                    >
                      {["x", "y", "z"].map((a) => (
                        <option key={a}>{a}</option>
                      ))}
                    </select>
                  </label>
                  <NumberField
                    label="Plane offset"
                    value={params.offset}
                    onChange={(v) => change("offset", v)}
                  />
                </>
              )}
            </>
          ) : (
            <>
              <p className="panel-description">
                {s.panel === "fillet" || s.panel === "chamfer"
                  ? g?.kind === "brep"
                    ? "Blend selected CAD edges with the solid kernel."
                    : "Approximate blend of complete straight convex edges between flat faces meeting at 90°. Stops at corners; select adjoining edges to continue."
                  : s.panel === "offset"
                    ? "Select a complete planar face or mesh region. Positive adds material, negative subtracts."
                    : s.panel === "repair"
                      ? "Resolve tiny T-junctions. This does not fill holes or reconstruct broken solids."
                      : "Process the mesh in a worker, retaining the original in history."}
              </p>
              {blend && (
                <div
                  className="edge-selection-prompt"
                  role="status"
                  aria-live="polite"
                >
                  <strong>
                    {needsContinuation
                      ? "Select the edge continuation"
                      : blendCount
                        ? `${blendCount} ${g?.kind === "brep" ? "CAD" : "straight"} edge${blendCount === 1 ? "" : "s"} selected`
                        : `Select an edge to ${s.panel}`}
                  </strong>
                  {blendCount > 0 && g?.kind === "mesh" && (
                    <span>
                      {blendIds.length} mesh segment
                      {blendIds.length === 1 ? "" : "s"} · follows the complete
                      straight edge
                    </span>
                  )}
                  <p>
                    {needsContinuation
                      ? "Several continuations meet here. Click the segment you want to follow; Shift-click unwanted segments."
                      : blendCount
                        ? "Add adjoining edges to continue around corners. Shift-click removes an edge."
                        : "Click a feature edge in the viewport. The full edge is followed automatically."}
                  </p>
                  <span className="selection-key">
                    <i /> Bright yellow = selected
                  </span>
                </div>
              )}
              {["fillet", "chamfer", "offset"].includes(s.panel) && (
                <NumberField
                  label={
                    s.panel === "fillet"
                      ? "Blend radius"
                      : s.panel === "chamfer"
                        ? "Chamfer distance"
                        : "Offset distance"
                  }
                  value={params.amount}
                  step={0.5}
                  onChange={(v) => change("amount", v)}
                />
              )}
              {s.panel === "simplify" && (
                <NumberField
                  label="Target triangles"
                  unit="tri"
                  value={params.triangles}
                  min={4}
                  step={1000}
                  onChange={(v) => change("triangles", v)}
                />
              )}
              {s.panel === "subdivide" && (
                <NumberField
                  label="Maximum edge"
                  value={params.edgeLength}
                  min={0.1}
                  onChange={(v) => change("edgeLength", v)}
                />
              )}
              <div className="selection-summary">
                <Check size={14} />
                {s.selection.refs.reduce((n, r) => n + r.ids.length, 0)}{" "}
                entities selected
              </div>
            </>
          )}
          <div className="tool-actions">
            <button
              className="secondary-button"
              disabled={
                Boolean(s.busy) || (blend && (!blendCount || needsContinuation))
              }
              onClick={preview}
            >
              <Eye size={15} />
              Preview
            </button>
            <button
              className="primary-button"
              disabled={
                Boolean(s.busy) || (blend && (!blendCount || needsContinuation))
              }
              onClick={apply}
            >
              <Check size={16} />
              {prepared ? "Apply preview" : "Apply"}
            </button>
          </div>
          <button className="text-button" onClick={close}>
            Cancel
          </button>
        </>
      ) : (
        <>
          {body && g ? (
            <>
              <div className="object-card">
                <div className="object-symbol">
                  {g.kind === "brep" ? <Box size={22} /> : <Move3D size={22} />}
                </div>
                <div>
                  <strong>{body.name}</strong>
                  <span>
                    {g.kind === "brep" ? "Native CAD solid" : "Triangle mesh"} ·{" "}
                    {body.role === "cutter" ? "Negative object" : "Solid"}
                  </span>
                </div>
              </div>
              <div className="stats-grid">
                <div>
                  <span>Triangles</span>
                  <strong>{g.diagnostics.triangles.toLocaleString()}</strong>
                </div>
                <div>
                  <span>Shells</span>
                  <strong>{g.diagnostics.shells}</strong>
                </div>
                <div>
                  <span>Open edges</span>
                  <strong className={g.diagnostics.openEdges ? "warning" : ""}>
                    {g.diagnostics.openEdges}
                  </strong>
                </div>
                <div>
                  <span>Non-manifold</span>
                  <strong
                    className={g.diagnostics.nonManifoldEdges ? "warning" : ""}
                  >
                    {g.diagnostics.nonManifoldEdges}
                  </strong>
                </div>
              </div>
              <div className="dimension-line">
                {g.bounds.max
                  .map((n, i) => (n - g.bounds.min[i]).toFixed(2))
                  .join(" × ")}{" "}
                <span>mm</span>
              </div>
              {["move", "rotate", "scale"].includes(s.tool) && trans && (
                <>
                  <div className="section-heading">TRANSFORM</div>
                  <div className="segmented">
                    <button
                      className={coordinates === "world" ? "active" : ""}
                      onClick={() => {
                        setCoordinates("world");
                        window.dispatchEvent(
                          new CustomEvent("me-space", { detail: "world" }),
                        );
                      }}
                    >
                      World
                    </button>
                    <button
                      className={coordinates === "local" ? "active" : ""}
                      onClick={() => {
                        setCoordinates("local");
                        window.dispatchEvent(
                          new CustomEvent("me-space", { detail: "local" }),
                        );
                      }}
                    >
                      Local
                    </button>
                  </div>
                  {s.tool === "scale" && (
                    <label className="checkbox-field">
                      <input
                        type="checkbox"
                        checked={uniform}
                        onChange={(e) => setUniform(e.target.checked)}
                      />
                      Uniform scale
                    </label>
                  )}
                  {["X", "Y", "Z"].map((axis, i) => {
                    const key =
                        s.tool === "move"
                          ? "position"
                          : s.tool === "rotate"
                            ? "rotation"
                            : "scale",
                      value =
                        trans[key][i] *
                        (key === "rotation" ? 180 / Math.PI : 1);
                    return (
                      <NumberField
                        key={axis}
                        label={
                          axis +
                          (key === "rotation"
                            ? " (degrees)"
                            : key === "scale"
                              ? " (factor)"
                              : "")
                        }
                        value={Number(value.toFixed(3))}
                        step={key === "scale" ? 0.1 : 1}
                        unit={
                          key === "rotation"
                            ? "°"
                            : key === "scale"
                              ? "×"
                              : "mm"
                        }
                        onChange={(v) => {
                          const next = structuredClone(trans);
                          if (key === "scale" && uniform)
                            next.scale = [v, v, v];
                          else
                            next[key][i] =
                              v * (key === "rotation" ? Math.PI / 180 : 1);
                          setTrans(next);
                        }}
                      />
                    );
                  })}
                  <button className="primary-button full" onClick={transform}>
                    Apply transform
                  </button>
                </>
              )}
              <div className="section-heading">SELECTION SETTINGS</div>
              <label className="field">
                <span>
                  Surface angle <b>{s.selection.angle}°</b>
                </span>
                <input
                  aria-label="Surface angle"
                  type="range"
                  min={0}
                  max={180}
                  value={s.selection.angle}
                  onChange={(e) =>
                    s.patch({
                      selection: {
                        ...s.selection,
                        angle: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
              {s.brush && (
                <>
                  <NumberField
                    label="Brush radius"
                    value={s.selection.brushRadius}
                    min={0.1}
                    onChange={(v) =>
                      s.patch({
                        selection: {
                          ...s.selection,
                          brushRadius: Math.max(0.1, v),
                        },
                      })
                    }
                  />
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={s.selection.through}
                      onChange={(e) =>
                        s.patch({
                          selection: {
                            ...s.selection,
                            through: e.target.checked,
                          },
                        })
                      }
                    />
                    Paint through surfaces
                  </label>
                </>
              )}
              <div className="selection-summary">
                {s.selection.refs
                  .reduce((n, r) => n + r.ids.length, 0)
                  .toLocaleString()}{" "}
                {s.selection.mode === "exclude" ? "excluded" : "selected"}{" "}
                entities · Shift to remove
              </div>
              {exactRadius !== undefined ? (
                <div className="info-box">
                  CAD radius {exactRadius.toFixed(3)} mm
                </div>
              ) : (
                fitted && (
                  <div className="info-box">
                    Approx. radius {fitted.radius.toFixed(3)} mm
                    <br />
                    Fit deviation {fitted.error.toFixed(3)} mm
                  </div>
                )
              )}
              {(g.diagnostics.openEdges > 0 ||
                g.diagnostics.nonManifoldEdges > 0) && (
                <div className="warning-box">
                  Open or non-manifold geometry. Solid operations require a
                  closed manifold mesh.
                </div>
              )}
              <button
                className="secondary-button full"
                disabled={Boolean(s.busy)}
                onClick={async () => {
                  s.patch({
                    busy: {
                      message: "Running advanced diagnostics",
                      progress: 0,
                    },
                  });
                  try {
                    const result = await runJob({
                      revision: s.revision,
                      operation: "diagnostics",
                      params: {},
                      inputs: [{ geometry: g, transform: body.transform }],
                    });
                    setDiag(result.data);
                    s.patch({ notice: "Advanced diagnostics complete" });
                  } catch (e) {
                    report(e);
                  } finally {
                    s.patch({ busy: null });
                  }
                }}
              >
                <Info size={15} />
                Advanced diagnostics
              </button>
              {diag && (
                <div className="info-box">
                  Intersecting pairs: {diag.intersectingPairs}
                  <br />
                  Overlapping pairs: {diag.overlappingPairs}
                </div>
              )}
            </>
          ) : (
            <div className="no-selection">
              <Scissors size={28} />
              <h3>Select a body or surface</h3>
              <p>
                Inspect geometry, adjust selection, and edit your model here.
              </p>
              <div className="shortcut-row">
                <kbd>Ctrl</kbd>
                <span>Add to selection</span>
              </div>
              <div className="shortcut-row">
                <kbd>Shift</kbd>
                <span>Remove / erase</span>
              </div>
            </div>
          )}
          {s.tool === "measure" && (
            <>
              <div className="section-heading">MEASURE</div>
              <p className="panel-description">
                Pick two points for distance. A third point shows the angle at
                the middle point.
              </p>
              {s.measurements.length >= 2 && (
                <div className="measurement">
                  <Ruler size={18} />
                  {new THREE.Vector3(...s.measurements[0].point)
                    .distanceTo(new THREE.Vector3(...s.measurements[1].point))
                    .toFixed(3)}{" "}
                  mm
                </div>
              )}
              {s.measurements.length === 3 && (
                <div className="measurement">
                  {(new THREE.Vector3(...s.measurements[0].point)
                    .sub(new THREE.Vector3(...s.measurements[1].point))
                    .angleTo(
                      new THREE.Vector3(...s.measurements[2].point).sub(
                        new THREE.Vector3(...s.measurements[1].point),
                      ),
                    ) *
                    180) /
                    Math.PI}
                  °
                </div>
              )}
              <button
                className="secondary-button"
                onClick={() => s.patch({ measurements: [] })}
              >
                <RotateCcw size={14} />
                Clear measurements
              </button>
            </>
          )}
        </>
      )}
      <div className="panel-footer">
        <span className="live-dot" />
        Geometry runs on your device
      </div>
    </aside>
  );
}
function HistoryEditor({ index }: { index: number }) {
  const s = useEditor(),
    node = s.history[index],
    [values, setValues] = useState<Record<string, any>>({ ...node.params });
  const numeric = Object.entries(values).filter(
    ([k, v]) => typeof v === "number" && !["tolerance"].includes(k),
  );
  return (
    <>
      <p className="panel-description">
        {node.label}. Downstream operations rebuild from stored inputs. Changed
        topology requires reselection.
      </p>
      {numeric.map(([k, v]) => (
        <NumberField
          key={k}
          label={k}
          value={v}
          onChange={(n) => setValues((p) => ({ ...p, [k]: n }))}
        />
      ))}
      {!numeric.length && (
        <div className="info-box">
          This feature has no numerical parameters. Use suppression or undo to
          change its effect.
        </div>
      )}
      <button
        className="primary-button full"
        disabled={Boolean(s.busy) || index >= s.cursor}
        onClick={() => rebuildHistory(index, values)}
      >
        Rebuild feature
      </button>
      {node.error && <div className="warning-box">{node.error}</div>}
    </>
  );
}
