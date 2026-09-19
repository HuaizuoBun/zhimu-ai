// Desktop build pipeline (JavaScript, Windows-compatible):
// 1) esbuild bundles the Electron main + preload and the Node/Hono server.
// 2) Vite builds the renderer (original React UI) with its own config.
// 3) Static public assets are copied into the renderer output.
import { build } from "esbuild";
import { build as viteBuild } from "vite";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const rootDir = path.resolve(desktopDir, "..");
const distDir = path.join(desktopDir, "dist");

const electronTarget = "node22"; // matches Electron's bundled Node major version

await mkdir(path.join(distDir, "main"), { recursive: true });
await mkdir(path.join(distDir, "server"), { recursive: true });

async function bundle(entry, outfile, extra = {}) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    target: electronTarget,
    format: "cjs",
    sourcemap: false,
    legalComments: "none",
    ...extra,
  });
  console.log(`[desktop-build] bundled ${path.relative(rootDir, outfile)}`);
}

// Electron main + preload: "electron" stays external (provided by the runtime).
await bundle(path.join(desktopDir, "main.ts"), path.join(distDir, "main", "index.cjs"), { external: ["electron"] });
await bundle(path.join(desktopDir, "preload.ts"), path.join(distDir, "main", "preload.cjs"), { external: ["electron"] });

// Local server: fully bundled (hono included) so the app needs no node_modules.
await bundle(path.join(desktopDir, "server", "index.ts"), path.join(distDir, "server", "index.cjs"));

// Renderer: independent Vite build using desktop/vite.config.ts.
await viteBuild({ configFile: path.join(desktopDir, "vite.config.ts") });
console.log("[desktop-build] renderer built");

// Static assets referenced by index.html.
await copyFile(path.join(rootDir, "public", "favicon.svg"), path.join(distDir, "renderer", "favicon.svg"));

console.log("[desktop-build] done");
