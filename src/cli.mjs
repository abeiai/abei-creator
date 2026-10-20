#!/usr/bin/env node
import { workbuddyLocal } from "./adapter.mjs";
import { CreatorClient, CreatorError } from "./client.mjs";
import { serveStdio } from "./stdio.mjs";
import { uploadFile, describeFile, syncManifest } from "./media.mjs";
import { localTools, invokeTool } from "./tools.mjs";
import { setTimeout as delay } from "node:timers/promises";
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw Error(`参数${name}缺少值`);
  args.splice(index, 2);
  return value;
}
async function main() {
  const profile = option("--profile", "cli");
  const origin = option("--origin", "https://mcp.abeiai.com");
  const local = args.includes("--allow-local-test");
  if (local) args.splice(args.indexOf("--allow-local-test"), 1);
  const client = new CreatorClient({ profile, origin, allowLocalTest: local });
  const command = args.shift();
  if (command === "--version" || command === "version") {
    process.stdout.write("0.1.1\n");
    return;
  }
  if (command === "stdio") {
    await serveStdio(client);
    return;
  }
  let result;
  if (command === "adapter" && args.shift() === "workbuddy") {
    result = await workbuddyLocal(option("--archive"), option("--output"));
  } else if (command === "auth") {
    const operation = args.shift();
    if (operation === "status") result = await client.status();
    else if (operation === "logout") result = await client.logout();
    else if (operation === "poll") result = await client.loginPoll();
    else if (operation === "login") {
      const scopes = option("--scopes", "creator:read creator:write").split(
        " ",
      );
      const d = await client.loginStart(scopes);
      process.stderr.write(
        `请打开 ${d.verification_uri} 并输入 ${d.user_code}\n`,
      );
      if (args.includes("--wait")) {
        let p;
        do {
          await delay((p?.retryAfter ?? d.interval) * 1000);
          p = await client.loginPoll();
        } while (p.pending);
        result = p;
      } else result = { pending: true, interval: d.interval };
    } else throw Error("用法：auth login|poll|status|logout");
  } else if (command === "describe") result = await describeFile(args[0]);
  else if (command === "upload")
    result = await uploadFile(client, args[0], {
      externalId: option("--external-id"),
      kind: option("--kind"),
      mimeType: option("--mime"),
    });
  else if (command === "sync")
    result = await syncManifest(client, option("--project"), args[0]);
  else if (command === "transfer") {
    if (!args.includes("--session-stdin"))
      throw Error("窄上传会话仅通过--session-stdin私有输入接收");
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 8192) throw Error("会话数据过大");
    }
    result = await uploadFile(client, args[0], { session: JSON.parse(input) });
  } else if (command === "call") {
    const name = args.shift(),
      tool = localTools(client).find((t) => t.name === name);
    if (!tool) throw Error("工具不存在");
    result = await invokeTool(tool, JSON.parse(args[0] ?? "{}"));
  } else {
    process.stdout.write(
      "abei-creator 0.1.1\n命令：stdio | auth login|poll|status|logout | describe FILE | upload FILE --external-id ID --kind IMAGE|AUDIO --mime MIME | sync MANIFEST --project DIR | transfer FILE --session-stdin | call TOOL JSON\n入口：--profile cli|codex-local|claude-desktop|claude-code|workbuddy|deepseek\n",
    );
    return;
  }
  process.stdout.write(JSON.stringify(result) + "\n");
}
main().catch((error) => {
  process.stderr.write(
    error instanceof CreatorError
      ? JSON.stringify({ status: error.status, message: error.message }) + "\n"
      : "操作未完成。请检查命令参数、文件范围、网络及授权状态。\n",
  );
  process.exitCode = 1;
});
