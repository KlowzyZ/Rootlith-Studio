import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
await mkdir("dist-electron", { recursive: true });
await build({
  entryPoints: ["apps/desktop/main.ts"],
  outfile: "dist-electron/main.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  define: { "import.meta.url": "__import_meta_url" },
  banner: {
    js: 'const __import_meta_url = require("node:url").pathToFileURL(__filename).href;',
  },
});
await copyFile("apps/desktop/preload.cjs", "dist-electron/preload.cjs");
