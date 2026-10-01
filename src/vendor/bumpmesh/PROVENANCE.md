# BumpMesh source provenance

Source: https://github.com/CNCKitchen/stlTexturizer
Pinned commit: ee02c390484d7d47c9023470380cba9a58f88299
Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors.
License: AGPL-3.0-only, preserved in each source file and the root LICENSE.

The modules in this directory were copied unchanged except threeCompat.js, which
uses a static local Three.js import for Vite rather than a runtime CDN fallback.
exclusion.js also accepts an optional vertexEstimate allocation hint; its growing
hash map and all adjacency/dihedral behavior remain unchanged. M.E. adapters live outside
this directory. Selection uses exclusion, paintTree and meshIndex; diagnostics,
mesh repair, subdivision and decimation remain upstream algorithms. SectionController
is adapted through its host interface. The editor viewport adopts BumpMesh's
render-on-demand, overlay, projection and clipping approach, with new multi-body
state and persistent transforms rather than BumpMesh's single-model globals.
STL parsing uses the same Three.js STLLoader as BumpMesh, with editor-specific
validation and no import centering. No texture assets are distributed.
