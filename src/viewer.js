import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { geometryOf } from './mesh.js';

export class Viewer {
  constructor(container, callbacks) {
    this.container = container; this.callbacks = callbacks; this.tool = 'select'; this.edges = []; this.selected = new Set();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 10000); this.camera.up.set(0, 0, 1); this.camera.position.set(100, -120, 100);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.1;
    container.prepend(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.enableDamping = true; this.controls.dampingFactor = 0.09;
    this.controls.screenSpacePanning = true; this.controls.target.set(0, 0, 12);
    this.scene.add(new THREE.HemisphereLight(0xd4ecff, 0x263025, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.5); key.position.set(30, -60, 100); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xc0e9ff, 2.5); rim.position.set(-60, 40, 30); this.scene.add(rim);
    this.grid = new THREE.GridHelper(240, 24, 0x4a5a62, 0x354550); this.grid.rotation.x = Math.PI / 2;
    this.grid.material.transparent = true; this.grid.material.opacity = 0.15; this.scene.add(this.grid);
    this.edgeGroup = new THREE.Group(); this.scene.add(this.edgeGroup);
    this.ray = new THREE.Raycaster(); this.pointer = new THREE.Vector2();
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(container);
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', e => {
      this.down = [e.clientX, e.clientY];
      if (this.tool === 'sculpt' && e.button === 0 && this.mesh) {
        this.controls.enabled = false; this.stroke = []; this.strokeInward = e.shiftKey; canvas.setPointerCapture(e.pointerId); this.addStrokePoint(e);
      }
    });
    canvas.addEventListener('pointermove', e => { if (this.stroke) this.addStrokePoint(e); });
    canvas.addEventListener('pointerup', e => {
      if (this.stroke) {
        const points = this.stroke; this.stroke = null; this.controls.enabled = true;
        if (points.length) this.callbacks.onStroke(points, this.strokeInward); return;
      }
      if (this.tool !== 'select' || e.button !== 0 || !this.down || Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) > 5) return;
      this.cast(e);
      const surface = this.mesh ? this.ray.intersectObject(this.mesh)[0] : null;
      const hits = this.ray.intersectObjects(this.edgeGroup.children);
      const hit = hits.find(h => !surface || h.distance <= surface.distance + this.ray.params.Line.threshold * 1.5);
      if (hit) this.callbacks.onEdge(hit.object.userData.edgeIndex);
    });
    canvas.addEventListener('pointercancel', () => { this.stroke = null; this.controls.enabled = true; });
    this.renderer.setAnimationLoop(() => { this.controls.update(); this.renderer.render(this.scene, this.camera); });
  }
  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    this.renderer.setSize(width, height); this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
  }
  cast(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    this.ray.setFromCamera(this.pointer, this.camera);
    const perPixel = 2 * this.camera.position.distanceTo(this.controls.target) * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / rect.height;
    this.ray.params.Line.threshold = perPixel * 6;
  }
  addStrokePoint(e) {
    if (this.stroke.length >= 160) return;
    this.cast(e); const hit = this.ray.intersectObject(this.mesh)[0];
    if (hit) {
      const point = hit.point.toArray(), previous = this.stroke.at(-1);
      if (!previous || Math.hypot(...point.map((v, k) => v - previous[k])) > this.brushRadius / 5) this.stroke.push(point);
    }
  }
  load(data, fit = false) {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
    for (const line of [...this.edgeGroup.children]) { this.edgeGroup.remove(line); line.geometry.dispose(); line.material.dispose(); }
    const geometry = geometryOf(data.positions);
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xb9c9ad, metalness: 0.15, roughness: 0.36, side: THREE.DoubleSide, flatShading: true, wireframe: this.wireframe || false }));
    this.scene.add(this.mesh); this.edges = data.edges;
    data.edges.forEach((edge, index) => {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(edge.points, 3));
      const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x52644d, transparent: true, opacity: 0.65 }));
      line.userData.edgeIndex = index; this.edgeGroup.add(line);
    });
    this.setSelection([]);
    const box = geometry.boundingBox, size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z, 10);
    const center = box.getCenter(new THREE.Vector3());
    this.scene.remove(this.grid); this.grid.geometry.dispose(); this.grid.material.dispose();
    this.grid = new THREE.GridHelper(span * 5, 40, 0x56656d, 0x354550); this.grid.rotation.x = Math.PI / 2;
    this.grid.position.set(center.x, center.y, box.min.z - span * 0.002); this.grid.material.transparent = true; this.grid.material.opacity = 0.4;
    this.grid.visible = this.gridVisible !== false; this.scene.add(this.grid);
    if (fit) this.fit();
    return size.toArray();
  }
  setSelection(indices) {
    this.selected = new Set(indices);
    this.edgeGroup.children.forEach((line, i) => {
      line.material.color.set(this.selected.has(i) ? 0xc5ff77 : 0x52644d);
      line.material.opacity = this.selected.has(i) ? 1 : 0.65;
      line.material.depthTest = !this.selected.has(i); line.renderOrder = this.selected.has(i) ? 2 : 0;
    });
  }
  fit(view = 'iso') {
    if (!this.mesh) return;
    const box = this.mesh.geometry.boundingBox, center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 1);
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) / Math.min(this.camera.aspect, 1) * 1.15;
    const direction = ({ iso: new THREE.Vector3(1, -1.5, 1.05), top: new THREE.Vector3(0, -0.001, 1), front: new THREE.Vector3(0, -1, 0) })[view];
    this.camera.position.copy(center).addScaledVector(direction.normalize(), distance); this.controls.target.copy(center);
    this.camera.near = Math.max(radius / 10000, 0.001); this.camera.far = Math.max(distance * 100, 1000); this.camera.updateProjectionMatrix(); this.controls.update();
  }
  setTool(tool) { this.tool = tool; this.renderer.domElement.style.cursor = tool === 'sculpt' ? 'crosshair' : tool === 'orbit' ? 'grab' : 'default'; }
  toggleWireframe() { this.wireframe = !this.wireframe; if (this.mesh) this.mesh.material.wireframe = this.wireframe; return this.wireframe; }
  toggleGrid() { this.gridVisible = !this.grid.visible; this.grid.visible = this.gridVisible; return this.gridVisible; }
}
