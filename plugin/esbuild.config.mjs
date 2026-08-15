import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import esbuild from "esbuild";

const production = process.argv[2] === "production";
const outputDirectory = resolve(import.meta.dirname, "../.obsidian/plugins/obsidian-codex-cli");

mkdirSync(outputDirectory, { recursive: true });

await esbuild.build({
  entryPoints: [resolve(import.meta.dirname, "src/main.ts")],
  bundle: true,
  format: "cjs",
  external: ["obsidian"],
  platform: "node",
  target: "node18",
  sourcemap: production ? false : "inline",
  outfile: resolve(outputDirectory, "main.js")
});

for (const fileName of ["manifest.json", "styles.css"]) {
  const destination = resolve(outputDirectory, fileName);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(resolve(import.meta.dirname, fileName), destination);
}
