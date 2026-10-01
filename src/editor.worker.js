import initOC from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import * as cad from 'replicad';
import { readSTL, writeSTL, validatePositions, transformMesh, smoothMesh, sculptMesh, subdivideMesh, topology } from './mesh.js';

let ocPromise;
function kernel() {
  ocPromise ??= initOC({ locateFile: () => wasmUrl, print: () => {}, printErr: () => {} }).then(oc => { cad.setOC(oc); return oc; });
  return ocPromise;
}
let history = [], cursor = -1;
const current = () => history[cursor];
function release(state) { state?.shape?.delete(); }
function commit(state, reset = false) {
  if (reset) { history.forEach(release); history = []; cursor = -1; }
  history.splice(cursor + 1).forEach(release);
  history.push(state); cursor++;
  let bytes = history.reduce((n, s) => n + (s.positions?.byteLength || 0), 0);
  while (history.length > 16 || (bytes > 96 * 1024 * 1024 && history.length > 1)) {
    bytes -= history[0].positions?.byteLength || 0;
    release(history.shift()); cursor--;
  }
}
async function validShape(shape) {
  const oc = await kernel();
  if (!cad.isShape3D(shape) || shape.isNull) throw new Error('The operation did not produce a solid model.');
  const check = new oc.BRepCheck_Analyzer(shape.wrapped);
  const valid = check.IsValid(); check.delete();
  if (!valid) throw new Error('This operation would create invalid geometry. Try a smaller radius or fewer edges.');
  const solids = shape.solids;
  const count = solids.length; solids.forEach(s => s.delete());
  if (!count) throw new Error('The file contains surfaces but no solid bodies.');
}
function display(state) {
  let positions, edges = [];
  if (state.shape) {
    const mesh = state.shape.mesh({ tolerance: 0.08, angularTolerance: 0.15 });
    if (mesh.triangles.length / 3 > 600_000) throw new Error('The model exceeds the 600,000 triangle limit.');
    positions = new Float32Array(mesh.triangles.length * 3);
    mesh.triangles.forEach((v, i) => positions.set(mesh.vertices.slice(v * 3, v * 3 + 3), i * 3));
    const edgeMesh = state.shape.meshEdges({ tolerance: 0.08, angularTolerance: 0.12 });
    const shapeEdges = state.shape.edges;
    const byHash = new Map(shapeEdges.map(e => [e.hashCode, e]));
    edges = edgeMesh.edgeGroups.map(group => {
      const e = byHash.get(group.edgeId);
      return { id: group.edgeId, type: e?.geomType || 'EDGE', points: Array.from(edgeMesh.lines.slice(group.start * 3, (group.start + group.count) * 3)) };
    });
    shapeEdges.forEach(e => e.delete());
  } else positions = state.positions.slice();
  validatePositions(positions);
  return { positions, edges, mode: state.shape ? 'solid' : 'mesh', name: state.name,
    canUndo: cursor > 0, canRedo: cursor < history.length - 1,
    history: history.map(s => s.label), cursor, brep: state.shape ? (state.brep ??= state.shape.serialize()) : null };
}
async function stlSolid(positions) {
  if (positions.length / 9 > 20_000) throw new Error('Solid conversion is limited to 20,000 triangles. Dense STL models can use mesh tools; STEP is better for CAD edges.');
  const t = topology(positions);
  if (t.open || t.nonManifold || t.degenerate) throw new Error('Solid conversion needs a closed mesh without degenerate or non-manifold triangles.');
  const oc = await kernel();
  const path = '/me-convert.stl';
  const reader = new oc.StlAPI_Reader(), raw = new oc.TopoDS_Shape();
  let wrapper, shell, solid, upgrader;
  try {
    oc.FS.writeFile(path, new Uint8Array(writeSTL(positions)));
    if (!reader.Read(raw, path)) throw new Error('OpenCascade could not read this mesh.');
    wrapper = cad.cast(raw);
    shell = cad.weldShellsAndFaces([wrapper]);
    upgrader = new oc.ShapeUpgrade_UnifySameDomain(shell.wrapped, true, true, false);
    upgrader.Build();
    const unified = cad.cast(upgrader.Shape());
    try { solid = cad.makeSolid([unified]); } finally { unified.delete(); }
    await validShape(solid);
    return solid;
  } catch (error) { solid?.delete(); throw error; }
  finally { reader.delete(); wrapper?.delete(); shell?.delete(); upgrader?.delete(); oc.FS.unlink(path); }
}
async function run(message) {
  const { cmd, args = {} } = message;
  if (cmd === 'import') {
    if (args.name.toLowerCase().endsWith('.me')) {
      const project = JSON.parse(new TextDecoder().decode(args.buffer));
      if (project.version !== 1 || !Array.isArray(project.positions)) throw new Error('Unsupported M.E. project file.');
      const positions = new Float32Array(project.positions); validatePositions(positions);
      let shape;
      if (project.brep) { await kernel(); shape = cad.deserializeShape(project.brep); await validShape(shape); }
      const state = { name: String(project.name || 'model.stl'), positions: shape ? undefined : positions, shape, label: 'Opened project' };
      try { display(state); commit(state, true); return display(state); } catch (error) { release(state); throw error; }
    }
    if (/\.stl$/i.test(args.name)) {
      const state = { positions: readSTL(args.buffer), name: args.name, label: 'Imported STL' };
      commit(state, true); return display(state);
    }
    if (!/\.(step|stp)$/i.test(args.name)) throw new Error('Choose an STL, STEP, STP, or M.E. project file.');
    const text = new TextDecoder().decode(args.buffer.slice(0, 4096));
    if (!/ISO-10303-21/i.test(text)) throw new Error('This file is not a STEP document.');
    await kernel();
    const shape = await cad.importSTEP(new Blob([args.buffer]));
    try { await validShape(shape); const state = { shape, name: args.name, label: 'Imported STEP' }; display(state); commit(state, true); return display(state); }
    catch (error) { shape.delete(); throw error; }
  }
  if (cmd === 'example') {
    await kernel();
    let shape;
    if (args.kind === 'box') shape = cad.makeBox([-20, -15, 0], [20, 15, 20]);
    else {
      shape = cad.makeBox([-25, -20, 0], [25, 20, 12]);
      const hole = cad.makeCylinder(8, 20, [0, 0, -4]);
      const cut = shape.cut(hole); shape.delete(); hole.delete(); shape = cut;
    }
    const state = { shape, name: args.kind === 'box' ? 'practice-block.step' : 'mounting-plate.step', label: 'Created example' };
    display(state); commit(state, true); return display(state);
  }
  const state = current(); if (!state) throw new Error('Import a model first.');
  if (cmd === 'undo' || cmd === 'redo') {
    cursor = Math.max(0, Math.min(history.length - 1, cursor + (cmd === 'undo' ? -1 : 1)));
    return display(current());
  }
  if (cmd === 'export') {
    if (args.format === 'me') {
      const data = display(state);
      return { blob: new Blob([JSON.stringify({ version: 1, name: state.name, positions: Array.from(data.positions), brep: state.shape?.serialize() })], { type: 'application/json' }), extension: 'me' };
    }
    if (args.format === 'step') {
      if (!state.shape) throw new Error('Convert the mesh to a solid before exporting STEP.');
      return { blob: state.shape.blobSTEP(), extension: 'step' };
    }
    const data = display(state);
    return { blob: new Blob([writeSTL(data.positions)], { type: 'model/stl' }), extension: 'stl' };
  }
  if (cmd === 'diagnostics') {
    const { positions } = display(state), t = topology(positions);
    return { triangles: positions.length / 9, vertices: t.vertices.length, open: t.open, nonManifold: t.nonManifold, degenerate: t.degenerate };
  }
  let next = { name: state.name, label: args.label || cmd };
  try {
    if (cmd === 'convert') { if (state.shape) throw new Error('This model is already a CAD solid.'); next.shape = await stlSolid(state.positions); next.label = 'Converted to solid'; }
    else if (cmd === 'fillet' || cmd === 'chamfer') {
      if (!state.shape) throw new Error('Convert this STL to a solid to edit its edges.');
      if (!Number.isFinite(args.radius) || args.radius <= 0) throw new Error('The radius must be greater than zero.');
      if (!args.ids?.length) throw new Error('Select at least one edge.');
      const ids = new Set(args.ids);
      next.shape = state.shape[cmd](args.radius, finder => finder.when(({ element }) => ids.has(element.hashCode)));
      await validShape(next.shape); next.label = `${cmd === 'fillet' ? 'Fillet' : 'Chamfer'} · ${args.radius} mm`;
    } else if (cmd === 'transform') {
      const { scale, rotation, translation } = args;
      if (![scale, ...rotation, ...translation].every(Number.isFinite) || scale <= 0) throw new Error('Use finite values and a positive scale.');
      if (state.shape) {
        const bbox = state.shape.boundingBox, [low, high] = bbox.bounds; bbox.delete();
        const center = low.map((v, k) => (v + high[k]) / 2);
        let shape = state.shape.clone().scale(scale, center);
        rotation.forEach((v, k) => { if (v) shape = shape.rotate(v, center, ['X', 'Y', 'Z'][k]); });
        next.shape = shape.translate(translation);
      } else next.positions = transformMesh(state.positions, args);
      next.label = 'Transformed model';
    } else if (['smooth', 'sculpt', 'refine', 'toMesh'].includes(cmd)) {
      const positions = state.shape ? display(state).positions : state.positions;
      if (cmd === 'smooth') next.positions = smoothMesh(positions, args.iterations || 1, 0.25);
      if (cmd === 'sculpt') next.positions = sculptMesh(positions, args.points, args.radius, args.amount);
      if (cmd === 'refine') next.positions = subdivideMesh(positions);
      if (cmd === 'toMesh') next.positions = positions.slice();
      next.label = ({ smooth: 'Smoothed mesh', sculpt: 'Sculpted surface', refine: 'Refined triangles', toMesh: 'Converted to mesh' })[cmd];
    } else throw new Error('Unknown operation.');
    if (next.shape) await validShape(next.shape);
    display(next); commit(next); return display(next);
  } catch (error) { release(next); throw error; }
}
self.onmessage = async ({ data }) => {
  try { self.postMessage({ id: data.id, result: await run(data) }); }
  catch (error) { self.postMessage({ id: data.id, error: typeof error === 'number' ? 'The CAD kernel could not build this operation. Try a smaller radius or a different edge.' : error.message || String(error) }); }
};
