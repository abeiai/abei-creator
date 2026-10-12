import { z } from "zod";
import { bookSchema, albumSchema } from "./schemas.mjs";
import { syncManifest, uploadFile, describeFile } from "./media.mjs";
const empty = z.strictObject({}),
  id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  identified = z.strictObject({ id });
export function localTools(client) {
  const definitions = [];
  const add = (name, description, schema, read, run) =>
    definitions.push({ name, description, schema, read, run });
  add(
    "creator_login_start",
    "开始设备授权；返回浏览器地址和用户码，默认只申请读取和保存。用户已要求投稿时可包含creator:submit",
    z.strictObject({
      scopes: z
        .array(z.enum(["creator:read", "creator:write", "creator:submit"]))
        .min(1)
        .optional(),
    }),
    false,
    (a, s) => client.loginStart(a.scopes, s),
  );
  add(
    "creator_login_poll",
    "在提示间隔后检查设备授权；跨进程重启恢复",
    empty,
    false,
    (_, s) => client.loginPoll(s),
  );
  add(
    "creator_auth_status",
    "查看本入口本地授权状态，不请求网络或刷新",
    empty,
    true,
    () => client.status(),
  );
  add("creator_logout", "撤销本入口授权并清理本地凭证", empty, false, (_, s) =>
    client.logout(s),
  );
  for (const [name, path, description] of [
    ["capabilities", "/capabilities", "查询服务能力和版本"],
    ["account", "/account", "查看当前创作账号"],
    ["books_list", "/books", "列出本账号客户端同步绘本，最多100本"],
    ["albums_list", "/albums", "列出本账号客户端同步专辑，最多100个"],
  ])
    add(`creator_${name}`, description, empty, true, (_, s) =>
      client.api(path, "GET", undefined, "creator:read", s),
    );
  for (const [kind, plural, schema] of [
    ["book", "books", bookSchema],
    ["album", "albums", albumSchema],
  ]) {
    add(
      `creator_${kind}_get`,
      "读取已同步作品的当前版本与审核状态",
      identified,
      true,
      (a, s) =>
        client.api(`/${plural}/${a.id}`, "GET", undefined, "creator:read", s),
    );
    add(
      `creator_${kind}_validate`,
      "验证当前作品完整性",
      identified,
      true,
      (a, s) =>
        client.api(
          `/${plural}/${a.id}/validate`,
          "POST",
          {},
          "creator:read",
          s,
        ),
    );
    add(
      `creator_${kind}_save`,
      "保存作品，不投稿；409时读取新版本并核对，不自动覆盖",
      schema,
      false,
      (a, s) => client.api(`/${plural}`, "POST", a, "creator:write", s),
    );
    add(
      `creator_${kind}_submit`,
      "显式投稿指定版本，仅在用户任务已包含投稿时使用",
      z.strictObject({
        id,
        expectedVersion: z.number().int().min(0).max(2147483647),
      }),
      false,
      (a, s) =>
        client.api(
          `/${plural}/${a.id}/submit`,
          "POST",
          { expectedVersion: a.expectedVersion },
          "creator:submit",
          s,
        ),
    );
  }
  add(
    "creator_local_describe",
    "只读取用户明确指定的一个本地素材，返回大小及SHA256，不输出媒体内容",
    z.strictObject({ path: z.string().min(1) }),
    true,
    (a) => describeFile(a.path),
  );
  add(
    "creator_local_upload",
    "上传用户明确指定的一个本地素材。需要本入口API授权；原生远程MCP窄上传应使用transfer命令，不能把capability粘到对话",
    z.strictObject({
      path: z.string().min(1),
      externalId: z.string().min(1).max(120),
      kind: z.enum(["IMAGE", "AUDIO"]),
      mimeType: z.enum([
        "image/png",
        "image/jpeg",
        "image/webp",
        "audio/mpeg",
        "audio/wav",
        "audio/mp4",
        "audio/ogg",
      ]),
    }),
    false,
    (a, s) => uploadFile(client, a.path, { ...a, signal: s }),
  );
  add(
    "creator_local_sync",
    "只同步用户选定项目目录中指定清单及其显式引用素材；不会扫描目录，也不会投稿",
    z.strictObject({
      projectRoot: z.string().min(1),
      manifestPath: z.string().min(1),
    }),
    false,
    (a, s) => syncManifest(client, a.projectRoot, a.manifestPath, s),
  );
  return definitions;
}
export async function invokeTool(definition, args, signal) {
  signal?.throwIfAborted();
  const parsed = definition.schema.safeParse(args);
  if (!parsed.success) throw Error("工具参数格式错误");
  return definition.run(parsed.data, signal);
}
