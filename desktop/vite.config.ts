import tailwindcss from "@tailwindcss/postcss";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const rendererDir = fileURLToPath(new URL("./renderer", import.meta.url));

// Independent build config for the desktop renderer. The web (vinext) build
// keeps using the root vite.config.ts; the two never share a pipeline.
export default defineConfig({
  root: rendererDir,
  base: "/",
  plugins: [react()],
  css: {
    postcss: { plugins: [tailwindcss()] },
  },
  build: {
    outDir: "../dist/renderer",
    emptyOutDir: true,
    target: "chrome130",
    sourcemap: false,
  },
});
