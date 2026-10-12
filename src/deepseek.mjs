import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { CreatorClient } from "./client.mjs";
import { localTools, invokeTool } from "./tools.mjs";
export const name = "abei-creator";
export const inject = ["tools", "skills"];
export function apply(ctx) {
  const client = new CreatorClient({ profile: "deepseek" });
  const resourceBase = {
    kind: "directory",
    path: fileURLToPath(new URL("../skills/abei-creator/", import.meta.url)),
  };
  const candidate = {
    name: "abei-creator",
    description: "创作、修订和同步原创绘本及专辑，按用户任务显式投稿",
    invocation: { modelInvocable: true, userInvocable: true },
    source: "bundled",
    provider: "abei-creator",
    rank: 600,
    resourceBase,
  };
  ctx.skills.registerProvider(() => ({
    name: "abei-creator",
    list: async () => [candidate],
    get: async (_, options) => ({
      ...candidate,
      content: await readFile(
        new URL("../skills/abei-creator/SKILL.md", import.meta.url),
        { encoding: "utf8", signal: options.signal },
      ),
    }),
  }));
  for (const t of localTools(client)) {
    const { $schema, ...parameters } = z.toJSONSchema(t.schema);
    ctx.tools.register({
      name: t.name,
      description: t.description,
      parameters,
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_, value) => [{ type: "text", text: JSON.stringify(value) }],
      },
      execute: async (args, exec) => ({
        result: await invokeTool(t, args, exec.signal),
      }),
    });
  }
}
