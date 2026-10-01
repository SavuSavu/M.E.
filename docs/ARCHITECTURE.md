# M.E. architecture

M.E. is a static, local-processing application. React owns application panels;
Three.js owns the viewport. Geometry processing, import/export, brush refinement,
diagnostics and kernel calls execute in a module worker. Kernel resources are
lazy-loaded, bundled and served from the application's own origin.

## Reuse

BumpMesh is pinned at `ee02c390484d7d47c9023470380cba9a58f88299`.
See `src/vendor/bumpmesh/PROVENANCE.md`. Its selection, painting, welding,
diagnostics, repair, subdivision, decimation and section algorithms are directly
reused. Its viewer architecture informed the multi-body viewport. Its single-model
texturing application and pose-reversing export convention are not carried over.
The application is licensed AGPL-3.0-only; Three.js and Manifold retain their MIT
and Apache-2.0 notices, and OpenCascade.js retains LGPL-2.1 notices in its package.

## Document and topology

Bodies have persistent IDs, independent visibility, names, roles and transforms.
Immutable GeometryRevision records contain display triangles and derived mesh
topology. Native bodies additionally contain a serialized kernel B-Rep, a
triangle-to-CAD-face map, sampled CAD edges with kernel edge IDs, and analytic
circle radii. Imported STL remains triangle geometry. Mesh planar/tangent regions
and feature curves are inferred and do not become kernel entities.

Float32 display/import buffers use upstream 1e4 topology welding. The complete
edge incidence table is authoritative; non-manifold edges stop surface traversal.
BVH raycasting uses indirect indexing so triangle IDs stay attached to the source
triangle ordering. Plane matching checks both normal and seed-plane distance.

Mesh + mesh and mixed native/mesh operations use manifold-3d. Native operands are
tessellated for a mixed operation, and the result is explicitly a mesh. Native +
native operations use OpenCascade. CAD B-Rep snapshots stay authoritative even
when tessellation is used for selection and rendering. Uniform transforms preserve
analytic geometry; non-uniform transforms use the kernel's general transform and
must pass CAD validation at evaluation time.

## Worker lifecycle

The worker sends a ready handshake before receiving its first job. This is needed
because async module dependencies may otherwise consume an early message before
the event handler has been installed. Job responses include request and document
revision IDs. The UI rejects stale results and never commits a cancelled preview.

Synchronous WASM calls are cancelled by terminating the worker. The next job boots
another instance and rehydrates native geometry from B-Rep snapshots. Borrowed
kernel triangulation objects are not deleted; owned value objects, handles and
operation builders are disposed after each job. A three-minute timeout and
estimated 512 MB input-processing budget protect operation execution. Import and
project archive limits are 200 MB and 256 MB respectively. These are practical
bounds, not guarantees that every permitted model can complete a kernel operation.

## Commands and history

Each committed operation records before/after body and selection snapshots with
immutable geometry references. A brush gesture or gizmo drag is one undo action.
Redo branches are truncated after a new command. Original Boolean tools are kept
hidden, not discarded; their geometry is retained in history. Negative bodies are
reusable explicit tools, not automatic global subtraction objects.

History parameter editing and suppression replay affected operations in order.
Geometry outputs are rebuilt in the worker. Changed face/edge topology blocks
operations that require unresolved references rather than silently selecting
arbitrary new triangles. Failed replay retains the workspace's last valid result.
Full sketch constraints and topological naming are future capabilities.

## Project persistence

`.meproj` is a version-1 ZIP: `manifest.json`, original/revision position buffers,
CAD-face index buffers, and native B-Rep snapshots. The manifest contains bodies,
transforms, cutter roles, history and selection/paint data. Geometry topology is
rebuilt on load. Validation completes before the active document is replaced.
ZIP entry sizes are bounded to reduce decompression memory pressure. Local
recovery uses IndexedDB. Models are not sent to remote services.

STL export writes committed world coordinates and corrects mirrored winding.
Exporting multiple bodies together concatenates triangles; it is not a union.
Hidden or negative bodies are omitted from default export unless explicitly
selected. STL has no reliable unit metadata: imported coordinates are treated as
millimetres.

## Present limits

- STL-only file import/export. STEP is deliberately deferred.
- STL fillet/chamfer follows collinear welded feature segments between the same
  two perpendicular planar surfaces, stopping at corners. Several selected chains
  are processed atomically as swept cuts. Curved and concave STL blends are not
  supported; intersecting fillets do not construct exact rolling-ball corner patches.
  Native B-Rep blends continue to use the kernel's topological edges.

Edge picking measures distance in screen pixels and checks visibility against the
display mesh. Slightly offset rays avoid rejecting an edge when a silhouette ray
misses its front triangle. Picking works just outside the outline, under perspective
and after body transforms. Feature-edge lookup and welded connectivity are cached
per immutable revision. Selected edges use 4 px yellow lines with an 8 px dark
outline; hover uses cyan. The edge tool preserves prior edge/curve selections and
prompts to add adjoining edges where automatic straight continuation stops.

- Mesh face offset accepts one planar region with one simple closed boundary.
  Native face offset uses an exact prism and Boolean for a single planar face.
- Repair resolves small T-junctions. It does not fill arbitrary holes or recreate
  CAD surfaces.
- Native shape loading uses the lazy full OpenCascade WASM build (~50 MB raw,
  ~14 MB gzip). A reproducible minimal custom-build configuration is included as
  a packaging optimization; it must pass the same kernel regression tests before
  replacing this validated package build.
- Large-model performance and memory ceilings depend on geometry and browser.
  The one-million-triangle performance target must be assessed on real desktop
  hardware; a software-rendered CI browser is not a frame-rate reference.

## Recorded large-model check

`npm run benchmark` uses 1,002,528 planar triangles on an Intel i5-7500 machine
with 16 GB RAM. The October 2026 run built topology and an indirect BVH in 3.75 s,
averaged 0.050 ms for warm ray picking, and selected the complete planar region
in 1.15 s. The process reported 1,115 MB JS heap and 279 MB array buffers at that
point, including temporary allocations not yet collected. This is a CPU check;
it does not establish the 30 FPS hardware-rendering target. Worker transfer,
GPU upload and browser object-clone overhead are additional costs.

The adapter shares welded endpoint vectors and reuses upstream adjacency instead
of constructing a second copy. The upstream welder receives a smaller initial
allocation hint and grows as needed, preserving its exact welding semantics.
