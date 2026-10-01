import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync } from "node:fs";
const kernel = process.env.ME_OC_BUILD;
if (kernel && (!existsSync(kernel + ".js") || !existsSync(kernel + ".wasm")))
  throw new Error("ME_OC_BUILD requires matching .js and .wasm assets.");
export default defineConfig({
  base: process.env.ME_BASE_PATH || "/",
  resolve: {
    alias: kernel
      ? {
          "opencascade.js/dist/opencascade.full.js": kernel + ".js",
          "opencascade.js/dist/opencascade.full.wasm": kernel + ".wasm",
        }
      : {},
  },
  plugins: [react()],
  worker: { format: "es" },
  optimizeDeps: { exclude: ["opencascade.js", "manifold-3d"] },
  server: { host: "0.0.0.0" },
  build: { chunkSizeWarningLimit: 1500 },
});
