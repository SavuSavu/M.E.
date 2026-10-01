import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-700.css';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-700.css';
import './style.css';
import { createIcons, FolderOpen, Download, MousePointer2, Orbit, Paintbrush, Scan, CircleHelp, Github, Network, Grid2x2, Box, Upload, ArrowUpRight, Disc3, ArrowRight, ShieldCheck, Mouse, Blend, Route, Check, Move3d, Waves, Triangle, History, Undo2, Redo2, Save } from 'lucide';
import { Viewer } from './viewer.js';
import { tangentChain } from './chains.js';

createIcons({ icons: { FolderOpen, Download, MousePointer2, Orbit, Paintbrush, Scan, CircleHelp, Github, Network, Grid2x2, Box, Upload, ArrowUpRight, Disc3, ArrowRight, ShieldCheck, Mouse, Blend, Route, Check, Move3d, Waves, Triangle, History, Undo2, Redo2, Save } });
const $ = id => document.getElementById(id);
let worker, pending = new Map(), counter = 0, busy = false, model, selection = new Set(), edgeOperation = 'fillet', toastTimer;
const viewer = new Viewer($('viewport'), { onEdge: selectEdge, onStroke: (points, inward) => {
  withNumbers(() => {
    const radius = number('brush-radius'), depth = number('brush-depth');
    if (radius <= 0 || depth <= 0) return error('Use positive brush radius and depth.');
    operate('sculpt', { points, radius, amount: depth * (inward ? -1 : 1) }, 'Shaping the surface…');
  });
} });
viewer.brushRadius = 5;
function startWorker() {
  worker = new Worker(new URL('./editor.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const task = pending.get(data.id); if (!task) return; pending.delete(data.id);
    if (data.error) task.reject(new Error(data.error)); else task.resolve(data.result);
  };
  worker.onerror = e => { for (const task of pending.values()) task.reject(new Error(e.message || 'The modeling worker failed. Reload this page.')); pending.clear(); };
}
startWorker();
function request(cmd, args = {}) {
  return new Promise((resolve, reject) => { const id = ++counter; pending.set(id, { resolve, reject }); worker.postMessage({ id, cmd, args }); });
}
function error(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 10000); }
function setBusy(value, text) {
  busy = value; $('busy').hidden = !value; $('busy-text').textContent = text || 'Working on your model…';
  viewer.controls.enabled = !value;
  $('open').disabled = value; $('welcome-import').disabled = value;
  document.querySelectorAll('[data-example]').forEach(b => b.disabled = value);
  updateButtons();
}
function updateButtons() {
  const loaded = !!model;
  for (const id of ['download', 'diagnostics', 'apply-transform', 'smooth', 'refine', 'save-project']) $(id).disabled = !loaded || busy;
  $('save-step').disabled = !loaded || model.mode !== 'solid' || busy;
  $('apply-edge').disabled = !loaded || model.mode !== 'solid' || !selection.size || busy;
  $('undo').disabled = busy || !model?.canUndo; $('redo').disabled = busy || !model?.canRedo;
  $('convert').disabled = busy; $('convert').hidden = !loaded || model.mode !== 'mesh';
  document.querySelectorAll('.rail-button[data-tool]').forEach(b => b.disabled = busy);
}
function render(data, fit = false) {
  model = data; selection.clear();
  const dimensions = viewer.load(data, fit);
  $('welcome').hidden = true; $('model-empty').hidden = true; $('model-info').hidden = false;
  $('document-name').textContent = data.name;
  $('mode-badge').textContent = data.mode === 'solid' ? 'CAD SOLID' : 'STL MESH';
  $('model-state').textContent = data.mode === 'solid' ? 'Solid geometry' : 'Triangle mesh';
  ['x', 'y', 'z'].forEach((axis, k) => $(`dim-${axis}`).textContent = dimensions[k].toFixed(2));
  $('triangles').textContent = (data.positions.length / 9).toLocaleString();
  $('diagnostic-result').textContent = '';
  $('edge-help').textContent = data.mode === 'solid' ? 'Click an edge to select it. Selected curves glow green.' : 'STL stores triangles. Convert a closed mesh to a solid to attempt CAD edge finishes.';
  $('edge-total').textContent = `(${data.edges.length})`;
  const list = $('edge-list'); list.replaceChildren();
  data.edges.forEach((edge, index) => {
    const label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.dataset.index = index;
    check.addEventListener('change', () => selectEdge(index));
    label.append(check, document.createTextNode(`Edge ${index + 1} · ${edge.type.toLowerCase()}`)); list.append(label);
  });
  const history = $('history'); history.replaceChildren();
  data.history.forEach((text, index) => { const li = document.createElement('li'); li.textContent = text; li.className = index === data.cursor ? 'current' : index > data.cursor ? 'future' : ''; history.append(li); });
  $('status').textContent = `${data.history[data.cursor]} · ${(data.positions.length / 9).toLocaleString()} triangles`;
  updateSelection(); updateButtons();
}
function updateSelection() {
  viewer.setSelection([...selection]);
  $('selection-count').textContent = `${selection.size} ${selection.size === 1 ? 'edge' : 'edges'} selected`;
  $('edge-list').querySelectorAll('input').forEach(input => { input.checked = selection.has(Number(input.dataset.index)); input.parentElement.classList.toggle('selected', input.checked); });
  updateButtons();
}
function selectEdge(index) {
  if (busy || !model || model.mode !== 'solid') return;
  const indices = $('follow').checked ? tangentChain(model.edges, index) : [index];
  const remove = selection.has(index); indices.forEach(i => remove ? selection.delete(i) : selection.add(i)); updateSelection();
}
async function operate(cmd, args = {}, text = 'Updating your model…', fit = false) {
  if (busy) return;
  setBusy(true, text);
  try { const data = await request(cmd, args); render(data, fit); }
  catch (e) { error(e.message); }
  finally { setBusy(false); }
}
function number(id) { const input = $(id); if (input.value.trim() === '') throw new Error('Fill in all numeric fields.'); const value = Number(input.value); if (!Number.isFinite(value)) throw new Error('Enter a finite numeric value.'); return value; }
function withNumbers(action) { try { action(); } catch (e) { error(e.message); } }
async function importFile(file) {
  if (!file || busy) return;
  if (!/\.(stl|step|stp|me)$/i.test(file.name)) return error('Choose an STL, STEP, STP, or M.E. project file.');
  if (file.size > 80 * 1024 * 1024) return error('The maximum file size is 80 MB. Simplify this model before importing.');
  setBusy(true, /\.(step|stp)$/i.test(file.name) ? 'Loading the CAD kernel and model…' : 'Opening your model…');
  try { const buffer = await file.arrayBuffer(); render(await request('import', { name: file.name, buffer }), true); }
  catch (e) { error(e.message); }
  finally { setBusy(false); $('file-input').value = ''; }
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function exportModel(format) {
  if (!model || busy) return; setBusy(true, 'Preparing your download…');
  try { const data = await request('export', { format }); download(data.blob, `${model.name.replace(/\.[^.]+$/, '')}-edited.${data.extension}`); $('status').textContent = `Saved ${data.extension.toUpperCase()} · ${model.name}`; }
  catch (e) { error(e.message); } finally { setBusy(false); }
}
$('open').onclick = $('welcome-import').onclick = () => $('file-input').click();
$('file-input').onchange = e => importFile(e.target.files[0]);
document.querySelectorAll('[data-example]').forEach(b => b.onclick = () => operate('example', { kind: b.dataset.example }, 'Starting the CAD kernel…', true));
$('download').onclick = () => exportModel('stl'); $('save-project').onclick = () => exportModel('me'); $('save-step').onclick = () => exportModel('step');
$('apply-edge').onclick = () => withNumbers(() => operate(edgeOperation, { radius: number('edge-radius'), ids: [...selection].map(i => model.edges[i].id) }, `Building your ${edgeOperation}…`));
function setEdgeOperation(value) {
  edgeOperation = value; $('tab-fillet').classList.toggle('active', value === 'fillet'); $('tab-chamfer').classList.toggle('active', value === 'chamfer');
  $('radius-label').textContent = value === 'fillet' ? 'Radius' : 'Distance'; $('apply-edge').textContent = `Apply ${value}`;
}
$('tab-fillet').onclick = () => setEdgeOperation('fillet'); $('tab-chamfer').onclick = () => setEdgeOperation('chamfer');
$('clear-selection').onclick = () => { selection.clear(); updateSelection(); };
$('apply-transform').onclick = () => withNumbers(() => {
  operate('transform', { scale: number('scale'), translation: ['x', 'y', 'z'].map(a => number(`move-${a}`)), rotation: ['x', 'y', 'z'].map(a => number(`rotate-${a}`)) }, 'Transforming your model…', true);
});
$('smooth').onclick = () => operate('smooth', {}, 'Smoothing connected vertices…');
$('refine').onclick = () => operate('refine', {}, 'Refining the triangle mesh…');
$('convert').onclick = () => operate('convert', {}, 'Reconstructing a solid from triangles…');
$('undo').onclick = () => operate('undo'); $('redo').onclick = () => operate('redo');
$('diagnostics').onclick = async () => {
  if (!model || busy) return; setBusy(true, 'Checking mesh topology…');
  try { const d = await request('diagnostics'); $('diagnostic-result').textContent = `${d.open} open edges · ${d.nonManifold} non-manifold edges · ${d.degenerate} degenerate faces. ${d.open || d.nonManifold || d.degenerate ? 'Review in your slicer before printing.' : 'Closed topology. Review in your slicer for printability.'}`; }
  catch (e) { error(e.message); } finally { setBusy(false); }
};
function setTool(tool) {
  if (busy) return; viewer.setTool(tool);
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  if (tool === 'sculpt') $('status').textContent = 'Brush: drag to raise · Shift-drag to push inward · Refine coarse meshes first';
}
document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
$('brush-radius').onchange = () => withNumbers(() => viewer.brushRadius = number('brush-radius'));
$('fit').onclick = () => viewer.fit();
$('wireframe').onclick = () => $('wireframe').classList.toggle('active', viewer.toggleWireframe());
$('grid').onclick = () => $('grid').classList.toggle('active', viewer.toggleGrid());
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { viewer.fit(b.dataset.view); document.querySelectorAll('[data-view]').forEach(v => v.classList.toggle('active', v === b)); });
$('help').onclick = () => $('help-dialog').showModal(); $('close-help').onclick = () => $('help-dialog').close();
$('help-dialog').onclick = e => { if (e.target === $('help-dialog')) { const rect = e.target.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) e.target.close(); } };
$('cancel').onclick = async () => {
  worker.terminate(); const tasks = [...pending.values()]; pending.clear(); startWorker();
  tasks.forEach(task => task.reject(new Error('Operation cancelled. The previous model was restored; its earlier history was cleared.')));
  if (model) {
    const snapshot = { version: 1, name: model.name, positions: Array.from(model.positions), brep: model.brep };
    setTimeout(() => operate('import', { name: 'restored.me', buffer: new TextEncoder().encode(JSON.stringify(snapshot)).buffer }, 'Restoring the previous model…'), 0);
  }
};
let dragDepth = 0;
window.addEventListener('dragenter', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); dragDepth++; $('drop-overlay').hidden = false; } });
window.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
window.addEventListener('dragleave', () => { dragDepth--; if (dragDepth <= 0) $('drop-overlay').hidden = true; });
window.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; $('drop-overlay').hidden = true; importFile(e.dataTransfer.files[0]); });
window.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) || $('help-dialog').open) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (!(e.shiftKey ? $('redo') : $('undo')).disabled) operate(e.shiftKey ? 'redo' : 'undo'); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); if (!$('redo').disabled) operate('redo'); }
  if (e.key.toLowerCase() === 'f') viewer.fit();
  if (e.key.toLowerCase() === 'v') setTool('select'); if (e.key.toLowerCase() === 'o') setTool('orbit'); if (e.key.toLowerCase() === 'b') setTool('sculpt');
  if (e.key === 'Escape') { selection.clear(); updateSelection(); }
});
window.addEventListener('beforeunload', e => { if (model) { e.preventDefault(); e.returnValue = ''; } });
