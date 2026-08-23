import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(import.meta.dirname),
  cacheDir: resolve(import.meta.dirname, "../../node_modules/.vite/argus-trace"),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    fs: { allow: [resolve(import.meta.dirname, "../..")] }
  },
  build: {
    outDir: resolve(import.meta.dirname, "../../dist/argus-trace"),
    emptyOutDir: true,
    sourcemap: true
  }
});
