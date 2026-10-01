// The kernel is worker-local. Shapes are serialized between jobs for safe cancellation/recovery.
import initOC from "opencascade.js/dist/opencascade.full.js";
import wasmUrl from "opencascade.js/dist/opencascade.full.wasm?url";
import { buildRevision, transformMatrix } from "./mesh";
import * as THREE from "three";
import type {
  GeometryRevision,
  JobRequest,
  Transform,
  Edge,
  Vec3,
} from "../types";
let ocPromise: Promise<any> | undefined;
export const cadModule = () =>
  (ocPromise ??= initOC({
    locateFile: () => wasmUrl,
    print: () => {},
    printErr: () => {},
  }));
export async function cadOperation(job: JobRequest) {
  const oc = await cadModule(),
    allocated: any[] = [];
  const own = <T>(v: T): T => {
    allocated.push(v);
    return v;
  };
  const progress = own(new oc.Message_ProgressRange_1());
  const enumValue = (v: any) => v?.value ?? v;
  const explore = (
    shape: any,
    type: any,
    fn: (item: any, index: number) => void,
  ) => {
    const ex = own(
      new oc.TopExp_Explorer_2(shape, type, oc.TopAbs_ShapeEnum.TopAbs_SHAPE),
    );
    let i = 0;
    while (ex.More()) {
      const item = own(ex.Current());
      fn(item, i++);
      ex.Next();
    }
  };
  const read = (g: GeometryRevision) => {
    if (!g.brep) throw new Error("CAD shape is missing.");
    const shape = own(new oc.TopoDS_Shape()),
      builder = own(new oc.BRep_Builder());
    oc.FS.writeFile("/input.brep", g.brep);
    if (!oc.BRepTools.Read_2(shape, "/input.brep", builder, progress))
      throw new Error("Cannot read native B-Rep snapshot.");
    oc.FS.unlink("/input.brep");
    return shape;
  };
  const transformed = (shape: any, t: Transform) => {
    if (
      t.position.every((v) => v === 0) &&
      t.rotation.every((v) => v === 0) &&
      t.scale.every((v) => v === 1)
    )
      return shape;
    const m = transformMatrix(t),
      uniform = t.scale.every(
        (v) => Math.abs(Math.abs(v) - Math.abs(t.scale[0])) < 1e-8,
      );
    if (uniform) {
      const tr = own(new oc.gp_Trsf_1());
      const values = [];
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 4; col++)
          values.push(m.elements[col * 4 + row]);
      tr.SetValues(...values);
      const op = own(new oc.BRepBuilderAPI_Transform_2(shape, tr, true));
      return own(op.Shape());
    }
    const tr = own(new oc.gp_GTrsf_1());
    for (let row = 1; row <= 3; row++)
      for (let col = 1; col <= 4; col++)
        tr.SetValue(row, col, m.elements[(col - 1) * 4 + row - 1]);
    tr.SetForm();
    const op = own(new oc.BRepBuilderAPI_GTransform_2(shape, tr, true));
    return own(op.Shape());
  };
  const boolean = (a: any, b: any, type: string) => {
    const Constructor =
      type === "union"
        ? oc.BRepAlgoAPI_Fuse_3
        : type === "subtract"
          ? oc.BRepAlgoAPI_Cut_3
          : oc.BRepAlgoAPI_Common_3;
    const op = own(new Constructor(a, b, progress));
    op.Build(progress);
    if (!op.IsDone()) throw new Error("CAD Boolean failed.");
    return own(op.Shape());
  };
  const serialize = (shape: any) => {
    if (!oc.BRepTools.Write_3(shape, "/output.brep", progress))
      throw new Error("Cannot serialize native shape.");
    const s = oc.FS.readFile("/output.brep", { encoding: "utf8" });
    oc.FS.unlink("/output.brep");
    return s;
  };
  const tessellate = (shape: any): GeometryRevision => {
    if (shape.IsNull()) throw new Error("Operation produced an empty shape.");
    const analyzer = own(new oc.BRepCheck_Analyzer(shape, true, false));
    if (!analyzer.IsValid_2())
      throw new Error("CAD operation produced invalid topology.");
    own(
      new oc.BRepMesh_IncrementalMesh_2(
        shape,
        job.params.tolerance || 0.05,
        false,
        0.15,
        false,
      ),
    );
    const positions: number[] = [],
      faceIds: number[] = [],
      planarFaceIds: number[] = [];
    explore(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, (item, id) => {
      const face = own(oc.TopoDS.Face_1(item)),
        loc = own(new oc.TopLoc_Location_1()),
        handle = own(oc.BRep_Tool.Triangulation(face, loc, 0));
      const surface = own(new oc.BRepAdaptor_Surface_2(face, true));
      if (
        enumValue(surface.GetType()) ===
        enumValue(oc.GeomAbs_SurfaceType.GeomAbs_Plane)
      )
        planarFaceIds.push(id);
      if (handle.IsNull()) return;
      const tri = handle.get(),
        tr = own(loc.Transformation());
      const reverse =
        enumValue(face.Orientation_1()) ===
        enumValue(oc.TopAbs_Orientation.TopAbs_REVERSED);
      for (let i = 1; i <= tri.NbTriangles(); i++) {
        const triangle = tri.Triangle(i);
        const indices = [
          triangle.Value(1),
          triangle.Value(reverse ? 3 : 2),
          triangle.Value(reverse ? 2 : 3),
        ];
        for (const idx of indices) {
          const p = tri.Node(idx);
          p.Transform(tr);
          positions.push(p.X(), p.Y(), p.Z());
          p.delete();
        }
        triangle.delete();
        faceIds.push(id);
      }
    });
    const revision = buildRevision(new Float32Array(positions), {
      kind: "brep",
      faceIds: new Int32Array(faceIds),
      planarFaceIds,
      brep: serialize(shape),
    });
    // Unique kernel edges; curved edges are displayed as sampled line segments with one kernel ID.
    const kernelEdges: Edge[] = [],
      seen: any[] = [],
      nativeRadii: Record<number, number> = {};
    explore(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, (item) => {
      const edge = own(oc.TopoDS.Edge_1(item));
      if (seen.some((e) => e.IsSame(edge))) return;
      const id = seen.length;
      seen.push(edge);
      if (oc.BRep_Tool.Degenerated(edge)) return;
      const curve = own(new oc.BRepAdaptor_Curve_2(edge)),
        first = curve.FirstParameter(),
        last = curve.LastParameter();
      if (!Number.isFinite(first) || !Number.isFinite(last)) return;
      if (
        enumValue(curve.GetType()) ===
        enumValue(oc.GeomAbs_CurveType.GeomAbs_Circle)
      ) {
        const circle = own(curve.Circle());
        nativeRadii[id] = circle.Radius();
      }
      const straight =
          enumValue(curve.GetType()) ===
          enumValue(oc.GeomAbs_CurveType.GeomAbs_Line),
        steps = straight ? 1 : 48;
      let previous: Vec3 | undefined;
      for (let i = 0; i <= steps; i++) {
        const p = curve.Value(first + ((last - first) * i) / steps),
          point: Vec3 = [p.X(), p.Y(), p.Z()];
        p.delete();
        if (previous)
          kernelEdges.push({
            a: previous,
            b: point,
            faces: [],
            angle: 180,
            kernelId: id,
          });
        previous = point;
      }
    });
    const loops: number[][] = [];
    explore(shape, oc.TopAbs_ShapeEnum.TopAbs_WIRE, (wire) => {
      const ids = new Set<number>();
      explore(wire, oc.TopAbs_ShapeEnum.TopAbs_EDGE, (edge) => {
        const id = seen.findIndex((e) => e.IsSame(edge));
        if (id >= 0) ids.add(id);
      });
      if (ids.size) loops.push([...ids]);
    });
    revision.nativeLoops = loops;
    revision.edges = kernelEdges;
    revision.nativeRadii = nativeRadii;
    return revision;
  };
  try {
    let result: any;
    if (job.operation === "primitive") {
      const p = job.params;
      const maker = own(
        p.shape === "cube"
          ? new oc.BRepPrimAPI_MakeBox_3(
              own(new oc.gp_Pnt_3(-p.width / 2, -p.depth / 2, 0)),
              p.width,
              p.depth,
              p.height,
            )
          : p.shape === "cylinder"
            ? new oc.BRepPrimAPI_MakeCylinder_1(p.radius, p.height)
            : new oc.BRepPrimAPI_MakeSphere_1(p.radius),
      );
      result = own(maker.Shape());
    } else {
      const input = job.inputs![0],
        local = read(input.geometry);
      if (["fillet", "chamfer"].includes(job.operation)) {
        const op = own(
          job.operation === "fillet"
            ? new oc.BRepFilletAPI_MakeFillet(
                local,
                oc.ChFi3d_FilletShape.ChFi3d_Rational,
              )
            : new oc.BRepFilletAPI_MakeChamfer(local),
        );
        const requested = new Set(
          (job.params.edges as number[]).map(
            (i) => input.geometry.edges[i]?.kernelId,
          ),
        );
        const seen: any[] = [];
        let count = 0;
        explore(local, oc.TopAbs_ShapeEnum.TopAbs_EDGE, (item) => {
          const edge = own(oc.TopoDS.Edge_1(item));
          if (seen.some((e) => e.IsSame(edge))) return;
          const id = seen.length;
          seen.push(edge);
          if (requested.has(id)) {
            op.Add_2(job.params.amount, edge);
            count++;
          }
        });
        if (!count) throw new Error("Select at least one native CAD edge.");
        op.Build(progress);
        if (!op.IsDone())
          throw new Error(
            "Cannot construct this blend. Reduce the size or change the edges.",
          );
        result = transformed(own(op.Shape()), input.transform);
      } else if (job.operation === "offset") {
        const ids = job.params.faces as number[];
        if (!ids?.length) throw new Error("Select a planar CAD face.");
        const faceId = input.geometry.faceIds![ids[0]];
        if (
          ids.length !==
            Array.from(input.geometry.faceIds!).filter((id) => id === faceId)
              .length ||
          ids.some((i) => input.geometry.faceIds![i] !== faceId)
        )
          throw new Error("Select one planar CAD face.");
        let selected: any;
        explore(local, oc.TopAbs_ShapeEnum.TopAbs_FACE, (item, id) => {
          if (id === faceId) selected = own(oc.TopoDS.Face_1(item));
        });
        const surf = own(new oc.BRepAdaptor_Surface_2(selected, true));
        if (
          enumValue(surf.GetType()) !==
          enumValue(oc.GeomAbs_SurfaceType.GeomAbs_Plane)
        )
          throw new Error("Offset supports planar CAD faces.");
        const n = input.geometry.faceNormals.subarray(
            ids[0] * 3,
            ids[0] * 3 + 3,
          ),
          amount = Number(job.params.amount);
        if (!amount) throw new Error("Enter a non-zero offset.");
        const vec = own(
            new oc.gp_Vec_4(n[0] * amount, n[1] * amount, n[2] * amount),
          ),
          prism = own(
            new oc.BRepPrimAPI_MakePrism_1(selected, vec, true, true),
          );
        result = transformed(
          boolean(local, own(prism.Shape()), amount > 0 ? "union" : "subtract"),
          input.transform,
        );
      } else if (job.operation === "split" && !job.inputs![1]) {
        // A finite half-space cutter encloses the body and avoids converting native solids to meshes.
        const b = input.geometry.bounds,
          p = job.params,
          axis = p.axis || "z",
          extent =
            Math.max(...b.max.map((v, i) => Math.abs(v - b.min[i]))) *
              Math.max(...input.transform.scale.map(Math.abs)) *
              20 +
            100;
        const matrix = transformMatrix(input.transform),
          corners = [];
        for (const x of [b.min[0], b.max[0]])
          for (const y of [b.min[1], b.max[1]])
            for (const z of [b.min[2], b.max[2]])
              corners.push(new THREE.Vector3(x, y, z).applyMatrix4(matrix));
        const world = new THREE.Box3().setFromPoints(corners),
          min = world.min.toArray().map((v) => v - extent),
          size = world
            .getSize(new THREE.Vector3())
            .toArray()
            .map((v) => v + extent * 2);
        const idx = axis === "x" ? 0 : axis === "y" ? 1 : 2;
        min[idx] = p.offset || 0;
        size[idx] = world.max.getComponent(idx) + extent - min[idx];
        if (size[idx] <= 0)
          throw new Error("Plane does not intersect this body.");
        const maker = own(
            new oc.BRepPrimAPI_MakeBox_3(own(new oc.gp_Pnt_3(...min)), ...size),
          ),
          a = transformed(local, input.transform),
          cutter = own(maker.Shape());
        return [
          tessellate(boolean(a, cutter, "intersect")),
          tessellate(boolean(a, cutter, "subtract")),
        ];
      } else {
        const a = transformed(local, input.transform),
          second = job.inputs![1],
          b = transformed(read(second.geometry), second.transform);
        if (job.operation === "split")
          return [
            tessellate(boolean(a, b, "intersect")),
            tessellate(boolean(a, b, "subtract")),
          ];
        result = boolean(a, b, job.operation);
      }
    }
    return [tessellate(result)];
  } finally {
    for (const object of allocated.reverse())
      try {
        object.delete();
      } catch {
        /* handles can alias */
      }
    for (const path of ["/input.brep", "/output.brep"])
      try {
        oc.FS.unlink(path);
      } catch {
        /* absent */
      }
  }
}
