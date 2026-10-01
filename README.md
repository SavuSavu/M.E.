# M.E. — Model-Editor

[Open the editor on GitHub Pages](https://savusavu.github.io/M.E./).

A browser-based editor for modifying existing STL models. Import several models,
select surfaces or edges, move and scale bodies, cut with another object, and save
an editable workspace. Geometry stays on your device.

M.E. adapts the mesh selection and processing foundations of
[BumpMesh by CNC Kitchen](https://github.com/CNCKitchen/stlTexturizer), with
[Three.js](https://threejs.org/), [Manifold](https://github.com/elalish/manifold)
and [OpenCascade.js](https://github.com/donalffons/opencascade.js).

## Run

Requires Node.js 22.12+.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite (normally http://localhost:5173).

```sh
npm run build        # TypeScript check + static production assets
npm run preview      # Serve the production build
npm test             # Geometry regression tests
npx playwright install chromium
npm run test:e2e     # Browser workflows, including both WASM kernels
```

Host `dist/` on any static web server. Serve `.wasm` as `application/wasm` and
compress static assets with gzip or Brotli. Fonts, code and geometry kernels are
bundled locally; no CDN requests are needed at runtime. The CAD kernel loads
when the first native solid operation is used.

The GitHub Actions workflow tests the editor and production assets before deploying
`master` to Pages. The production build uses `/M.E./` for all assets and worker
resources. To reproduce the hosted build locally:

```sh
npm run build:pages
npm run test:pages
```

Run the same browser smoke test against a deployed site with
`ME_TEST_BASE_URL=https://savusavu.github.io/M.E./ npm run test:pages`.

## Editing

- Multi-file ASCII/binary STL import with preserved coordinates and diagnostics.
- Object tree: visibility, rename, duplicate, delete and negative/cutter role.
- Body/triangle/CAD-face, connected/planar/tangent surface, edge, loop, connected
  edge and feature/curve selection. Configurable angle thresholds, Include Only,
  Exclude, brush, fill, Clear All and Shift erasure.
- Move, rotate, uniform/per-axis scale, Mirror X, align and place-on-face.
- Union/subtract/intersect, plane/object split and reusable negative objects.
- Exact native cube/cylinder/sphere solids, native fillet/chamfer and planar offset.
- Approximate STL fillet/chamfer on a single straight convex edge between
  perpendicular planar patches; mesh planar-region offset.
- Section view, wireframe, distance/angle/radius measurement, mesh diagnostics,
  explicit T-junction repair, simplification and subdivision.
- Preview / Apply / Cancel, undo/redo, editable numerical history and suppression.
- `.meproj` project save/load, IndexedDB recovery, and transformed binary STL export.

Choose a target and tool for subtraction. A negative body is a reusable cutter;
marking it negative does not silently cut every other object. Remove material by
subtracting a volume rather than deleting selected triangles. Delete in the tree
removes a whole body. Original geometry and tool bodies remain available in history.

STL triangles are not CAD faces. Native solids retain B-Rep topology; a mixed
STL/native Boolean produces a mesh. Mesh radius measurements are approximate;
CAD circular edges report their analytic radius. STEP import/export is deferred.

## Navigation

| Input                           | Action                               |
| ------------------------------- | ------------------------------------ |
| Right drag                      | Orbit                                |
| Middle drag / Ctrl + right drag | Pan                                  |
| Wheel                           | Zoom                                 |
| F / double middle click         | Fit visible bodies                   |
| Ctrl-click                      | Add to selection                     |
| Shift-click / Shift + brush     | Remove / erase selection             |
| Ctrl/Cmd + Z                    | Undo                                 |
| Ctrl/Cmd + Shift + Z            | Redo                                 |
| Ctrl/Cmd + S                    | Save project                         |
| Escape                          | Close tool / cancel running geometry |

Use the View tab for orthographic/perspective, named views, wireframe and section.
Dimensions default to millimetres, with Z up. A project preserves geometry,
transforms, selection, history and cutter roles; STL exports the final triangles.

See [architecture and limits](docs/ARCHITECTURE.md) and
[upstream provenance](src/vendor/bumpmesh/PROVENANCE.md).

## License

AGPL-3.0-only. Retains CNC Kitchen's source copyright and license notices.
See [LICENSE](LICENSE) and [third-party notices](docs/THIRD_PARTY.md).
