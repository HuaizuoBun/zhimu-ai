// Bundles the desktop server surface for direct Node test imports.
// Node's type stripping needs explicit file extensions in import graphs,
// so tests import this ESM bundle instead of the TS sources.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");

await build({
  entryPoints: [path.join(desktopDir, "test-exports.ts")],
  outfile: path.join(desktopDir, "dist", "test", "wires.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: "inline",
  legalComments: "none",
});
console.log("[desktop-build] test bundle written to desktop/dist/test/wires.mjs");
