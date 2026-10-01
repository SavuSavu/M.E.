import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import { SectionController } from "../vendor/bumpmesh/section.js";
import { buildExclusionOverlayGeo } from "../vendor/bumpmesh/exclusion.js";
import { useEditor } from "../state/editor";
import {
  bufferGeometry,
  transformedPositions,
  transformMatrix,
} from "../geometry/mesh";
import {
  surfaceSelection,
  edgeSelection,
  featureEdges,
  effectiveSelection,
} from "../geometry/selection";
import { runJob } from "../geometry/jobs";
import { report, importFiles } from "../state/operations";
import { emptySelection } from "../types";
import type { Body, Vec3 } from "../types";
const dispose = (object: THREE.Object3D) =>
  object.traverse((child) => {
    const o = child as THREE.Mesh;
    if (o.geometry) {
      (o.geometry as any).boundsTree?.dispose?.();
      o.geometry.dispose();
    }
    if (o.material)
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        m.dispose();
  });
export function Viewport() {
  const ref = useRef<HTMLDivElement>(null),
    state = useEditor();
  useEffect(() => {
    const host = ref.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });
    } catch {
      useEditor.getState().patch({
        error:
          "WebGL is unavailable. Enable hardware acceleration in your browser.",
      });
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor("#131d27");
    renderer.localClippingEnabled = true;
    host.prepend(renderer.domElement);
    const scene = new THREE.Scene(),
      ortho = new THREE.OrthographicCamera(-70, 70, 70, -70, 0.01, 100000),
      persp = new THREE.PerspectiveCamera(40, 1, 0.01, 100000);
    let camera: THREE.Camera = ortho;
    camera.up.set(0, 0, 1);
    camera.position.set(100, -140, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enableRotate = true;
    controls.zoomToCursor = true;
    controls.mouseButtons = {
      LEFT: undefined as any,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    controls.target.set(0, 0, 10);
    controls.update();
    scene.add(new THREE.HemisphereLight("#e3efff", "#58677b", 2.5));
    const sun = new THREE.DirectionalLight("#ffffff", 3);
    sun.position.set(70, -100, 140);
    scene.add(sun);
    const fill = new THREE.DirectionalLight("#87bfff", 1);
    fill.position.set(-80, 50, 50);
    scene.add(fill);
    const grid = new THREE.GridHelper(400, 40, "#3e5365", "#263848");
    grid.rotation.x = Math.PI / 2;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    scene.add(grid);
    const axes = new THREE.AxesHelper(35);
    scene.add(axes);
    const models = new THREE.Group(),
      overlays = new THREE.Group(),
      hoverEdges = new THREE.Group(),
      preview = new THREE.Group();
    scene.add(models, overlays, hoverEdges, preview);
    const gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.setSpace("world");
    gizmo.setSize(0.8);
    scene.add(gizmo.getHelper());
    const meshes = new Map<string, THREE.Mesh>(),
      cache = new Map<string, THREE.BufferGeometry>();
    let dirty = true,
      frame = 0,
      disposed = false,
      fitPending = false,
      hoverKey = "",
      lastEdgeHover = 0;
    const requestRender = () => {
      dirty = true;
    };
    const bounds = () => {
      const box = new THREE.Box3();
      for (const mesh of meshes.values())
        if (mesh.visible) box.expandByObject(mesh);
      return box.isEmpty()
        ? new THREE.Box3(
            new THREE.Vector3(-25, -25, 0),
            new THREE.Vector3(25, 25, 40),
          )
        : box;
    };
    const section = new SectionController({
      scene,
      camera: () => camera,
      domElement: renderer.domElement,
      requestRender,
      onDraggingChanged: (dragging: boolean) => {
        controls.enabled = !dragging;
      },
      bounds: () => {
        const box = bounds();
        return {
          center: box.getCenter(new THREE.Vector3()),
          diag: box.getSize(new THREE.Vector3()).length(),
        };
      },
    });
    let sectionProxy: THREE.Mesh | undefined;
    let sectionSettings:
      | { enabled: boolean; axis: string; offset: number }
      | undefined;
    const fit = () => {
      const box = bounds(),
        center = box.getCenter(new THREE.Vector3()),
        size = box.getSize(new THREE.Vector3()),
        radius = Math.max(size.length() / 2, 5),
        dir = camera.position.clone().sub(controls.target).normalize();
      controls.target.copy(center);
      camera.position.copy(center).addScaledVector(dir, radius * 3.6);
      ortho.zoom = 1;
      const ratio = host.clientWidth / Math.max(host.clientHeight, 1),
        half = radius * 1.25;
      ortho.top = half;
      ortho.bottom = -half;
      ortho.left = -half * ratio;
      ortho.right = half * ratio;
      ortho.updateProjectionMatrix();
      controls.update();
      requestRender();
    };
    const resize = () => {
      const width = host.clientWidth,
        height = host.clientHeight;
      renderer.setSize(width, height);
      persp.aspect = width / Math.max(height, 1);
      persp.updateProjectionMatrix();
      const half = ortho.top;
      ortho.left = -half * persp.aspect;
      ortho.right = half * persp.aspect;
      ortho.updateProjectionMatrix();
      requestRender();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    const geometryFor = (id: string) => {
      if (cache.has(id)) return cache.get(id)!;
      const g =
          useEditor.getState().geometries[id] ||
          useEditor.getState().previewGeometries[id],
        geometry = bufferGeometry(g.positions);
      geometry.setAttribute("normal", new THREE.BufferAttribute(g.normals, 3));
      (geometry as any).boundsTree = g.bvh
        ? MeshBVH.deserialize(g.bvh, geometry, { setIndex: false })
        : new MeshBVH(geometry, { indirect: true });
      cache.set(id, geometry);
      return geometry;
    };
    const clearGroup = (group: THREE.Group) => {
      for (const c of [...group.children]) {
        group.remove(c);
        dispose(c);
      }
    };
    const draw = () => {
      const s = useEditor.getState(),
        ids = new Set(s.bodies.map((b) => b.id));
      for (const [id, mesh] of meshes)
        if (!ids.has(id)) {
          models.remove(mesh);
          (mesh.material as THREE.Material).dispose();
          meshes.delete(id);
        }
      for (const b of s.bodies) {
        let mesh = meshes.get(b.id);
        if (!mesh) {
          mesh = new THREE.Mesh(
            geometryFor(b.geometryId),
            new THREE.MeshStandardMaterial({
              color: b.color,
              roughness: 0.48,
              metalness: 0.12,
              side: THREE.DoubleSide,
            }),
          );
          mesh.raycast = acceleratedRaycast;
          mesh.userData.bodyId = b.id;
          models.add(mesh);
          meshes.set(b.id, mesh);
        } else mesh.geometry = geometryFor(b.geometryId);
        mesh.visible = b.visible;
        mesh.position.set(...b.transform.position);
        mesh.rotation.set(...b.transform.rotation);
        mesh.scale.set(...b.transform.scale);
        mesh.updateMatrixWorld(true);
        const material = mesh.material as THREE.MeshStandardMaterial;
        material.color.set(b.role === "cutter" ? "#f29a74" : b.color);
        material.transparent = b.role === "cutter";
        material.opacity = b.role === "cutter" ? 0.42 : 1;
        material.wireframe = s.wireframe;
        material.emissive.set(
          s.selection.bodyIds.includes(b.id) ? "#153c37" : "#000000",
        );
        material.clippingPlanes = s.section ? [section.plane] : [];
      }
      gizmo.detach();
      const active = meshes.get(s.selection.bodyIds[0]);
      if (active && ["move", "rotate", "scale"].includes(s.tool)) {
        gizmo.attach(active);
        gizmo.setMode(
          s.tool === "move"
            ? "translate"
            : s.tool === "rotate"
              ? "rotate"
              : "scale",
        );
      }
      section.setSuppressed(["move", "rotate", "scale"].includes(s.tool));
      clearGroup(overlays);
      clearGroup(hoverEdges);
      hoverKey = "";
      const edgeMode = ["edge", "loop", "connected-edges", "curve"].includes(
        s.entity,
      );
      if (edgeMode)
        for (const body of s.bodies.filter(
          (b) => b.visible && s.selection.bodyIds.includes(b.id),
        )) {
          const g = s.geometries[body.geometryId],
            mesh = meshes.get(body.id)!;
          const points = featureEdges(g, s.selection.angle).flatMap((i) => [
            ...g.edges[i].a,
            ...g.edges[i].b,
          ]);
          const outline = new LineSegments2(
            new LineSegmentsGeometry().setPositions(points),
            new LineMaterial({
              color: "#334557",
              linewidth: 1.8,
              depthTest: true,
              depthWrite: false,
              polygonOffset: true,
              polygonOffsetFactor: -2,
            }),
          );
          outline.position.copy(mesh.position);
          outline.quaternion.copy(mesh.quaternion);
          outline.scale.copy(mesh.scale);
          outline.renderOrder = 3;
          overlays.add(outline);
        }
      const refs =
        edgeMode &&
        s.selection.mode === "exclude" &&
        !s.selection.refs.length &&
        s.selection.bodyIds[0]
          ? [
              {
                bodyId: s.selection.bodyIds[0],
                revision: s.bodies.find((b) => b.id === s.selection.bodyIds[0])!
                  .geometryId,
                kind: "edge",
                ids: [] as number[],
              },
            ]
          : s.selection.refs;
      for (const selection of refs) {
        const body = s.bodies.find((b) => b.id === selection.bodyId),
          mesh = meshes.get(selection.bodyId);
        if (!body || !mesh || selection.revision !== body.geometryId) continue;
        const g = s.geometries[body.geometryId];
        let object: THREE.Object3D;
        if (
          ["edge", "loop", "connected-edges", "curve"].includes(selection.kind)
        ) {
          const p = effectiveSelection(
              g,
              selection.ids,
              s.selection.mode,
              true,
              s.selection.angle,
            ).flatMap((i) =>
              g.edges[i] ? [...g.edges[i].a, ...g.edges[i].b] : [],
            ),
            group = new THREE.Group();
          for (const [color, linewidth] of [
            ["#101820", 8],
            ["#ffda60", 4],
          ] as const) {
            const line = new LineSegments2(
              new LineSegmentsGeometry().setPositions(p),
              new LineMaterial({
                color,
                linewidth,
                depthTest: false,
                depthWrite: false,
              }),
            );
            line.renderOrder = linewidth === 8 ? 5 : 6;
            group.add(line);
          }
          object = group;
        } else {
          const paint =
            s.selection.paint?.bodyId === body.id
              ? (s.selection.paint.data as any)
              : undefined;
          const geo = paint
            ? bufferGeometry(new Float32Array(paint.overlay))
            : buildExclusionOverlayGeo(
                mesh.geometry,
                new Set(selection.ids),
                s.selection.mode === "exclude",
              );
          object = new THREE.Mesh(
            geo,
            new THREE.MeshBasicMaterial({
              color: s.selection.mode === "exclude" ? "#ffad66" : "#ffc83d",
              transparent: true,
              opacity: 0.68,
              side: THREE.DoubleSide,
              depthWrite: false,
              polygonOffset: true,
              polygonOffsetFactor: -2,
            }),
          );
        }
        object.position.copy(mesh.position);
        object.quaternion.copy(mesh.quaternion);
        object.scale.copy(mesh.scale);
        object.renderOrder = 5;
        overlays.add(object);
      }
      // An empty Exclude mask means all of the active body is eligible.
      if (
        s.selection.mode === "exclude" &&
        !s.selection.refs.length &&
        !edgeMode &&
        active
      ) {
        const object = new THREE.Mesh(
          active.geometry.clone(),
          new THREE.MeshBasicMaterial({
            color: "#56d9ba",
            transparent: true,
            opacity: 0.18,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        object.matrix.copy(active.matrix);
        object.matrixAutoUpdate = false;
        overlays.add(object);
      }
      for (const b of s.bodies)
        if (b.visible) {
          const g = s.geometries[b.geometryId],
            bad = g.edges.filter(
              (e) => e.faces.length === 1 || e.faces.length > 2,
            );
          if (bad.length) {
            const object = new THREE.LineSegments(
              bufferGeometry(
                new Float32Array(bad.flatMap((e) => [...e.a, ...e.b])),
              ),
              new THREE.LineBasicMaterial({ color: "#f2856b" }),
            );
            object.matrix.copy(meshes.get(b.id)!.matrix);
            object.matrixAutoUpdate = false;
            overlays.add(object);
          }
        }
      clearGroup(preview);
      for (const b of s.preview) {
        const g = s.previewGeometries[b.geometryId],
          object = new THREE.Mesh(
            bufferGeometry(g.positions),
            new THREE.MeshStandardMaterial({
              color: "#58dfbc",
              transparent: true,
              opacity: 0.6,
              side: THREE.DoubleSide,
              roughness: 0.4,
            }),
          );
        object.geometry.computeVertexNormals();
        preview.add(object);
      }
      if (s.section) {
        if (sectionProxy) {
          sectionProxy.geometry.dispose();
        }
        const arrays = s.bodies
            .filter((b) => b.visible)
            .map((b) =>
              transformedPositions(s.geometries[b.geometryId], b.transform),
            ),
          p = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
        let off = 0;
        for (const a of arrays) {
          p.set(a, off);
          off += a.length;
        }
        sectionProxy ??= new THREE.Mesh(
          undefined,
          new THREE.MeshStandardMaterial(),
        );
        sectionProxy.geometry = bufferGeometry(p);
        section.setTarget(sectionProxy);
        section.setEnabled(true);
        if (!sectionSettings?.enabled || sectionSettings.axis !== s.sectionAxis)
          section.setAxis(s.sectionAxis);
        if (
          !sectionSettings?.enabled ||
          sectionSettings.axis !== s.sectionAxis ||
          sectionSettings.offset !== s.sectionOffset
        ) {
          (section as any)._proxy.position[s.sectionAxis] = s.sectionOffset;
          (section as any)._sync();
        }
        (section as any)._buildQuad();
      } else section.setEnabled(false);
      sectionSettings = {
        enabled: s.section,
        axis: s.sectionAxis,
        offset: s.sectionOffset,
      };
      overlays.traverse((o) => {
        const material = (o as THREE.Mesh).material;
        if (material && !Array.isArray(material))
          material.clippingPlanes = s.section ? [section.plane] : [];
      });
      for (const [id, geometry] of cache)
        if (!s.geometries[id] && !s.previewGeometries[id]) {
          geometry.dispose();
          cache.delete(id);
        }
      requestRender();
      if (!fitPending && s.bodies.length && meshes.size === s.bodies.length) {
        fitPending = true;
        fit();
      }
    };
    let drawing = false,
      down: { x: number; y: number } | null = null,
      stroke: any[] = [],
      strokeBody: string | undefined,
      dragBody: Body | undefined;
    gizmo.addEventListener("dragging-changed", (e) => {
      controls.enabled = !e.value;
      if (e.value) {
        const s = useEditor.getState();
        dragBody = structuredClone(
          s.bodies.find((b) => b.id === s.selection.bodyIds[0]),
        );
      } else if (dragBody) {
        const mesh = meshes.get(dragBody.id)!;
        const transform = {
          position: mesh.position.toArray() as Vec3,
          rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z] as Vec3,
          scale: mesh.scale.toArray() as Vec3,
        };
        if (transform.scale.some((v) => Math.abs(v) < 1e-5)) {
          draw();
          return;
        }
        useEditor
          .getState()
          .updateBody(
            dragBody.id,
            { transform },
            `${useEditor.getState().tool} ${dragBody.name}`,
            "transform",
          );
        dragBody = undefined;
      }
    });
    gizmo.addEventListener("change", requestRender);
    controls.addEventListener("change", requestRender);
    const raycaster = new THREE.Raycaster(),
      ndc = new THREE.Vector2();
    const hits = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      return raycaster
        .intersectObjects(
          [...meshes.values()].filter((m) => m.visible),
          false,
        )
        .filter((h) => !section.clips(h.point));
    };
    const paintSample = (e: PointerEvent) => {
      const s = useEditor.getState(),
        found = hits(e);
      for (const hit of s.selection.through ? found : found.slice(0, 1)) {
        const bodyId = hit.object.userData.bodyId;
        if (strokeBody && strokeBody !== bodyId) continue;
        strokeBody = bodyId;
        const mesh = hit.object as THREE.Mesh,
          point = mesh.worldToLocal(hit.point.clone()),
          view = camera
            .getWorldDirection(new THREE.Vector3())
            .transformDirection(mesh.matrixWorld.clone().invert());
        const previous = s.selection.through
          ? undefined
          : stroke[stroke.length - 1];
        if (s.selection.through) view.copy(hit.face!.normal).negate();
        stroke.push({
          face: hit.faceIndex,
          from: previous?.to || point,
          to: point,
          view,
        });
      }
      requestRender();
    };
    const findEdge = (e: PointerEvent) => {
      const s = useEditor.getState(),
        rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
      const candidates: {
        bodyId: string;
        id: number;
        point: THREE.Vector3;
        screen: THREE.Vector2;
        distance: number;
        depth: number;
      }[] = [];
      const objects = [...meshes.values()].filter((m) => m.visible);
      for (const mesh of objects) {
        const body = s.bodies.find((b) => b.id === mesh.userData.bodyId)!;
        const g = s.geometries[body.geometryId],
          normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
        for (const id of featureEdges(g, s.selection.angle)) {
          const edge = g.edges[id],
            a = new THREE.Vector3(...edge.a).applyMatrix4(mesh.matrixWorld),
            b = new THREE.Vector3(...edge.b).applyMatrix4(mesh.matrixWorld),
            pa = a.clone().project(camera),
            pb = b.clone().project(camera);
          if (Math.min(pa.z, pb.z) > 1 || Math.max(pa.z, pb.z) < -1) continue;
          const start = new THREE.Vector2(
              ((pa.x + 1) * rect.width) / 2,
              ((1 - pa.y) * rect.height) / 2,
            ),
            end = new THREE.Vector2(
              ((pb.x + 1) * rect.width) / 2,
              ((1 - pb.y) * rect.height) / 2,
            ),
            delta = end.clone().sub(start);
          const t = Math.max(
            0,
            Math.min(
              1,
              pointer.clone().sub(start).dot(delta) / (delta.lengthSq() || 1),
            ),
          );
          const at = start.clone().addScaledVector(delta, t),
            distance = at.distanceTo(pointer);
          if (distance > 12) continue;
          const wa = -a.clone().applyMatrix4(camera.matrixWorldInverse).z;
          const wb = -b.clone().applyMatrix4(camera.matrixWorldInverse).z;
          const worldT =
            camera instanceof THREE.PerspectiveCamera
              ? (t * wa) / ((1 - t) * wb + t * wa)
              : t;
          const point = a.clone().lerp(b, worldT);
          if (section.clips(point)) continue;
          const towardCamera =
            camera instanceof THREE.OrthographicCamera
              ? camera.getWorldDirection(new THREE.Vector3()).negate()
              : camera.position.clone().sub(point).normalize();
          if (
            g.kind === "mesh" &&
            !edge.faces.some(
              (f) =>
                new THREE.Vector3()
                  .fromArray(g.faceNormals, f * 3)
                  .applyMatrix3(normalMatrix)
                  .normalize()
                  .dot(towardCamera) > 1e-6,
            )
          )
            continue;
          candidates.push({
            bodyId: body.id,
            id,
            point,
            screen: at,
            distance,
            depth: camera.position.distanceTo(point),
          });
        }
      }
      candidates.sort((a, b) => a.distance - b.distance || a.depth - b.depth);
      for (const candidate of candidates) {
        const perPixel =
          camera instanceof THREE.OrthographicCamera
            ? (camera.top - camera.bottom) / camera.zoom / rect.height
            : (candidate.depth *
                2 *
                Math.tan(
                  THREE.MathUtils.degToRad(
                    (camera as THREE.PerspectiveCamera).fov / 2,
                  ),
                )) /
              rect.height;
        // Rays exactly on a silhouette can miss the front triangle and hit its
        // rear face. Probe slightly into adjacent faces before declaring occlusion.
        const mesh = meshes.get(candidate.bodyId)!,
          body = s.bodies.find((b) => b.id === candidate.bodyId)!,
          g = s.geometries[body.geometryId];
        const probes = [candidate.screen];
        for (const f of g.edges[candidate.id].faces) {
          const center = new THREE.Vector3()
            .fromArray(g.centroids, f * 3)
            .applyMatrix4(mesh.matrixWorld)
            .project(camera);
          const offset = new THREE.Vector2(
            ((center.x + 1) * rect.width) / 2,
            ((1 - center.y) * rect.height) / 2,
          )
            .sub(candidate.screen)
            .normalize();
          probes.push(candidate.screen.clone().add(offset));
        }
        for (const offset of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ])
          probes.push(
            candidate.screen.clone().add(new THREE.Vector2(...offset)),
          );
        let found = false;
        for (const probe of probes) {
          raycaster.setFromCamera(
            new THREE.Vector2(
              (probe.x / rect.width) * 2 - 1,
              1 - (probe.y / rect.height) * 2,
            ),
            camera,
          );
          const front = raycaster
            .intersectObjects(objects, false)
            .find((h) => !section.clips(h.point));
          if (!front) continue;
          found = true;
          if (
            front.object.userData.bodyId === candidate.bodyId &&
            front.point.distanceTo(candidate.point) <=
              Math.max(perPixel * 3, 1e-4)
          )
            return candidate;
        }
        if (!found) return candidate;
      }
    };
    const handlePick = async (e: PointerEvent) => {
      const s = useEditor.getState();
      if (s.busy) return;
      const edgeMode =
        ["edge", "loop", "connected-edges", "curve"].includes(s.entity) &&
        s.tool === "select";
      const pickedEdge = edgeMode ? findEdge(e) : undefined;
      const hit = pickedEdge
        ? ({
            object: meshes.get(pickedEdge.bodyId)!,
            point: pickedEdge.point,
            distance: pickedEdge.depth,
            faceIndex: 0,
          } as THREE.Intersection)
        : hits(e)[0];
      if (edgeMode && !pickedEdge) {
        s.patch({
          notice:
            "Click near a visible feature edge. Corners and boundaries are pickable from either side.",
        });
        return;
      }
      if (!hit) {
        s.selectBodies([]);
        return;
      }
      const bodyId = hit.object.userData.bodyId,
        body = s.bodies.find((b) => b.id === bodyId)!,
        g = s.geometries[body.geometryId],
        mesh = hit.object as THREE.Mesh;
      if (s.tool === "measure") {
        const measurements = [
          ...s.measurements,
          { point: hit.point.toArray(), bodyId },
        ].slice(-3);
        s.patch({
          measurements,
          notice:
            measurements.length >= 2
              ? `Distance: ${new THREE.Vector3(...measurements[0].point).distanceTo(new THREE.Vector3(...measurements[1].point)).toFixed(3)} mm`
              : "Pick another point to measure",
        });
        return;
      }
      if (s.tool === "place" || s.tool === "align") {
        const moving = s.bodies.find((b) => b.id === s.selection.bodyIds[0]);
        if (!moving) {
          s.selectBodies([bodyId]);
          s.patch({ notice: "Now select the face to place or align." });
          return;
        }
        const normal = hit
          .face!.normal.clone()
          .applyNormalMatrix(
            new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld),
          )
          .normalize();
        const movingMesh = meshes.get(moving.id)!;
        let rotation: THREE.Quaternion, position: Vec3;
        if (s.tool === "place") {
          if (moving.id !== bodyId) {
            report(
              new Error(
                "Pick a face on the selected body to place it on the ground.",
              ),
            );
            return;
          }
          rotation = new THREE.Quaternion()
            .setFromUnitVectors(normal, new THREE.Vector3(0, 0, -1))
            .multiply(movingMesh.quaternion);
          const temp = new THREE.Mesh(movingMesh.geometry);
          temp.quaternion.copy(rotation);
          temp.scale.copy(movingMesh.scale);
          const box = new THREE.Box3().setFromObject(temp);
          position = [
            moving.transform.position[0],
            moving.transform.position[1],
            -box.min.z,
          ];
        } else {
          if (moving.id === bodyId) {
            report(new Error("Choose a face on another body for alignment."));
            return;
          }
          const sourceGeometry = s.geometries[moving.geometryId],
            sourceRef = s.selection.refs.find(
              (r) =>
                r.bodyId === moving.id &&
                r.ids.length &&
                !["edge", "loop", "curve", "connected-edges"].includes(r.kind),
            );
          const sourceNormal = sourceRef
            ? new THREE.Vector3().fromArray(
                sourceGeometry.faceNormals,
                sourceRef.ids[0] * 3,
              )
            : new THREE.Vector3(0, 0, -1);
          sourceNormal
            .applyNormalMatrix(
              new THREE.Matrix3().getNormalMatrix(movingMesh.matrixWorld),
            )
            .normalize();
          rotation = new THREE.Quaternion()
            .setFromUnitVectors(sourceNormal, normal.clone().negate())
            .multiply(movingMesh.quaternion);
          const sourcePoint = sourceRef
            ? new THREE.Vector3().fromArray(
                sourceGeometry.centroids,
                sourceRef.ids[0] * 3,
              )
            : new THREE.Vector3(
                (sourceGeometry.bounds.min[0] + sourceGeometry.bounds.max[0]) /
                  2,
                (sourceGeometry.bounds.min[1] + sourceGeometry.bounds.max[1]) /
                  2,
                sourceGeometry.bounds.min[2],
              );
          sourcePoint.multiply(movingMesh.scale).applyQuaternion(rotation);
          position = hit.point.clone().sub(sourcePoint).toArray() as Vec3;
        }
        const angles = new THREE.Euler().setFromQuaternion(rotation);
        s.updateBody(
          moving.id,
          {
            transform: {
              ...moving.transform,
              position,
              rotation: [angles.x, angles.y, angles.z],
            },
          },
          s.tool === "place" ? "Place on face" : "Align to face",
          "transform",
        );
        s.patch({ tool: "select" });
        return;
      }
      if (s.entity === "body") {
        const ids = e.shiftKey
          ? s.selection.bodyIds.filter((id) => id !== bodyId)
          : e.ctrlKey || e.metaKey
            ? [...new Set([...s.selection.bodyIds, bodyId])]
            : [bodyId];
        s.selectBodies(ids);
        return;
      }
      let ids: number[] = [];
      if (["edge", "loop", "connected-edges", "curve"].includes(s.entity)) {
        if (!pickedEdge) return;
        ids = edgeSelection(g, pickedEdge.id, s.entity, s.selection.angle);
      } else if (g.diagnostics.triangles > 10000) {
        s.patch({ busy: { message: "Selecting surface", progress: 0 } });
        try {
          const result = await runJob({
            revision: s.revision,
            operation: "select",
            params: {
              seed: hit.faceIndex,
              mode: s.entity,
              angle: s.selection.angle,
            },
            inputs: [{ geometry: g, transform: body.transform }],
          });
          ids = result.data as number[];
          if (useEditor.getState().revision !== s.revision) return;
        } catch (error) {
          report(error);
          return;
        } finally {
          s.patch({ busy: null });
        }
      } else
        ids = surfaceSelection(g, hit.faceIndex!, s.entity, s.selection.angle);
      const before = s.selection;
      s.selectEntities(
        bodyId,
        ids,
        s.entity,
        e.shiftKey,
        e.ctrlKey || e.metaKey || ["fillet", "chamfer"].includes(s.panel || ""),
      );
      const after = useEditor.getState().selection;
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        s.patch({ selection: before });
        s.commit("Select region", "selection", {}, s.bodies, [], after);
      }
    };
    const onDown = (e: PointerEvent) => {
      const s = useEditor.getState();
      controls.mouseButtons.RIGHT = e.ctrlKey
        ? THREE.MOUSE.PAN
        : THREE.MOUSE.ROTATE;
      if (e.button !== 0) return;
      if (gizmo.axis || section.busy() || s.busy) return;
      clearGroup(hoverEdges);
      hoverKey = "";
      down = { x: e.clientX, y: e.clientY };
      requestRender();
      if (s.brush) {
        drawing = true;
        stroke = [];
        strokeBody = undefined;
        controls.enabled = false;
        renderer.domElement.setPointerCapture(e.pointerId);
        paintSample(e);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (drawing) {
        paintSample(e);
        return;
      }
      if (gizmo.dragging || useEditor.getState().busy) return;
      if (e.buttons && hoverKey) {
        clearGroup(hoverEdges);
        hoverKey = "";
        requestRender();
      }
      const state = useEditor.getState();
      if (
        ["edge", "loop", "connected-edges", "curve"].includes(state.entity) &&
        state.tool === "select" &&
        !e.buttons
      ) {
        if (performance.now() - lastEdgeHover < 50) return;
        lastEdgeHover = performance.now();
        const candidate = findEdge(e),
          key = candidate ? `${candidate.bodyId}:${candidate.id}` : "";
        renderer.domElement.style.cursor = candidate ? "pointer" : "crosshair";
        if (key !== hoverKey) {
          clearGroup(hoverEdges);
          hoverKey = key;
          if (candidate) {
            const body = state.bodies.find((b) => b.id === candidate.bodyId)!,
              g = state.geometries[body.geometryId],
              mesh = meshes.get(body.id)!;
            const ids = edgeSelection(
              g,
              candidate.id,
              "edge",
              state.selection.angle,
            );
            const points = ids.flatMap((i) => [
              ...g.edges[i].a,
              ...g.edges[i].b,
            ]);
            for (const [color, linewidth] of [
              ["#101820", 7],
              ["#54dfff", 3],
            ] as const) {
              const line = new LineSegments2(
                new LineSegmentsGeometry().setPositions(points),
                new LineMaterial({
                  color,
                  linewidth,
                  depthTest: false,
                  depthWrite: false,
                  clippingPlanes: state.section ? [section.plane] : [],
                }),
              );
              line.position.copy(mesh.position);
              line.quaternion.copy(mesh.quaternion);
              line.scale.copy(mesh.scale);
              line.renderOrder = 4;
              hoverEdges.add(line);
            }
            state.patch({
              hover: `${body.name} · Edge · ${ids.length} segment${ids.length === 1 ? "" : "s"} · Click to add, Shift to remove`,
            });
          } else state.patch({ hover: "" });
          requestRender();
        } else if (!candidate && state.hover) state.patch({ hover: "" });
        return;
      }
      renderer.domElement.style.cursor = "default";
      const hit = hits(e)[0],
        s = useEditor.getState(),
        text = hit
          ? `${s.bodies.find((b) => b.id === hit.object.userData.bodyId)?.name} · triangle ${(hit.faceIndex || 0) + 1}`
          : "";
      if (s.hover !== text) s.patch({ hover: text });
    };
    const onUp = async (e: PointerEvent) => {
      if (e.button !== 0) return;
      const s = useEditor.getState();
      if (drawing) {
        drawing = false;
        controls.enabled = true;
        renderer.domElement.releasePointerCapture(e.pointerId);
        if (!strokeBody || !stroke.length) return;
        const body = s.bodies.find((b) => b.id === strokeBody)!,
          g = s.geometries[body.geometryId],
          before = s.selection,
          ref = s.selection.refs.find((r) => r.bodyId === body.id),
          previous =
            s.selection.paint?.bodyId === body.id
              ? (s.selection.paint.data as any).serialized
              : undefined;
        const scale = Math.max(...body.transform.scale.map(Math.abs));
        s.patch({ busy: { message: "Painting selection", progress: 0 } });
        try {
          const result = await runJob({
            revision: s.revision,
            operation: "paint",
            inputs: [{ geometry: g, transform: body.transform }],
            params: {
              samples: stroke,
              radius: s.selection.brushRadius / scale,
              erase: e.shiftKey,
              previous,
              faces: ref?.ids,
              mode: s.selection.mode,
            },
          });
          if (useEditor.getState().revision !== s.revision) return;
          const data = result.data as any,
            selection = {
              ...before,
              bodyIds: [body.id],
              refs: data.ids.length
                ? [
                    {
                      bodyId: body.id,
                      revision: g.id,
                      kind: "brush" as const,
                      ids: data.ids,
                    },
                  ]
                : [],
              paint: { bodyId: body.id, revision: g.id, data },
            };
          s.commit("Brush selection", "selection", {}, s.bodies, [], selection);
        } catch (error) {
          report(error);
        } finally {
          s.patch({ busy: null });
        }
        return;
      }
      if (
        down &&
        Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4 &&
        !gizmo.axis &&
        !section.busy()
      )
        handlePick(e);
      down = null;
    };
    const onLeave = () => {
      clearGroup(hoverEdges);
      hoverKey = "";
      requestRender();
      useEditor.getState().patch({ hover: "" });
    };
    const onContext = (e: Event) => e.preventDefault();
    renderer.domElement.addEventListener("pointerdown", onDown, {
      capture: true,
    });
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("contextmenu", onContext);
    let middleClick = 0;
    const onMiddle = (e: PointerEvent) => {
      if (e.button === 1) {
        const now = performance.now();
        if (now - middleClick < 350) fit();
        middleClick = now;
      }
    };
    renderer.domElement.addEventListener("pointerdown", onMiddle);
    const onView = (event: Event) => {
      const name = (event as CustomEvent<string>).detail;
      const directions: Record<string, Vec3> = {
        Front: [0, -1, 0],
        Back: [0, 1, 0],
        Left: [-1, 0, 0],
        Right: [1, 0, 0],
        Top: [0, 0, 1],
        Bottom: [0, 0, -1],
        Isometric: [1, -1, 0.8],
      };
      const dir = new THREE.Vector3(...directions[name]).normalize(),
        distance = camera.position.distanceTo(controls.target);
      camera.up.set(
        0,
        Math.abs(dir.z) === 1 ? 1 : 0,
        Math.abs(dir.z) === 1 ? 0 : 1,
      );
      camera.position.copy(controls.target).addScaledVector(dir, distance);
      controls.update();
      requestRender();
    };
    const onProjection = () => {
      const next = useEditor.getState().perspective ? persp : ortho;
      if (next !== camera) {
        next.position.copy(camera.position);
        next.quaternion.copy(camera.quaternion);
        next.up.copy(camera.up);
        camera = next;
        controls.object = camera;
        gizmo.camera = camera;
        section.setCamera(camera);
        fit();
      }
    };
    const unsub = useEditor.subscribe((s, old) => {
      if (s.perspective !== old.perspective) onProjection();
      if (
        s.bodies !== old.bodies ||
        s.selection !== old.selection ||
        s.tool !== old.tool ||
        s.section !== old.section ||
        s.sectionAxis !== old.sectionAxis ||
        s.sectionOffset !== old.sectionOffset ||
        s.wireframe !== old.wireframe ||
        s.preview !== old.preview ||
        s.entity !== old.entity
      )
        draw();
    });
    const onSpace = (e: Event) =>
      gizmo.setSpace((e as CustomEvent<"world" | "local">).detail);
    window.addEventListener("me-space", onSpace);
    window.addEventListener("me-fit", fit);
    window.addEventListener("me-view", onView);
    const keys = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,[contenteditable="true"]',
        )
      )
        return;
      if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        fit();
      }
      if (e.key === "Escape") {
        useEditor.getState().patch({
          tool: "select",
          brush: false,
          panel: null,
          preview: [],
          previewGeometries: {},
        });
        gizmo.detach();
      }
    };
    window.addEventListener("keydown", keys);
    const animate = () => {
      if (disposed) return;
      frame = requestAnimationFrame(animate);
      controls.update();
      if (dirty) {
        renderer.render(scene, camera);
        dirty = false;
      }
    };
    draw();
    animate();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      unsub();
      observer.disconnect();
      window.removeEventListener("me-space", onSpace);
      window.removeEventListener("me-fit", fit);
      window.removeEventListener("me-view", onView);
      window.removeEventListener("keydown", keys);
      controls.dispose();
      gizmo.dispose();
      section.setEnabled(false);
      dispose(scene);
      for (const g of cache.values()) g.dispose();
      sectionProxy?.geometry.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return (
    <div
      ref={ref}
      className="viewport"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void importFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="viewport-label">
        <span className="live-dot" />{" "}
        {state.perspective ? "PERSPECTIVE" : "ORTHOGRAPHIC"}{" "}
        <span className="divider-dot">/</span> MILLIMETRES
      </div>
      <div className="view-cube" aria-label="View controls">
        <button
          onClick={() =>
            window.dispatchEvent(new CustomEvent("me-view", { detail: "Top" }))
          }
        >
          TOP
        </button>
        <div>
          <button
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("me-view", { detail: "Front" }),
              )
            }
          >
            FRONT
          </button>
          <button
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("me-view", { detail: "Right" }),
              )
            }
          >
            RIGHT
          </button>
        </div>
        <button
          className="iso"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("me-view", { detail: "Isometric" }),
            )
          }
        >
          ↗ ISO
        </button>
      </div>
      {!state.bodies.length && (
        <div className="empty-view">
          <div className="empty-glyph">
            M<span>.</span>E<span>.</span>
          </div>
          <h2>A workspace for your next idea.</h2>
          <p>Drop STL files here, or create your first solid.</p>
          <span>Local processing · Your models stay on this device</span>
        </div>
      )}
      <div className="navigation-hint">
        <span>
          RMB <b>Orbit</b>
        </span>
        <span>
          MMB <b>Pan</b>
        </span>
        <span>
          Scroll <b>Zoom</b>
        </span>
        <span>
          F <b>Fit</b>
        </span>
      </div>
    </div>
  );
}
