import { realpath, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
export async function workbuddyLocal(archive, output) {
  const path = await realpath(archive);
  if (!path.endsWith(".tgz")) throw Error("请选择已下载的助手tgz安装包");
  const dir = resolve(output);
  await mkdir(dir, { recursive: true });
  const config = {
    mcpServers: {
      "abei-creator-local": {
        type: "stdio",
        command: "npx",
        args: [
          "--yes",
          "--package",
          path,
          "abei-creator",
          "stdio",
          "--profile",
          "workbuddy",
        ],
        runtime: { type: "node", version: "22" },
      },
    },
  };
  await writeFile(
    resolve(dir, "mcp.json"),
    JSON.stringify(config, null, 2) + "\n",
    { flag: "wx" },
  );
  return {
    config: resolve(dir, "mcp.json"),
    profile: "workbuddy",
    note: "在WorkBuddy自定义MCP中导入；宿主准备Node，无需用户安装运行时。",
  };
}
