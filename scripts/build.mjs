import { build } from "esbuild";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { jsonSchemas } from "../src/schemas.mjs";
await mkdir("dist", { recursive: true });
await mkdir("schemas", { recursive: true });
for (const [name, schema] of Object.entries(jsonSchemas))
  await writeFile(
    `schemas/${name}.schema.json`,
    JSON.stringify(schema, null, 2) + "\n",
  );
await build({
  entryPoints: ["src/cli.mjs"],
  outfile: "dist/cli.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: {
    js: "import {createRequire as __createRequire} from 'node:module'; const require=__createRequire(import.meta.url);",
  },
});
await chmod("dist/cli.mjs", 0o755);
await build({
  entryPoints: ["src/deepseek.mjs"],
  outfile: "dist/deepseek.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: {
    js: "import {createRequire as __createRequire} from 'node:module'; const require=__createRequire(import.meta.url);",
  },
});
