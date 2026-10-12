import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  readFile,
  writeFile,
  stat,
  symlink,
  mkdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CreatorClient } from "../src/client.mjs";
import { syncManifest, uploadFile } from "../src/media.mjs";
const response = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
async function setup() {
  const home = await mkdtemp(join(tmpdir(), "abei-helper-"));
  return {
    home,
    client: (options = {}) =>
      new CreatorClient({ profile: "test", stateDir: home, ...options }),
    clean: () => rm(home, { force: true, recursive: true }),
  };
}
test("device restart, private credentials, refresh persisted before API, profile isolation, revoke", async () => {
  const s = await setup();
  let refreshes = 0;
  const requests = [];
  const fetch = async (url, init) => {
    requests.push([url, init]);
    if (url.endsWith("/register"))
      return response({ client_id: "client-test" });
    if (url.endsWith("/device"))
      return response({
        device_code: "private-device",
        user_code: "PUBLIC",
        verification_uri: "https://new.abeiai.com/creator/device",
        expires_in: 600,
        interval: 5,
      });
    if (url.endsWith("/token")) {
      const body = JSON.parse(init.body);
      if (body.grant_type === "refresh_token") refreshes++;
      return response({
        access_token: refreshes ? "new-access" : "old-access",
        refresh_token: refreshes ? "new-refresh" : "old-refresh",
        expires_in: refreshes ? 900 : 0,
        scope: "creator:read creator:write",
        resource: "https://mcp.abeiai.com/api/creator/v1",
      });
    }
    if (url.endsWith("/revoke")) return response({});
    assert.equal(
      JSON.parse(await readFile(join(s.home, "test", "state.json"), "utf8"))
        .tokens.refresh_token,
      "new-refresh",
    );
    return response({ code: 0, data: { ok: true } });
  };
  try {
    let c = s.client({ fetch });
    const device = await c.loginStart(["creator:read", "creator:write"]);
    assert.equal(device.device_code, undefined);
    assert.equal(device.user_code, "PUBLIC");
    c = s.client({ fetch });
    await c.loginPoll();
    assert.equal(
      (await stat(join(s.home, "test", "state.json"))).mode & 0o777,
      0o600,
    );
    await Promise.all([c.api("/account"), c.api("/account")]);
    assert.equal(refreshes, 1);
    assert.equal(
      (
        await new CreatorClient({
          profile: "another",
          stateDir: s.home,
          fetch,
        }).status()
      ).authenticated,
      false,
    );
    await c.logout();
    assert.equal((await c.status()).authenticated, false);
    assert.ok(requests.some(([u]) => u.endsWith("/revoke")));
  } finally {
    await s.clean();
  }
});
test("network origin and redirects cannot leak credentials; scope expansion needs consent", async () => {
  const s = await setup();
  try {
    assert.throws(() => s.client({ origin: "http://evil.test" }));
    assert.throws(() => s.client({ origin: "https://evil.test/path" }));
    const c = s.client({
      fetch: async (u, i) => {
        assert.equal(i.redirect, "error");
        return response({ error: "invalid_grant" }, 400);
      },
    });
    await assert.rejects(c.request("https://evil.test", "POST", {}));
    await assert.rejects(c.api("/account"), /授权/);
  } finally {
    await s.clean();
  }
});
test("capability-only transfer recovers committed offset after lost reply without login and hides secret", async () => {
  const s = await setup();
  const file = join(s.home, "image.png");
  await writeFile(file, Buffer.from("abcdef"));
  let offset = 0,
    first = true;
  const caps = [];
  const c = s.client({
    fetch: async (url, init) => {
      assert.equal(init.headers.authorization, undefined);
      caps.push(init.headers["x-creator-upload-capability"]);
      if (url.endsWith("/chunks")) {
        const b = JSON.parse(init.body);
        if (first) {
          first = false;
          offset = b.offset + Buffer.from(b.data, "base64").length;
          throw new Error("lost");
        }
        offset = b.offset + Buffer.from(b.data, "base64").length;
      }
      return response({
        code: 0,
        data: {
          id: "asset1",
          offset,
          size: 6,
          sha256:
            "bef57ec7f53a6d40beb640a780a639c83bc29ac8a9816f1fc6c5c6dcd93c4721",
          status: url.endsWith("/complete") ? "COMPLETED" : "UPLOADING",
        },
      });
    },
  });
  try {
    const result = await uploadFile(c, file, {
      session: {
        id: "asset1",
        uploadCapability: "x".repeat(43),
        sha256:
          "bef57ec7f53a6d40beb640a780a639c83bc29ac8a9816f1fc6c5c6dcd93c4721",
        size: 6,
      },
    });
    assert.equal(result.status, "COMPLETED");
    assert.ok(caps.every((x) => x === "x".repeat(43)));
    assert.ok(!JSON.stringify(result).includes("x".repeat(43)));
  } finally {
    await s.clean();
  }
});
test("sync rejects traversal and symlink outside chosen root before network, and never auto-submits", async () => {
  const s = await setup();
  const root = join(s.home, "project");
  await mkdir(root);
  await writeFile(join(s.home, "secret.png"), "secret");
  await symlink(join(s.home, "secret.png"), join(root, "link.png"));
  let calls = 0;
  const c = s.client({
    fetch: async () => {
      calls++;
      throw Error("unexpected");
    },
  });
  try {
    for (const path of ["../secret.png", "link.png"]) {
      await writeFile(
        join(root, "book.json"),
        JSON.stringify({
          schemaVersion: 1,
          kind: "BOOK",
          work: {
            schemaVersion: 1,
            externalId: "b",
            expectedVersion: 0,
            title: "测试",
            style: "水彩",
            pageCount: 4,
            pages: [],
          },
          assets: { cover: { path, kind: "IMAGE", mimeType: "image/png" } },
          bindings: { coverAssetId: "cover" },
        }),
      );
      await assert.rejects(syncManifest(c, root, "book.json"), /目录/);
    }
    assert.equal(calls, 0);
  } finally {
    await s.clean();
  }
});
test("save retries preserve identity; 409 does not auto-update version or submit; expanded scope is denied", async () => {
  const s = await setup();
  const root = join(s.home, "project");
  await mkdir(root);
  const work = {
    schemaVersion: 1,
    externalId: "stable",
    expectedVersion: 0,
    title: "测试",
    style: "水彩",
    pageCount: 4,
    pages: [],
  };
  await writeFile(
    join(root, "book.json"),
    JSON.stringify({ schemaVersion: 1, kind: "BOOK", work }),
  );
  let bodies = [];
  const c = s.client({
    fetch: async (url, init) => {
      assert.ok(url.endsWith("/books"));
      bodies.push(JSON.parse(init.body));
      return bodies.length < 3
        ? response({
            code: 0,
            data: {
              id: "book1",
              version: 1,
              previewHref: "/picture-books/book1/play",
            },
          })
        : response({ code: 40901, message: "conflict" }, 409);
    },
  });
  try {
    await c.store.write({
      version: 1,
      origin: c.origin,
      clientId: "client",
      tokens: {
        access_token: "access",
        refresh_token: "refresh",
        scope: "creator:read creator:write",
        expiresAt: Date.now() + 900000,
      },
    });
    const one = await syncManifest(c, root, "book.json");
    assert.equal(one.submitted, false);
    assert.equal(one.nextExpectedVersion, 1);
    await syncManifest(c, root, "book.json");
    assert.deepEqual(bodies[0], bodies[1]);
    await assert.rejects(syncManifest(c, root, "book.json"), /冲突/);
    assert.equal(bodies.length, 3);
    await assert.rejects(
      c.api(
        "/books/book1/submit",
        "POST",
        { expectedVersion: 1 },
        "creator:submit",
      ),
      /重新授权/,
    );
    assert.equal(bodies.length, 3);
  } finally {
    await s.clean();
  }
});
test("invalid grant clears refresh state, denied revoke keeps state for retry, device polling respects interval", async () => {
  const s = await setup();
  const c = s.client({
    fetch: async (url) =>
      response(
        { error: url.endsWith("/revoke") ? "server_error" : "invalid_grant" },
        url.endsWith("/revoke") ? 503 : 400,
      ),
  });
  try {
    const state = {
      version: 1,
      origin: c.origin,
      clientId: "client",
      tokens: {
        access_token: "old",
        refresh_token: "refresh",
        scope: "creator:read",
        expiresAt: 0,
      },
    };
    await c.store.write(state);
    await assert.rejects(c.api("/account"), /重新授权/);
    assert.equal((await c.status()).authenticated, false);
    await c.store.write(state);
    await assert.rejects(c.logout());
    assert.equal((await c.status()).authenticated, true);
    state.device = {
      nextPollAt: Date.now() + 5000,
      expiresAt: Date.now() + 600000,
      interval: 5,
    };
    await c.store.write(state);
    assert.equal((await c.loginPoll()).pending, true);
  } finally {
    await s.clean();
  }
});
test("upload retries 503 zero progress, recovers finalize lost reply, and restart keeps private session", async () => {
  const s = await setup();
  const file = join(s.home, "file.png");
  await writeFile(file, "abcdef");
  const session = {
    id: "asset1",
    size: 6,
    sha256: "bef57ec7f53a6d40beb640a780a639c83bc29ac8a9816f1fc6c5c6dcd93c4721",
    uploadCapability: "y".repeat(43),
    capabilityExpiresAt: new Date(Date.now() + 900000).toISOString(),
  };
  let offset = 0,
    attempts = 0,
    completed = false;
  const c = s.client({
    fetch: async (url, init) => {
      if (url.endsWith("/chunks")) {
        if (++attempts === 1) return response({ code: 50301 }, 503);
        offset = 6;
      }
      if (url.endsWith("/complete")) {
        completed = true;
        throw Error("lost finalize");
      }
      return response({
        code: 0,
        data: {
          id: "asset1",
          size: 6,
          sha256: session.sha256,
          offset,
          status: completed ? "COMPLETED" : "UPLOADING",
        },
      });
    },
  });
  try {
    const result = await uploadFile(c, file, { session });
    assert.equal(result.status, "COMPLETED");
    assert.equal(attempts, 2);
    assert.deepEqual((await c.store.read()).uploads, {});
  } finally {
    await s.clean();
  }
});
test("credentials reject symlink and broad permissions; revoked capabilities do not trigger broad login", async () => {
  const s = await setup();
  try {
    const c = s.client();
    await c.store.write({ version: 1 });
    await import("node:fs/promises").then((fs) =>
      fs.chmod(join(s.home, "test", "state.json"), 0o644),
    );
    await assert.rejects(c.status(), /0600/);
    const f = join(s.home, "file.png");
    await writeFile(f, "abcdef");
    let urls = [];
    const denied = s.client({
      fetch: async (u) => {
        urls.push(u);
        return response({ code: 40101 }, 401);
      },
    });
    await import("node:fs/promises").then((fs) =>
      fs.chmod(join(s.home, "test", "state.json"), 0o600),
    );
    await assert.rejects(
      uploadFile(denied, f, {
        session: {
          id: "a",
          size: 6,
          sha256:
            "bef57ec7f53a6d40beb640a780a639c83bc29ac8a9816f1fc6c5c6dcd93c4721",
          uploadCapability: "z".repeat(43),
        },
      }),
      /重新授权/,
    );
    assert.equal(urls.length, 1);
    assert.ok(!urls[0].includes("/oauth/"));
  } finally {
    await s.clean();
  }
});
test("interrupted upload restarts from private stored capability without an API login", async () => {
  const s = await setup();
  const file = join(s.home, "retry.png");
  await writeFile(file, "abcdef");
  const session = {
    id: "resume1",
    size: 6,
    sha256: "bef57ec7f53a6d40beb640a780a639c83bc29ac8a9816f1fc6c5c6dcd93c4721",
    uploadCapability: "r".repeat(43),
    capabilityExpiresAt: new Date(Date.now() + 900000).toISOString(),
  };
  try {
    const first = s.client({
      fetch: async () => response({ code: 50301 }, 503),
    });
    await assert.rejects(
      uploadFile(first, file, { session, externalId: "restart" }),
    );
    assert.equal(Object.values((await first.store.read()).uploads).length, 1);
    let offset = 0;
    const second = s.client({
      fetch: async (url, init) => {
        assert.equal(init.headers.authorization, undefined);
        assert.ok(url.includes("/assets/resume1"));
        if (url.endsWith("/chunks")) offset = 6;
        return response({
          code: 0,
          data: {
            id: "resume1",
            offset,
            status: url.endsWith("/complete") ? "COMPLETED" : "UPLOADING",
          },
        });
      },
    });
    assert.equal(
      (await uploadFile(second, file, { externalId: "restart" })).status,
      "COMPLETED",
    );
    assert.equal((await second.status()).authenticated, false);
  } finally {
    await s.clean();
  }
});
test("changing configured origin never forwards stored refresh or device credentials", async () => {
  const s = await setup();
  let requests = 0;
  try {
    const original = s.client();
    await original.store.write({
      version: 1,
      origin: original.origin,
      clientId: "c",
      tokens: {
        access_token: "private",
        refresh_token: "private-refresh",
        scope: "creator:read",
        expiresAt: 0,
      },
      device: {
        device_code: "private-device",
        expiresAt: Date.now() + 60000,
        nextPollAt: 0,
        interval: 5,
      },
    });
    const other = s.client({
      origin: "https://other.example",
      fetch: async () => {
        requests++;
        return response({});
      },
    });
    await assert.rejects(other.logout(), /服务器/);
    await assert.rejects(other.loginPoll(), /服务器/);
    assert.equal(requests, 0);
  } finally {
    await s.clean();
  }
});

test("orphan contenders cannot remove a successor lock during delayed stale cleanup", async () => {
  const { default: fs } = await import("node:fs/promises");
  const { syncBuiltinESMExports } = await import("node:module");
  const { PrivateStore } = await import("../src/store.mjs");
  const { setTimeout: delay } = await import("node:timers/promises");
  const s = await setup();
  const store = new PrivateStore(s.home, "test");
  await store.prepare();
  const lock = join(store.dir, "lock");
  await mkdir(lock);
  await writeFile(join(lock, "owner"), JSON.stringify({ pid: 2147483647 }));
  const realRm = fs.rm,
    realUnlink = fs.unlink,
    realKill = process.kill;
  let observed = 0,
    removals = 0,
    active = 0,
    maximum = 0,
    entered = 0;
  let sawBoth, firstEntered, secondRemoved;
  const both = new Promise((r) => (sawBoth = r)),
    first = new Promise((r) => (firstEntered = r)),
    second = new Promise((r) => (secondRemoved = r));
  process.kill = function (pid, signal) {
    if (pid === 2147483647) {
      if (++observed === 2) sawBoth();
      throw Object.assign(Error("dead"), { code: "ESRCH" });
    }
    return realKill.call(process, pid, signal);
  };
  async function scheduledRemove(original, path, options) {
    // Original implementation removes shared directory; corrected implementation removes only observed owner.
    if (String(path) === lock || String(path) === join(lock, "owner")) {
      const index = ++removals;
      if (index === 1) await both;
      if (index === 2) await first;
      try {
        return await original(path, options);
      } finally {
        if (index === 2) secondRemoved();
      }
    }
    return original(path, options);
  }
  fs.rm = (path, options) => scheduledRemove(realRm, path, options);
  fs.unlink = (path) => scheduledRemove(realUnlink, path);
  syncBuiltinESMExports();
  const critical = async () => {
    active++;
    maximum = Math.max(maximum, active);
    if (++entered === 1) {
      firstEntered();
      await second;
      await delay(100);
    }
    active--;
  };
  try {
    await Promise.all([
      store.lock(critical),
      new PrivateStore(s.home, "test").lock(critical),
    ]);
    assert.equal(observed, 2);
    assert.equal(maximum, 1);
    assert.equal(entered, 2);
  } finally {
    fs.rm = realRm;
    fs.unlink = realUnlink;
    process.kill = realKill;
    syncBuiltinESMExports();
    await s.clean();
  }
});

test("ordinary cross-process contention serializes critical sections and releases only owned locks", async () => {
  const { spawn } = await import("node:child_process");
  const { pathToFileURL } = await import("node:url");
  const { resolve } = await import("node:path");
  const s = await setup();
  const code = `import {PrivateStore} from ${JSON.stringify(pathToFileURL(resolve("src/store.mjs")).href)};import {open,rm} from 'node:fs/promises';import {join} from 'node:path';import {setTimeout as delay} from 'node:timers/promises';const store=new PrivateStore(process.argv[1],'test');for(let i=0;i<4;i++)await store.lock(async()=>{const marker=join(store.dir,'critical');const f=await open(marker,'wx');try{const state=await store.read();await delay(10);await store.write({...state,count:(state.count??0)+1});}finally{await f.close();await rm(marker);}});`;
  try {
    await Promise.all(
      Array.from(
        { length: 3 },
        () =>
          new Promise((done, fail) => {
            const child = spawn(process.execPath, [
              "--input-type=module",
              "--eval",
              code,
              s.home,
            ]);
            let errors = "";
            child.stderr.on("data", (b) => (errors += b));
            child.on("error", fail);
            child.on("exit", (status) =>
              status === 0 ? done() : fail(Error(errors)),
            );
          }),
      ),
    );
    assert.equal(
      JSON.parse(await readFile(join(s.home, "test", "state.json"), "utf8"))
        .count,
      12,
    );
  } finally {
    await s.clean();
  }
});

async function mediaFixture() {
  const s = await setup();
  const root = join(s.home, "project");
  await mkdir(root);
  const assets = new Map(),
    attempted = [],
    saved = [];
  const c = s.client({
    fetch: async (url, init) => {
      if (url.endsWith("/assets")) {
        const body = JSON.parse(init.body);
        attempted.push(body);
        if (body.externalId.length > 120) return response({ code: 40001 }, 400);
        const existing = assets.get(body.externalId);
        if (
          existing &&
          ["sha256", "size", "kind", "mimeType"].some(
            (k) => existing[k] !== body[k],
          )
        )
          return response({ code: 40901 }, 409);
        const asset = existing ?? {
          ...body,
          id: `asset-${assets.size + 1}`,
          uploadCapability: "p".repeat(43),
          capabilityExpiresAt: new Date(Date.now() + 60000).toISOString(),
        };
        assets.set(body.externalId, asset);
        return response({ code: 0, data: asset });
      }
      if (url.includes("/assets/")) {
        const asset = [...assets.values()].find((a) =>
          url.endsWith("/" + a.id),
        );
        assert.ok(asset);
        return response({
          code: 0,
          data: { ...asset, offset: asset.size, status: "COMPLETED" },
        });
      }
      assert.ok(url.endsWith("/books"));
      const body = JSON.parse(init.body);
      saved.push(body);
      return response({
        code: 0,
        data: {
          id: "book-stable",
          version: body.expectedVersion + 1,
          coverAssetId: body.coverAssetId,
        },
      });
    },
  });
  await c.store.write({
    version: 1,
    origin: c.origin,
    clientId: "test-client",
    tokens: {
      access_token: "access",
      refresh_token: "refresh",
      scope: "creator:write",
      expiresAt: Date.now() + 900000,
    },
  });
  const manifest = {
    schemaVersion: 1,
    kind: "BOOK",
    work: {
      schemaVersion: 1,
      externalId: "story",
      expectedVersion: 0,
      title: "测试",
      style: "水彩",
      pageCount: 4,
      pages: [],
    },
    assets: {
      cover: { path: "cover.png", kind: "IMAGE", mimeType: "image/png" },
    },
    bindings: { coverAssetId: "cover" },
  };
  await writeFile(join(root, "cover.png"), "first-image");
  return {
    ...s,
    root,
    c,
    assets,
    attempted,
    saved,
    manifest,
    sync: async () => {
      await writeFile(join(root, "book.json"), JSON.stringify(manifest));
      return syncManifest(c, root, "book.json");
    },
  };
}
for (const workId of ["story", "w".repeat(120)])
  test(`generated media identities retry and revise with stable work identity (${workId.length} chars)`, async () => {
    const f = await mediaFixture();
    f.manifest.work.externalId = workId;
    try {
      const first = await f.sync();
      const retry = await f.sync();
      assert.deepEqual(retry, first);
      assert.equal(f.attempted[0].externalId, f.attempted[1].externalId);
      assert.equal(f.assets.size, 1);
      await writeFile(join(f.root, "cover.png"), "changed-image");
      f.manifest.work.expectedVersion = 1;
      const revised = await f.sync();
      assert.equal(revised.result.id, first.result.id);
      assert.equal(revised.result.version, 2);
      assert.notEqual(revised.result.coverAssetId, first.result.coverAssetId);
      assert.notEqual(f.attempted[2].sha256, f.attempted[0].sha256);
      assert.notEqual(f.attempted[2].externalId, f.attempted[0].externalId);
      // Immutable MIME metadata also versions an automatically assigned asset ID.
      f.manifest.assets.cover.mimeType = "image/jpeg";
      f.manifest.work.expectedVersion = 2;
      await f.sync();
      assert.notEqual(f.attempted[3].externalId, f.attempted[2].externalId);
      assert.ok(f.attempted.every((a) => a.externalId.length <= 120));
      assert.ok(f.saved.every((w) => w.externalId === workId));
      assert.equal(f.saved.length, 4);
    } finally {
      await f.clean();
    }
  });
test("explicit immutable asset identities still reject conflicting content", async () => {
  const f = await mediaFixture();
  f.manifest.assets.cover.externalId = "explicit-cover";
  try {
    await f.sync();
    await f.sync();
    await writeFile(join(f.root, "cover.png"), "changed-image");
    f.manifest.work.expectedVersion = 1;
    await assert.rejects(f.sync(), (e) => e.status === 409);
    assert.ok(f.attempted.every((a) => a.externalId === "explicit-cover"));
    assert.equal(f.saved.length, 2);
  } finally {
    await f.clean();
  }
});

test("private recovery cannot bypass explicit asset metadata conflicts", async () => {
  const f = await mediaFixture();
  f.manifest.assets.cover.externalId = "explicit-cover";
  const capability = f.c.capability.bind(f.c);
  f.c.capability = async () => {
    throw Error("test interruption before status");
  };
  try {
    await assert.rejects(f.sync(), /test interruption/);
    assert.equal(Object.keys((await f.c.store.read()).uploads).length, 1);
    f.c.capability = capability;
    f.manifest.assets.cover.mimeType = "image/jpeg";
    await assert.rejects(f.sync(), (e) => e.status === 409);
    assert.equal(f.saved.length, 0);
  } finally {
    await f.clean();
  }
});
