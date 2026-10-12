import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { apply } from "../src/deepseek.mjs";
test("official SDK initializes stdio helper; stdout is only protocol, status and malformed arguments work", async () => {
  const dir = await mkdtemp(join(tmpdir(), "abei-stdio-"));
  const client = new Client({ name: "test", version: "1" });
  let errors = "";
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("src/cli.mjs"), "stdio", "--profile", "claude-desktop"],
    env: { ...process.env, ABEI_CREATOR_STATE_DIR: dir },
    stderr: "pipe",
  });
  transport.stderr?.on("data", (b) => (errors += b));
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 19);
    const status = await client.callTool({
      name: "creator_auth_status",
      arguments: {},
    });
    assert.equal(status.structuredContent.result.profile, "claude-desktop");
    assert.equal(status.structuredContent.result.authenticated, false);
    const invalid = await client.callTool({
      name: "creator_local_sync",
      arguments: { projectRoot: 4 },
    });
    assert.equal(invalid.isError, true);
    const missing = await client.callTool({name: "creator_local_sync", arguments: {projectRoot: dir, manifestPath: "missing-private-manifest.json"}});
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /文件不存在/);
    assert.doesNotMatch(JSON.stringify(missing), /ENOENT|missing-private-manifest|abei-stdio-|stack/);
    const unauthenticated = await client.callTool({name: "creator_books_list", arguments: {}});
    assert.equal(unauthenticated.isError, true);
    assert.equal(unauthenticated.structuredContent.error.status, 401);
    assert.equal(unauthenticated.structuredContent.error.code, "request_failed");
    assert.match(unauthenticated.content[0].text, /请先授权登录/);
    assert.equal(errors, "");
  } finally {
    await client.close();
    await rm(dir, { force: true, recursive: true });
  }
});
test("DeepSeek adapter uses pinned registry contracts, JSON output and cancellation", async () => {
  const tools = [],
    providers = [];
  apply({
    tools: { register: (t) => tools.push(t) },
    skills: { registerProvider: (p) => providers.push(p()) },
  });
  assert.equal(tools.length, 19);
  assert.equal((await providers[0].list()).length, 1);
  const t = tools.find((t) => t.name === "creator_auth_status");
  assert.equal(typeof t.output.render, "function");
  assert.equal(t.parameters.type, "object");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(t.execute({}, { signal: controller.signal }));
  assert.deepEqual(t.output.render({}, { result: { ok: true } }), [
    { type: "text", text: '{"result":{"ok":true}}' },
  ]);
});
