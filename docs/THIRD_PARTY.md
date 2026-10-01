# Third-party notices

M.E. uses the following open-source projects. Distributed JavaScript retains
upstream copyright comments where present. Package licenses are included in
npm dependencies; see each linked upstream license for complete terms.

| Project                                                                            | License                 | Use                                                   |
| ---------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------- |
| [BumpMesh](https://github.com/CNCKitchen/stlTexturizer/blob/main/LICENSE)          | AGPL-3.0-only           | Mesh selection, processing, diagnostics, section view |
| [Three.js](https://github.com/mrdoob/three.js/blob/dev/LICENSE)                    | MIT                     | Rendering, controls, STL parsing                      |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh/blob/master/LICENSE)  | MIT                     | Accelerated picking                                   |
| [Manifold](https://github.com/elalish/manifold/blob/master/LICENSE)                | Apache-2.0              | Mesh solid operations                                 |
| [OpenCascade.js](https://github.com/donalffons/opencascade.js/blob/master/LICENSE) | LGPL-2.1-only           | Native CAD kernel                                     |
| [Open CASCADE Technology](https://dev.opencascade.org/resources/licensing)         | LGPL-2.1 with exception | CAD algorithms inside WASM                            |
| React, Zustand, fflate, Lucide                                                     | MIT                     | UI, state, ZIP, recovery, icons                       |
| [idb-keyval](https://github.com/jakearchibald/idb-keyval/blob/main/LICENCE)        | Apache-2.0              | Local recovery                                        |
| DM Sans, IBM Plex Mono                                                             | SIL OFL-1.1             | Bundled fonts                                         |

The OpenCascade WASM asset remains a separate dynamically loaded file. Its
corresponding source and build tooling are available from the pinned
`opencascade.js@2.0.0-beta.b5ff984` upstream and OCCT source distribution. The
repository includes the configuration for a reduced kernel build.
