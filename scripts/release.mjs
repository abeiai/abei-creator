import { execFileSync } from "node:child_process";
import { mkdir, cp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
const version = "0.1.1",
  root = process.cwd(),
  release = resolve("release"),
  stage = join(release, "staging");
await mkdir(release, { recursive: true });
await rm(stage, { recursive: true, force: true });
await mkdir(stage);
execFileSync(process.execPath, ["scripts/build.mjs"], { stdio: "inherit" });
execFileSync(process.execPath, ["scripts/notices.mjs"], { stdio: "inherit" });
const run = (cmd, args, cwd = root) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
async function common(dir) {
  await mkdir(dir, { recursive: true });
  for (const file of [
    "skills",
    "schemas",
    "LICENSE",
    "README.md",
    "THIRD-PARTY-NOTICES.txt",
  ])
    await cp(file, join(dir, file), { recursive: true });
}
for (const adapter of [
  "codex",
  "claude-code",
  "claude-cowork",
  "claude-desktop",
  "workbuddy",
  "deepseek",
  "doubao-work",
]) {
  const dir = join(stage, adapter);
  await common(dir);
  await cp(`adapters/${adapter}`, dir, { recursive: true });
  if (adapter === "claude-desktop") {
    await mkdir(join(dir, "server"));
    await cp("dist/cli.mjs", join(dir, "server/cli.mjs"));
  }
  if (adapter === "deepseek") {
    await mkdir(join(dir, "dist"));
    await cp("dist/deepseek.mjs", join(dir, "dist/deepseek.mjs"));
  }
  const filename =
    adapter === "claude-desktop"
      ? `abei-creator-desktop-${version}.mcpb`
      : `abei-creator-${adapter}-${version}.zip`;
  await rm(join(release, filename), { force: true });
  let archiveRoot = dir;
  if (adapter === "codex") {
    archiveRoot = join(stage, "codex-marketplace");
    await cp("adapters/codex-marketplace", archiveRoot, { recursive: true });
    await mkdir(join(archiveRoot, "plugins"));
    await cp(dir, join(archiveRoot, "plugins/abei-creator"), {
      recursive: true,
    });
  }
  run("zip", ["-qr", join(release, filename), "."], archiveRoot);
}
// Node tarball contains prebundled executable with no registry/workspace dependencies.
const nodeDir = join(stage, "node");
await common(nodeDir);
await mkdir(join(nodeDir, "dist"));
await cp("dist/cli.mjs", join(nodeDir, "dist/cli.mjs"));
await writeFile(
  join(nodeDir, "package.json"),
  JSON.stringify(
    {
      name: "@abeiai/creator",
      version,
      type: "module",
      license: "MIT",
      bin: { "abei-creator": "dist/cli.mjs" },
      files: [
        "dist",
        "skills",
        "schemas",
        "LICENSE",
        "README.md",
        "THIRD-PARTY-NOTICES.txt",
      ],
      engines: { node: ">=20" },
    },
    null,
    2,
  ),
);
run(
  "npm",
  ["pack", "--ignore-scripts", "--pack-destination", release],
  nodeDir,
);
// Public source export: explicit allowlist, never a recursive private-repository copy.
const source = join(stage, "source");
await common(source);
for (const file of [
  "src",
  "scripts",
  "tests",
  "adapters",
  "package.json",
  "package-lock.json",
  "plugin.json",
  "mcp.json",
  ".gitignore",
])
  await cp(file, join(source, file), { recursive: true });
await rm(join(release, `abei-creator-source-${version}.zip`), { force: true });
run(
  "zip",
  ["-qr", join(release, `abei-creator-source-${version}.zip`), "."],
  source,
);
const hostPlatform =
  process.platform === "win32" ? "windows" : process.platform;
const hostArch = process.arch === "arm64" ? "aarch64" : process.arch;
const bun = resolve(
  `node_modules/@oven/bun-${hostPlatform}-${hostArch}/bin/bun${process.platform === "win32" ? ".exe" : ""}`,
);
for (const target of [
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "linux-arm64",
  "windows-x64",
])
  run(bun, [
    "build",
    "src/cli.mjs",
    "--compile",
    `--target=bun-${target}`,
    `--outfile=${join(release, `abei-creator-${target}${target.startsWith("windows") ? ".exe" : ""}`)}`,
  ]);
const files = (await readdir(release))
  .filter((f) => f !== "staging" && f !== "SHA256SUMS")
  .sort();
let sums = "";
for (const file of files)
  sums += `${createHash("sha256")
    .update(await readFile(join(release, file)))
    .digest("hex")}  ${file}\n`;
await writeFile(join(release, "SHA256SUMS"), sums);
process.stdout.write(`构建完成：${files.length}个分发文件；SHA256SUMS\n`);
