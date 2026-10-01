# Third-party notices

The M.E. application source is original MIT-licensed code. BumpMesh was analyzed as a reference; its AGPL source and assets are not distributed in this project.

Runtime components are installed through npm, pinned by `package-lock.json`, bundled by Vite, and served locally in the production site:

| Component | License | Source / notices |
| --- | --- | --- |
| Three.js | MIT | https://github.com/mrdoob/three.js · `public/licenses/three-MIT.txt` |
| Replicad | MIT | https://github.com/sgenoud/replicad · `public/licenses/replicad-MIT.txt` |
| replicad-opencascadejs | LGPL-2.1-only | https://github.com/sgenoud/replicad/tree/main/packages/replicad-opencascadejs · `public/licenses/replicad-opencascadejs-LGPL-2.1.txt` |
| OpenCascade Technology | LGPL-2.1 with additional exception | https://github.com/Open-Cascade-SAS/OCCT · `public/licenses/occt-LGPL-2.1.txt` and `occt-exception.txt` |
| opencascade.js binding generator | LGPL-2.1 | https://github.com/taucad/opencascade.js (build source pointer below) |
| Lucide | ISC | https://github.com/lucide-icons/lucide · `public/licenses/lucide-ISC.txt` (includes its additional icon notices) |
| DM Sans | SIL Open Font License 1.1 | https://github.com/googlefonts/dm-fonts · `public/licenses/dm-sans-OFL.txt` |
| Space Grotesk | SIL Open Font License 1.1 | https://github.com/floriankarsten/space-grotesk · `public/licenses/space-grotesk-OFL.txt` |

The unmodified `replicad-opencascadejs@1.1.0` package contains the separately loaded WASM asset. Its build configuration and generator reference are available at the Replicad source tree linked above (package gitHead `e4b05f67dc4e2393a876ce8c5064a9c93db05bf1`). The package identifies the binding generator as `ghcr.io/taucad/opencascade.js:canary-ebd263f1-single-threaded`; see https://github.com/taucad/opencascade.js. To rebuild or replace the kernel, follow that package's source build scripts, replace the npm package or its WASM, then run `npm run build`. The wrapper and WASM have not been modified by M.E.

These dependencies retain their own copyright and license terms. The application's MIT license does not replace them. Corresponding license files in `public/licenses/` are copied to `dist/licenses/` when building.
