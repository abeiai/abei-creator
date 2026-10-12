import { homedir } from "node:os";
import { join } from "node:path";
import { PrivateStore } from "./store.mjs";
export const API_RESOURCE = "https://mcp.abeiai.com/api/creator/v1";
export const SCOPES = ["creator:read", "creator:write", "creator:submit"];
const names = {
  "codex-local": "Codex 本地创作助手",
  "claude-desktop": "Claude Desktop 创作助手",
  "claude-code": "Claude Code 创作助手",
  workbuddy: "WorkBuddy 创作助手",
  deepseek: "DeepSeek Harness 创作助手",
  cli: "阿贝创作命令行",
};
export class CreatorError extends Error {
  constructor(message, status = 0, code = "request_failed") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export class CreatorClient {
  constructor({
    profile = "cli",
    stateDir = process.env.ABEI_CREATOR_STATE_DIR ??
      join(homedir(), ".abei-creator"),
    origin = "https://mcp.abeiai.com",
    allowLocalTest = false,
    fetch = globalThis.fetch,
  } = {}) {
    const url = new URL(origin);
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      !(
        url.protocol === "https:" ||
        (allowLocalTest &&
          url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
          Number(url.port) >= 3600 &&
          Number(url.port) <= 3680)
      )
    )
      throw Error("服务器地址必须为HTTPS源，测试仅允许显式本机3600–3680端口");
    this.origin = origin;
    this.profile = profile;
    this.store = new PrivateStore(stateDir, profile);
    this.fetch = fetch;
    this.clientName = names[profile] ?? `阿贝创作助手 ${profile}`;
  }
  async request(path, method = "GET", body, headers = {}, signal) {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\"))
      throw new CreatorError("不允许跨源请求");
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin) throw new CreatorError("不允许跨源请求");
    let response;
    try {
      response = await this.fetch(url.href, {
        method,
        redirect: "error",
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000),
      });
    } catch (e) {
      if (signal?.aborted) throw signal.reason;
      throw new CreatorError(
        "网络请求失败，可查询进度后重试",
        0,
        "network_error",
      );
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new CreatorError("服务响应格式错误", response.status);
    }
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new CreatorError("服务响应格式错误", response.status);
    if (!response.ok || data.error || ("code" in data && data.code !== 0)) {
      const status = response.status;
      const code =
        typeof data.error === "string" ? data.error : "request_failed";
      const message =
        status === 409
          ? "作品或素材版本冲突，请读取当前版本后核对"
          : status === 401 || code === "invalid_grant"
            ? "授权已失效，请重新授权"
            : status === 403
              ? "当前授权范围不足，请明确重新授权"
              : status === 429
                ? "请求过于频繁，请稍后重试"
                : status >= 500
                  ? "创作服务暂不可用，请查询进度后重试"
                  : "请求未完成，请检查输入或授权状态";
      throw new CreatorError(message, status, code);
    }
    return path.startsWith("/api/creator/v1") ? data.data : data;
  }
  async status() {
    const s = await this.store.read();
    return {
      profile: this.profile,
      authenticated: !!s.tokens,
      accessExpiresAt: s.tokens?.expiresAt ?? null,
      scopes: s.tokens?.scope?.split(" ") ?? [],
      pending: !!s.device,
    };
  }
  async loginStart(scopes = ["creator:read", "creator:write"], signal) {
    if (
      !Array.isArray(scopes) ||
      !scopes.length ||
      scopes.some((x) => !SCOPES.includes(x))
    )
      throw Error("授权范围无效");
    return this.store.lock(async () => {
      const s = await this.store.read();
      if (s.origin && s.origin !== this.origin)
        throw Error("已有授权属于其他服务器，请使用独立客户端标识");
      if (!s.clientId) {
        const r = await this.request(
          "/oauth/register",
          "POST",
          {
            client_name: this.clientName,
            redirect_uris: ["http://127.0.0.1:3606/callback"],
            token_endpoint_auth_method: "none",
          },
          {},
          signal,
        );
        s.clientId = r.client_id;
        s.origin = this.origin;
        await this.store.write(s);
      }
      const d = await this.request(
        "/oauth/device",
        "POST",
        {
          client_id: s.clientId,
          resource: API_RESOURCE,
          scope: [...new Set(scopes)].join(" "),
        },
        {},
        signal,
      );
      s.device = {
        ...d,
        expiresAt: Date.now() + d.expires_in * 1000,
        nextPollAt: 0,
      };
      await this.store.write(s);
      return {
        verification_uri: d.verification_uri,
        user_code: d.user_code,
        expires_in: d.expires_in,
        interval: d.interval,
      };
    }, signal);
  }
  async loginPoll(signal) {
    return this.store.lock(async () => {
      const s = await this.store.read(),
        d = s.device;
      if (s.origin !== this.origin) throw new CreatorError("授权服务器不匹配");
      if (!d) throw new CreatorError("没有待完成授权，请先开始登录");
      if (d.expiresAt <= Date.now()) {
        delete s.device;
        await this.store.write(s);
        throw new CreatorError("授权码已过期，请重新授权");
      }
      if (d.nextPollAt > Date.now())
        return {
          pending: true,
          retryAfter: Math.ceil((d.nextPollAt - Date.now()) / 1000),
        };
      d.nextPollAt = Date.now() + d.interval * 1000;
      await this.store.write(s);
      try {
        const t = await this.request(
          "/oauth/token",
          "POST",
          {
            client_id: s.clientId,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: d.device_code,
            resource: API_RESOURCE,
          },
          {},
          signal,
        );
        this.acceptTokens(s, t);
        delete s.device;
        await this.store.write(s);
        return { authenticated: true, scopes: t.scope.split(" ") };
      } catch (e) {
        if (["authorization_pending", "slow_down"].includes(e.code)) {
          if (e.code === "slow_down") {
            d.interval += 5;
            d.nextPollAt = Date.now() + d.interval * 1000;
            await this.store.write(s);
          }
          return { pending: true, retryAfter: d.interval };
        }
        if (
          ["expired_token", "access_denied", "invalid_grant"].includes(e.code)
        ) {
          delete s.device;
          await this.store.write(s);
        }
        throw e;
      }
    }, signal);
  }
  acceptTokens(s, t) {
    if (
      t.resource !== API_RESOURCE ||
      typeof t.access_token !== "string" ||
      typeof t.refresh_token !== "string" ||
      typeof t.scope !== "string" ||
      !Number.isFinite(t.expires_in)
    )
      throw new CreatorError("授权响应无效");
    s.tokens = { ...t, expiresAt: Date.now() + t.expires_in * 1000 };
  }
  async access(scope, signal) {
    return this.store.lock(async () => {
      const s = await this.store.read();
      if (!s.tokens) throw new CreatorError("请先授权登录", 401);
      if (s.origin !== this.origin) throw new CreatorError("授权服务器不匹配");
      if (scope && !s.tokens.scope.split(" ").includes(scope))
        throw new CreatorError("当前授权范围不足，请明确重新授权", 403);
      if (s.tokens.expiresAt <= Date.now() + 60000) {
        try {
          const t = await this.request(
            "/oauth/token",
            "POST",
            {
              client_id: s.clientId,
              grant_type: "refresh_token",
              refresh_token: s.tokens.refresh_token,
              resource: API_RESOURCE,
            },
            {},
            signal,
          );
          this.acceptTokens(s, t);
          await this.store.write(s);
        } catch (e) {
          if (e.code === "invalid_grant") {
            delete s.tokens;
            await this.store.write(s);
          }
          throw e;
        }
      }
      return s.tokens.access_token;
    }, signal);
  }
  async api(path, method = "GET", body, scope = "creator:read", signal) {
    if (
      !/^\/(?:capabilities|account|books|albums|assets)(?:\/[A-Za-z0-9_-]+)*(?:\/(?:validate|submit|chunks|complete))?$/.test(
        path,
      )
    )
      throw Error("API路径无效");
    const access = await this.access(scope, signal);
    return this.request(
      `/api/creator/v1${path}`,
      method,
      body,
      { authorization: `Bearer ${access}` },
      signal,
    );
  }
  async capability(id, secret, suffix = "", body, signal) {
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
      !/^[A-Za-z0-9_-]{43}$/.test(secret) ||
      !["", "/chunks", "/complete"].includes(suffix)
    )
      throw Error("上传会话无效");
    return this.request(
      `/api/creator/v1/assets/${id}${suffix}`,
      suffix ? "POST" : "GET",
      body,
      { "x-creator-upload-capability": secret },
      signal,
    );
  }
  async logout(signal) {
    return this.store.lock(async () => {
      const s = await this.store.read();
      if (s.origin && s.origin !== this.origin)
        throw new CreatorError("授权服务器不匹配");
      if (s.tokens) {
        await this.request(
          "/oauth/revoke",
          "POST",
          { client_id: s.clientId, token: s.tokens.refresh_token },
          {},
          signal,
        );
      }
      delete s.tokens;
      delete s.device;
      delete s.uploads;
      await this.store.write(s);
      return { authenticated: false };
    }, signal);
  }
}
