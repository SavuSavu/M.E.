# Reduced CAD kernel packaging

The application uses the tested, pinned npm WASM build by default. This recipe
is a starting configuration for OpenCascade.js's documented custom-build tool.
It has not been compiled in this workspace and is not the shipped kernel.

Use the build tooling from `opencascade.js@2.0.0-beta.b5ff984` with this YAML.
The builder must include inherited API bindings, handle types and associated
value types. Generated API names must match `src/geometry/cad.ts`.

When the build produces `me-kernel.js` and `me-kernel.wasm`, place them together
in a local directory and use:

```sh
ME_OC_BUILD=/absolute/path/to/me-kernel npm run build
ME_OC_BUILD=/absolute/path/to/me-kernel npm run test:e2e
```

The Vite config switches both imports together. Run the full kernel tests before
shipping the alternative asset. The full package build remains the fallback if
a required binding is absent. STEP reader/writer bindings are intentionally
excluded from this STL-only release.
