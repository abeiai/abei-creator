import { CreatorError } from "./client.mjs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { localTools, invokeTool } from "./tools.mjs";
export async function serveStdio(client) {
  const server = new McpServer({
    name: `abei-creator-${client.profile}`,
    version: "0.1.1",
  });
  for (const t of localTools(client))
    server.registerTool(
      t.name,
      {
        description: t.description,
        inputSchema: t.schema,
        annotations: {
          readOnlyHint: t.read,
          destructiveHint: !t.read,
          idempotentHint: !t.name.startsWith("creator_login"),
          openWorldHint: false,
        },
      },
      async (args, extra) => {
        try {
          const result = await invokeTool(t, args, extra.signal);
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: { result },
          };
        } catch (e) {
          const known = e instanceof CreatorError;
          const message = known ? e.message : ({
            ENOENT: "文件不存在，请检查所选文件", EACCES: "无法读取文件，请检查访问权限",
            EPERM: "无法读取文件，请检查访问权限", EISDIR: "请选择文件，不能选择目录",
            ENOTDIR: "文件目录无效，请重新选择", ENOSPC: "本地存储空间不足"
          }[e?.code] ?? "操作未完成，请检查输入后重试");
          return {
            isError: true,
            content: [{ type: "text", text: message }],
            ...(known ? { structuredContent: { error: { message, status: e.status, code: e.code } } } : {})
          };
        }
      },
    );
  await server.connect(new StdioServerTransport());
  return server;
}
