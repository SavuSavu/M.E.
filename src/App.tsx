import { useEffect, useRef, useState } from "react";
import {
  Box,
  Cylinder,
  Circle,
  Plus,
  Upload,
  Download,
  Save,
  FolderOpen,
  Undo2,
  Redo2,
  MousePointer2,
  Move3D,
  Rotate3D,
  Scaling,
  Combine,
  Scissors,
  Layers,
  Spline,
  Ruler,
  Copy,
  Trash2,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  Grid3X3,
  Scan,
  FlipHorizontal2,
  Magnet,
  Square,
  Paintbrush,
  PaintBucket,
  X,
  History,
  Minus,
  Check,
  Settings2,
  CornerDownRight,
  GitBranch,
  CircleHelp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Viewport } from "./components/Viewport";
import { ContextPanel } from "./components/ContextPanel";
import { useEditor } from "./state/editor";
import {
  importFiles,
  duplicateBody,
  deleteBody,
  cancel,
  setMaskMode,
} from "./state/operations";
import {
  saveProject,
  loadProject,
  exportSTL,
  startRecovery,
  recoveryAvailable,
  recover,
} from "./state/project";
import { rebuildHistory } from "./state/history";
import { emptySelection } from "./types";
import type { EntityKind } from "./types";
function ToolButton({
  icon: Icon,
  label,
  active,
  onClick,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className={`feature-button ${active ? "active" : ""}`}
      disabled={disabled}
      onClick={onClick}
      title={label}
    >
      <Icon size={19} strokeWidth={1.6} />
      <span>{label}</span>
    </button>
  );
}
export default function App() {
  const s = useEditor(),
    modelInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    [historyOpen, setHistoryOpen] = useState(true),
    [rename, setRename] = useState<string | null>(null),
    [recovery, setRecovery] = useState(false),
    [help, setHelp] = useState(false),
    [category, setCategory] = useState("Model"),
    [treeOpen, setTreeOpen] = useState(true);
  useEffect(() => {
    const stop = startRecovery();
    recoveryAvailable()
      .then(setRecovery)
      .catch(() => {});
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,[contenteditable="true"]',
        )
      )
        return;
      const state = useEditor.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) state.redo();
        else state.undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveProject();
      }
      if (e.key === "Delete" && !state.selection.refs.length)
        for (const id of state.selection.bodyIds) deleteBody(id);
      if (e.key === "Escape" && state.busy) cancel();
    };
    window.addEventListener("keydown", key);
    return () => {
      stop();
      window.removeEventListener("keydown", key);
    };
  }, []);
  const selected = s.bodies.find((b) => s.selection.bodyIds.includes(b.id)),
    visible = s.bodies.filter((b) => b.visible),
    triangles = visible.reduce(
      (n, b) => n + s.geometries[b.geometryId].diagnostics.triangles,
      0,
    ),
    busy = Boolean(s.busy);
  const setTool = (tool: typeof s.tool) =>
    s.patch({
      tool,
      panel: null,
      brush: false,
      preview: [],
      previewGeometries: {},
    });
  const setPanel = (panel: string) =>
    s.patch({
      panel,
      tool: "select",
      brush: false,
      preview: [],
      previewGeometries: {},
    });
  const entity = (kind: EntityKind) =>
    s.patch({ entity: kind, brush: false, tool: "select" });
  const mirror = () => {
    if (!selected || busy) return;
    const transform = structuredClone(selected.transform);
    transform.scale[0] *= -1;
    s.updateBody(
      selected.id,
      { transform },
      `Mirror ${selected.name}`,
      "mirror",
    );
  };
  const modes: [EntityKind, string][] = [
    ["body", "Body"],
    ["face", "Face"],
    ["surface", "Connected"],
    ["planar", "Planar"],
    ["tangent", "Tangent"],
    ["edge", "Edge"],
    ["loop", "Edge loop"],
    ["connected-edges", "Connected edges"],
    ["curve", "Feature / curve"],
  ];
  return (
    <div className="app-shell">
      <input
        ref={modelInput}
        data-testid="stl-input"
        type="file"
        accept=".stl"
        multiple
        hidden
        onChange={(e) => {
          void importFiles(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
      <input
        ref={projectInput}
        data-testid="project-input"
        type="file"
        accept=".meproj"
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) void loadProject(e.target.files[0]);
          e.target.value = "";
        }}
      />
      <header className="app-header">
        <a className="brand" href="#" aria-label="Model Editor home">
          M<span>.</span>E<span>.</span>
        </a>
        <div className="header-divider" />
        <div className="document-title">
          <input
            aria-label="Workspace name"
            value={s.title}
            onChange={(e) => s.patch({ title: e.target.value })}
          />
          <span className="document-state">LOCAL WORKSPACE</span>
        </div>
        <div className="header-actions">
          <button
            className="header-button"
            disabled={busy}
            onClick={() => projectInput.current?.click()}
          >
            <FolderOpen size={15} />
            Open
          </button>
          <button
            className="header-button"
            disabled={busy}
            onClick={saveProject}
          >
            <Save size={15} />
            Save
          </button>
          <button
            className="export-button"
            disabled={busy || !s.bodies.length}
            onClick={() => exportSTL()}
          >
            <Download size={15} />
            Export STL
          </button>
          <button
            className="icon-button help-button"
            onClick={() => setHelp(!help)}
            title="Help"
          >
            <CircleHelp size={18} />
          </button>
        </div>
      </header>
      <nav className="workspace-tabs">
        <button
          className={category === "Model" ? "active" : ""}
          onClick={() => setCategory("Model")}
        >
          Model
        </button>
        <button
          className={category === "Inspect" ? "active" : ""}
          onClick={() => setCategory("Inspect")}
        >
          Inspect
        </button>
        <button
          className={category === "View" ? "active" : ""}
          onClick={() => setCategory("View")}
        >
          View
        </button>
        <span className="version-label">
          MODEL-EDITOR <span> / </span> v0.1
        </span>
      </nav>
      <div className="feature-toolbar">
        <div className="toolbar-group">
          <ToolButton
            icon={Undo2}
            label="Undo"
            disabled={busy || !s.cursor}
            onClick={s.undo}
          />
          <ToolButton
            icon={Redo2}
            label="Redo"
            disabled={busy || s.cursor >= s.history.length}
            onClick={s.redo}
          />
        </div>
        {category === "Model" ? (
          <>
            <div className="toolbar-group">
              <ToolButton
                icon={Upload}
                label="Import STL"
                disabled={busy}
                onClick={() => modelInput.current?.click()}
              />
              <ToolButton
                icon={Plus}
                label="Add solid"
                active={s.panel === "primitive"}
                disabled={busy}
                onClick={() => setPanel("primitive")}
              />
            </div>
            <div className="toolbar-group">
              <ToolButton
                icon={MousePointer2}
                label="Select"
                active={s.tool === "select" && !s.panel}
                disabled={busy}
                onClick={() => setTool("select")}
              />
              <ToolButton
                icon={Move3D}
                label="Move"
                active={s.tool === "move"}
                disabled={busy || !selected}
                onClick={() => setTool("move")}
              />
              <ToolButton
                icon={Rotate3D}
                label="Rotate"
                active={s.tool === "rotate"}
                disabled={busy || !selected}
                onClick={() => setTool("rotate")}
              />
              <ToolButton
                icon={Scaling}
                label="Scale"
                active={s.tool === "scale"}
                disabled={busy || !selected}
                onClick={() => setTool("scale")}
              />
            </div>
            <div className="toolbar-group">
              <ToolButton
                icon={Combine}
                label="Union"
                disabled={busy || s.bodies.length < 2}
                onClick={() => setPanel("union")}
              />
              <ToolButton
                icon={Scissors}
                label="Subtract"
                disabled={busy || s.bodies.length < 2}
                onClick={() => setPanel("subtract")}
              />
              <ToolButton
                icon={Layers}
                label="Intersect"
                disabled={busy || s.bodies.length < 2}
                onClick={() => setPanel("intersect")}
              />
              <ToolButton
                icon={GitBranch}
                label="Split"
                disabled={busy || !selected}
                onClick={() => setPanel("split")}
              />
            </div>
            <div className="toolbar-group">
              <ToolButton
                icon={Spline}
                label="Fillet"
                disabled={busy || !selected}
                onClick={() => setPanel("fillet")}
              />
              <ToolButton
                icon={CornerDownRight}
                label="Chamfer"
                disabled={busy || !selected}
                onClick={() => setPanel("chamfer")}
              />
              <ToolButton
                icon={Layers}
                label="Offset"
                disabled={busy || !selected}
                onClick={() => setPanel("offset")}
              />
            </div>
            <div className="toolbar-group">
              <ToolButton
                icon={FlipHorizontal2}
                label="Mirror X"
                disabled={busy || !selected}
                onClick={mirror}
              />
              <ToolButton
                icon={Magnet}
                label="Align"
                disabled={busy || !selected}
                onClick={() => setTool("align")}
              />
              <ToolButton
                icon={Square}
                label="Place on face"
                disabled={busy || !selected}
                onClick={() => setTool("place")}
              />
            </div>
          </>
        ) : category === "Inspect" ? (
          <>
            <div className="toolbar-group">
              <ToolButton
                icon={Ruler}
                label="Measure"
                active={s.tool === "measure"}
                onClick={() => setTool("measure")}
              />
              <ToolButton
                icon={Scan}
                label="Diagnostics"
                disabled={!selected || busy}
                onClick={() => setPanel("diagnostics")}
              />
            </div>
            <div className="toolbar-group">
              <ToolButton
                icon={Settings2}
                label="Repair"
                disabled={!selected || busy}
                onClick={() => setPanel("repair")}
              />
              <ToolButton
                icon={Minus}
                label="Simplify"
                disabled={!selected || busy}
                onClick={() => setPanel("simplify")}
              />
              <ToolButton
                icon={Plus}
                label="Subdivide"
                disabled={!selected || busy}
                onClick={() => setPanel("subdivide")}
              />
            </div>
          </>
        ) : (
          <>
            <div className="toolbar-group">
              <ToolButton
                icon={Scan}
                label="Fit all"
                onClick={() => window.dispatchEvent(new Event("me-fit"))}
              />
              <ToolButton
                icon={Grid3X3}
                label="Wireframe"
                active={s.wireframe}
                onClick={() => s.patch({ wireframe: !s.wireframe })}
              />
              <ToolButton
                icon={Scissors}
                label="Section"
                active={s.section}
                onClick={() => s.patch({ section: !s.section })}
              />
              <ToolButton
                icon={Box}
                label={s.perspective ? "Perspective" : "Orthographic"}
                onClick={() => s.patch({ perspective: !s.perspective })}
              />
            </div>
            {[
              "Front",
              "Back",
              "Left",
              "Right",
              "Top",
              "Bottom",
              "Isometric",
            ].map((view) => (
              <button
                key={view}
                className="view-button"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("me-view", { detail: view }),
                  )
                }
              >
                {view}
              </button>
            ))}
          </>
        )}
      </div>
      <div className="work-area">
        <aside className={`object-panel ${treeOpen ? "" : "collapsed"}`}>
          <div className="panel-heading">
            <span className="eyebrow">WORKSPACE</span>
            <button
              className="icon-button"
              onClick={() => setTreeOpen(!treeOpen)}
              aria-label="Toggle object tree"
            >
              <PanelLeftClose size={16} />
            </button>
          </div>
          {treeOpen && (
            <>
              <div className="tree-heading">
                <ChevronDown size={14} />
                <Box size={15} />
                <strong>Bodies</strong>
                <span>{s.bodies.length}</span>
                <button
                  className="icon-button"
                  title="Add solid"
                  onClick={() => setPanel("primitive")}
                >
                  <Plus size={15} />
                </button>
              </div>
              <div className="body-list">
                {!s.bodies.length && (
                  <div className="tree-empty">
                    <p>Your models live here.</p>
                    <button onClick={() => modelInput.current?.click()}>
                      <Upload size={14} />
                      Import an STL
                    </button>
                  </div>
                )}
                {s.bodies.map((b) => (
                  <div
                    className={`body-row ${s.selection.bodyIds.includes(b.id) ? "selected" : ""} ${!b.visible ? "muted" : ""}`}
                    key={b.id}
                    onClick={(e) =>
                      s.selectBodies(
                        e.ctrlKey || e.metaKey
                          ? [...new Set([...s.selection.bodyIds, b.id])]
                          : [b.id],
                      )
                    }
                  >
                    <button
                      className="icon-button visibility"
                      aria-label={`${b.visible ? "Hide" : "Show"} ${b.name}`}
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        s.updateBody(
                          b.id,
                          { visible: !b.visible },
                          `${b.visible ? "Hide" : "Show"} ${b.name}`,
                          "visibility",
                        );
                      }}
                    >
                      {b.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <span
                      className={`body-kind ${b.role === "cutter" ? "negative" : ""}`}
                    >
                      {b.role === "cutter" ? (
                        <Scissors size={15} />
                      ) : s.geometries[b.geometryId].kind === "brep" ? (
                        <Box size={15} />
                      ) : (
                        <Grid3X3 size={15} />
                      )}
                    </span>
                    {rename === b.id ? (
                      <input
                        className="rename-input"
                        autoFocus
                        defaultValue={b.name}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          if (e.target.value.trim())
                            s.updateBody(
                              b.id,
                              { name: e.target.value.trim() },
                              "Rename body",
                              "rename",
                            );
                          setRename(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                      />
                    ) : (
                      <span
                        className="body-name"
                        title="Double-click to rename"
                        onDoubleClick={() => setRename(b.id)}
                      >
                        {b.name}
                      </span>
                    )}
                    <span className="body-tag">
                      {b.role === "cutter"
                        ? "−"
                        : s.geometries[b.geometryId].kind === "brep"
                          ? "CAD"
                          : "STL"}
                    </span>
                  </div>
                ))}
              </div>
              {selected && (
                <div className="body-actions">
                  <button
                    disabled={busy}
                    onClick={() => setRename(selected.id)}
                    title="Rename"
                  >
                    <Settings2 size={14} />
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => duplicateBody(selected.id)}
                    title="Duplicate"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      s.updateBody(
                        selected.id,
                        {
                          role: selected.role === "cutter" ? "solid" : "cutter",
                        },
                        "Change cutter role",
                        "role",
                      )
                    }
                    title="Toggle negative object"
                  >
                    <Scissors size={14} />
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => deleteBody(selected.id)}
                    title="Delete body"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
              <div
                className="history-heading"
                onClick={() => setHistoryOpen(!historyOpen)}
              >
                <History size={15} />
                <strong>Feature history</strong>
                <span>{s.cursor}</span>
                {historyOpen ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
              </div>
              {historyOpen && (
                <div className="history-list">
                  {!s.history.length && (
                    <p className="history-empty">
                      Your edits become a history.
                    </p>
                  )}
                  {s.history.map((node, i) => (
                    <div
                      key={node.id}
                      className={`history-row ${i >= s.cursor ? "future" : ""} ${node.suppressed ? "suppressed" : ""} ${node.status === "blocked" ? "blocked" : ""}`}
                    >
                      <span className="history-index">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <button
                        className="history-label"
                        onClick={() => setPanel(`history:${i}`)}
                        title={node.error || node.label}
                      >
                        {node.label}
                      </button>
                      <button
                        className="icon-button"
                        disabled={
                          busy ||
                          i >= s.cursor ||
                          ["import", "selection"].includes(node.operation)
                        }
                        onClick={() =>
                          rebuildHistory(i, undefined, !node.suppressed)
                        }
                        title={
                          node.suppressed
                            ? "Enable feature"
                            : "Suppress feature"
                        }
                      >
                        {node.status === "blocked" ? (
                          <CircleHelp size={12} />
                        ) : node.suppressed ? (
                          <EyeOff size={12} />
                        ) : (
                          <Check size={12} />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="tree-footer">
                <div className="local-indicator">
                  <span className="live-dot" />
                  LOCAL & PRIVATE
                </div>
                <p>No models leave your browser.</p>
                <a
                  href="https://github.com/SavuSavu/M.E."
                  target="_blank"
                  rel="noreferrer"
                >
                  Source & AGPL license ↗
                </a>
              </div>
            </>
          )}
        </aside>
        <main className="viewport-column">
          <div className="selection-toolbar">
            <div className="selection-mode">
              <button
                className={
                  !["edge", "loop", "connected-edges", "curve"].includes(
                    s.entity,
                  )
                    ? "active"
                    : ""
                }
                onClick={() => entity("surface")}
              >
                <Square size={14} />
                By Surface
              </button>
              <button
                className={
                  ["edge", "loop", "connected-edges"].includes(s.entity)
                    ? "active"
                    : ""
                }
                onClick={() => entity("edge")}
              >
                <Minus size={14} />
                By Line
              </button>
              <button
                className={s.entity === "curve" ? "active" : ""}
                onClick={() => entity("curve")}
              >
                <Spline size={14} />
                By Curve
              </button>
            </div>
            <select
              aria-label="Selection type"
              value={s.entity}
              onChange={(e) => entity(e.target.value as EntityKind)}
            >
              {modes.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <span className="toolbar-separator" />
            <button
              className={s.selection.mode === "include" ? "mask-active" : ""}
              onClick={() => setMaskMode("include")}
            >
              Include Only
            </button>
            <button
              className={
                s.selection.mode === "exclude" ? "mask-active exclude" : ""
              }
              onClick={() => setMaskMode("exclude")}
            >
              Exclude
            </button>
            <span className="toolbar-separator" />
            <button
              className={s.brush ? "mask-active" : ""}
              onClick={() => s.patch({ brush: !s.brush, tool: "select" })}
            >
              <Paintbrush size={14} />
              Brush
            </button>
            <button
              onClick={() =>
                s.patch({ brush: false, entity: "surface", tool: "select" })
              }
            >
              <PaintBucket size={14} />
              Fill
            </button>
            <button
              onClick={() =>
                s.commit("Clear selection", "selection", {}, s.bodies, [], {
                  ...emptySelection(),
                  mode: s.selection.mode,
                  bodyIds: s.selection.bodyIds,
                })
              }
            >
              <X size={13} />
              Clear All
            </button>
          </div>
          <Viewport />
          {s.section && (
            <div className="section-bar">
              <Scissors size={14} />
              <strong>Section view</strong>
              <select
                aria-label="Section axis"
                value={s.sectionAxis}
                onChange={(e) =>
                  s.patch({ sectionAxis: e.target.value as "x" | "y" | "z" })
                }
              >
                {["x", "y", "z"].map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
              <input
                aria-label="Section offset"
                type="number"
                value={s.sectionOffset}
                onChange={(e) =>
                  s.patch({ sectionOffset: Number(e.target.value) })
                }
              />
              <span>mm</span>
              <button onClick={() => s.patch({ section: false })}>
                <X size={14} />
              </button>
            </div>
          )}
        </main>
        <ContextPanel />
      </div>
      <footer className="status-bar">
        <span className="status-message">
          <span className="live-dot" />
          {s.hover || s.notice}
        </span>
        <span>{visible.length} visible bodies</span>
        <span>{triangles.toLocaleString()} triangles</span>
        <span>
          {s.selection.refs
            .reduce((n, r) => n + r.ids.length, 0)
            .toLocaleString()}{" "}
          selected
        </span>
        <span className="status-unit">mm</span>
      </footer>
      {s.error && (
        <div className="toast error-toast" role="alert">
          <CircleHelp size={18} />
          <span>{s.error}</span>
          <button
            onClick={() => s.patch({ error: null })}
            aria-label="Dismiss error"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {s.busy && (
        <div className="job-toast" role="status">
          <span className="spinner" />
          <div>
            <strong>{s.busy.message}</strong>
            <div className="progress-track">
              <div
                style={{ width: `${Math.max(8, s.busy.progress * 100)}%` }}
              />
            </div>
          </div>
          <button onClick={cancel}>Cancel</button>
        </div>
      )}
      {recovery && (
        <div className="recovery-toast">
          <History size={17} />
          <span>A saved local workspace is available.</span>
          <button
            onClick={() => {
              setRecovery(false);
              void recover();
            }}
          >
            Restore
          </button>
          <button onClick={() => setRecovery(false)}>
            <X size={14} />
          </button>
        </div>
      )}
      {help && (
        <div className="help-popover">
          <button className="icon-button" onClick={() => setHelp(false)}>
            <X size={15} />
          </button>
          <h3>Built for editing existing models.</h3>
          <p>
            Import STL files or add exact CAD solids. Select a target and cutter
            to subtract material. Mark a body as negative to keep it as a
            reusable cutter.
          </p>
          <p>
            Right-drag orbits; middle-drag pans. Ctrl+right-drag pans too. Wheel
            zooms. F fits visible models.
          </p>
          <p>
            Ctrl-click adds selection; Shift removes. Ctrl+Z undoes. Ctrl+S
            saves your project.
          </p>
          <p>
            STL surfaces and curves are inferred from triangles. Native solids
            preserve CAD topology. Mixed operations produce mesh geometry.
          </p>
          <a
            href="https://github.com/SavuSavu/M.E."
            target="_blank"
            rel="noreferrer"
          >
            M.E. source code ↗
          </a>
        </div>
      )}
    </div>
  );
}
