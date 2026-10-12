import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
test("native standalone helper exists and runs without external Node", () => {
  const path = resolve(`release/abei-creator-darwin-arm64`);
  assert.ok(existsSync(path), "standalone artifact missing");
  assert.equal(
    execFileSync(path, ["--version"], {
      env: { PATH: "/usr/bin:/bin" },
      encoding: "utf8",
    }).trim(),
    "0.1.0",
  );
});
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workbuddyLocal } from "../src/adapter.mjs";
test("standalone binary and bundled Node distribution speak real SDK stdio; WorkBuddy uses local artifact", async () => {
  const home = await mkdtemp(join(tmpdir(), "abei-artifact-"));
  try {
    for (const [command, args] of [
      [
        resolve("release/abei-creator-darwin-arm64"),
        ["stdio", "--profile", "codex-local"],
      ],
      [
        process.execPath,
        [
          resolve("release/staging/claude-desktop/server/cli.mjs"),
          "stdio",
          "--profile",
          "claude-desktop",
        ],
      ],
    ]) {
      const client = new Client({ name: "artifact-test", version: "1" });
      const transport = new StdioClientTransport({
        command,
        args,
        env: { PATH: "/usr/bin:/bin", ABEI_CREATOR_STATE_DIR: home },
        stderr: "pipe",
      });
      try {
        await client.connect(transport);
        assert.equal((await client.listTools()).tools.length, 19);
        assert.equal(
          (
            await client.callTool({
              name: "creator_auth_status",
              arguments: {},
            })
          ).structuredContent.result.authenticated,
          false,
        );
      } finally {
        await client.close();
      }
    }
    const result = await workbuddyLocal(
      resolve("release/abeiai-creator-0.1.0.tgz"),
      join(home, "config"),
    );
    const config = JSON.parse(await readFile(result.config, "utf8"));
    const mcp = config.mcpServers["abei-creator-local"];
    assert.equal(mcp.runtime.type, "node");
    assert.ok(existsSync(mcp.args[2]));
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});
test("release archives contain only public allowlisted files; Cowork has no root bin and DeepSeek no workspace dependencies", () => {
  for (const name of [
    "codex",
    "claude-code",
    "claude-cowork",
    "deepseek",
    "source",
  ]) {
    const entries = execFileSync(
      "unzip",
      ["-Z1", `release/abei-creator-${name}-0.1.0.zip`],
      { encoding: "utf8" },
    );
    assert.doesNotMatch(
      entries,
      /(^|\n)(\.env|\.git\/|apps\/|packages\/|\.superpowers\/|private-data\/|node_modules\/)/,
    );
    if (name === "claude-cowork") assert.doesNotMatch(entries, /(^|\n)bin\//);
  }
  const packageText = execFileSync(
    "unzip",
    ["-p", "release/abei-creator-deepseek-0.1.0.zip", "package.json"],
    { encoding: "utf8" },
  );
  assert.doesNotMatch(packageText, /workspace:/);
});
