import { realpath, open, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { CreatorError } from "./client.mjs";
import { manifestSchema, bookSchema, albumSchema } from "./schemas.mjs";
const hash = (data) => createHash("sha256").update(data).digest("hex");
async function selectedFile(path, max = 26214400, root) {
  const file = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size <= 0 || before.size > max)
      throw Error("文件为空、过大或不是普通文件");
    if (root) {
      const resolved = await confined(root, relative(root, path));
      const current = await stat(resolved);
      if (current.dev !== before.dev || current.ino !== before.ino)
        throw Error("文件在目录校验期间被替换");
    }
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const part = await file.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!part.bytesRead) break;
      offset += part.bytesRead;
    }
    const after = await file.stat();
    if (
      offset !== bytes.length ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    )
      throw Error("文件在读取期间发生变化，请重试");
    return bytes;
  } finally {
    await file.close();
  }
}
async function confined(root, path) {
  if (typeof path !== "string" || isAbsolute(path))
    throw Error("文件必须位于用户选定项目目录内");
  const real = await realpath(resolve(root, path));
  const rel = relative(root, real);
  if (
    rel === ".." ||
    rel.startsWith(".." + (process.platform === "win32" ? "\\" : "/")) ||
    isAbsolute(rel)
  )
    throw Error("文件越出用户选定项目目录");
  return real;
}
export async function describeFile(path) {
  const bytes = await selectedFile(path);
  return { size: bytes.length, sha256: hash(bytes) };
}
export async function uploadFile(client, path, options = {}) {
  return uploadBytes(client, await selectedFile(path), options);
}
async function uploadBytes(
  client,
  bytes,
  { session, externalId, kind, mimeType, signal } = {},
) {
  const digest = hash(bytes);
  const key = hash(
    JSON.stringify([client.origin, digest, externalId ?? session?.id]),
  );
  // Recovery state lives only in the private credential directory, never in the artwork manifest.
  if (!session) {
    const state = await client.store.read();
    session = state.uploads?.[key];
    // A stored capability must not bypass immutable metadata checks when an
    // explicit identity is reused with a different media declaration.
    if (
      !session ||
      Date.parse(session.capabilityExpiresAt) <= Date.now() ||
      (kind && session.kind !== kind) ||
      (mimeType && session.mimeType !== mimeType)
    )
      session = await client.api(
        "/assets",
        "POST",
        {
          schemaVersion: 1,
          externalId,
          expectedVersion: 0,
          kind,
          mimeType,
          size: bytes.length,
          sha256: digest,
        },
        "creator:write",
        signal,
      );
  }
  if (session.sha256 !== digest || session.size !== bytes.length)
    throw Error("上传会话与本地文件哈希或大小不匹配");
  await client.store.lock(async () => {
    const s = await client.store.read();
    s.uploads ??= {};
    s.uploads[key] = session;
    await client.store.write(s);
  }, signal);
  const cap = (suffix = "", body) =>
    client.capability(
      session.id,
      session.uploadCapability,
      suffix,
      body,
      signal,
    );
  let progress = await cap();
  let retries = 0;
  while (progress.status !== "COMPLETED" && progress.offset < bytes.length) {
    signal?.throwIfAborted();
    if (
      !Number.isSafeInteger(progress.offset) ||
      progress.offset < 0 ||
      progress.offset > bytes.length
    )
      throw Error("上传进度无效");
    const offset = progress.offset;
    try {
      progress = await cap("/chunks", {
        offset,
        data: bytes.subarray(offset, offset + 1048576).toString("base64"),
      });
      if (progress.offset <= offset)
        throw new CreatorError("上传未取得进展", 503);
      retries = 0;
    } catch (e) {
      if (![0, 409, 503].includes(e.status) || ++retries > 3) throw e;
      progress = await cap();
    }
  }
  while (progress.status !== "COMPLETED") {
    try {
      progress = await cap("/complete", {});
      if (progress.status !== "COMPLETED")
        throw new CreatorError("素材尚未完成", 503);
    } catch (e) {
      if (![0, 409, 503].includes(e.status) || ++retries > 3) throw e;
      progress = await cap();
    }
  }
  await client.store.lock(async () => {
    const s = await client.store.read();
    delete s.uploads?.[key];
    await client.store.write(s);
  }, signal);
  const { uploadCapability, capabilityExpiresAt, ...safe } = progress;
  return safe;
}
export async function syncManifest(client, projectRoot, manifestPath, signal) {
  const root = await realpath(projectRoot);
  const path = await confined(root, manifestPath);
  const source = await selectedFile(path, 262144, root);
  let parsed;
  try {
    parsed = manifestSchema.parse(JSON.parse(source));
  } catch {
    throw Error("作品清单格式错误，请按schemaVersion 1填写");
  }
  const work = structuredClone(parsed.work);
  const schema = parsed.kind === "BOOK" ? bookSchema : albumSchema;
  // Resolve and read exactly referenced user-selected files BEFORE any network or credential actions.
  const check = structuredClone(work);
  for (const [field, name] of Object.entries(parsed.bindings ?? {})) {
    if (!parsed.assets?.[name]) throw Error("素材绑定名称不存在");
    if (field === "coverAssetId") check.coverAssetId = "pending";
    else {
      const m = /^pages\.(\d+)\.(imageAssetId|audioAssetId)$/.exec(field);
      if (!m || !check.pages?.[Number(m[1])]) throw Error("素材绑定位置无效");
      check.pages[Number(m[1])][m[2]] = "pending";
    }
  }
  if (!schema.safeParse(check).success)
    throw Error("作品内容不符合当前版本规范");
  const selected = {};
  for (const [name, asset] of Object.entries(parsed.assets ?? {})) {
    selected[name] = { ...asset, path: await confined(root, asset.path) };
    const info = await stat(selected[name].path);
    if (!info.isFile() || info.size <= 0 || info.size > 26214400)
      throw Error("素材大小无效");
  }
  const uploaded = {};
  for (const [name, asset] of Object.entries(selected)) {
    const bytes = await selectedFile(asset.path, 26214400, root);
    // Asset identities are immutable on the server. Version generated identities
    // by content and immutable metadata; keep the work identity stable on edits.
    const externalId =
      asset.externalId ??
      `asset-v1-${hash(
        JSON.stringify([
          parsed.kind,
          work.externalId.trim(),
          name,
          asset.kind,
          asset.mimeType,
          bytes.length,
          hash(bytes),
        ]),
      )}`;
    uploaded[name] = await uploadBytes(client, bytes, {
      externalId,
      kind: asset.kind,
      mimeType: asset.mimeType,
      signal,
    });
  }
  for (const [field, name] of Object.entries(parsed.bindings ?? {})) {
    if (!uploaded[name]) throw Error("素材绑定名称不存在");
    if (field === "coverAssetId") work.coverAssetId = uploaded[name].id;
    else {
      const match = /^pages\.(\d+)\.(imageAssetId|audioAssetId)$/.exec(field);
      if (!match || !work.pages?.[Number(match[1])])
        throw Error("素材绑定位置无效");
      work.pages[Number(match[1])][match[2]] = uploaded[name].id;
    }
  }
  const valid = schema.safeParse(work);
  if (!valid.success) throw Error("作品内容不符合当前版本规范");
  const result = await client.api(
    parsed.kind === "BOOK" ? "/books" : "/albums",
    "POST",
    valid.data,
    "creator:write",
    signal,
  );
  return {
    result,
    nextExpectedVersion: result.version,
    previewUrl: result.previewHref
      ? new URL(result.previewHref, "https://new.abeiai.com").href
      : null,
    submitted: false,
  };
}
